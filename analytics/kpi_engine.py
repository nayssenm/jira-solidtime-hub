"""Advanced KPI generation for the analytics plug-in."""

from __future__ import annotations

import pandas as pd

from analytics.anomaly_detection import DONE_STATUSES, normalize_dataframe
from analytics.scoring_engine import health_from_anomaly, risk_color, risk_level


def _completion_rate(data: pd.DataFrame) -> float:
    if data.empty:
        return 0.0
    return float(data["is_completed"].sum()) / len(data)


def build_project_summaries(df: pd.DataFrame, anomalies: list[dict] | None = None) -> list[dict]:
    data = normalize_dataframe(df)
    anomalies = anomalies or []
    project_scores = {
        item["project"]: max(float(item["score"]), float(item.get("project_score", 0)))
        for item in anomalies
        if item.get("project")
    }
    summaries = []
    for project, rows in data.groupby("Project"):
        total_hours = float(rows["duration_hours"].sum())
        tasks = rows.groupby("task_id").agg(
            task_key=("Task_key", "first"),
            total_hours=("duration_hours", "sum"),
            status=("Status", "first"),
            users=("User", "nunique"),
            completed=("is_completed", "max"),
        )
        completion_rate = _completion_rate(rows)
        inactive_tasks = int((tasks["total_hours"] <= 0).sum())
        active_users = int(rows["User"].nunique())
        anomaly_score = float(project_scores.get(project, 0.0))
        health = health_from_anomaly(anomaly_score)
        summaries.append(
            {
                "project": project,
                "tasks_count": int(tasks.shape[0]),
                "total_hours": round(total_hours, 2),
                "average_time_per_task": round(total_hours / max(int(tasks.shape[0]), 1), 2),
                "completed_tasks": int(tasks["completed"].sum()),
                "non_completed_tasks": int((~tasks["completed"].astype(bool)).sum()),
                "inactive_tasks": inactive_tasks,
                "active_users": active_users,
                "completion_rate": round(completion_rate * 100, 1),
                "health_score": round(health, 1),
                "risk_level": risk_level(anomaly_score),
                "risk_color": risk_color(anomaly_score),
            }
        )
    return sorted(summaries, key=lambda item: item["health_score"])


def build_user_contributions(df: pd.DataFrame) -> list[dict]:
    data = normalize_dataframe(df)
    grouped = (
        data.groupby(["Project", "User"], dropna=False)
        .agg(
            total_hours=("duration_hours", "sum"),
            tasks=("task_id", "nunique"),
            completed_entries=("is_completed", "sum"),
            entries=("duration_hours", "size"),
        )
        .reset_index()
    )
    rows = []
    for item in grouped.to_dict("records"):
        rows.append(
            {
                "project": item["Project"],
                "user": item["User"],
                "total_hours": round(float(item["total_hours"]), 2),
                "tasks": int(item["tasks"]),
                "completed_entries": int(item["completed_entries"]),
                "entries": int(item["entries"]),
            }
        )
    return sorted(rows, key=lambda item: item["total_hours"], reverse=True)


def build_task_metrics(df: pd.DataFrame) -> list[dict]:
    data = normalize_dataframe(df)
    grouped = (
        data.groupby(["Project", "task_id"], dropna=False)
        .agg(
            task_key=("Task_key", "first"),
            total_hours=("duration_hours", "sum"),
            status=("Status", "first"),
            users=("User", lambda s: sorted(set(v for v in s if v))),
            entries=("duration_hours", "size"),
            completed=("is_completed", "max"),
        )
        .reset_index()
    )
    rows = []
    for item in grouped.to_dict("records"):
        rows.append(
            {
                "project": item["Project"],
                "task": item["task_key"] or item["task_id"],
                "total_hours": round(float(item["total_hours"]), 2),
                "status": item["status"],
                "completed": bool(item["completed"]),
                "users": item["users"],
                "entries": int(item["entries"]),
            }
        )
    return sorted(rows, key=lambda item: item["total_hours"], reverse=True)


def build_kpis(df: pd.DataFrame, anomalies: list[dict] | None = None) -> dict:
    data = normalize_dataframe(df)
    anomalies = anomalies or []
    task_count = int(data["task_id"].nunique())
    total_hours = float(data["duration_hours"].sum())
    completion_rate = _completion_rate(data)
    inactive_users = int(
        (data.groupby("User")["duration_hours"].sum() <= 0.01).sum()
    ) if not data.empty else 0
    average_anomaly = (
        sum(float(item["score"]) for item in anomalies) / len(anomalies)
        if anomalies else 0.0
    )
    health_score = health_from_anomaly(average_anomaly)
    productivity_score = min(
        100.0,
        (completion_rate * 65.0)
        + (min(total_hours / max(data["User"].nunique(), 1), 80.0) / 80.0 * 35.0),
    )
    return {
        "project_health_score": round(health_score, 1),
        "team_productivity_score": round(productivity_score, 1),
        "task_completion_rate": round(completion_rate * 100.0, 1),
        "average_time_per_task": round(total_hours / max(task_count, 1), 2),
        "inactive_users_count": inactive_users,
        "risk_level": risk_level(average_anomaly),
        "risk_color": risk_color(average_anomaly),
        "total_projects": int(data["Project"].nunique()),
        "total_tasks": task_count,
        "total_users": int(data["User"].nunique()),
        "total_hours": round(total_hours, 2),
    }


def ranking_payload(projects: list[dict], users: list[dict]) -> dict:
    by_user = {}
    for item in users:
        user = item["user"]
        by_user.setdefault(user, {"user": user, "total_hours": 0.0, "tasks": 0})
        by_user[user]["total_hours"] += float(item["total_hours"])
        by_user[user]["tasks"] += int(item["tasks"])
    best_users = sorted(by_user.values(), key=lambda item: item["total_hours"], reverse=True)[:10]
    worst_projects = sorted(projects, key=lambda item: item["health_score"])[:10]
    return {
        "worst_projects": worst_projects,
        "best_users": [
            {
                "user": item["user"],
                "total_hours": round(item["total_hours"], 2),
                "tasks": int(item["tasks"]),
            }
            for item in best_users
        ],
    }
