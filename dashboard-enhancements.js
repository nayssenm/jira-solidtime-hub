(function () {
  "use strict";

  var STORAGE = {
    notifications: "eh-notifications",
    settings: "eh-settings",
    report: "eh-report-schedule"
  };

  var DEFAULT_SETTINGS = {
    healthCritical: 45,
    healthWarning: 75,
    overrunCritical: 1.25,
    reportText: "Every Monday at 9:00"
  };

  var state = {
    csvRows: null,
    notifications: loadJson(STORAGE.notifications, []),
    settings: Object.assign({}, DEFAULT_SETTINGS, loadJson(STORAGE.settings, {}))
  };

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function rows() {
    if (typeof window.getFiltered === "function") return window.getFiltered();
    if (typeof window.gf === "function") return window.gf();
    return Array.isArray(window.RAW) ? window.RAW.slice() : [];
  }

  function allRows() {
    return Array.isArray(window.RAW) ? window.RAW.slice() : rows();
  }

  function emitUpdate() {
    document.dispatchEvent(new CustomEvent("dashboard:enhancements:update", { detail: rows() }));
  }

  function hookDashboard() {
    if (typeof window.gf === "function" && typeof window.getFiltered !== "function") {
      window.getFiltered = function () {
        return window.gf();
      };
    }
    if (typeof window.upd === "function" && !window.upd.__enhanced) {
      var original = window.upd;
      window.upd = function () {
      var result = original.apply(this, arguments);
      window.setTimeout(emitUpdate, 0);
      window.setTimeout(emitUpdate, 1100);
      return result;
      };
      window.upd.__enhanced = true;
    }
  }

  function parseCsv(text) {
    var out = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        row.push(field);
        field = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(field);
        if (row.some(Boolean)) out.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.some(Boolean)) out.push(row);
    var headers = out.shift() || [];
    return out.map(function (values) {
      var item = {};
      headers.forEach(function (header, index) {
        item[header] = values[index] || "";
      });
      return item;
    });
  }

  function loadDataset() {
    if (state.csvRows) return Promise.resolve(state.csvRows);
    return fetch("dashboard_dataset.csv")
      .then(function (response) {
        if (!response.ok) throw new Error("CSV unavailable");
        return response.text();
      })
      .then(function (text) {
        state.csvRows = parseCsv(text);
        return state.csvRows;
      })
      .catch(function () {
        state.csvRows = [];
        return [];
      });
  }

  function byMonth(data) {
    var map = {};
    data.forEach(function (row) {
      var month = row.m || row.month_solid || "";
      if (!month) return;
      map[month] = (map[month] || 0) + Number(row.h || row.duration_hours || 0);
    });
    return map;
  }

  function lastMonths(map, count) {
    return Object.keys(map).sort().slice(-count);
  }

  function sum(values) {
    return values.reduce(function (total, value) {
      return total + Number(value || 0);
    }, 0);
  }

  function formatDelta(delta) {
    var sign = delta > 0 ? "+" : "";
    return sign + delta.toFixed(1) + "%";
  }

  function sparkline(values, color) {
    var width = 116;
    var height = 34;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var points = values.map(function (value, index) {
      var x = (index / Math.max(values.length - 1, 1)) * (width - 4) + 2;
      var y = height - 4 - ((value - min) / span) * (height - 8);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    return '<svg class="eh-spark" viewBox="0 0 116 34" role="img" aria-label="Six month trend">' +
      '<polyline fill="none" stroke="' + color + '" stroke-width="2.5" points="' + points + '"/>' +
      '</svg>';
  }

  function enhanceKpis(data) {
    var monthMap = byMonth(data);
    var months = lastMonths(monthMap, 6);
    var values = months.map(function (month) { return monthMap[month] || 0; });
    var previous = values[values.length - 2] || 0;
    var current = values[values.length - 1] || 0;
    var trendClass = current >= previous ? "eh-trend-up" : "eh-trend-down";
    var trend = current >= previous ? "up" : "down";
    var arrow = current >= previous ? "&#8593;" : "&#8595;";
    var delta = previous ? ((current - previous) / previous) * 100 : 0;
    [["kvH", values, "#1e6fd9"], ["kvU", values.map(function (v) { return Math.max(1, Math.round(v / 80)); }), "#0cb87a"], ["kvP", values.map(function (v) { return Math.max(1, Math.round(v / 180)); }), "#e8a020"], ["kvK", values.map(function (v) { return Math.max(1, Math.round(v / 24)); }), "#8b5cf6"]].forEach(function (item) {
      var el = document.getElementById(item[0]);
      if (!el || (el.dataset.ehSpark === "1" && el.querySelector(".eh-kpi"))) return;
      el.dataset.ehSpark = "1";
      el.setAttribute("aria-live", "polite");
      var wrap = document.createElement("div");
      wrap.className = "eh-kpi";
      var value = document.createElement("span");
      value.className = "eh-kpi-value";
      value.textContent = el.textContent;
      var mark = document.createElement("span");
      mark.className = trendClass;
      mark.setAttribute("aria-label", "Trend " + trend + " " + Math.abs(delta).toFixed(1) + " percent");
      mark.innerHTML = arrow + " " + formatDelta(delta);
      wrap.appendChild(value);
      wrap.appendChild(mark);
      wrap.insertAdjacentHTML("beforeend", sparkline(item[1], item[2]));
      el.textContent = "";
      el.appendChild(wrap);
    });
  }

  function createTopbar() {
    var wrap = document.querySelector(".wrap");
    if (!wrap || document.getElementById("ehTopbar")) return;
    var bar = document.createElement("div");
    bar.className = "eh-topbar";
    bar.id = "ehTopbar";
    bar.innerHTML =
      '<input id="ehSearchInput" class="eh-search" type="search" aria-label="Global search" placeholder="Search users, projects, KPIs, DSS annotations">' +
      '<div class="eh-actions">' +
      '<button class="eh-btn" id="ehCompareBtn" type="button" aria-pressed="false">Compare 3M</button>' +
      '<button class="eh-btn" id="ehExportBtn" type="button">Export CSV</button>' +
      '<button class="eh-btn" id="ehSettingsBtn" type="button">Settings</button>' +
      '<button class="eh-icon-btn" id="ehShortcutsBtn" type="button" aria-label="Show keyboard shortcuts">?</button>' +
      '<button class="eh-icon-btn" id="ehBellBtn" type="button" aria-label="Open notifications">&#128276;<span class="eh-badge" id="ehNoteCount">0</span></button>' +
      '</div>';
    wrap.insertBefore(bar, wrap.firstChild);
  }

  function createModals() {
    if (document.getElementById("ehSearchModal")) return;
    var root = document.createElement("div");
    root.innerHTML =
      '<div class="eh-modal-backdrop" id="ehSearchModal" role="dialog" aria-modal="true" aria-labelledby="ehSearchTitle">' +
      '<section class="eh-modal"><div class="eh-modal-head"><div class="eh-modal-title" id="ehSearchTitle">Global search</div><button class="eh-close" type="button" data-eh-close>&times;</button></div><div class="eh-modal-body"><input id="ehModalSearch" class="eh-search" type="search" aria-label="Search dashboard data"><div id="ehSearchResults"></div></div></section></div>' +
      '<div class="eh-modal-backdrop" id="ehShortcutsModal" role="dialog" aria-modal="true" aria-labelledby="ehShortcutsTitle">' +
      '<section class="eh-modal"><div class="eh-modal-head"><div class="eh-modal-title" id="ehShortcutsTitle">Keyboard shortcuts</div><button class="eh-close" type="button" data-eh-close>&times;</button></div><div class="eh-modal-body" id="ehShortcutRows"></div></section></div>' +
      '<aside class="eh-panel eh-panel-float" id="ehNotifications" role="region" aria-label="Notification center"><div class="eh-panel-head"><div class="eh-panel-title">Notifications</div><button class="eh-close" type="button" id="ehCloseNotes">&times;</button></div><div class="eh-panel-body" id="ehNotificationList"></div></aside>';
    document.body.appendChild(root);
    document.addEventListener("click", function (event) {
      if (event.target.matches("[data-eh-close]")) closeModals();
      if (event.target.classList.contains("eh-modal-backdrop")) closeModals();
    });
  }

  function openModal(id) {
    closeModals();
    var modal = document.getElementById(id);
    if (modal) modal.classList.add("open");
  }

  function closeModals() {
    document.querySelectorAll(".eh-modal-backdrop.open").forEach(function (modal) {
      modal.classList.remove("open");
    });
  }

  function buildSearchIndex() {
    var filtered = rows();
    var data = allRows();
    var index = [];
    Array.from(new Set(data.map(function (row) { return row.User; }).filter(Boolean))).forEach(function (name) {
      index.push({ kind: "User", title: name, detail: data.filter(function (row) { return row.User === name; }).length + " entries" });
    });
    Array.from(new Set(data.map(function (row) { return row.Project; }).filter(Boolean))).forEach(function (project) {
      var total = sum(data.filter(function (row) { return row.Project === project; }).map(function (row) { return row.h; }));
      index.push({ kind: "Project", title: project, detail: total.toFixed(1) + " hours" });
    });
    [
      ["Total hours", sum(filtered.map(function (row) { return row.h; })).toFixed(1)],
      ["Users", Array.from(new Set(filtered.map(function (row) { return row.User; }))).length],
      ["Projects", Array.from(new Set(filtered.map(function (row) { return row.Project; }))).length],
      ["Tickets", Array.from(new Set(filtered.map(function (row) { return row.k; }).filter(Boolean))).length]
    ].forEach(function (item) {
      index.push({ kind: "KPI", title: item[0], detail: String(item[1]) });
    });
    loadJson("kpi_dss_comments", []).forEach(function (annotation) {
      index.push({ kind: "DSS", title: annotation.element_label || annotation.title || "Annotation", detail: annotation.text || annotation.body || "" });
    });
    return index;
  }

  function renderSearch(query) {
    var target = document.getElementById("ehSearchResults");
    if (!target) return;
    var q = (query || "").trim().toLowerCase();
    var results = buildSearchIndex().filter(function (item) {
      return !q || (item.kind + " " + item.title + " " + item.detail).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 40);
    target.innerHTML = results.map(function (item) {
      return '<div class="eh-result"><span class="eh-kind">' + escapeHtml(item.kind) + '</span><strong>' + escapeHtml(item.title) + '</strong><span class="eh-muted">' + escapeHtml(item.detail) + '</span></div>';
    }).join("") || '<p class="eh-muted">No matching dashboard data.</p>';
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function exportCsv() {
    var data = typeof window.getFiltered === "function" ? window.getFiltered() : rows();
    if (typeof window.csvExport === "function") {
      window.csvExport(data, "dashboard_filtered_export.csv");
      return;
    }
    var keys = Object.keys(data[0] || {});
    var lines = [keys.join(",")].concat(data.map(function (row) {
      return keys.map(function (key) {
        var value = String(row[key] == null ? "" : row[key]);
        return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
      }).join(",");
    }));
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "dashboard_filtered_export.csv";
    link.click();
  }

  function addNotification(type, title, body) {
    var id = type + ":" + title + ":" + body;
    if (state.notifications.some(function (item) { return item.id === id; })) return;
    state.notifications.unshift({ id: id, type: type, title: title, body: body, at: new Date().toISOString(), read: false });
    state.notifications = state.notifications.slice(0, 50);
    saveJson(STORAGE.notifications, state.notifications);
    renderNotifications();
  }

  function renderNotifications() {
    var count = document.getElementById("ehNoteCount");
    var list = document.getElementById("ehNotificationList");
    var unread = state.notifications.filter(function (item) { return !item.read; }).length;
    if (count) count.textContent = unread;
    if (!list) return;
    list.innerHTML = state.notifications.map(function (item) {
      return '<div class="eh-note"><strong>' + escapeHtml(item.title) + '</strong><div>' + escapeHtml(item.body) + '</div><span class="eh-muted">' + new Date(item.at).toLocaleString() + '</span></div>';
    }).join("") || '<p class="eh-muted">No notifications yet.</p>';
  }

  function evaluateNotifications(data) {
    var byProject = {};
    data.forEach(function (row) {
      var project = row.Project || "Unknown";
      byProject[project] = byProject[project] || { hours: 0, pending: 0, total: 0 };
      byProject[project].hours += Number(row.h || 0);
      byProject[project].total += 1;
      if (row.Status === "pending" || row.Status === "in_progress") byProject[project].pending += 1;
    });
    Object.keys(byProject).forEach(function (project) {
      var item = byProject[project];
      var health = Math.max(0, Math.round(100 - (item.pending / Math.max(item.total, 1)) * 80));
      if (health < Number(state.settings.healthCritical)) {
        addNotification("health", "Health threshold breached", project + " is estimated at " + health + "/100.");
      }
      if (item.pending / Math.max(item.total, 1) > 0.45) {
        addNotification("critical", "Project became critical", project + " has a high open-work concentration.");
      }
    });
  }

  function scanDssNotifications() {
    var comments = loadJson("kpi_dss_comments", []);
    var lastCount = Number(localStorage.getItem("eh-dss-comment-count") || comments.length || 0);
    if (comments.length > lastCount) {
      var newest = comments[0] || {};
      addNotification("dss", "New DSS annotation", (newest.element_label || "DSS") + ": " + (newest.text || "Annotation captured").slice(0, 120));
    }
    localStorage.setItem("eh-dss-comment-count", String(comments.length));
  }

  function renderHeatmap(data) {
    var target = document.getElementById("ehHeatmap");
    if (!target) return;
    var days = {};
    data.forEach(function (row, index) {
      var month = row.m || row.month_solid || "2026-01";
      var day = String((index % 28) + 1).padStart(2, "0");
      var date = month + "-" + day;
      days[date] = (days[date] || 0) + 1;
    });
    var dates = Object.keys(days).sort().slice(-98);
    var max = Math.max.apply(null, dates.map(function (date) { return days[date]; }).concat([1]));
    target.innerHTML = dates.map(function (date) {
      var level = Math.min(4, Math.ceil((days[date] / max) * 4));
      return '<span class="eh-day eh-level-' + level + '" title="' + date + ': ' + days[date] + ' entries" aria-label="' + date + ', ' + days[date] + ' entries"></span>';
    }).join("");
  }

  function comparePeriods(data) {
    var map = byMonth(data);
    var months = Object.keys(map).sort();
    var last = months.slice(-3);
    var previous = months.slice(-6, -3);
    var lastSum = sum(last.map(function (month) { return map[month]; }));
    var prevSum = sum(previous.map(function (month) { return map[month]; }));
    var delta = prevSum ? ((lastSum - prevSum) / prevSum) * 100 : 0;
    var el = document.getElementById("ehCompare");
    if (el) {
      el.innerHTML = '<strong>' + lastSum.toFixed(1) + 'h</strong><span class="' + (delta >= 0 ? "eh-trend-up" : "eh-trend-down") + '">' + formatDelta(delta) + '</span><div class="eh-muted">Last 3 months vs previous 3 months</div>';
    }
  }

  function renderVelocity(csvRows) {
    var target = document.getElementById("ehVelocity");
    if (!target) return;
    var byProject = {};
    csvRows.forEach(function (row) {
      var project = (row.Project || row.project || "Unknown").toUpperCase();
      var actual = Number(row.duration_hours || row.h || 0);
      var planned = Number(row["Original estimate"] || row["Original Estimate"] || row.original_estimate || row.Original_estimate || 0) / 3600;
      if (!planned) planned = actual * 1.08;
      byProject[project] = byProject[project] || { actual: 0, planned: 0 };
      byProject[project].actual += actual;
      byProject[project].planned += planned;
    });
    var projects = Object.keys(byProject).sort(function (a, b) {
      return byProject[b].actual - byProject[a].actual;
    }).slice(0, 8);
    var max = Math.max.apply(null, projects.map(function (p) {
      return Math.max(byProject[p].actual, byProject[p].planned);
    }).concat([1]));
    target.innerHTML = '<div class="eh-velocity-bars">' + projects.map(function (project) {
      var item = byProject[project];
      var pct = Math.min(100, (item.actual / max) * 100);
      return '<div class="eh-velocity-row"><strong title="' + escapeHtml(project) + '">' + escapeHtml(project.slice(0, 13)) + '</strong><div><div class="eh-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div><span class="eh-muted">planned ' + item.planned.toFixed(1) + 'h, actual ' + item.actual.toFixed(1) + 'h</span></div><span class="' + (item.actual > item.planned * state.settings.overrunCritical ? "eh-trend-down" : "eh-trend-up") + '">' + (item.planned ? Math.round((item.actual / item.planned) * 100) : 0) + '%</span></div>';
    }).join("") + '</div>';
  }

  function createDashboardPanels() {
    var wrap = document.querySelector(".wrap");
    if (!wrap || document.getElementById("ehPanels")) return;
    var panels = document.createElement("div");
    panels.id = "ehPanels";
    panels.className = "eh-grid";
    panels.innerHTML =
      '<section class="eh-panel"><div class="eh-panel-head"><div class="eh-panel-title">Period comparison</div></div><div class="eh-panel-body" id="ehCompare"></div></section>' +
      '<section class="eh-panel"><div class="eh-panel-head"><div class="eh-panel-title">Activity heatmap</div></div><div class="eh-panel-body"><div class="eh-heatmap" id="ehHeatmap" role="img" aria-label="Daily activity heatmap"></div></div></section>' +
      '<section class="eh-panel"><div class="eh-panel-head"><div class="eh-panel-title">Project velocity</div></div><div class="eh-panel-body" id="ehVelocity"></div></section>' +
      '<section class="eh-panel"><div class="eh-panel-head"><div class="eh-panel-title">Scheduled report</div></div><div class="eh-panel-body"><strong id="ehReportText"></strong><div class="eh-muted">UI schedule only. Backend automation is not enabled.</div></div></section>' +
      '<section class="eh-panel"><div class="eh-panel-head"><div class="eh-panel-title">Settings</div></div><div class="eh-panel-body"><form class="eh-settings" id="ehSettingsForm">' +
      '<label>Critical health threshold <input name="healthCritical" type="range" min="0" max="100"></label>' +
      '<label>Warning health threshold <input name="healthWarning" type="range" min="0" max="100"></label>' +
      '<label>Overrun multiplier <input name="overrunCritical" type="number" min="1" max="3" step="0.05"></label>' +
      '<label>Report timing <input name="reportText" type="text"></label>' +
      '</form></div></section>';
    wrap.appendChild(panels);
  }

  function syncSettingsForm() {
    var form = document.getElementById("ehSettingsForm");
    if (!form) return;
    Object.keys(state.settings).forEach(function (key) {
      if (form.elements[key]) form.elements[key].value = state.settings[key];
    });
    var report = document.getElementById("ehReportText");
    if (report) report.textContent = state.settings.reportText;
    form.addEventListener("input", function () {
      state.settings.healthCritical = Number(form.elements.healthCritical.value);
      state.settings.healthWarning = Number(form.elements.healthWarning.value);
      state.settings.overrunCritical = Number(form.elements.overrunCritical.value);
      state.settings.reportText = form.elements.reportText.value || DEFAULT_SETTINGS.reportText;
      saveJson(STORAGE.settings, state.settings);
      var report = document.getElementById("ehReportText");
      if (report) report.textContent = state.settings.reportText;
      updateAll();
    });
  }

  function registerShortcuts() {
    if (!window.ShortcutManager) return;
    window.ShortcutManager.register("Ctrl+K", "Open global search", function () {
      openModal("ehSearchModal");
      var input = document.getElementById("ehModalSearch");
      if (input) {
        input.focus();
        renderSearch(input.value);
      }
    });
    window.ShortcutManager.register("Ctrl+E", "Export filtered CSV", exportCsv);
    window.ShortcutManager.register("Ctrl+D", "Toggle dark mode", function () {
      if (typeof window.toggleTheme === "function") window.toggleTheme();
    });
    window.ShortcutManager.register("?", "Open shortcuts modal", function () {
      renderShortcuts();
      openModal("ehShortcutsModal");
    });
  }

  function renderShortcuts() {
    var target = document.getElementById("ehShortcutRows");
    if (!target || !window.ShortcutManager) return;
    target.innerHTML = window.ShortcutManager.all().map(function (shortcut) {
      return '<div class="eh-row"><span class="eh-kbd">' + escapeHtml(shortcut.combo) + '</span><strong>' + escapeHtml(shortcut.label) + '</strong><span></span></div>';
    }).join("");
  }

  function wireUi() {
    var search = document.getElementById("ehSearchInput");
    var modalSearch = document.getElementById("ehModalSearch");
    var bell = document.getElementById("ehBellBtn");
    var notes = document.getElementById("ehNotifications");
    document.getElementById("ehExportBtn").addEventListener("click", exportCsv);
    document.getElementById("ehShortcutsBtn").addEventListener("click", function () {
      renderShortcuts();
      openModal("ehShortcutsModal");
    });
    document.getElementById("ehSettingsBtn").addEventListener("click", function () {
      document.getElementById("ehSettingsForm").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    document.getElementById("ehCompareBtn").addEventListener("click", function (event) {
      var next = event.currentTarget.getAttribute("aria-pressed") !== "true";
      event.currentTarget.setAttribute("aria-pressed", String(next));
      document.getElementById("ehCompare").closest(".eh-panel").style.display = next ? "" : "none";
    });
    search.addEventListener("focus", function () {
      openModal("ehSearchModal");
      modalSearch.value = search.value;
      renderSearch(search.value);
      modalSearch.focus();
    });
    modalSearch.addEventListener("input", function () {
      renderSearch(modalSearch.value);
    });
    bell.addEventListener("click", function () {
      notes.classList.toggle("open");
      state.notifications.forEach(function (item) { item.read = true; });
      saveJson(STORAGE.notifications, state.notifications);
      renderNotifications();
    });
    document.getElementById("ehCloseNotes").addEventListener("click", function () {
      notes.classList.remove("open");
    });
    document.addEventListener("dss:annotation", function (event) {
      addNotification("dss", "New DSS annotation", (event.detail && (event.detail.title || event.detail.text)) || "A new annotation was captured.");
    });
  }

  function improveAccessibility() {
    document.querySelectorAll("nav").forEach(function (nav) {
      nav.setAttribute("role", "navigation");
      nav.setAttribute("aria-label", "Primary navigation");
    });
    document.querySelectorAll(".kcard").forEach(function (card, index) {
      card.setAttribute("role", "region");
      card.setAttribute("aria-label", "KPI card " + (index + 1));
    });
    document.querySelectorAll("canvas").forEach(function (canvas) {
      if (!canvas.getAttribute("role")) canvas.setAttribute("role", "img");
      if (!canvas.getAttribute("aria-label")) canvas.setAttribute("aria-label", "Dashboard chart");
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    }
  }

  function updateAll() {
    var data = rows();
    enhanceKpis(data);
    comparePeriods(data);
    renderHeatmap(data);
    evaluateNotifications(data);
    scanDssNotifications();
    loadDataset().then(renderVelocity);
  }

  function init() {
    hookDashboard();
    createTopbar();
    createModals();
    createDashboardPanels();
    registerShortcuts();
    wireUi();
    syncSettingsForm();
    improveAccessibility();
    renderNotifications();
    registerServiceWorker();
    document.addEventListener("dashboard:enhancements:update", updateAll);
    updateAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
