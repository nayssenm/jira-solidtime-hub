"""
health_api.py  —  KPI Hub Project & Group Health Diagnostic System
===================================================================
Flask API that analyses dashboard_dataset.csv and returns structured
JSON diagnostics for every project (or a specific one).

Run:
    pip install flask pandas flask-cors
    python health_api.py

Endpoints:
    GET  /api/health                      → diagnose ALL projects
    GET  /api/health?project=WEB          → diagnose ONE project
    GET  /api/health?project=WEB&user=alice  → scoped to user
    GET  /api/projects                    → list available projects
    GET  /api/users                       → list available users
    GET  /api/health/summary              → global platform overview
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
import os, math

# ── Config ─────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
CSV_PATH    = os.path.join(BASE_DIR, "dashboard_dataset.csv")
PORT        = 5050          # avoids collision with common dev servers
DEBUG       = True

app = Flask(__name__)
CORS(app)  # allow requests from the HTML frontend served on any port


# ════════════════════════════════════════════════════════════════════════════
# DATA LAYER
# ════════════════════════════════════════════════════════════════════════════

def load_data() -> pd.DataFrame:
    """Load and minimally normalise dashboard_dataset.csv."""
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV not found: {CSV_PATH}")

    df = pd.read_csv(CSV_PATH, low_memory=False)

    # Normalise column names we rely on
    df["User"]           = df["User"].fillna("Unknown").str.strip().str.title()
    df["Project"]        = df["Project"].fillna("Unknown").str.strip().str.upper()
    df["duration_hours"] = pd.to_numeric(df.get("duration_hours", 0), errors="coerce").fillna(0)
    df["Status"]         = df.get("Status", pd.Series("other", index=df.index)).fillna("other").str.lower().str.strip().str.replace(" ", "_")
    df["Tags"]           = df.get("Tags", pd.Series("", index=df.index)).fillna("").str.lower()
    df["Issue_Type"]     = df.get("Issue Type", pd.Series("", index=df.index)).fillna("").str.lower()
    df["month_solid"]    = df.get("month_solid", pd.Series("", index=df.index)).fillna("")
    df["Task_key"]       = df.get("Task_key", pd.Series("", index=df.index)).fillna("")

    # Remove zero-duration entries
    df = df[df["duration_hours"] > 0].copy()
    return df


# ════════════════════════════════════════════════════════════════════════════
# SCORING ENGINE
# ════════════════════════════════════════════════════════════════════════════

# Weights (must sum to 100)
W_BALANCE       = 40   # workload balance across users
W_COVERAGE      = 30   # presence of testing/QA/documentation tasks
W_COLLABORATION = 30   # number of distinct contributors


def _score_balance(df_proj: pd.DataFrame) -> tuple[float, list[str], list[str]]:
    """
    Score workload balance (0-100).
    Deductions:
      - One user > 60% of total hours  → −30
      - One user > 70% of total hours  → −50
      - Any user far below average (< 15% of avg) → −10 per user (max −20)
    Returns: (sub_score_0_100, anomalies, insights)
    """
    anomalies, insights = [], []
    by_user = df_proj.groupby("User")["duration_hours"].sum()
    if by_user.empty:
        return 0.0, ["No data to analyse"], []

    total_h = by_user.sum()
    top_user = by_user.idxmax()
    top_pct  = by_user.max() / total_h * 100 if total_h > 0 else 0
    avg_h    = by_user.mean()
    n_users  = len(by_user)

    score = 100.0

    if top_pct > 70:
        score -= 50
        anomalies.append(
            f"🔴 Overloaded user: {top_user} handles {top_pct:.0f}% of total hours "
            f"({by_user.max():.1f}h out of {total_h:.1f}h total)"
        )
        insights.append(
            f"One member ({top_user}) is doing most of the work. "
            "Consider redistributing tasks to balance the team."
        )
    elif top_pct > 60:
        score -= 30
        anomalies.append(
            f"🟠 High workload concentration: {top_user} handles {top_pct:.0f}% of hours"
        )
        insights.append(
            f"Workload is not evenly distributed. {top_user} carries a "
            "disproportionate share of hours."
        )

    # Inactive / very low contributors
    inactive = by_user[by_user < avg_h * 0.15]
    if len(inactive) > 0 and n_users > 2:
        penalty = min(len(inactive) * 10, 20)
        score -= penalty
        names = ", ".join(inactive.index.tolist())
        anomalies.append(
            f"🟡 Inactive / low-contribution users: {names} "
            f"(each below 15% of team average {avg_h:.1f}h)"
        )
        insights.append(
            f"{len(inactive)} team member(s) have very low activity. "
            "Verify whether they are still active on this project."
        )

    # Only 1 user doing everything
    if n_users == 1:
        score = max(score - 20, 0)
        insights.append("This project has only one contributor — no collaboration at all.")

    return max(0.0, min(100.0, score)), anomalies, insights


def _score_coverage(df_proj: pd.DataFrame) -> tuple[float, list[str], list[str]]:
    """
    Score task coverage (testing, QA, documentation) (0-100).
    Uses Tags + Issue_Type + Description keywords.
    """
    anomalies, insights = [], []

    # Combine searchable text
    search_text = (
        df_proj["Tags"].str.lower().fillna("") + " " +
        df_proj["Issue_Type"].str.lower().fillna("") + " " +
        df_proj.get("Description", pd.Series("", index=df_proj.index)).astype(str).str.lower()
    )

    has_testing = search_text.str.contains(
        r"test(?:ing)?|qa|quality|recette|qualit[eé]", regex=True, na=False
    ).any()
    has_documentation = search_text.str.contains(
        r"doc(?:umentation)?|readme|spec(?:ification)?|wiki", regex=True, na=False
    ).any()
    has_review = search_text.str.contains(
        r"review|code.?review|relectur", regex=True, na=False
    ).any()

    score = 100.0
    missing = []

    if not has_testing:
        score -= 40
        missing.append("Testing / QA")
        anomalies.append("🔴 Testing phase is missing — no tasks tagged as Testing or QA")
        insights.append(
            "No testing or QA activity detected. This is a critical gap "
            "that increases the risk of undetected bugs."
        )
    if not has_documentation:
        score -= 30
        missing.append("Documentation")
        anomalies.append("🟡 Documentation phase is missing")
        insights.append(
            "No documentation tasks found. Consider adding documentation "
            "to ensure knowledge transfer and maintainability."
        )
    if not has_review:
        score -= 20
        missing.append("Code review")
        insights.append(
            "No code review activity detected. Regular reviews improve "
            "code quality and spread knowledge across the team."
        )

    if missing:
        insights.insert(0, f"Missing work phases: {', '.join(missing)}.")

    return max(0.0, min(100.0, score)), anomalies, insights


def _score_collaboration(df_proj: pd.DataFrame) -> tuple[float, list[str], list[str]]:
    """
    Score collaboration quality (0-100).
    Based on: distinct user count vs project size, task variety per user.
    """
    anomalies, insights = [], []

    n_users      = df_proj["User"].nunique()
    n_entries    = len(df_proj)
    by_user      = df_proj.groupby("User")["duration_hours"].sum()
    total_h      = by_user.sum()

    # Gini coefficient (inequality measure 0 = perfect equality, 1 = one person does all)
    def gini(arr):
        arr = sorted(arr)
        n = len(arr)
        if n == 0 or sum(arr) == 0:
            return 0.0
        cumsum = 0.0
        for i, v in enumerate(arr):
            cumsum += v * (2 * (i + 1) - n - 1)
        return cumsum / (n * sum(arr))

    g = gini(by_user.values.tolist())
    score = 100.0 - (g * 80)   # scale gini → score deduction

    if n_users < 2:
        score = max(score - 40, 0)
        anomalies.append("🔴 Poor collaboration: only 1 contributor on this project")
        insights.append(
            "Only one person is contributing. This creates a key-person "
            "dependency risk. Consider involving more team members."
        )
    elif n_users < 3 and n_entries > 50:
        score = max(score - 20, 0)
        anomalies.append(
            f"🟠 Low team diversity: only {n_users} contributors for {n_entries} entries"
        )
        insights.append(
            "Team collaboration is weak. Tasks are concentrated on very "
            "few people despite a high volume of work."
        )

    if g > 0.6:
        anomalies.append(
            f"🔴 High workload inequality (Gini={g:.2f}) — "
            "work is heavily concentrated on a small number of users"
        )
        insights.append(
            "Work distribution is very unequal. Some team members carry "
            "significantly more load than others."
        )
    elif g > 0.4:
        insights.append(
            "Some imbalance in work distribution detected. "
            "Minor rebalancing could improve team morale and efficiency."
        )

    return max(0.0, min(100.0, score)), anomalies, insights


def compute_health(df_proj: pd.DataFrame, project_name: str) -> dict:
    """
    Compute full health diagnostic for a single project's DataFrame slice.
    Returns the structured JSON object the frontend expects.
    """
    if df_proj.empty:
        return {
            "project": project_name,
            "score": 0,
            "label": "No Data",
            "color": "#94a3b8",
            "anomalies": ["No data available for this project"],
            "insights": ["No records found — check filters or data source"],
            "breakdown": {"balance": 0, "coverage": 0, "collaboration": 0},
            "stats": {}
        }

    s_balance,       a_bal, i_bal = _score_balance(df_proj)
    s_coverage,      a_cov, i_cov = _score_coverage(df_proj)
    s_collaboration, a_col, i_col = _score_collaboration(df_proj)

    weighted_score = (
        s_balance       * (W_BALANCE / 100) +
        s_coverage      * (W_COVERAGE / 100) +
        s_collaboration * (W_COLLABORATION / 100)
    )
    final_score = round(weighted_score)

    if final_score >= 75:
        label, color, emoji = "Good",        "#0CB87A", "🟢"
    elif final_score >= 45:
        label, color, emoji = "Medium Risk", "#E8A020", "🟡"
    else:
        label, color, emoji = "Critical",    "#E8522A", "🔴"

    # Stats summary
    by_user  = df_proj.groupby("User")["duration_hours"].sum()
    total_h  = df_proj["duration_hours"].sum()
    n_users  = df_proj["User"].nunique()
    n_months = df_proj["month_solid"].nunique() if "month_solid" in df_proj.columns else 0

    stats = {
        "total_hours":     round(float(total_h), 1),
        "total_entries":   int(len(df_proj)),
        "unique_users":    int(n_users),
        "active_months":   int(n_months),
        "top_user":        str(by_user.idxmax()) if not by_user.empty else "—",
        "top_user_hours":  round(float(by_user.max()), 1) if not by_user.empty else 0,
        "top_user_pct":    round(float(by_user.max() / total_h * 100), 1) if total_h > 0 else 0,
        "avg_hours_user":  round(float(total_h / n_users), 1) if n_users > 0 else 0,
        "done_pct":        round(
            float((df_proj["Status"] == "done").sum() / len(df_proj) * 100), 1
        ),
    }

    all_anomalies = a_bal + a_cov + a_col
    all_insights  = i_bal + i_cov + i_col

    # Deduplicate while preserving order
    seen = set()
    unique_anomalies, unique_insights = [], []
    for a in all_anomalies:
        k = a[:50]
        if k not in seen:
            seen.add(k); unique_anomalies.append(a)
    seen = set()
    for ins in all_insights:
        k = ins[:50]
        if k not in seen:
            seen.add(k); unique_insights.append(ins)

    # Always add a positive note if score is good
    if final_score >= 75 and not unique_anomalies:
        unique_anomalies = ["✅ No critical issues detected"]
        unique_insights  = unique_insights or [
            "This project shows healthy collaboration and good task coverage.",
            "Keep maintaining the current team balance and workflow."
        ]

    return {
        "project":    project_name,
        "score":      final_score,
        "label":      f"{emoji} {label}",
        "color":      color,
        "anomalies":  unique_anomalies,
        "insights":   unique_insights,
        "breakdown": {
            "balance":       round(s_balance),
            "coverage":      round(s_coverage),
            "collaboration": round(s_collaboration),
        },
        "stats": stats,
        "weights": {
            "balance":       W_BALANCE,
            "coverage":      W_COVERAGE,
            "collaboration": W_COLLABORATION,
        }
    }


# ════════════════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/health", methods=["GET"])
def health():
    """
    GET /api/health
    GET /api/health?project=WEB
    GET /api/health?project=WEB&user=Alice

    Returns project health diagnostic(s).
    """
    try:
        df = load_data()
    except FileNotFoundError as e:
        return jsonify({"error": str(e), "hint": "Place dashboard_dataset.csv next to health_api.py"}), 404

    project_filter = request.args.get("project", "").strip().upper()
    user_filter    = request.args.get("user",    "").strip()

    # Apply filters
    if project_filter:
        df = df[df["Project"] == project_filter]
    if user_filter:
        df = df[df["User"].str.lower() == user_filter.lower()]

    # Single project diagnostic
    if project_filter:
        result = compute_health(df, project_filter or "All Projects")
        return jsonify(result)

    # All projects diagnostic
    projects = df["Project"].unique().tolist()
    results  = []
    for proj in sorted(projects):
        df_proj = df[df["Project"] == proj]
        results.append(compute_health(df_proj, proj))

    # Sort by score ascending (worst first)
    results.sort(key=lambda x: x["score"])

    return jsonify({
        "total_projects": len(results),
        "projects": results
    })


@app.route("/api/projects", methods=["GET"])
def projects():
    """List all available projects."""
    try:
        df = load_data()
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    return jsonify({
        "projects": sorted(df["Project"].unique().tolist()),
        "count": df["Project"].nunique()
    })


@app.route("/api/users", methods=["GET"])
def users():
    """List all users, optionally filtered by project."""
    try:
        df = load_data()
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    proj = request.args.get("project", "").strip().upper()
    if proj:
        df = df[df["Project"] == proj]
    return jsonify({
        "users": sorted(df["User"].unique().tolist()),
        "count": df["User"].nunique()
    })


@app.route("/api/health/summary", methods=["GET"])
def summary():
    """
    Global platform overview: overall health, count by label, top risks.
    """
    try:
        df = load_data()
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404

    projects  = df["Project"].unique().tolist()
    all_diags = [compute_health(df[df["Project"] == p], p) for p in projects]

    good     = [d for d in all_diags if d["score"] >= 75]
    medium   = [d for d in all_diags if 45 <= d["score"] < 75]
    critical = [d for d in all_diags if d["score"] < 45]

    avg_score = round(sum(d["score"] for d in all_diags) / len(all_diags)) if all_diags else 0

    if avg_score >= 75:
        platform_label = "🟢 Healthy"
    elif avg_score >= 45:
        platform_label = "🟡 Needs Attention"
    else:
        platform_label = "🔴 At Risk"

    return jsonify({
        "platform_score": avg_score,
        "platform_label": platform_label,
        "total_projects": len(all_diags),
        "good_count":     len(good),
        "medium_count":   len(medium),
        "critical_count": len(critical),
        "top_risks":      sorted(all_diags, key=lambda x: x["score"])[:3],
        "top_healthy":    sorted(all_diags, key=lambda x: x["score"], reverse=True)[:3],
    })


# ════════════════════════════════════════════════════════════════════════════
# MISSING FIELD WARNINGS  (printed on startup)
# ════════════════════════════════════════════════════════════════════════════

def check_missing_fields():
    """
    Print warnings for fields that the diagnostic engine could use
    but that may be absent or empty in your CSV.
    """
    print("\n" + "═"*60)
    print("  KPI Hub — Health Diagnostic API")
    print("═"*60)
    try:
        df = load_data()
        cols = set(df.columns.str.lower())
        warnings = []

        DESIRED = {
            "tags":          "Tags column — used for testing/QA/doc detection",
            "issue type":    "Issue Type (Jira) — helps detect testing tasks",
            "status":        "Status — required for done/in_progress/pending scoring",
            "duration_hours":"duration_hours — primary workload measure",
            "month_solid":   "month_solid — for temporal analysis",
            "user":          "User — required for workload balance",
            "project":       "Project — required for project scoping",
        }
        for field, desc in DESIRED.items():
            if field not in cols:
                warnings.append(f"  ⚠  Missing field required: '{field}' — {desc}")

        if warnings:
            print("\nFIELD WARNINGS:")
            for w in warnings:
                print(w)
        else:
            print(f"\n  ✅  All required fields present ({len(df.columns)} columns, {len(df):,} rows)")

        # Check for useful but optional fields
        print("\n  OPTIONAL ENRICHMENTS (not required, but improve scoring):")
        optional = [
            ("story_points",                 "Story Points — for velocity analysis"),
            ("custom field (story points)",  "Story Points (Jira custom field)"),
            ("resolved",                     "Resolved date — for cycle time analysis"),
            ("reporter",                     "Reporter — for requester vs. executor analysis"),
        ]
        for field, desc in optional:
            status = "✅ present" if field in cols else "⬜ absent (optional)"
            print(f"  {status} — '{field}': {desc}")

    except FileNotFoundError:
        print(f"\n  ❌  dashboard_dataset.csv not found at: {CSV_PATH}")
        print("     Run the ETL first, or copy the CSV next to health_api.py")

    print("\n" + "═"*60)
    print(f"  Server: http://localhost:{PORT}")
    print(f"  Endpoints:")
    print(f"    GET /api/health               → all projects")
    print(f"    GET /api/health?project=WEB   → one project")
    print(f"    GET /api/health/summary       → platform overview")
    print(f"    GET /api/projects             → list projects")
    print(f"    GET /api/users                → list users")
    print("═"*60 + "\n")


if __name__ == "__main__":
    check_missing_fields()
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG)