/* ═══════════════════════════════════════════════════════════════
   KPI HUB — SHARED JAVASCRIPT
   Used by: kpi.html · dashboard.html · data-warehouse.html
   ═══════════════════════════════════════════════════════════════ */

/* ─── AUTH GUARD ──────────────────────────────────────────────── */
(function () {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('share');
  if (!token && localStorage.getItem('kpi_auth') !== 'true') {
    window.location.href = 'login.html';
  }
})();

/* ─── THEME ───────────────────────────────────────────────────── */
const HTML = document.documentElement;

(function initTheme() {
  const saved = localStorage.getItem('kpi-theme') || 'light';
  HTML.setAttribute('data-theme', saved);
  syncToggleLabel(saved);
})();

function toggleTheme() {
  const isDark = HTML.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  HTML.setAttribute('data-theme', next);
  localStorage.setItem('kpi-theme', next);
  syncToggleLabel(next);
}

function syncToggleLabel(theme) {
  const lbl = document.getElementById('togLabel');
  if (lbl) lbl.textContent = theme === 'dark' ? 'Sombre' : 'Clair';
}

/* ─── ACTIVE NAV LINK ─────────────────────────────────────────── */
(function markActiveNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href === path || (path === '' && href === 'kpi.html')) {
      link.classList.add('active');
    }
  });
})();

/* ─── USER INFO ───────────────────────────────────────────────── */
(function loadUser() {
  const u = JSON.parse(localStorage.getItem('kpi_current_user') || 'null');
  if (!u) return;
  const name = (u.name || u.email || 'Admin').split('@')[0];
  const els  = document.querySelectorAll('.js-user-name');
  const avts = document.querySelectorAll('.js-user-avatar');
  const eml  = document.querySelectorAll('.js-user-email');
  els.forEach(el => el.textContent = name);
  avts.forEach(el => el.textContent = name[0].toUpperCase());
  eml.forEach(el  => el.textContent = u.email || '—');
  // nav user chip
  const navName = document.getElementById('navUserName');
  if (navName) navName.textContent = name;
  const navAvt = document.getElementById('navAvatar');
  if (navAvt) navAvt.textContent = name[0].toUpperCase();
})();

/* ─── LOGOUT ──────────────────────────────────────────────────── */
function logout() {
  localStorage.removeItem('kpi_auth');
  localStorage.removeItem('kpi_current_user');
  window.location.href = 'login.html';
}

/* ─── TOAST ───────────────────────────────────────────────────── */
function showToast(msg, icon = '✓') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ─── SHARE MODAL ─────────────────────────────────────────────── */
let _perm = 'viewer';

function openShare() {
  const ov = document.getElementById('shareOverlay');
  if (!ov) return;
  document.getElementById('shareLinkRow').style.display = 'none';
  const note = document.getElementById('shareNote');
  if (note) note.style.display = 'none';
  ov.classList.add('open');
}
function closeShare() {
  const ov = document.getElementById('shareOverlay');
  if (ov) ov.classList.remove('open');
}
function closeShareBg(e) {
  if (e.target === document.getElementById('shareOverlay')) closeShare();
}
function selectPerm(el, perm) {
  document.querySelectorAll('.perm-opt').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
  _perm = perm;
  document.getElementById('shareLinkRow').style.display = 'none';
  const note = document.getElementById('shareNote');
  if (note) note.style.display = 'none';
}
function generateLink() {
  const payload = { perm: _perm, ts: Date.now(), id: Math.random().toString(36).slice(2, 9) };
  const token   = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const base    = window.location.href.split('?')[0].split('#')[0];
  const url     = `${base}?share=${token}`;

  const inp = document.getElementById('shareLinkInput');
  if (inp) inp.value = url;
  document.getElementById('shareLinkRow').style.display = 'flex';

  const labels = { viewer: 'Lecteur', editor: 'Éditeur', restricted: 'Accès restreint' };
  const note   = document.getElementById('shareNote');
  if (note) { note.textContent = `Lien valide 7 jours · Permission : ${labels[_perm]}`; note.style.display = 'block'; }
}
async function copyShareLink() {
  const val = document.getElementById('shareLinkInput')?.value;
  if (!val) return;
  try { await navigator.clipboard.writeText(val); }
  catch {
    const ta = document.createElement('textarea'); ta.value = val;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
  const btn = document.getElementById('copyLinkBtn');
  if (btn) { btn.innerHTML = '<span>✓</span>'; setTimeout(() => btn.innerHTML = '<span>📋</span>', 2500); }
  showToast('Lien copié dans le presse-papier !');
}

/* ─── HANDLE INCOMING SHARE TOKEN ────────────────────────────── */
(function handleShareToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('share');
  if (!token) return;
  try {
    const data   = JSON.parse(decodeURIComponent(escape(atob(token))));
    const age    = Date.now() - data.ts;
    const banner = document.getElementById('shareBanner');
    const permEl = document.getElementById('sharePerm');
    const labels = { viewer: 'Lecteur', editor: 'Éditeur', restricted: 'Accès restreint' };
    if (!banner) return;
    if (age > 7 * 24 * 60 * 60 * 1000) {
      banner.style.background = 'rgba(248,113,113,0.1)';
      banner.style.borderColor = 'rgba(248,113,113,0.3)';
      document.getElementById('shareBannerText').textContent = '⚠ Ce lien a expiré (7 jours)';
      if (permEl) { permEl.textContent = 'Expiré'; permEl.style.color = '#f87171'; }
    } else {
      if (document.getElementById('shareBannerText'))
        document.getElementById('shareBannerText').textContent = 'Vous consultez un dashboard partagé';
      if (permEl) permEl.textContent = labels[data.perm] || data.perm;
    }
    banner.classList.add('show');
  } catch { showToast('Lien de partage invalide', '⚠'); }
})();

