"""Standalone advanced analytics API and widget.

Run directly:
    python api/advanced_analytics_api.py

Or import the blueprint in an existing Flask app:
    from api.advanced_analytics_api import advanced_analytics_bp
    app.register_blueprint(advanced_analytics_bp)
"""

from __future__ import annotations

import csv
import io
import os
import sys
from pathlib import Path

import pandas as pd
from flask import Blueprint, Flask, Response, jsonify, request
from flask_cors import CORS

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from analytics.anomaly_detection import detect_anomalies, normalize_dataframe
from analytics.insight_generator import generate_insights
from analytics.kpi_engine import (
    build_kpis,
    build_project_summaries,
    build_task_metrics,
    build_user_contributions,
    ranking_payload,
)
from analytics.recommendation_engine import generate_recommendations


CSV_PATH = ROOT_DIR / "dashboard_dataset.csv"
PORT = int(os.environ.get("ADVANCED_ANALYTICS_PORT", "5051"))

advanced_analytics_bp = Blueprint("advanced_analytics", __name__)


def load_data(csv_path: Path = CSV_PATH) -> pd.DataFrame:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")
    return normalize_dataframe(pd.read_csv(csv_path, low_memory=False))


def filter_data(df: pd.DataFrame, project: str | None = None) -> pd.DataFrame:
    if project:
        return df[df["Project"] == project.strip().upper()].copy()
    return df


def build_report(project: str | None = None) -> dict:
    data = filter_data(load_data(), project)
    anomalies = detect_anomalies(data)
    projects = build_project_summaries(data, anomalies)
    users = build_user_contributions(data)
    tasks = build_task_metrics(data)
    kpis = build_kpis(data, anomalies)
    insights = generate_insights(projects, anomalies, kpis)
    recommendations = generate_recommendations(anomalies, insights)

    return {
        "meta": {
            "source": "dashboard_dataset.csv",
            "project_filter": project.strip().upper() if project else None,
            "rows": int(len(data)),
            "schema_version": "1.0",
        },
        "kpis": kpis,
        "projects": projects,
        "tasks": tasks[:500],
        "users": users,
        "anomalies": anomalies[:100],
        "insights": insights,
        "recommendations": recommendations,
        "rankings": ranking_payload(projects, users),
        "charts": {
            "project_hours": [
                {"label": item["project"], "value": item["total_hours"]}
                for item in sorted(projects, key=lambda x: x["total_hours"], reverse=True)
            ],
            "project_health": [
                {"label": item["project"], "value": item["health_score"], "color": item["risk_color"]}
                for item in projects
            ],
            "user_contribution": [
                {"label": item["user"], "project": item["project"], "value": item["total_hours"]}
                for item in users[:25]
            ],
        },
        "pdf_ready": {
            "title": "Advanced Analytics Report",
            "sections": [
                {"heading": "Executive KPIs", "items": kpis},
                {"heading": "Top Insights", "items": insights[:10]},
                {"heading": "Recommendations", "items": recommendations[:10]},
            ],
        },
    }


def report_to_csv(report: dict) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=["type", "project", "entity", "score", "risk_level", "problem", "suggested_action"],
    )
    writer.writeheader()
    for item in report["anomalies"]:
        writer.writerow(
            {
                "type": item["entity_type"],
                "project": item.get("project", ""),
                "entity": item["entity_id"],
                "score": item["score"],
                "risk_level": item["risk_level"],
                "problem": item["reason"],
                "suggested_action": "",
            }
        )
    for item in report["recommendations"]:
        writer.writerow(
            {
                "type": item["entity_type"],
                "project": item.get("project", ""),
                "entity": item["entity_id"],
                "score": item["score"],
                "risk_level": item["priority"],
                "problem": item["problem"],
                "suggested_action": item["suggested_action"],
            }
        )
    return buffer.getvalue()


@advanced_analytics_bp.get("/api/advanced-analytics/report")
def advanced_report():
    project = request.args.get("project")
    output_format = request.args.get("format", "json").lower()
    report = build_report(project=project)
    if output_format == "csv":
        return Response(
            report_to_csv(report),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=advanced_analytics_report.csv"},
        )
    if output_format in {"pdf", "pdf_data", "pdf-ready"}:
        return jsonify(report["pdf_ready"])
    return jsonify(report)


@advanced_analytics_bp.get("/advanced-analytics/widget")
def advanced_widget():
    return Response(WIDGET_HTML, mimetype="text/html")


