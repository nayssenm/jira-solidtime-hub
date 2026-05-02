"""Reusable scoring helpers for the advanced analytics plug-in.

This module is intentionally independent from the existing dashboard code.
It operates on normalized dictionaries/dataframes and returns plain JSON-ready
values so it can be removed without touching the current application.
"""

from __future__ import annotations

from statistics import mean, pstdev
from typing import Iterable


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, float(value)))


def normalize_ratio(value: float, good_at: float, bad_at: float) -> float:
    """Map a metric into a 0-100 anomaly score.

    Values at or below ``good_at`` become 0, values at or above ``bad_at``
    become 100. The range between them is linear.
    """
    if bad_at == good_at:
        return 100.0 if value >= bad_at else 0.0
    return clamp(((value - good_at) / (bad_at - good_at)) * 100.0)


def z_score_anomaly(value: float, population: Iterable[float], high_z: float = 3.0) -> float:
    values = [float(v) for v in population if v is not None]
    if len(values) < 2:
        return 0.0
    sigma = pstdev(values)
    if sigma == 0:
        return 0.0
    z = abs((float(value) - mean(values)) / sigma)
    return clamp((z / high_z) * 100.0)


def risk_level(score: float) -> str:
    score = float(score)
    if score >= 70:
        return "High"
    if score >= 40:
        return "Medium"
    return "Low"


def risk_color(score: float) -> str:
    level = risk_level(score)
    return {"Low": "green", "Medium": "orange", "High": "red"}[level]


def health_from_anomaly(anomaly_score: float) -> float:
    return clamp(100.0 - float(anomaly_score))


def weighted_score(parts: dict[str, float], weights: dict[str, float]) -> float:
    total_weight = sum(weights.values()) or 1.0
    total = 0.0
    for key, weight in weights.items():
        total += float(parts.get(key, 0.0)) * weight
    return clamp(total / total_weight)


def task_anomaly_score(task_hours: float, project_average_hours: float, status: str = "") -> float:
    zero_time = 100.0 if task_hours <= 0 else 0.0
    if project_average_hours <= 0:
        overload = 0.0
    else:
        overload = normalize_ratio(task_hours / project_average_hours, good_at=1.5, bad_at=4.0)
    open_status_penalty = 15.0 if status not in {"done", "completed", "closed"} and task_hours <= 0 else 0.0
    return clamp(max(zero_time, overload) + open_status_penalty)


def user_anomaly_score(user_hours: float, project_average_user_hours: float, assigned_tasks: int = 0) -> float:
    inactive = 100.0 if assigned_tasks > 0 and user_hours <= 0 else 0.0
    if project_average_user_hours <= 0:
        low_contribution = 0.0
    else:
        low_contribution = normalize_ratio(
            1.0 - (user_hours / project_average_user_hours),
            good_at=0.25,
            bad_at=0.9,
        )
    return clamp(max(inactive, low_contribution))


def project_anomaly_score(
    inactive_task_rate: float,
    completion_rate: float,
    total_hours: float,
    average_project_hours: float,
) -> float:
    inactive_component = normalize_ratio(inactive_task_rate, good_at=0.1, bad_at=0.55)
    incomplete_component = normalize_ratio(1.0 - completion_rate, good_at=0.2, bad_at=0.75)
    if average_project_hours <= 0:
        low_activity_component = 100.0 if total_hours <= 0 else 0.0
    else:
        low_activity_component = normalize_ratio(
            1.0 - (total_hours / average_project_hours),
            good_at=0.15,
            bad_at=0.85,
        )
    return weighted_score(
        {
            "inactive": inactive_component,
            "incomplete": incomplete_component,
            "activity": low_activity_component,
        },
        {"inactive": 0.4, "incomplete": 0.35, "activity": 0.25},
    )