/* ─── PDF EXPORT (universal) ─────────────────────────────────── */
async function exportPDF() {
  const btn = document.getElementById('pdfBtn');
  if (!btn) return;
  btn.setAttribute('disabled', '');
  btn.innerHTML = '<span>⏳</span> Export…';
  showToast('Génération du PDF…', '📄');
  await new Promise(r => setTimeout(r, 600));

  try {
    const { jsPDF } = window.jspdf;
    const pdf       = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297, M = 12, COL = (PW - M * 3) / 2;
    const isDark = HTML.getAttribute('data-theme') === 'dark';
    const bgR = isDark ? 14  : 250;
    const bgG = isDark ? 11  : 249;
    const bgB = isDark ? 11  : 244;

    function addChart(id, x, y, w, h) {
      const src = document.getElementById(id); if (!src) return;
      const off = document.createElement('canvas'); off.width = src.width; off.height = src.height;
      const ctx = off.getContext('2d');
      ctx.fillStyle = isDark ? '#1c1515' : '#ffffff'; ctx.fillRect(0, 0, off.width, off.height);
      ctx.drawImage(src, 0, 0);
      pdf.addImage(off.toDataURL('image/jpeg', .93), 'JPEG', x, y, w, h);
    }

    // ── PAGE 1 — header ──
    pdf.setFillColor(128, 0, 32); pdf.rect(0, 0, PW, 15, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
    const pageTitle = document.title.replace(' — KPI Hub', '') || 'KPI Hub';
    pdf.text(pageTitle, M, 10);
    pdf.setFontSize(6.5); pdf.setFont('helvetica', 'normal');
    pdf.text(new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }), PW - M, 10, { align: 'right' });

    let y = 19;

    // ── KPI cards ──
    const kpiMeta = [
      ['kpiH', 'Total Heures'], ['kpiP', 'Projets'], ['kpiU', 'Utilisateurs'], ['kpiT', 'Tickets'],
      ['totalHours', 'Total Heures'], ['totalUsers', 'Utilisateurs'], ['totalProjects', 'Projets'],
      ['kpiTotalH', 'Total Heures'], ['kpiTotalT', 'Total Tickets'],
    ];
    const found = kpiMeta.filter(([id]) => document.getElementById(id));
    if (found.length) {
      const kw = (PW - M * 2 - (found.length - 1) * 2) / Math.min(found.length, 4);
      found.slice(0, 4).forEach(([id, lbl], i) => {
        const x = M + i * (kw + 2);
        const val = document.getElementById(id)?.textContent || '—';
        pdf.setFillColor(isDark ? 28 : 255, isDark ? 21 : 255, isDark ? 21 : 255);
        pdf.roundedRect(x, y, kw, 15, 1.5, 1.5, 'F');
        pdf.setFillColor(128, 0, 32); pdf.rect(x, y, kw, 1, 'F');
        pdf.setTextColor(168, 153, 145); pdf.setFontSize(4.5); pdf.setFont('helvetica', 'normal');
        pdf.text(lbl.toUpperCase(), x + 2, y + 6);
        pdf.setTextColor(128, 0, 32); pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
        pdf.text(val, x + 2, y + 13);
      });
      y += 19;
    }

    // ── Charts ── (all canvas elements on the page)
    const canvases = document.querySelectorAll('canvas');
    const canvasIds = [...canvases].map(c => c.id).filter(Boolean);
    const pairs = [];
    for (let i = 0; i < canvasIds.length; i += 2) pairs.push(canvasIds.slice(i, i + 2));

    for (const pair of pairs) {
      if (y + 50 > PH - 20) { pdf.addPage(); y = 15; }
      if (pair.length === 2) {
        pdf.setFillColor(isDark ? 28 : 255, isDark ? 21 : 255, isDark ? 21 : 255);
        pdf.roundedRect(M, y, COL, 48, 1.5, 1.5, 'F');
        pdf.roundedRect(M + COL + M, y, COL, 48, 1.5, 1.5, 'F');
        addChart(pair[0], M + 2, y + 8, COL - 4, 38);
        addChart(pair[1], M + COL + M + 2, y + 8, COL - 4, 38);
        y += 52;
      } else if (pair.length === 1) {
        pdf.setFillColor(isDark ? 28 : 255, isDark ? 21 : 255, isDark ? 21 : 255);
        pdf.roundedRect(M, y, PW - M * 2, 48, 1.5, 1.5, 'F');
        addChart(pair[0], M + 2, y + 8, PW - M * 2 - 4, 38);
        y += 52;
      }
    }

    // ── Footer ──
    pdf.setFillColor(128, 0, 32); pdf.rect(0, PH - 10, PW, 10, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(6); pdf.setFont('helvetica', 'normal');
    pdf.text('Généré par KPI Hub · ' + new Date().toLocaleString('fr-FR'), PW / 2, PH - 3.5, { align: 'center' });

    pdf.save('kpi-hub-' + new Date().toISOString().slice(0, 10) + '.pdf');
    showToast('PDF exporté avec succès !');
  } catch (e) {
    console.error('PDF error:', e);
    showToast('Erreur PDF : ' + e.message, '⚠');
  } finally {
    btn.removeAttribute('disabled');
    btn.innerHTML = '<span>⬇</span> PDF';
  }
}

/* ─── KEYBOARD SHORTCUTS ──────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeShare();
});

/* ─── COUNTER ANIMATION ───────────────────────────────────────── */
function animateNum(el, target, decimals = 0) {
  if (!el) return;
  const dur = 1100, start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = decimals ? (target * e).toFixed(decimals) : Math.round(target * e);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
