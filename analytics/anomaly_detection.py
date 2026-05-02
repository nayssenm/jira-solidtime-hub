"""Entity-level anomaly detection for Jira/Solidtime analytics."""

from __future__ import annotations

import pandas as pd

from analytics.scoring_engine import (
    project_anomaly_score,
    risk_color,
    risk_level,
    task_anomaly_score,
    user_anomaly_score,
)


DONE_STATUSES = {"done", "completed", "closed", "resolved"}


def normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Return a compatible dataframe without mutating caller data."""
    data = df.copy()
    data["User"] = data.get("User", pd.Series("Unknown", index=data.index)).fillna("Unknown").astype(str).str.strip()
    data["Project"] = data.get("Project", pd.Series("Unknown", index=data.index)).fillna("Unknown").astype(str).str.strip().str.upper()
    data["Status"] = data.get("Status", pd.Series("other", index=data.index)).fillna("other").astype(str).str.lower().str.strip().str.replace(" ", "_")
    data["duration_hours"] = pd.to_numeric(data.get("duration_hours", 0), errors="coerce").fillna(0.0)
    data["Task_key"] = data.get("Task_key", pd.Series("", index=data.index)).fillna("").astype(str).str.strip()
    data["month_solid"] = data.get("month_solid", pd.Series("", index=data.index)).fillna("").astype(str).str.strip()
    data["Tags"] = data.get("Tags", pd.Series("", index=data.index)).fillna("").astype(str)
    data["task_id"] = data["Task_key"].where(data["Task_key"].ne(""), "unlinked-" + data.index.astype(str))
    data["is_completed"] = data["Status"].isin(DONE_STATUSES)
    return data


def detect_task_anomalies(df: pd.DataFrame) -> list[dict]:
    data = normalize_dataframe(df)
    task_frame = (
        data.groupby(["Project", "task_id"], dropna=False)
        .agg(
            task_key=("Task_key", "first"),
            status=("Status", "first"),
            total_hours=("duration_hours", "sum"),
            entries=("duration_hours", "size"),
            users=("User", lambda s: sorted(set(v for v in s if v))),
            completed=("is_completed", "max"),
        )
        .reset_index()
    )
    project_avg = task_frame.groupby("Project")["total_hours"].mean().to_dict()

    anomalies = []
    for row in task_frame.to_dict("records"):
        avg = float(project_avg.get(row["Project"], 0.0))
        score = task_anomaly_score(float(row["total_hours"]), avg, str(row["status"]))
        if score < 35:
            continue
        task_label = row["task_key"] or row["task_id"]
        reason = "zero tracked time" if float(row["total_hours"]) <= 0 else "time far above project average"
        anomalies.append(
            {
                "entity_type": "task",
                "entity_id": task_label,
                "project": row["Project"],
                "score": round(score, 1),
                "risk_level": risk_level(score),
                "risk_color": risk_color(score),
                "reason": reason,
                "metrics": {
                    "total_hours": round(float(row["total_hours"]), 2),
                    "project_average_hours": round(avg, 2),
                    "entries": int(row["entries"]),
                    "completed": bool(row["completed"]),
                },
            }
        )
    return sorted(anomalies, key=lambda item: item["score"], reverse=True)


def detect_user_anomalies(df: pd.DataFrame) -> list[dict]:
    data = normalize_dataframe(df)
    user_project = (
        data.groupby(["Project", "User"], dropna=False)
        .agg(
            total_hours=("duration_hours", "sum"),
            assigned_tasks=("task_id", "nunique"),
            completed_tasks=("is_completed", "sum"),
            total_entries=("duration_hours", "size"),
        )
        .reset_index()
    )
    project_avg = user_project.groupby("Project")["total_hours"].mean().to_dict()

    anomalies = []
    for row in user_project.to_dict("records"):
        avg = float(project_avg.get(row["Project"], 0.0))
        score = user_anomaly_score(float(row["total_hours"]), avg, int(row["assigned_tasks"]))
        if score < 35:
            continue
        reason = "assigned but inactive" if float(row["total_hours"]) <= 0 else "extremely low contribution"
        anomalies.append(
            {
                "entity_type": "user",
                "entity_id": row["User"],
                "project": row["Project"],
                "score": round(score, 1),
                "risk_level": risk_level(score),
                "risk_color": risk_color(score),
                "reason": reason,
                "metrics": {
                    "total_hours": round(float(row["total_hours"]), 2),
                    "project_average_user_hours": round(avg, 2),
                    "assigned_tasks": int(row["assigned_tasks"]),
                    "completed_tasks": int(row["completed_tasks"]),
                },
            }
        )
    return sorted(anomalies, key=lambda item: item["score"], reverse=True)


def detect_project_anomalies(df: pd.DataFrame) -> list[dict]:
    data = normalize_dataframe(df)
    project_frame = (
        data.groupby("Project", dropna=False)
        .agg(
            total_hours=("duration_hours", "sum"),
            total_tasks=("task_id", "nunique"),
            completed_entries=("is_completed", "sum"),
            total_entries=("duration_hours", "size"),
            active_users=("User", "nunique"),
        )
        .reset_index()
    )
    average_project_hours = float(project_frame["total_hours"].mean()) if not project_frame.empty else 0.0

    anomalies = []
    for row in project_frame.to_dict("records"):
        project_rows = data[data["Project"] == row["Project"]]
        task_hours = project_rows.groupby("task_id")["duration_hours"].sum()
        inactive_tasks = int((task_hours <= 0).sum())
        total_tasks = int(row["total_tasks"]) or 1
        inactive_rate = inactive_tasks / total_tasks
        completion_rate = float(row["completed_entries"]) / max(int(row["total_entries"]), 1)
        score = project_anomaly_score(
            inactive_task_rate=inactive_rate,
            completion_rate=completion_rate,
            total_hours=float(row["total_hours"]),
            average_project_hours=average_project_hours,
        )
        if score < 30:
            continue
        anomalies.append(
            {
                "entity_type": "project",
                "entity_id": row["Project"],
                "project": row["Project"],
                "score": round(score, 1),
                "risk_level": risk_level(score),
                "risk_color": risk_color(score),
                "reason": "inactive tasks or low activity",
                "metrics": {
                    "total_hours": round(float(row["total_hours"]), 2),
                    "total_tasks": int(row["total_tasks"]),
                    "inactive_task_rate": round(inactive_rate, 3),
                    "completion_rate": round(completion_rate, 3),
                    "active_users": int(row["active_users"]),
                },
            }
        )
    return sorted(anomalies, key=lambda item: item["score"], reverse=True)


def detect_anomalies(df: pd.DataFrame) -> list[dict]:
    return sorted(
        detect_project_anomalies(df) + detect_user_anomalies(df) + detect_task_anomalies(df),
        key=lambda item: item["score"],
        reverse=True,
    )
