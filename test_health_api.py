import unittest
import sys
import types

import pandas as pd

try:
    import flask  # noqa: F401
except ModuleNotFoundError:
    flask_stub = types.ModuleType("flask")

    class FlaskStub:
        def __init__(self, *args, **kwargs):
            pass

        def route(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

    flask_stub.Flask = FlaskStub
    flask_stub.request = types.SimpleNamespace(args={})
    flask_stub.jsonify = lambda value=None, *args, **kwargs: value
    sys.modules["flask"] = flask_stub

try:
    import flask_cors  # noqa: F401
except ModuleNotFoundError:
    cors_stub = types.ModuleType("flask_cors")
    cors_stub.CORS = lambda *args, **kwargs: None
    sys.modules["flask_cors"] = cors_stub

from health_api import (
    _score_balance,
    _score_collaboration,
    _score_coverage,
    compute_health,
)


def frame(rows):
    defaults = {
        "User": "Alice",
        "Project": "WEB",
        "duration_hours": 1.0,
        "Status": "done",
        "Tags": "testing documentation review",
        "Issue_Type": "task",
        "Description": "",
        "month_solid": "2026-01",
        "Task_key": "WEB-1",
    }
    return pd.DataFrame([{**defaults, **row} for row in rows])


class HealthScoringTests(unittest.TestCase):
    def test_balance_penalizes_single_overloaded_user(self):
        df = frame([
            {"User": "Alice", "duration_hours": 90},
            {"User": "Bob", "duration_hours": 5},
            {"User": "Cara", "duration_hours": 5},
        ])
        score, anomalies, insights = _score_balance(df)
        self.assertLess(score, 60)
        self.assertTrue(any("Overloaded" in item or "concentration" in item for item in anomalies))
        self.assertTrue(insights)

    def test_coverage_detects_missing_quality_phases(self):
        df = frame([
            {"Tags": "development", "Issue_Type": "story", "Description": "build feature"},
            {"Tags": "meeting", "Issue_Type": "task", "Description": "planning"},
        ])
        score, anomalies, insights = _score_coverage(df)
        self.assertLessEqual(score, 10)
        self.assertTrue(any("Testing" in item for item in anomalies))
        self.assertTrue(any("Documentation" in item for item in anomalies))
        self.assertTrue(insights)

    def test_collaboration_penalizes_one_contributor(self):
        df = frame([
            {"User": "Alice", "duration_hours": 4},
            {"User": "Alice", "duration_hours": 3},
        ])
        score, anomalies, _ = _score_collaboration(df)
        self.assertLess(score, 70)
        self.assertTrue(any("only 1 contributor" in item for item in anomalies))

    def test_compute_health_returns_weighted_breakdown_and_label(self):
        df = frame([
            {"User": "Alice", "duration_hours": 5, "Tags": "testing review documentation"},
            {"User": "Bob", "duration_hours": 4, "Tags": "testing documentation review"},
            {"User": "Cara", "duration_hours": 3, "Tags": "qa wiki code review"},
        ])
        result = compute_health(df, "WEB")
        self.assertGreaterEqual(result["score"], 75)
        self.assertEqual(set(result["breakdown"].keys()), {"balance", "coverage", "collaboration"})
        self.assertIn("weights", result)
        self.assertEqual(result["project"], "WEB")


if __name__ == "__main__":
    unittest.main()