WIDGET_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Advanced Analytics Widget</title>
  <style>
    :root{font-family:Inter,Arial,sans-serif;color:#172033;background:#f5f7fb}
    body{margin:0;padding:24px}
    .shell{max-width:1180px;margin:auto}
    .top{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:18px}
    h1{font-size:24px;margin:0}
    select,button{height:38px;border:1px solid #d7deea;border-radius:8px;background:white;padding:0 12px}
    button{cursor:pointer;background:#1e6fd9;color:white;font-weight:700}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .card,.panel{background:white;border:1px solid #e3e8f2;border-radius:8px;box-shadow:0 12px 30px rgba(20,32,58,.06)}
    .card{padding:14px}
    .label{font-size:12px;color:#667085}.value{font-size:26px;font-weight:800;margin-top:6px}
    .panels{display:grid;grid-template-columns:1.1fr .9fr;gap:14px;margin-top:14px}
    .panel{padding:16px}.row{display:grid;grid-template-columns:88px 1fr auto;gap:12px;padding:10px 0;border-bottom:1px solid #eef2f7}
    .badge{border-radius:999px;padding:3px 8px;font-size:12px;font-weight:700}.green{background:#e7f8ef;color:#087a50}.orange{background:#fff3dd;color:#9a6200}.red{background:#ffe9e4;color:#b42318}
    .insight{padding:10px 0;border-bottom:1px solid #eef2f7;line-height:1.45}.muted{color:#667085;font-size:12px}
    @media(max-width:900px){.grid,.panels{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="top">
      <div><h1>Advanced Analytics & AI Insight Engine</h1><div class="muted">Plug-and-play report powered by dashboard_dataset.csv</div></div>
      <div><select id="project"><option value="">All projects</option></select><button id="download">Download CSV</button></div>
    </div>
    <section class="grid" id="kpis"></section>
    <section class="panels">
      <div class="panel"><h2>Anomaly alerts</h2><div id="anomalies"></div></div>
      <div class="panel"><h2>Insights</h2><div id="insights"></div></div>
    </section>
    <section class="panel" style="margin-top:14px"><h2>Recommendations</h2><div id="recommendations"></div></section>
  </main>
  <script>
    let latest=null;
    const project=document.getElementById('project');
    const colorClass=(value)=>String(value||'green').toLowerCase();
    async function load(){
      const qs=project.value?('?project='+encodeURIComponent(project.value)):'';
      const res=await fetch('/api/advanced-analytics/report'+qs);
      latest=await res.json();
      render(latest);
    }
    function card(label,value,sub,color){
      return `<article class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="muted"><span class="badge ${colorClass(color)}">${sub}</span></div></article>`;
    }
    function render(data){
      if(project.options.length===1){
        data.projects.slice().sort((a,b)=>a.project.localeCompare(b.project)).forEach(p=>{
          const option=document.createElement('option'); option.value=p.project; option.textContent=p.project; project.appendChild(option);
        });
      }
      const k=data.kpis;
      document.getElementById('kpis').innerHTML=[
        card('Health Score',k.project_health_score,'risk '+k.risk_level,k.risk_color),
        card('Productivity',k.team_productivity_score,'team score','green'),
        card('Completion Rate',k.task_completion_rate+'%','tasks done',k.task_completion_rate<45?'red':'green'),
        card('Avg Time / Task',k.average_time_per_task+'h',k.total_tasks+' tasks','orange')
      ].join('');
      document.getElementById('anomalies').innerHTML=data.anomalies.slice(0,12).map(a=>
        `<div class="row"><span class="badge ${colorClass(a.risk_color)}">${a.risk_level}</span><strong>${a.entity_type}: ${a.entity_id}</strong><span>${a.score}</span><div class="muted" style="grid-column:2/4">${a.reason}</div></div>`
      ).join('') || '<p class="muted">No anomalies detected.</p>';
      document.getElementById('insights').innerHTML=data.insights.slice(0,12).map(i=>
        `<div class="insight"><span class="badge ${i.severity==='High'?'red':i.severity==='Medium'?'orange':'green'}">${i.severity}</span> ${i.text}</div>`
      ).join('') || '<p class="muted">No insights for this filter.</p>';
      document.getElementById('recommendations').innerHTML=data.recommendations.slice(0,12).map(r=>
        `<div class="insight"><strong>${r.priority}: ${r.problem}</strong><br><span class="muted">${r.suggested_action}</span></div>`
      ).join('');
    }
    project.addEventListener('change',load);
    document.getElementById('download').addEventListener('click',()=>{
      const qs=project.value?('&project='+encodeURIComponent(project.value)):'';
      location.href='/api/advanced-analytics/report?format=csv'+qs;
    });
    load();
  </script>
</body>
</html>"""


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(advanced_analytics_bp)
    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=PORT, debug=True)
