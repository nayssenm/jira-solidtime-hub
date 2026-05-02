(function () {
  'use strict';

  try {
    if (window._healthWidgetLoaded) return;
    window._healthWidgetLoaded = true;

  /* ── Palette matching styles.css Midnight Sapphire ── */
  const COLOR = {
    good:     '#0CB87A',
    medium:   '#E8A020',
    critical: '#E8522A',
    sa:  '#1E6FD9', sa3: '#5BA3F5',
    or:  '#E8A020', em:  '#0CB87A',
    li:  '#8B5CF6', text3: '#4A6A9A',
  };

  /* ══════════════════════════════════════════════════════════════
     ANALYSIS ENGINE — pure JS, mirrors health_api.py logic
  ══════════════════════════════════════════════════════════════ */

  function gini(values) {
    /* Gini inequality coefficient (0 = perfect equal, 1 = all to one) */
    const arr = [...values].sort((a, b) => a - b);
    const n   = arr.length;
    const sum = arr.reduce((s, v) => s + v, 0);
    if (n === 0 || sum === 0) return 0;
    let cumsum = 0;
    arr.forEach((v, i) => { cumsum += v * (2 * (i + 1) - n - 1); });
    return cumsum / (n * sum);
  }

  function scoreBalance(rows) {
    /* 0-100: penalise when one user dominates hours */
    const anomalies = [], insights = [];
    const byUser = {};
    rows.forEach(r => {
      const u = (r.User || 'Unknown').trim();
      byUser[u] = (byUser[u] || 0) + parseFloat(r.duration_hours || 0);
    });
    const vals    = Object.values(byUser);
    const users   = Object.keys(byUser);
    const total   = vals.reduce((s, v) => s + v, 0);
    const maxVal  = Math.max(...vals);
    const maxUser = users[vals.indexOf(maxVal)];
    const topPct  = total > 0 ? (maxVal / total * 100) : 0;
    const avg     = vals.length > 0 ? total / vals.length : 0;

    let score = 100;

    if (topPct > 70) {
      score -= 50;
      anomalies.push(`🔴 Surcharge : ${maxUser} assure ${topPct.toFixed(0)}% des heures (${maxVal.toFixed(1)}h / ${total.toFixed(1)}h)`);
      insights.push(`Un membre (${maxUser}) fait la quasi-totalité du travail. Redistribuez les tâches.`);
    } else if (topPct > 60) {
      score -= 30;
      anomalies.push(`🟠 Concentration élevée : ${maxUser} assure ${topPct.toFixed(0)}% des heures`);
      insights.push(`La charge n'est pas bien répartie. ${maxUser} porte une part disproportionnée.`);
    }

    /* Inactive users: below 15% of average */
    const inactive = users.filter(u => byUser[u] < avg * 0.15);
    if (inactive.length > 0 && users.length > 2) {
      score -= Math.min(inactive.length * 10, 20);
      anomalies.push(`🟡 Membres peu actifs : ${inactive.join(', ')} (< 15% de la moyenne)`);
      insights.push(`${inactive.length} membre(s) ont une activité très faible. Vérifiez leur implication.`);
    }

    if (users.length === 1) {
      score = Math.max(score - 20, 0);
      insights.push('Ce projet n\'a qu\'un seul contributeur — aucune collaboration.');
    }

    return { score: Math.max(0, Math.min(100, score)), anomalies, insights };
  }

  function scoreCoverage(rows) {
    /* 0-100: penalise missing testing/QA/documentation phases */
    const anomalies = [], insights = [];
    const text = rows.map(r =>
      [(r.Tags || ''), (r['Issue Type'] || r.Issue_Type || ''), (r.Description || '')].join(' ').toLowerCase()
    ).join(' ');

    const hasTesting = /test(ing)?|qa|quality|recette/.test(text);
    const hasDoc     = /doc(umentation)?|readme|spec(ification)?|wiki/.test(text);
    const hasReview  = /review|code.?review|relecture/.test(text);

    let score   = 100;
    const missing = [];

    if (!hasTesting) {
      score -= 40;
      missing.push('Testing / QA');
      anomalies.push('🔴 Phase de test absente — aucune tâche tagguée Testing ou QA');
      insights.push('Aucune activité de test ou QA détectée. Risque élevé de bugs non identifiés.');
    }
    if (!hasDoc) {
      score -= 30;
      missing.push('Documentation');
      anomalies.push('🟡 Phase documentation absente');
      insights.push('Aucune tâche de documentation trouvée. Ajoutez-en pour la maintenabilité.');
    }
    if (!hasReview) {
      score -= 20;
      insights.push('Aucune activité de code review détectée. Les reviews améliorent la qualité.');
    }

    if (missing.length > 0) {
      insights.unshift(`Phases manquantes : ${missing.join(', ')}.`);
    }

    return { score: Math.max(0, Math.min(100, score)), anomalies, insights };
  }

  function scoreCollaboration(rows) {
    /* 0-100: based on team size and Gini inequality */
    const anomalies = [], insights = [];
    const byUser = {};
    rows.forEach(r => {
      const u = (r.User || 'Unknown').trim();
      byUser[u] = (byUser[u] || 0) + parseFloat(r.duration_hours || 0);
    });
    const nUsers = Object.keys(byUser).length;
    const g      = gini(Object.values(byUser));
    let score    = 100 - g * 80;

    if (nUsers < 2) {
      score = Math.max(score - 40, 0);
      anomalies.push('🔴 Collaboration faible : 1 seul contributeur sur ce projet');
      insights.push('Un seul membre contribue. Risque de dépendance clé. Impliquez d\'autres membres.');
    } else if (nUsers < 3 && rows.length > 50) {
      score = Math.max(score - 20, 0);
      anomalies.push(`🟠 Équipe réduite : ${nUsers} contributeurs pour ${rows.length} entrées`);
      insights.push('Collaboration faible : trop peu de personnes pour ce volume de travail.');
    }

    if (g > 0.6) {
      anomalies.push(`🔴 Inégalité forte (Gini=${g.toFixed(2)}) — travail concentré sur peu de membres`);
      insights.push('La répartition du travail est très inégale. Certains membres portent beaucoup plus que d\'autres.');
    } else if (g > 0.4) {
      insights.push('Léger déséquilibre de charge. Un rééquilibrage améliorerait le moral de l\'équipe.');
    }

    return { score: Math.max(0, Math.min(100, score)), anomalies, insights };
  }

  function computeHealth(rows, projectName) {
    /* Full diagnostic for a set of rows belonging to one project */
    if (!rows || rows.length === 0) {
      return {
        project: projectName, score: 0, label: 'Aucune donnée', color: COLOR.text3,
        anomalies: ['Aucune donnée disponible pour ce projet'],
        insights:  ['Aucun enregistrement — vérifiez les filtres ou la source de données'],
        breakdown: { balance: 0, coverage: 0, collaboration: 0 }, stats: {}
      };
    }

    const W = { balance: 40, coverage: 30, collaboration: 30 };
    const b = scoreBalance(rows);
    const c = scoreCoverage(rows);
    const k = scoreCollaboration(rows);

    const finalScore = Math.round(
      b.score * W.balance / 100 +
      c.score * W.coverage / 100 +
      k.score * W.collaboration / 100
    );

    let label, color, emoji;
    if (finalScore >= 75)      { label = 'Bon';           color = COLOR.good;     emoji = '🟢'; }
    else if (finalScore >= 45) { label = 'Risque Moyen';  color = COLOR.medium;   emoji = '🟡'; }
    else                       { label = 'Critique';      color = COLOR.critical;  emoji = '🔴'; }

    /* Stats */
    const byUser  = {};
    rows.forEach(r => {
      const u = (r.User || 'Unknown').trim();
      byUser[u] = (byUser[u] || 0) + parseFloat(r.duration_hours || 0);
    });
    const totalH  = Object.values(byUser).reduce((s, v) => s + v, 0);
    const nUsers  = Object.keys(byUser).length;
    const topUser = Object.entries(byUser).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
    const months  = new Set(rows.map(r => (r.month_solid || '').slice(0, 7)).filter(Boolean)).size;
    const done    = rows.filter(r => (r.Status || '').toLowerCase().replace(' ', '_') === 'done').length;

    /* Deduplicate */
    const uniq = arr => [...new Map(arr.map(a => [a.slice(0, 50), a])).values()];
    const allAnomalies = uniq([...b.anomalies, ...c.anomalies, ...k.anomalies]);
    const allInsights  = uniq([...b.insights,  ...c.insights,  ...k.insights]);

    if (finalScore >= 75 && allAnomalies.length === 0) {
      allAnomalies.push('✅ Aucun problème critique détecté');
      allInsights.push('Ce projet présente une bonne santé globale. Maintenez le rythme actuel.');
    }

    return {
      project:   projectName,
      score:     finalScore,
      label:     `${emoji} ${label}`,
      color,
      anomalies: allAnomalies,
      insights:  allInsights,
      breakdown: {
        balance:       Math.round(b.score),
        coverage:      Math.round(c.score),
        collaboration: Math.round(k.score),
      },
      stats: {
        total_hours:    +totalH.toFixed(1),
        total_entries:  rows.length,
        unique_users:   nUsers,
        active_months:  months,
        top_user:       topUser[0],
        top_user_hours: +topUser[1].toFixed(1),
        top_user_pct:   totalH > 0 ? +(topUser[1] / totalH * 100).toFixed(1) : 0,
        avg_hours_user: nUsers > 0 ? +(totalH / nUsers).toFixed(1) : 0,
        done_pct:       rows.length > 0 ? +(done / rows.length * 100).toFixed(1) : 0,
      },
      weights: { balance: W.balance, coverage: W.coverage, collaboration: W.collaboration },
    };
  }

  /* ══════════════════════════════════════════════════════════════
     CSS INJECTION
  ══════════════════════════════════════════════════════════════ */
  function injectCSS() {
    if (document.getElementById('hw2CSS')) return;
    const s = document.createElement('style');
    s.id = 'hw2CSS';
    s.textContent = `
      #healthWidget2{margin-bottom:28px;animation:fadeUp .6s cubic-bezier(.4,0,.2,1) .15s both;}
      .hw2-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;}
      .hw2-title{font-family:var(--font-d,'Lora',serif);font-size:17px;font-weight:600;color:var(--text);}
      .hw2-sub{font-size:11px;color:var(--text3);margin-top:2px;}
      .hw2-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:var(--radius,10px);border:1px solid var(--border);background:var(--surf);color:var(--text2);font-family:var(--font-b,sans-serif);font-size:11px;font-weight:500;cursor:pointer;transition:all .22s;}
      .hw2-btn:hover{border-color:#1E6FD9;color:#1E6FD9;}
      .hw2-btn.prim{background:linear-gradient(135deg,#1E6FD9,#1558B0);color:#D6E8FF;border-color:transparent;}
      .hw2-btn.prim:hover{box-shadow:0 4px 14px rgba(30,111,217,.38);}
      /* Grid */
      .hw2-grid{display:grid;grid-template-columns:210px 1fr;gap:14px;margin-bottom:14px;}
      @media(max-width:760px){.hw2-grid{grid-template-columns:1fr;}}
      /* Score card */
      .hw2-score-card{background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg,14px);padding:22px 18px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;position:relative;overflow:hidden;}
      .hw2-score-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--hw2c,#1E6FD9);transition:background .4s;}
      .hw2-ring-wrap{position:relative;width:110px;height:110px;}
      .hw2-ring{transform:rotate(-90deg);}
      .hw2-ring-bg{fill:none;stroke:var(--border);stroke-width:10;}
      .hw2-ring-fill{fill:none;stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1),stroke .4s;}
      .hw2-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
      .hw2-score-num{font-family:var(--font-d,'Lora',serif);font-size:28px;font-weight:700;color:var(--text);line-height:1;}
      .hw2-score-denom{font-size:10px;color:var(--text3);}
      .hw2-pill{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.04em;border:1px solid transparent;transition:all .4s;}
      .hw2-proj-name{font-family:var(--font-m,monospace);font-size:9px;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      /* Breakdown */
      .hw2-breakdown{background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg,14px);padding:18px 20px;}
      .hw2-bd-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:14px;}
      .hw2-bar-row{margin-bottom:12px;}
      .hw2-bar-row:last-child{margin-bottom:0;}
      .hw2-bar-lbl{display:flex;justify-content:space-between;margin-bottom:4px;}
      .hw2-bar-name{font-size:12px;font-weight:500;color:var(--text2);}
      .hw2-bar-weight{font-size:9px;color:var(--text3);}
      .hw2-bar-val{font-family:var(--font-m,monospace);font-size:11px;font-weight:600;color:var(--text3);}
      .hw2-track{height:6px;background:var(--border);border-radius:3px;overflow:hidden;}
      .hw2-fill{height:100%;border-radius:3px;width:0%;transition:width 1s cubic-bezier(.4,0,.2,1);}
      /* Stats chips */
      .hw2-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border2,rgba(91,163,245,.07));}
      .hw2-chip{display:flex;flex-direction:column;align-items:center;padding:5px 10px;border-radius:var(--radius,10px);background:var(--badge-bg,rgba(30,111,217,.10));flex:1;min-width:60px;}
      .hw2-chip-val{font-family:var(--font-m,monospace);font-size:14px;font-weight:700;color:var(--text);}
      .hw2-chip-lbl{font-size:8px;color:var(--text3);text-align:center;margin-top:1px;}
      /* Bottom lists */
      .hw2-bottom{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
      @media(max-width:760px){.hw2-bottom{grid-template-columns:1fr;}}
      .hw2-list-card{background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg,14px);padding:16px 18px;}
      .hw2-list-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:7px;}
      .hw2-list-badge{font-family:var(--font-m,monospace);font-size:9px;font-weight:600;padding:2px 7px;border-radius:12px;}
      .hw2-list-item{padding:8px 0;border-bottom:1px solid var(--border2,rgba(91,163,245,.07));font-size:12px;color:var(--text2);line-height:1.6;}
      .hw2-list-item:last-child{border-bottom:none;padding-bottom:0;}
      /* All-projects table */
      .hw2-table-wrap{overflow-x:auto;background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg,14px);}
      .hw2-table{width:100%;border-collapse:collapse;font-size:12px;min-width:560px;}
      .hw2-table thead tr{background:var(--surf2,rgba(30,111,217,.12));}
      .hw2-table th{padding:9px 13px;text-align:left;font-family:var(--font-m,monospace);font-size:9px;font-weight:500;letter-spacing:.10em;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);}
      .hw2-table td{padding:9px 13px;border-bottom:1px solid var(--border2,rgba(91,163,245,.07));color:var(--text2);transition:background .15s;}
      .hw2-table tr:hover td{background:var(--row-hover,rgba(30,111,217,.06));}
      .hw2-table tr:last-child td{border-bottom:none;}
      .hw2-mini-bar{display:flex;align-items:center;gap:6px;}
      .hw2-mini-track{flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden;min-width:50px;}
      .hw2-mini-fill{height:100%;border-radius:3px;}
      .hw2-score-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-weight:700;font-size:11px;}
      .hw2-proj-link{cursor:pointer;color:#1E6FD9;font-weight:600;text-decoration:underline;text-underline-offset:2px;}
      .hw2-proj-link:hover{color:#E8A020;}
      /* Loading */
      .hw2-loading{display:flex;align-items:center;justify-content:center;padding:38px;gap:10px;font-size:13px;color:var(--text3);}
      .hw2-spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:#1E6FD9;border-radius:50%;animation:hw2spin .7s linear infinite;flex-shrink:0;}
      @keyframes hw2spin{to{transform:rotate(360deg);}}
      /* Error */
      .hw2-notice{padding:16px 18px;border-radius:var(--radius-lg,14px);background:rgba(232,160,32,.07);border:1px solid rgba(232,160,32,.25);border-left:3px solid #E8A020;font-size:12px;color:var(--text3);}
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     HTML CONTAINER INJECTION
  ══════════════════════════════════════════════════════════════ */
  function injectContainer() {
    if (document.getElementById('healthWidget2')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'healthWidget2';

    const div = document.createElement('div');
    div.className = 'sec-div';
    div.innerHTML = '<div class="sec-dot"></div>Diagnostic Santé Projet — Analyse Intelligente';
    wrapper.appendChild(div);

    const body = document.createElement('div');
    body.id = 'hw2Body';
    body.innerHTML = `<div class="hw2-loading"><div class="hw2-spinner"></div><span>En attente des données…</span></div>`;
    wrapper.appendChild(body);

    /* Insert after the monthly chart grid */
    const monthly = document.querySelector('.chart-grid.span-full');
    if (monthly) {
      monthly.insertAdjacentElement('afterend', wrapper);
    } else {
      const page = document.querySelector('.sb-page');
      if (page) page.appendChild(wrapper);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     RENDERING
  ══════════════════════════════════════════════════════════════ */

  function scoreColor(s) {
    return s >= 75 ? COLOR.good : s >= 45 ? COLOR.medium : COLOR.critical;
  }

  function renderSingle(data) {
    const body   = document.getElementById('hw2Body');
    if (!body) return;
    const accent = scoreColor(data.score);
    const circ   = 2 * Math.PI * 47;
    const dash   = circ * data.score / 100;
    const bd     = data.breakdown || {};
    const st     = data.stats    || {};
    const wt     = data.weights  || { balance:40, coverage:30, collaboration:30 };

    const bars = [
      { name:'Équilibre charge', key:'balance',       color:COLOR.sa,  w:wt.balance },
      { name:'Couverture phases',key:'coverage',      color:COLOR.em,  w:wt.coverage },
      { name:'Collaboration',    key:'collaboration', color:COLOR.or,  w:wt.collaboration },
    ];

    const topLine = st.top_user
      ? `${st.top_user} · ${st.top_user_hours}h (${st.top_user_pct}%)`
      : '—';

    body.innerHTML = `
      <div class="hw2-header">
        <div>
          <div class="hw2-title">Diagnostic — ${data.project}</div>
          <div class="hw2-sub">${st.total_entries||0} entrées · ${st.unique_users||0} membres actifs · ${st.active_months||0} mois</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="hw2-btn" onclick="window._hw2All()">📊 Tous les projets</button>
          <button class="hw2-btn prim" onclick="window._hw2Refresh()">🔄 Actualiser</button>
        </div>
      </div>

      <div class="hw2-grid">
        <!-- Score ring -->
        <div class="hw2-score-card" style="--hw2c:${accent}">
          <div class="hw2-ring-wrap">
            <svg class="hw2-ring" viewBox="0 0 110 110" width="110" height="110">
              <circle class="hw2-ring-bg"   cx="55" cy="55" r="47"/>
              <circle class="hw2-ring-fill" cx="55" cy="55" r="47"
                id="hw2RingFill"
                stroke="${accent}"
                stroke-dasharray="${circ}"
                stroke-dashoffset="${circ}"/>
            </svg>
            <div class="hw2-ring-center">
              <span class="hw2-score-num" id="hw2Num">0</span>
              <span class="hw2-score-denom">/ 100</span>
            </div>
          </div>
          <span class="hw2-pill" id="hw2Pill"
            style="background:${accent}22;color:${accent};border-color:${accent}55;">
            ${data.label}
          </span>
          <span class="hw2-proj-name">${data.project}</span>
        </div>

        <!-- Breakdown + stats -->
        <div class="hw2-breakdown">
          <div class="hw2-bd-title">Décomposition du score</div>
          ${bars.map(bar => `
            <div class="hw2-bar-row">
              <div class="hw2-bar-lbl">
                <span class="hw2-bar-name">${bar.name}
                  <span class="hw2-bar-weight">(${bar.w}%)</span>
                </span>
                <span class="hw2-bar-val">${bd[bar.key]||0} / 100</span>
              </div>
              <div class="hw2-track">
                <div class="hw2-fill" style="background:${bar.color};" data-t="${bd[bar.key]||0}"></div>
              </div>
            </div>
          `).join('')}
          <div class="hw2-chips">
            <div class="hw2-chip">
              <span class="hw2-chip-val">${st.total_hours||0}h</span>
              <span class="hw2-chip-lbl">Total heures</span>
            </div>
            <div class="hw2-chip">
              <span class="hw2-chip-val">${st.unique_users||0}</span>
              <span class="hw2-chip-lbl">Membres</span>
            </div>
            <div class="hw2-chip">
              <span class="hw2-chip-val">${st.done_pct||0}%</span>
              <span class="hw2-chip-lbl">Done</span>
            </div>
            <div class="hw2-chip" style="flex:2;min-width:120px;">
              <span class="hw2-chip-val" style="font-size:10px;font-family:var(--font-b,sans-serif);">${topLine}</span>
              <span class="hw2-chip-lbl">Top contributeur</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Anomalies + Insights -->
      <div class="hw2-bottom">
        <div class="hw2-list-card">
          <div class="hw2-list-title">
            ⚠️ Anomalies
            <span class="hw2-list-badge" style="background:rgba(232,82,42,.14);color:#E8522A;">
              ${data.anomalies.length}
            </span>
          </div>
          ${data.anomalies.map(a => `<div class="hw2-list-item">${a}</div>`).join('')}
        </div>
        <div class="hw2-list-card">
          <div class="hw2-list-title">
            💡 Recommandations
            <span class="hw2-list-badge" style="background:rgba(30,111,217,.14);color:#5BA3F5;">
              ${data.insights.length}
            </span>
          </div>
          ${data.insights.map(i => `<div class="hw2-list-item">${i}</div>`).join('')}
        </div>
      </div>`;

    /* Animate */
    requestAnimationFrame(() => {
      setTimeout(() => {
        const fill = document.getElementById('hw2RingFill');
        const numEl = document.getElementById('hw2Num');
        if (fill) fill.style.strokeDashoffset = String(circ - dash);
        let cur = 0, tgt = data.score;
        const tmr = setInterval(() => {
          cur = Math.min(cur + Math.ceil(tgt / 40), tgt);
          if (numEl) numEl.textContent = cur;
          if (cur >= tgt) clearInterval(tmr);
        }, 22);
        document.querySelectorAll('.hw2-fill[data-t]').forEach(el => {
          setTimeout(() => { el.style.width = el.dataset.t + '%'; }, 80);
        });
      }, 60);
    });
  }

  function renderAll(results) {
    const body = document.getElementById('hw2Body');
    if (!body) return;

    const rows = results.map(p => {
      const col = scoreColor(p.score);
      return `<tr>
        <td>
          <span class="hw2-proj-link" onclick="window._hw2Project('${p.project}')">
            ${p.project}
          </span>
        </td>
        <td>
          <div class="hw2-mini-bar">
            <div class="hw2-mini-track">
              <div class="hw2-mini-fill" style="width:${p.score}%;background:${col};"></div>
            </div>
            <span class="hw2-score-pill" style="background:${col}22;color:${col};">
              ${p.score}
            </span>
          </div>
        </td>
        <td>${p.label}</td>
        <td style="color:#5BA3F5;font-weight:600;">${p.stats.unique_users||0}</td>
        <td style="color:#E8A020;font-family:var(--font-m,monospace);">${p.stats.total_hours||0}h</td>
        <td style="color:#E8522A;font-size:11px;">${p.anomalies.filter(a=>!a.includes('✅')).length}</td>
        <td>
          <button class="hw2-btn" style="padding:3px 9px;font-size:10px;"
            onclick="window._hw2Project('${p.project}')">
            Détails →
          </button>
        </td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="hw2-header">
        <div>
          <div class="hw2-title">Vue d'ensemble — ${results.length} projets analysés</div>
          <div class="hw2-sub">Classés par score croissant — cliquez un projet pour le détail</div>
        </div>
        <button class="hw2-btn prim" onclick="window._hw2Refresh()">🔄 Actualiser</button>
      </div>
      <div class="hw2-table-wrap">
        <table class="hw2-table">
          <thead>
            <tr>
              <th>Projet</th><th>Score</th><th>Statut</th>
              <th>Membres</th><th>Heures</th><th>Anomalies</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════════
     DATA ACCESS — reads static data embedded by dashboard.html
  ══════════════════════════════════════════════════════════════ */

  function normalizeRow(row) {
    return {
      ...row,
      User: row.User || 'Unknown',
      Project: row.Project || 'Unknown',
      Status: row.Status || 'other',
      Tags: row.Tags || '',
      Description: row.Description || '',
      duration_hours: Number(row.duration_hours ?? row.h ?? row.heures ?? 0) || 0,
      month_solid: row.month_solid || row.m || '',
      Task_key: row.Task_key || row.k || '',
    };
  }

  function getData() {
    /* Static dashboard data is embedded as RAW; older builds may expose raw. */
    const source = Array.isArray(window.RAW)
      ? window.RAW
      : Array.isArray(window.raw)
        ? window.raw
        : [];
    return source.map(normalizeRow).filter(r => r.duration_hours > 0);
  }

  function getCurrentProject() {
    const el = document.getElementById('fProj') || document.getElementById('fP');
    return el ? el.value.trim() : '';
  }

  function runAnalysis(project) {
    const data = getData();
    const body = document.getElementById('hw2Body');
    if (!body) return;

    if (!data || data.length === 0) {
      body.innerHTML = `
        <div class="hw2-notice">
          ⏳ Les données ne sont pas encore chargées. Attendez quelques secondes puis cliquez 🔄 Actualiser.
          <br><br>
          <button class="hw2-btn prim" onclick="window._hw2Refresh()" style="margin-top:6px;">🔄 Réessayer</button>
        </div>`;
      return;
    }

    if (project) {
      const rows = data.filter(r =>
        (r.Project || '').trim().toUpperCase() === project.toUpperCase()
      );
      renderSingle(computeHealth(rows, project));
    } else {
      const projects = [...new Set(data.map(r => (r.Project || '').trim()).filter(Boolean))].sort();
      const results  = projects
        .map(p => computeHealth(data.filter(r => (r.Project||'').trim() === p), p))
        .sort((a, b) => a.score - b.score);
      renderAll(results);
    }
  }

  function safeRunAnalysis(project) {
    try {
      runAnalysis(project);
    } catch (err) {
      console.warn('[health-widget] Diagnostic skipped:', err);
      const body = document.getElementById('hw2Body');
      if (body) {
        body.innerHTML = `
          <div class="hw2-notice">
            Diagnostic santé indisponible pour le moment. Le reste du dashboard reste utilisable.
            <br><br>
            <button class="hw2-btn prim" onclick="window._hw2Refresh()" style="margin-top:6px;">🔄 Réessayer</button>
          </div>`;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════ */

  window._hw2Project = project => safeRunAnalysis(project);
  window._hw2All     = ()      => safeRunAnalysis('');
  window._hw2Refresh = ()      => safeRunAnalysis(getCurrentProject());

  /* ══════════════════════════════════════════════════════════════
     HOOK INTO EXISTING FILTER CHANGES
  ══════════════════════════════════════════════════════════════ */

  function hookFilters() {
    const filters = ['fProj', 'fP', 'fU', 'fS', 'fMf', 'fMt']
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (!filters.length) return;
    let timer = null;
    filters.forEach(filter => filter.addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(() => safeRunAnalysis(getCurrentProject()), 500);
    }));
  }

  /* ══════════════════════════════════════════════════════════════
     PATCH applyFilters — re-run diagnostic after every filter
  ══════════════════════════════════════════════════════════════ */

  function patchDashboardRefresh(attempts = 50) {
    const refreshName =
      typeof window.applyFilters === 'function' ? 'applyFilters' :
      typeof window.upd === 'function' ? 'upd' :
      '';

    if (!refreshName) {
      if (attempts > 0) setTimeout(() => patchDashboardRefresh(attempts - 1), 100);
      return;
    }
    if (window._hw2Patched) return;
    window._hw2Patched = true;
    const orig = window[refreshName];
    window[refreshName] = function (...args) {
      const result = orig.apply(this, args);
      setTimeout(() => safeRunAnalysis(getCurrentProject()), 200);
      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════════
     INIT — wait until `raw` is populated
  ══════════════════════════════════════════════════════════════ */

  function waitForData(attempts) {
    const data = getData();
    if (data && data.length > 0) {
      safeRunAnalysis(getCurrentProject());
    } else if (attempts > 0) {
      setTimeout(() => waitForData(attempts - 1), 600);
    } else {
      const body = document.getElementById('hw2Body');
      if (body) body.innerHTML = `
        <div class="hw2-notice">
          ⚠️ Données non disponibles (mode démo ou CSV non chargé).
          <br><br>
          <button class="hw2-btn prim" onclick="window._hw2Refresh()" style="margin-top:6px;">🔄 Réessayer</button>
        </div>`;
    }
  }

  function init() {
    injectCSS();
    injectContainer();
    hookFilters();
    patchDashboardRefresh();
    /* Give dashboard.html up to 15 seconds to load its CSV */
    waitForData(25);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  } catch (err) {
    console.warn('[health-widget] Widget disabled safely:', err);
  }
})();
