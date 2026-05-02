(function () {
  "use strict";

  var DONE = { done: true, completed: true, closed: true, resolved: true };

  function clamp(value, low, high) {
    return Math.max(low == null ? 0 : low, Math.min(high == null ? 100 : high, Number(value) || 0));
  }

  function normalizeRatio(value, goodAt, badAt) {
    if (badAt === goodAt) return value >= badAt ? 100 : 0;
    return clamp(((value - goodAt) / (badAt - goodAt)) * 100, 0, 100);
  }

  function riskLevel(score) {
    if (score >= 70) return "High";
    if (score >= 40) return "Medium";
    return "Low";
  }

  function riskColor(score) {
    return { Low: "green", Medium: "orange", High: "red" }[riskLevel(score)];
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var quoted = false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        row.push(field);
        field = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(field);
        if (row.some(function (v) { return v !== ""; })) rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.some(function (v) { return v !== ""; })) rows.push(row);
    var headers = rows.shift() || [];
    return rows.map(function (values, index) {
      var item = { _row: index };
      headers.forEach(function (header, idx) {
        item[header] = values[idx] == null ? "" : values[idx];
      });
      return item;
    });
  }

  function normalizeRows(rows) {
    return rows.map(function (row, index) {
      var task = String(row.Task_key || "").trim();
      var status = String(row.Status || "other").trim().toLowerCase().replace(/\s+/g, "_");
      var hours = Number(row.duration_hours || row.h || 0) || 0;
      return {
        row: index,
        user: String(row.User || "Unknown").trim() || "Unknown",
        project: (String(row.Project || "Unknown").trim() || "Unknown").toUpperCase(),
        status: status,
        hours: hours,
        month: String(row.month_solid || row.m || "").trim(),
        task: task || "unlinked-" + index,
        taskKey: task,
        tags: String(row.Tags || ""),
        completed: !!DONE[status],
        raw: row
      };
    });
  }

  function groupBy(rows, keyFn) {
    var map = {};
    rows.forEach(function (row) {
      var key = keyFn(row);
      if (!map[key]) map[key] = [];
      map[key].push(row);
    });
    return map;
  }

  function sum(rows, key) {
    return rows.reduce(function (total, row) {
      return total + Number(typeof key === "function" ? key(row) : row[key] || 0);
    }, 0);
  }

  function unique(rows, key) {
    var values = {};
    rows.forEach(function (row) {
      var value = typeof key === "function" ? key(row) : row[key];
      if (value) values[value] = true;
    });
    return Object.keys(values);
  }

  function taskScore(hours, projectAverage, status) {
    var zero = hours <= 0 ? 100 : 0;
    var overload = projectAverage > 0 ? normalizeRatio(hours / projectAverage, 1.5, 4) : 0;
    var openPenalty = !DONE[status] && hours <= 0 ? 15 : 0;
    return clamp(Math.max(zero, overload) + openPenalty, 0, 100);
  }

  function userScore(hours, projectAverageUserHours, assignedTasks) {
    var inactive = assignedTasks > 0 && hours <= 0 ? 100 : 0;
    var low = projectAverageUserHours > 0
      ? normalizeRatio(1 - hours / projectAverageUserHours, 0.25, 0.9)
      : 0;
    return clamp(Math.max(inactive, low), 0, 100);
  }

  function projectScore(inactiveTaskRate, completionRate, totalHours, averageProjectHours) {
    var inactive = normalizeRatio(inactiveTaskRate, 0.1, 0.55);
    var incomplete = normalizeRatio(1 - completionRate, 0.2, 0.75);
    var activity = averageProjectHours > 0 ? normalizeRatio(1 - totalHours / averageProjectHours, 0.15, 0.85) : 0;
    return clamp((inactive * 0.4) + (incomplete * 0.35) + (activity * 0.25), 0, 100);
  }

  function buildTaskMetrics(rows) {
    var grouped = groupBy(rows, function (row) { return row.project + "::" + row.task; });
    return Object.keys(grouped).map(function (key) {
      var items = grouped[key];
      return {
        project: items[0].project,
        task: items[0].taskKey || items[0].task,
        total_hours: Number(sum(items, "hours").toFixed(2)),
        status: items[0].status,
        completed: items.some(function (item) { return item.completed; }),
        users: unique(items, "user"),
        entries: items.length
      };
    }).sort(function (a, b) { return b.total_hours - a.total_hours; });
  }

  function buildUserContributions(rows) {
    var grouped = groupBy(rows, function (row) { return row.project + "::" + row.user; });
    return Object.keys(grouped).map(function (key) {
      var items = grouped[key];
      return {
        project: items[0].project,
        user: items[0].user,
        total_hours: Number(sum(items, "hours").toFixed(2)),
        tasks: unique(items, "task").length,
        completed_entries: items.filter(function (item) { return item.completed; }).length,
        entries: items.length
      };
    }).sort(function (a, b) { return b.total_hours - a.total_hours; });
  }

  function detectAnomalies(rows, tasks, users) {
    var anomalies = [];
    var tasksByProject = groupBy(tasks, function (task) { return task.project; });
    var usersByProject = groupBy(users, function (user) { return user.project; });
    var rowsByProject = groupBy(rows, function (row) { return row.project; });
    var projectTotals = Object.keys(rowsByProject).map(function (project) {
      return sum(rowsByProject[project], "hours");
    });
    var averageProjectHours = projectTotals.length ? projectTotals.reduce(function (a, b) { return a + b; }, 0) / projectTotals.length : 0;

    Object.keys(tasksByProject).forEach(function (project) {
      var projectTasks = tasksByProject[project];
      var avg = projectTasks.length ? projectTasks.reduce(function (total, task) { return total + task.total_hours; }, 0) / projectTasks.length : 0;
      projectTasks.forEach(function (task) {
        var score = taskScore(task.total_hours, avg, task.status);
        if (score < 35) return;
        anomalies.push({
          entity_type: "task",
          entity_id: task.task,
          project: project,
          score: Number(score.toFixed(1)),
          risk_level: riskLevel(score),
          risk_color: riskColor(score),
          reason: task.total_hours <= 0 ? "zero tracked time" : "time far above project average",
          metrics: {
            total_hours: task.total_hours,
            project_average_hours: Number(avg.toFixed(2)),
            entries: task.entries,
            completed: task.completed
          }
        });
      });
    });

    Object.keys(usersByProject).forEach(function (project) {
      var projectUsers = usersByProject[project];
      var avg = projectUsers.length ? projectUsers.reduce(function (total, user) { return total + user.total_hours; }, 0) / projectUsers.length : 0;
      projectUsers.forEach(function (user) {
        var score = userScore(user.total_hours, avg, user.tasks);
        if (score < 35) return;
        anomalies.push({
          entity_type: "user",
          entity_id: user.user,
          project: project,
          score: Number(score.toFixed(1)),
          risk_level: riskLevel(score),
          risk_color: riskColor(score),
          reason: user.total_hours <= 0 ? "assigned but inactive" : "extremely low contribution",
          metrics: {
            total_hours: user.total_hours,
            project_average_user_hours: Number(avg.toFixed(2)),
            assigned_tasks: user.tasks,
            completed_tasks: user.completed_entries
          }
        });
      });
    });

    Object.keys(rowsByProject).forEach(function (project) {
      var projectRows = rowsByProject[project];
      var projectTasks = tasksByProject[project] || [];
      var inactive = projectTasks.filter(function (task) { return task.total_hours <= 0; }).length;
      var completion = projectRows.length ? projectRows.filter(function (row) { return row.completed; }).length / projectRows.length : 0;
      var totalHours = sum(projectRows, "hours");
      var score = projectScore(inactive / Math.max(projectTasks.length, 1), completion, totalHours, averageProjectHours);
      if (score < 30) return;
      anomalies.push({
        entity_type: "project",
        entity_id: project,
        project: project,
        score: Number(score.toFixed(1)),
        risk_level: riskLevel(score),
        risk_color: riskColor(score),
        reason: "inactive tasks or low activity",
        metrics: {
          total_hours: Number(totalHours.toFixed(2)),
          total_tasks: projectTasks.length,
          inactive_task_rate: Number((inactive / Math.max(projectTasks.length, 1)).toFixed(3)),
          completion_rate: Number(completion.toFixed(3)),
          active_users: unique(projectRows, "user").length
        }
      });
    });

    return anomalies.sort(function (a, b) { return b.score - a.score; });
  }

  function buildProjects(rows, tasks, anomalies) {
    var rowsByProject = groupBy(rows, function (row) { return row.project; });
    var tasksByProject = groupBy(tasks, function (task) { return task.project; });
    return Object.keys(rowsByProject).map(function (project) {
      var items = rowsByProject[project];
      var projectTasks = tasksByProject[project] || [];
      var anomalyScore = anomalies
        .filter(function (item) { return item.project === project; })
        .reduce(function (max, item) { return Math.max(max, item.score); }, 0);
      var totalHours = sum(items, "hours");
      var completedTasks = projectTasks.filter(function (task) { return task.completed; }).length;
      return {
        project: project,
        tasks_count: projectTasks.length,
        total_hours: Number(totalHours.toFixed(2)),
        average_time_per_task: Number((totalHours / Math.max(projectTasks.length, 1)).toFixed(2)),
        completed_tasks: completedTasks,
        non_completed_tasks: projectTasks.length - completedTasks,
        inactive_tasks: projectTasks.filter(function (task) { return task.total_hours <= 0; }).length,
        active_users: unique(items, "user").length,
        completion_rate: Number(((items.filter(function (row) { return row.completed; }).length / Math.max(items.length, 1)) * 100).toFixed(1)),
        health_score: Number((100 - anomalyScore).toFixed(1)),
        risk_level: riskLevel(anomalyScore),
        risk_color: riskColor(anomalyScore)
      };
    }).sort(function (a, b) { return a.health_score - b.health_score; });
  }

  function buildKpis(rows, tasks, anomalies) {
    var totalHours = sum(rows, "hours");
    var completionRate = rows.length ? rows.filter(function (row) { return row.completed; }).length / rows.length : 0;
    var averageAnomaly = anomalies.length
      ? anomalies.reduce(function (total, item) { return total + item.score; }, 0) / anomalies.length
      : 0;
    var productivity = Math.min(100, (completionRate * 65) + ((Math.min(totalHours / Math.max(unique(rows, "user").length, 1), 80) / 80) * 35));
    return {
      project_health_score: Number((100 - averageAnomaly).toFixed(1)),
      team_productivity_score: Number(productivity.toFixed(1)),
      task_completion_rate: Number((completionRate * 100).toFixed(1)),
      average_time_per_task: Number((totalHours / Math.max(tasks.length, 1)).toFixed(2)),
      inactive_users_count: 0,
      risk_level: riskLevel(averageAnomaly),
      risk_color: riskColor(averageAnomaly),
      total_projects: unique(rows, "project").length,
      total_tasks: tasks.length,
      total_users: unique(rows, "user").length,
      total_hours: Number(totalHours.toFixed(2))
    };
  }

  function generateInsights(projects, anomalies, kpis) {
    var insights = [];
    projects.forEach(function (project) {
      var inactiveRate = project.inactive_tasks / Math.max(project.tasks_count, 1);
      if (inactiveRate >= 0.25) {
        insights.push({
          type: "project",
          project: project.project,
          severity: project.risk_level,
          text: "Project " + project.project + " has " + Math.round(inactiveRate * 100) + "% inactive tasks, which increases delivery delay risk.",
          metric: { inactive_task_rate: Number(inactiveRate.toFixed(3)) }
        });
      }
      if (project.completion_rate < 45) {
        insights.push({
          type: "project",
          project: project.project,
          severity: project.risk_level,
          text: "Project " + project.project + " completion rate is " + project.completion_rate + "%, below the expected delivery baseline.",
          metric: { completion_rate: project.completion_rate }
        });
      }
    });
    anomalies.slice(0, 30).forEach(function (anomaly) {
      var metrics = anomaly.metrics || {};
      if (anomaly.entity_type === "task" && metrics.project_average_hours > 0 && metrics.total_hours >= metrics.project_average_hours * 2) {
        insights.push({
          type: "task",
          project: anomaly.project,
          severity: anomaly.risk_level,
          text: "Task " + anomaly.entity_id + " took " + (metrics.total_hours / metrics.project_average_hours).toFixed(1) + "x more time than the " + anomaly.project + " project average.",
          metric: metrics
        });
      }
      if (anomaly.entity_type === "user" && metrics.total_hours <= 0) {
        insights.push({
          type: "user",
          project: anomaly.project,
          severity: anomaly.risk_level,
          text: "User " + anomaly.entity_id + " is assigned in " + anomaly.project + " but has no recorded activity.",
          metric: metrics
        });
      }
    });
    if (kpis.risk_level === "High") {
      insights.unshift({
        type: "portfolio",
        project: null,
        severity: "High",
        text: "Portfolio risk is high: global health is " + kpis.project_health_score + "/100 with " + kpis.task_completion_rate + "% task completion.",
        metric: { health_score: kpis.project_health_score, completion_rate: kpis.task_completion_rate }
      });
    }
    return insights.slice(0, 50);
  }

  function generateRecommendations(anomalies, insights) {
    var recommendations = anomalies.slice(0, 40).map(function (anomaly) {
      var base = {
        entity_type: anomaly.entity_type,
        entity_id: anomaly.entity_id,
        project: anomaly.project,
        priority: anomaly.score >= 70 ? "High" : anomaly.score >= 40 ? "Medium" : "Low",
        score: anomaly.score
      };
      if (anomaly.entity_type === "user") {
        base.problem = anomaly.entity_id + " shows " + anomaly.reason + " in " + anomaly.project + ".";
        base.suggested_action = "Validate assignment, reassign blocked work, or rebalance tasks with active contributors.";
      } else if (anomaly.entity_type === "task") {
        base.problem = "Task " + anomaly.entity_id + " has " + anomaly.reason + ".";
        base.suggested_action = "Review estimation, split the task if needed, and investigate time tracking consistency.";
      } else {
        base.problem = "Project " + anomaly.entity_id + " has elevated delivery risk from " + anomaly.reason + ".";
        base.suggested_action = "Run a project health review, close stale tasks, and balance workload across contributors.";
      }
      return base;
    });
    if (!recommendations.length && insights.length) {
      recommendations.push({
        entity_type: "portfolio",
        entity_id: "all",
        project: null,
        priority: "Low",
        score: 0,
        problem: "No major anomalies were detected in the current data slice.",
        suggested_action: "Keep monitoring completion rate, workload balance, and time tracking quality."
      });
    }
    return recommendations;
  }

  function rankings(projects, users) {
    var userTotals = {};
    users.forEach(function (item) {
      if (!userTotals[item.user]) userTotals[item.user] = { user: item.user, total_hours: 0, tasks: 0 };
      userTotals[item.user].total_hours += item.total_hours;
      userTotals[item.user].tasks += item.tasks;
    });
    return {
      worst_projects: projects.slice().sort(function (a, b) { return a.health_score - b.health_score; }).slice(0, 10),
      best_users: Object.keys(userTotals).map(function (key) {
        return {
          user: userTotals[key].user,
          total_hours: Number(userTotals[key].total_hours.toFixed(2)),
          tasks: userTotals[key].tasks
        };
      }).sort(function (a, b) { return b.total_hours - a.total_hours; }).slice(0, 10)
    };
  }

  function buildReport(rawRows, options) {
    options = options || {};
    var rows = normalizeRows(rawRows);
    if (options.project) {
      rows = rows.filter(function (row) { return row.project === String(options.project).toUpperCase(); });
    }
    var tasks = buildTaskMetrics(rows);
    var users = buildUserContributions(rows);
    var anomalies = detectAnomalies(rows, tasks, users);
    var projects = buildProjects(rows, tasks, anomalies);
    var kpis = buildKpis(rows, tasks, anomalies);
    var insights = generateInsights(projects, anomalies, kpis);
    var recommendations = generateRecommendations(anomalies, insights);
    return {
      meta: {
        source: "dashboard_dataset.csv",
        project_filter: options.project || null,
        rows: rows.length,
        schema_version: "static-1.0"
      },
      kpis: kpis,
      projects: projects,
      tasks: tasks.slice(0, 500),
      users: users,
      anomalies: anomalies.slice(0, 100),
      insights: insights,
      recommendations: recommendations,
      rankings: rankings(projects, users),
      charts: {
        project_hours: projects.slice().sort(function (a, b) { return b.total_hours - a.total_hours; }).map(function (item) {
          return { label: item.project, value: item.total_hours };
        }),
        project_health: projects.map(function (item) {
          return { label: item.project, value: item.health_score, color: item.risk_color };
        }),
        user_contribution: users.slice(0, 25).map(function (item) {
          return { label: item.user, project: item.project, value: item.total_hours };
        })
      },
      pdf_ready: {
        title: "Advanced Analytics Report",
        sections: [
          { heading: "Executive KPIs", items: kpis },
          { heading: "Top Insights", items: insights.slice(0, 10) },
          { heading: "Recommendations", items: recommendations.slice(0, 10) }
        ]
      }
    };
  }

  function toCsv(report) {
    var rows = [["type", "project", "entity", "score", "risk_level", "problem", "suggested_action"]];
    report.anomalies.forEach(function (item) {
      rows.push([item.entity_type, item.project || "", item.entity_id, item.score, item.risk_level, item.reason, ""]);
    });
    report.recommendations.forEach(function (item) {
      rows.push([item.entity_type, item.project || "", item.entity_id, item.score, item.priority, item.problem, item.suggested_action]);
    });
    return rows.map(function (row) {
      return row.map(function (value) {
        value = String(value == null ? "" : value);
        return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
      }).join(",");
    }).join("\n");
  }

  window.AdvancedAnalyticsEngine = {
    parseCsv: parseCsv,
    normalizeRows: normalizeRows,
    buildReport: buildReport,
    toCsv: toCsv
  };
})();
