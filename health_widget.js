

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────
  const API_BASE  = 'http://localhost:5050';
  const WIDGET_ID = 'healthDiagnosticWidget';

  /* Palette matching styles.css Midnight Sapphire */
  const C = {
    sa:   '#1E6FD9', sa3:  '#5BA3F5',
    or:   '#E8A020', co:   '#E8522A',
    em:   '#0CB87A', li:   '#8B5CF6',
    text: '#D6E8FF', text2:'#A8CBFA', text3:'#4A6A9A',
    surf: 'var(--surf)', card:'var(--card)',
    border:'var(--border)',
    good:    '#0CB87A',
    medium:  '#E8A020',
    critical:'#E8522A',
    na:      '#64748b',
  };

  // ── Inject CSS ──────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('healthWidgetCSS')) return;
    const style = document.createElement('style');
    style.id = 'healthWidgetCSS';
    style.textContent = `
      /* ── Health Widget Styles ───────────────────────────────── */
      #${WIDGET_ID} {
        margin-bottom: 28px;
        animation: fadeUp .6s cubic-bezier(.4,0,.2,1) .1s both;
      }

      .hw-header {
        display: flex; align-items: center; justify-content: space-between;
        flex-wrap: wrap; gap: 10px; margin-bottom: 14px;
      }
      .hw-title {
        font-family: var(--font-d, 'Lora', serif);
        font-size: 17px; font-weight: 600; color: var(--text);
      }
      .hw-subtitle { font-size: 11px; color: var(--text3); margin-top: 2px; }
      .hw-btn {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 6px 14px; border-radius: var(--radius, 10px);
        border: 1px solid var(--border); background: var(--surf);
        color: var(--text2); font-family: var(--font-b, sans-serif);
        font-size: 11px; font-weight: 500; cursor: pointer;
        transition: all .22s;
      }
      .hw-btn:hover { border-color: var(--sa, #1E6FD9); color: var(--sa, #1E6FD9); }
      .hw-btn:disabled { opacity: .45; cursor: default; pointer-events: none; }
      .hw-btn.primary {
        background: linear-gradient(135deg, #1E6FD9, #1558B0);
        color: #D6E8FF; border-color: transparent;
      }
      .hw-btn.primary:hover { box-shadow: 0 4px 14px rgba(30,111,217,.38); }

      /* Loading skeleton */
      .hw-loading {
        display: flex; align-items: center; justify-content: center;
        padding: 40px; gap: 12px;
        font-size: 13px; color: var(--text3);
      }
      .hw-spinner {
        width: 18px; height: 18px;
        border: 2px solid var(--border);
        border-top-color: #1E6FD9;
        border-radius: 50%;
        animation: hwSpin .7s linear infinite;
      }
      @keyframes hwSpin { to { transform: rotate(360deg); } }

      /* Error state */
      .hw-error {
        padding: 18px 20px; border-radius: var(--radius-lg, 14px);
        background: rgba(232,82,42,.07); border: 1px solid rgba(232,82,42,.25);
        border-left: 3px solid #E8522A;
        font-size: 12px; color: var(--text3);
      }
      .hw-error strong { color: #E8522A; }

      /* ── Score card grid ─── */
      .hw-grid {
        display: grid;
        grid-template-columns: 220px 1fr;
        gap: 14px;
        margin-bottom: 14px;
      }
      @media (max-width: 768px) {
        .hw-grid { grid-template-columns: 1fr; }
      }

      /* Score ring card */
      .hw-score-card {
        background: var(--surf); border: 1px solid var(--border);
        border-radius: var(--radius-lg, 14px);
        padding: 24px 20px; text-align: center;
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        position: relative; overflow: hidden;
      }
      .hw-score-card::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0;
        height: 3px; background: var(--hw-accent, #1E6FD9);
        transition: background .4s;
      }
      .hw-ring-wrap { position: relative; width: 120px; height: 120px; }
      .hw-ring { transform: rotate(-90deg); }
      .hw-ring-bg   { fill: none; stroke: var(--border); stroke-width: 10; }
      .hw-ring-fill {
        fill: none; stroke-width: 10; stroke-linecap: round;
        transition: stroke-dashoffset .9s cubic-bezier(.4,0,.2,1),
                    stroke .4s;
      }
      .hw-ring-text {
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
      }
      .hw-ring-num {
        font-family: var(--font-d, 'Lora', serif);
        font-size: 30px; font-weight: 700; line-height: 1;
        color: var(--text);
      }
      .hw-ring-denom { font-size: 11px; color: var(--text3); }
      .hw-label-pill {
        display: inline-block; padding: 4px 14px;
        border-radius: 20px; font-size: 12px; font-weight: 600;
        letter-spacing: .04em; border: 1px solid transparent;
        transition: background .4s, color .4s, border-color .4s;
      }
      .hw-score-proj {
        font-family: var(--font-m, monospace); font-size: 10px;
        color: var(--text3); letter-spacing: .08em;
        text-transform: uppercase; max-width: 180px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      /* Breakdown bars */
      .hw-breakdown {
        background: var(--surf); border: 1px solid var(--border);
        border-radius: var(--radius-lg, 14px);
        padding: 20px 22px;
      }
      .hw-breakdown-title {
        font-size: 13px; font-weight: 600; color: var(--text);
        margin-bottom: 16px;
      }
      .hw-bar-row { margin-bottom: 14px; }
      .hw-bar-row:last-child { margin-bottom: 0; }
      .hw-bar-label {
        display: flex; justify-content: space-between; align-items: baseline;
        margin-bottom: 5px;
      }
      .hw-bar-name {
        font-size: 12px; font-weight: 500; color: var(--text2);
      }
      .hw-bar-val {
        font-family: var(--font-m, monospace); font-size: 11px;
        font-weight: 600; color: var(--text3);
      }
      .hw-bar-weight {
        font-size: 9px; color: var(--text3); margin-left: 4px;
      }
      .hw-bar-track {
        height: 7px; background: var(--border);
        border-radius: 4px; overflow: hidden;
      }
      .hw-bar-fill {
        height: 100%; border-radius: 4px;
        transition: width 1s cubic-bezier(.4,0,.2,1);
        width: 0%;
      }
      .hw-stats-row {
        display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px;
        padding-top: 14px; border-top: 1px solid var(--border2, rgba(91,163,245,.07));
      }
      .hw-stat-chip {
        display: inline-flex; flex-direction: column; align-items: center;
        padding: 6px 12px; border-radius: var(--radius, 10px);
        background: var(--badge-bg, rgba(30,111,217,.10));
        min-width: 70px; flex: 1;
      }
      .hw-stat-val {
        font-family: var(--font-m, monospace); font-size: 15px;
        font-weight: 700; color: var(--text);
      }
      .hw-stat-lbl { font-size: 9px; color: var(--text3); text-align: center; }

      /* Anomalies + Insights */
      .hw-bottom-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      @media (max-width: 900px) {
        .hw-bottom-grid { grid-template-columns: 1fr; }
      }
      .hw-list-card {
        background: var(--surf); border: 1px solid var(--border);
        border-radius: var(--radius-lg, 14px);
        padding: 18px 20px;
      }
      .hw-list-title {
        font-size: 13px; font-weight: 600; color: var(--text);
        margin-bottom: 12px; display: flex; align-items: center; gap: 7px;
      }
      .hw-list-badge {
        font-family: var(--font-m, monospace); font-size: 9px;
        font-weight: 600; padding: 2px 8px; border-radius: 12px;
      }
      .hw-list-item {
        padding: 9px 0; border-bottom: 1px solid var(--border2, rgba(91,163,245,.07));
        font-size: 12px; color: var(--text2); line-height: 1.6;
      }
      .hw-list-item:last-child { border-bottom: none; padding-bottom: 0; }

      /* All-projects table */
      .hw-table-wrap {
        overflow-x: auto;
        background: var(--surf); border: 1px solid var(--border);
        border-radius: var(--radius-lg, 14px);
      }
      .hw-table {
        width: 100%; border-collapse: collapse; font-size: 12px;
        min-width: 600px;
      }
      .hw-table thead tr {
        background: var(--surf2, rgba(30,111,217,.12));
      }
      .hw-table th {
        padding: 10px 14px; text-align: left;
        font-family: var(--font-m, monospace); font-size: 9px;
        font-weight: 500; letter-spacing: .10em; text-transform: uppercase;
        color: var(--text3); border-bottom: 1px solid var(--border);
      }
      .hw-table td {
        padding: 10px 14px; border-bottom: 1px solid var(--border2, rgba(91,163,245,.07));
        color: var(--text2);
        transition: background .15s;
      }
      .hw-table tr:hover td { background: var(--row-hover, rgba(30,111,217,.06)); }
      .hw-table tr:last-child td { border-bottom: none; }
      .hw-score-pill {
        display: inline-block; padding: 2px 10px; border-radius: 20px;
        font-weight: 700; font-size: 11px;
      }
      .hw-mini-bar-wrap { display: flex; align-items: center; gap: 7px; }
      .hw-mini-bar {
        flex: 1; height: 5px; background: var(--border);
        border-radius: 3px; overflow: hidden; min-width: 60px;
      }
      .hw-mini-fill { height: 100%; border-radius: 3px; }
      .hw-project-link {
        cursor: pointer; color: #1E6FD9; font-weight: 600;
        text-decoration: underline; text-underline-offset: 2px;
      }
      .hw-project-link:hover { color: #E8A020; }
    `;
    document.head.appendChild(style);
  }

  // ── Inject HTML container ────────────────────────────────────────────────
  function injectContainer() {
    if (document.getElementById(WIDGET_ID)) return;

    /* Find the monthly chart section — insert after it */
    const monthly = document.querySelector('.chart-grid.span-full');
    if (!monthly) {
      console.warn('[HealthWidget] Could not find .chart-grid.span-full — appending to .sb-page');
    }

    const wrapper = document.createElement('div');
    wrapper.id = WIDGET_ID;

    /* Section divider */
    const div = document.createElement('div');
    div.className = 'sec-div';
    div.innerHTML = '<div class="sec-dot"></div>Diagnostic Santé Projet — Analyse Intelligente';
    wrapper.appendChild(div);

    /* Widget body */
    const body = document.createElement('div');
    body.id = 'hwBody';
    body.innerHTML = `
      <div class="hw-loading">
        <div class="hw-spinner"></div>
        <span>Démarrage de l'analyse diagnostique…</span>
      </div>`;
    wrapper.appendChild(body);

    if (monthly) {
      monthly.insertAdjacentElement('afterend', wrapper);
    } else {
      const page = document.querySelector('.sb-page');
      if (page) page.appendChild(wrapper);
    }
  }

  // ── Score colour helper ──────────────────────────────────────────────────
  function scoreColor(score) {
    if (score >= 75) return C.good;
    if (score >= 45) return C.medium;
    return C.critical;
  }

  // ── Render: single project diagnostic ────────────────────────────────────
  function renderSingle(data) {
    const body    = document.getElementById('hwBody');
    const accent  = scoreColor(data.score);
    const circ    = 2 * Math.PI * 52;          // circumference for r=52 ring
    const dash    = circ * (data.score / 100);
    const b       = data.breakdown || {};
    const s       = data.stats    || {};
    const weights = data.weights  || { balance: 40, coverage: 30, collaboration: 30 };

    const bars = [
      { name: 'Équilibre de la charge', key: 'balance',       color: C.sa,  weight: weights.balance },
      { name: 'Couverture des phases',  key: 'coverage',      color: C.em,  weight: weights.coverage },
      { name: 'Collaboration équipe',   key: 'collaboration', color: C.or,  weight: weights.collaboration },
    ];

    const topUserLine = s.top_user
      ? `${s.top_user} · ${s.top_user_hours}h (${s.top_user_pct}%)`
      : '—';

    body.innerHTML = `
      <div class="hw-header">
        <div>
          <div class="hw-title">Diagnostic Santé — ${data.project}</div>
          <div class="hw-subtitle">Analyse automatique · ${s.total_entries || 0} entrées · ${s.unique_users || 0} membres</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="hw-btn" onclick="window._hwLoadAll()">📊 Tous les projets</button>
          <button class="hw-btn primary" id="hwRefreshBtn" onclick="window._hwRefresh()">🔄 Actualiser</button>
        </div>
      </div>

      <!-- Score + Breakdown grid -->
      <div class="hw-grid">

        <!-- Score ring -->
        <div class="hw-score-card" style="--hw-accent:${accent}">
          <div class="hw-ring-wrap">
            <svg class="hw-ring" viewBox="0 0 120 120" width="120" height="120">
              <circle class="hw-ring-bg"   cx="60" cy="60" r="52"/>
              <circle class="hw-ring-fill" cx="60" cy="60" r="52"
                id="hwRingFill"
                stroke="${accent}"
                stroke-dasharray="${circ}"
                stroke-dashoffset="${circ}"/>
            </svg>
            <div class="hw-ring-text">
              <span class="hw-ring-num" id="hwScoreNum">0</span>
              <span class="hw-ring-denom">/ 100</span>
            </div>
          </div>
          <span class="hw-label-pill" id="hwLabelPill"
            style="background:${accent}22;color:${accent};border-color:${accent}55;">
            ${data.label}
          </span>
          <span class="hw-score-proj">${data.project}</span>
        </div>

        <!-- Breakdown bars + stats -->
        <div class="hw-breakdown">
          <div class="hw-breakdown-title">Décomposition du score</div>
          ${bars.map(bar => `
            <div class="hw-bar-row">
              <div class="hw-bar-label">
                <span class="hw-bar-name">${bar.name}
                  <span class="hw-bar-weight">(${bar.weight}%)</span>
                </span>
                <span class="hw-bar-val">${b[bar.key] || 0} / 100</span>
              </div>
              <div class="hw-bar-track">
                <div class="hw-bar-fill"
                  style="width:0%;background:${bar.color};"
                  data-target="${b[bar.key] || 0}">
                </div>
              </div>
            </div>
          `).join('')}
          <div class="hw-stats-row">
            <div class="hw-stat-chip">
              <span class="hw-stat-val">${s.total_hours || 0}h</span>
              <span class="hw-stat-lbl">Total heures</span>
            </div>
            <div class="hw-stat-chip">
              <span class="hw-stat-val">${s.unique_users || 0}</span>
              <span class="hw-stat-lbl">Membres actifs</span>
            </div>
            <div class="hw-stat-chip">
              <span class="hw-stat-val">${s.done_pct || 0}%</span>
              <span class="hw-stat-lbl">Tâches Done</span>
            </div>
            <div class="hw-stat-chip" style="flex:2;min-width:140px;">
              <span class="hw-stat-val" style="font-size:11px;">${topUserLine}</span>
              <span class="hw-stat-lbl">Top contributeur</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Anomalies + Insights -->
      <div class="hw-bottom-grid">
        <div class="hw-list-card">
          <div class="hw-list-title">
            ⚠️ Anomalies détectées
            <span class="hw-list-badge"
              style="background:rgba(232,82,42,.14);color:#E8522A;">
              ${data.anomalies.length}
            </span>
          </div>
          ${data.anomalies.map(a =>
            `<div class="hw-list-item">${a}</div>`
          ).join('')}
        </div>
        <div class="hw-list-card">
          <div class="hw-list-title">
            💡 Recommandations
            <span class="hw-list-badge"
              style="background:rgba(30,111,217,.14);color:#5BA3F5;">
              ${data.insights.length}
            </span>
          </div>
          ${data.insights.map(ins =>
            `<div class="hw-list-item">${ins}</div>`
          ).join('')}
        </div>
      </div>`;

    /* Animate score ring */
    requestAnimationFrame(() => {
      setTimeout(() => {
        const fill = document.getElementById('hwRingFill');
        const numEl = document.getElementById('hwScoreNum');
        if (fill) {
          fill.style.strokeDashoffset = String(circ - dash);
        }
        /* Count-up animation */
        let current = 0;
        const target = data.score;
        const step   = Math.ceil(target / 40);
        const timer  = setInterval(() => {
          current = Math.min(current + step, target);
          if (numEl) numEl.textContent = current;
          if (current >= target) clearInterval(timer);
        }, 22);

        /* Animate breakdown bars */
        document.querySelectorAll('.hw-bar-fill[data-target]').forEach(el => {
          const t = parseFloat(el.dataset.target) || 0;
          setTimeout(() => { el.style.width = t + '%'; }, 100);
        });
      }, 50);
    });
  }

  // ── Render: all projects table ───────────────────────────────────────────
  function renderAll(data) {
    const body     = document.getElementById('hwBody');
    const projects = data.projects || [];

    const rows = projects.map(p => {
      const col = scoreColor(p.score);
      const pct = p.score;
      return `<tr>
        <td>
          <span class="hw-project-link"
            onclick="window._hwLoadProject('${p.project}')">
            ${p.project}
          </span>
        </td>
        <td>
          <div class="hw-mini-bar-wrap">
            <div class="hw-mini-bar">
              <div class="hw-mini-fill"
                style="width:${pct}%;background:${col};">
              </div>
            </div>
            <span class="hw-score-pill"
              style="background:${col}22;color:${col};">
              ${p.score}
            </span>
          </div>
        </td>
        <td>${p.label}</td>
        <td style="color:${C.sa3};font-weight:600;">${p.stats.unique_users || 0}</td>
        <td style="color:${C.or};font-family:var(--font-m);">${p.stats.total_hours || 0}h</td>
        <td style="font-size:11px;color:var(--text3);">${p.anomalies.length} anomalie(s)</td>
        <td>
          <button class="hw-btn" style="padding:4px 10px;font-size:10px;"
            onclick="window._hwLoadProject('${p.project}')">
            Détails →
          </button>
        </td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="hw-header">
        <div>
          <div class="hw-title">Vue d'ensemble — ${data.total_projects} projets analysés</div>
          <div class="hw-subtitle">Classés par score croissant · cliquer sur un projet pour le détail</div>
        </div>
        <button class="hw-btn primary" onclick="window._hwRefresh()">🔄 Actualiser</button>
      </div>
      <div class="hw-table-wrap">
        <table class="hw-table">
          <thead>
            <tr>
              <th>Projet</th>
              <th>Score</th>
              <th>Statut</th>
              <th>Membres</th>
              <th>Heures</th>
              <th>Anomalies</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Render: error ─────────────────────────────────────────────────────────
  function renderError(msg) {
    const body = document.getElementById('hwBody');
    if (!body) return;
    body.innerHTML = `
      <div class="hw-error">
        <strong>⚠ API non disponible</strong><br>
        ${msg}<br><br>
        <strong>Solution :</strong>
        <ol style="margin:6px 0 0 16px;line-height:1.8;">
          <li>Vérifiez que <code>health_api.py</code> est lancé :
            <code>python health_api.py</code></li>
          <li>L'API doit écouter sur
            <code><a href="${API_BASE}" target="_blank">${API_BASE}</a></code></li>
          <li><code>dashboard_dataset.csv</code> doit être dans le même dossier.</li>
        </ol>
      </div>`;
  }

  // ── API calls ─────────────────────────────────────────────────────────────
  async function fetchDiagnostic(project) {
    const body = document.getElementById('hwBody');
    if (body) body.innerHTML = `
      <div class="hw-loading">
        <div class="hw-spinner"></div>
        <span>Analyse en cours${project ? ' — ' + project : ''}…</span>
      </div>`;

    const url = project
      ? `${API_BASE}/api/health?project=${encodeURIComponent(project)}`
      : `${API_BASE}/api/health`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} — ${response.statusText}`);
    }
    return response.json();
  }

  // ── Public API (exposed on window) ────────────────────────────────────────
  window._hwLoadProject = async function (project) {
    try {
      const data = await fetchDiagnostic(project);
      renderSingle(data);
    } catch (e) {
      renderError(`Impossible de contacter l'API : ${e.message}`);
    }
  };

  window._hwLoadAll = async function () {
    try {
      const data = await fetchDiagnostic(null);
      renderAll(data);
    } catch (e) {
      renderError(`Impossible de contacter l'API : ${e.message}`);
    }
  };

  window._hwRefresh = function () {
    /* Read the current Project filter from dashboard.html */
    const fProj = document.getElementById('fProj');
    const project = fProj ? fProj.value.trim() : '';
    if (project) {
      window._hwLoadProject(project);
    } else {
      window._hwLoadAll();
    }
  };

  // ── Hook into dashboard filter changes ────────────────────────────────────
  function hookFilters() {
    const fProj = document.getElementById('fProj');
    if (!fProj) return;

    /* Debounced refresh: wait 600ms after filter change */
    let debounceTimer = null;
    const debouncedRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => window._hwRefresh(), 600);
    };

    fProj.addEventListener('change', debouncedRefresh);
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  function init() {
    injectCSS();
    injectContainer();
    hookFilters();

    /* Initial load: use current project filter or load all */
    const fProj   = document.getElementById('fProj');
    const project = fProj ? fProj.value.trim() : '';

    if (project) {
      window._hwLoadProject(project);
    } else {
      /* Try all-projects first; fall back gracefully if API is down */
      window._hwLoadAll().catch(() => {
        /* Silently fail — API may not be started yet */
        const body = document.getElementById('hwBody');
        if (body) body.innerHTML = `
          <div class="hw-error">
            <strong>API Health non démarrée</strong><br>
            Lancez <code>python health_api.py</code> pour activer le diagnostic.
            <br><br>
            <button class="hw-btn primary" onclick="window._hwRefresh()" style="margin-top:8px;">
              🔄 Réessayer
            </button>
          </div>`;
      });
    }
  }

  /* Wait for the dashboard to finish loading its CSV before running */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
  } else {
    setTimeout(init, 800);
  }

})();