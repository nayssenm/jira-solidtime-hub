"""Dynamic text insight generation for analytics reports."""

from __future__ import annotations


def generate_insights(projects: list[dict], anomalies: list[dict], kpis: dict) -> list[dict]:
    insights: list[dict] = []

    for project in projects:
        total_tasks = max(int(project.get("tasks_count", 0)), 1)
        inactive_rate = int(project.get("inactive_tasks", 0)) / total_tasks
        if inactive_rate >= 0.25:
            insights.append(
                {
                    "type": "project",
                    "project": project["project"],
                    "severity": project["risk_level"],
                    "text": (
                        f"Project {project['project']} has {inactive_rate:.0%} inactive tasks, "
                        "which increases delivery delay risk."
                    ),
                    "metric": {"inactive_task_rate": round(inactive_rate, 3)},
                }
            )
        if float(project.get("completion_rate", 0)) < 45:
            insights.append(
                {
                    "type": "project",
                    "project": project["project"],
                    "severity": project["risk_level"],
                    "text": (
                        f"Project {project['project']} completion rate is "
                        f"{project['completion_rate']:.1f}%, below the expected delivery baseline."
                    ),
                    "metric": {"completion_rate": project["completion_rate"]},
                }
            )

    for anomaly in anomalies[:30]:
        metrics = anomaly.get("metrics", {})
        if anomaly["entity_type"] == "user" and metrics.get("total_hours", 1) <= 0:
            insights.append(
                {
                    "type": "user",
                    "project": anomaly.get("project"),
                    "severity": anomaly["risk_level"],
                    "text": f"User {anomaly['entity_id']} is assigned in {anomaly['project']} but has no recorded activity.",
                    "metric": metrics,
                }
            )
        elif anomaly["entity_type"] == "task":
            avg = float(metrics.get("project_average_hours") or 0)
            hours = float(metrics.get("total_hours") or 0)
            if avg > 0 and hours >= avg * 2:
                multiplier = hours / avg
                insights.append(
                    {
                        "type": "task",
                        "project": anomaly.get("project"),
                        "severity": anomaly["risk_level"],
                        "text": (
                            f"Task {anomaly['entity_id']} took {multiplier:.1f}x more time "
                            f"than the {anomaly['project']} project average."
                        ),
                        "metric": metrics,
                    }
                )

    if kpis.get("risk_level") == "High":
        insights.insert(
            0,
            {
                "type": "portfolio",
                "project": None,
                "severity": "High",
                "text": (
                    f"Portfolio risk is high: global health is {kpis['project_health_score']:.1f}/100 "
                    f"with {kpis['task_completion_rate']:.1f}% task completion."
                ),
                "metric": {
                    "health_score": kpis["project_health_score"],
                    "completion_rate": kpis["task_completion_rate"],
                },
            },
        )

    return insights[:50]
