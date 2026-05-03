"""Recommendation generation from anomaly and KPI context."""

from __future__ import annotations


def generate_recommendations(anomalies: list[dict], insights: list[dict]) -> list[dict]:
    recommendations: list[dict] = []

    for anomaly in anomalies[:40]:
        entity_type = anomaly["entity_type"]
        score = float(anomaly["score"])
        base = {
            "entity_type": entity_type,
            "entity_id": anomaly["entity_id"],
            "project": anomaly.get("project"),
            "priority": "High" if score >= 70 else "Medium" if score >= 40 else "Low",
            "score": round(score, 1),
        }
        if entity_type == "user":
            recommendations.append(
                {
                    **base,
                    "problem": f"{anomaly['entity_id']} shows {anomaly['reason']} in {anomaly['project']}.",
                    "suggested_action": "Validate assignment, reassign blocked work, or rebalance tasks with active contributors.",
                }
            )
        elif entity_type == "task":
            recommendations.append(
                {
                    **base,
                    "problem": f"Task {anomaly['entity_id']} has {anomaly['reason']}.",
                    "suggested_action": "Review estimation, split the task if needed, and investigate time tracking consistency.",
                }
            )
        elif entity_type == "project":
            recommendations.append(
                {
                    **base,
                    "problem": f"Project {anomaly['entity_id']} has elevated delivery risk from {anomaly['reason']}.",
                    "suggested_action": "Run a project health review, close stale tasks, and balance workload across contributors.",
                }
            )

    seen = set()
    unique = []
    for item in recommendations:
        key = (item["entity_type"], item["entity_id"], item["suggested_action"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    if insights and not unique:
        unique.append(
            {
                "entity_type": "portfolio",
                "entity_id": "all",
                "project": None,
                "priority": "Low",
                "score": 0,
                "problem": "No major anomalies were detected in the current data slice.",
                "suggested_action": "Keep monitoring completion rate, workload balance, and time tracking quality.",
            }
        )
    return unique[:50]
