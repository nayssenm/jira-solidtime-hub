/* ════════════════════════════════════════════════════════════════
   KPI HUB — SHARED APP.JS  v6.0
   Global: dark mode · auth · nav · toast · share · PDF · task map
════════════════════════════════════════════════════════════════ */

/* ── THEME ──────────────────────────────────────────────────── */
(function(){
  const saved = localStorage.getItem('kpi-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme(){
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('kpi-theme', next);
}

/* ── AUTH ───────────────────────────────────────────────────── */
function logout(){
  localStorage.removeItem('kpi_auth');
  localStorage.removeItem('kpi_current_user');
  window.location.href = 'login.html';
}

function getUser(){
  try { return JSON.parse(localStorage.getItem('kpi_current_user') || 'null'); }
  catch { return null; }
}

(function(){
  const u = getUser();
  if(!u) return;
  const av   = document.getElementById('navAvatar');
  const nm   = document.getElementById('navName');
  const sbAv = document.getElementById('sbAvatar');
  const sbNm = document.getElementById('sbName');
  const sbEm = document.getElementById('sbEmail');
  const n    = (u.name || u.email || 'A').split('@')[0];
  if(av)   av.textContent   = n[0].toUpperCase();
  if(nm)   nm.textContent   = n;
  if(sbAv) sbAv.textContent = n[0].toUpperCase();
  if(sbNm) sbNm.textContent = n;
  if(sbEm) sbEm.textContent = u.email || '';
})();

/* ── TOAST ──────────────────────────────────────────────────── */
function showToast(msg, icon = '✓'){
  const t = document.getElementById('toast');
  if(!t) return;
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ── SHARE MODAL ────────────────────────────────────────────── */
let _sharePerm = 'viewer';

function openShare(){
  const ov = document.getElementById('shareOverlay');
  if(!ov) return;
  ov.classList.add('open');
  document.getElementById('linkRow').style.display  = 'none';
  const sn = document.getElementById('shareNote');
  if(sn) sn.style.display = 'none';
}
function closeShare(){
  const ov = document.getElementById('shareOverlay');
  if(ov) ov.classList.remove('open');
}
function closeShareOnBg(e){
  if(e.target === document.getElementById('shareOverlay')) closeShare();
}
function selPerm(el, perm){
  document.querySelectorAll('.perm').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
  _sharePerm = perm;
  document.getElementById('linkRow').style.display = 'none';
  const sn = document.getElementById('shareNote');
  if(sn) sn.style.display = 'none';
}
function genShareLink(){
  const payload = { perm: _sharePerm, ts: Date.now(), id: Math.random().toString(36).slice(2, 9) };
  const token   = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const isFileProtocol = window.location.protocol === 'file:';
  let url;
  if(isFileProtocol){
    const fileName = window.location.pathname.split('/').pop();
    url = `http://localhost:5500/${fileName}?share=${token}`;
    const inp = document.getElementById('shareLinkInp');
    if(inp) inp.value = url;
    document.getElementById('linkRow').style.display = 'flex';
    const sn = document.getElementById('shareNote');
    if(sn){
      sn.innerHTML = `⚠️ <strong>Vous êtes en mode fichier local</strong>.<br>
        Ce lien fonctionne uniquement via un serveur local (VS Code Live Server ou <code>python -m http.server</code>).`;
      sn.style.display = 'block';
    }
    return;
  }
  const base = window.location.href.split('?')[0].split('#')[0];
  url = `${base}?share=${token}`;
  const inp = document.getElementById('shareLinkInp');
  if(inp) inp.value = url;
  document.getElementById('linkRow').style.display = 'flex';
  const labels = { viewer: 'Lecteur', commenter: 'Commentateur', editor: 'Commentateur', restricted: 'Accès restreint' };
  const sn = document.getElementById('shareNote');
  if(sn){
    sn.textContent = `Lien valide 7 jours · Permission : ${labels[_sharePerm]}`;
    sn.style.display = 'block';
    sn.style.color = '';
  }
}
async function copyShareLink(){
  const val = document.getElementById('shareLinkInp')?.value;
  if(!val) return;
  try{ await navigator.clipboard.writeText(val); }
  catch{
    const ta = document.createElement('textarea');
    ta.value = val;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const btn = document.getElementById('copyBtn');
  if(btn){ btn.innerHTML = '<span>✓</span>'; setTimeout(() => btn.innerHTML = '<span>📋</span>', 2500); }
  showToast('Lien copié dans le presse-papier !');
}

/* ── QUICK SHARE (Web Share API) ────────────────────────────── */
async function quickShare(){
  const url = window.location.href.split('?')[0];
  const title = document.title || 'KPI Hub Report';
  if(navigator.share){
    try{
      await navigator.share({ title, url });
      showToast('Rapport partagé avec succès !');
    } catch(e){
      if(e.name !== 'AbortError') showToast('Partage annulé', '⚠');
    }
  } else {
    try{
      await navigator.clipboard.writeText(url);
      showToast('Lien copié dans le presse-papier !');
    } catch(e){
      showToast('Impossible de copier le lien', '⚠');
    }
  }
}

/* ── INCOMING SHARE TOKEN ───────────────────────────────────── */
(function(){
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('share');
  if(!token) return;
  try{
    const data   = JSON.parse(decodeURIComponent(escape(atob(token))));
    const age    = Date.now() - data.ts;
    const banner = document.getElementById('shareBanner');
    const permEl = document.getElementById('sharePerm');
    const txtEl  = document.getElementById('shareBannerText');
    const labels = { viewer:'Lecteur', commenter:'Commentateur', editor:'Commentateur', restricted:'Accès restreint' };
    if(age > 7*24*60*60*1000){
      if(banner){ banner.style.background='rgba(248,113,113,0.1)'; banner.style.borderColor='rgba(248,113,113,0.3)'; }
      if(txtEl) txtEl.textContent = '⚠ Ce lien a expiré (7 jours max)';
      if(permEl){ permEl.textContent='Expiré'; permEl.style.color='#f87171'; }
    } else {
      if(txtEl) txtEl.textContent = 'Vous consultez ce rapport via un lien partagé';
      if(permEl) permEl.textContent = labels[data.perm] || data.perm;
      if(data.perm === 'restricted') document.documentElement.setAttribute('data-share-perm','restricted');
    }
    if(banner) banner.classList.add('show');
  } catch(err){
    console.warn('Share token parse error:', err);
    showToast('Lien de partage invalide ou corrompu','⚠');
  }
})();

/* ── KEYBOARD ───────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){ closeShare(); }
});

/* ── COUNTER ANIMATION ──────────────────────────────────────── */
function animNum(id, target, dec=0){
  const el = document.getElementById(id);
  if(!el) return;
  const dur = 1000, start = performance.now();
  function f(now){
    const p = Math.min((now-start)/dur, 1), e = 1-Math.pow(1-p, 3);
    el.textContent = dec ? (target*e).toFixed(dec) : Math.round(target*e);
    if(p<1) requestAnimationFrame(f);
  }
  requestAnimationFrame(f);
}

/* ════════════════════════════════════════════════════════════════
   TASK NAME & USER MAPPING ENGINE
   Maps raw IDs to human-readable labels across all pages.
════════════════════════════════════════════════════════════════ */
window.KpiTaskMap = (function(){

  /* Known task name mappings — extend as needed */
  const TASK_NAMES = {
    /* Generic patterns */
    'design':            'Conception de l\'interface',
    'dev':               'Développement du module',
    'test':              'Tests et validation qualité',
    'fix':               'Correction de bugs',
    'review':            'Revue de code',
    'deploy':            'Déploiement en production',
    'meeting':           'Réunion d\'équipe',
    'doc':               'Rédaction de documentation',
    'analysis':          'Analyse des besoins',
    'integration':       'Intégration des composants',
    'refactor':          'Refactorisation du code',
    'setup':             'Configuration de l\'environnement',
    'research':          'Recherche et veille technologique',
    'maintenance':       'Maintenance préventive',
    'report':            'Rapport d\'avancement',
    /* Jira-style keys */
    'WEB':               'Projet Web Frontend',
    'DATA':              'Pipeline de données',
    'MOB':               'Application mobile',
    'ECOM':              'Plateforme e-commerce',
    'API':               'Développement API REST',
    'INFRA':             'Infrastructure & DevOps',
    /* Common task IDs */
    'T-101':             'Mise en place de l\'authentification',
    'T-102':             'Conception du tableau de bord',
    'T-103':             'Intégration des API tierces',
    'T-104':             'Tests de performance',
    'T-105':             'Migration de la base de données',
    'T-106':             'Optimisation des requêtes SQL',
    'T-107':             'Déploiement cloud AWS',
    'T-108':             'Revue de sécurité',
    'T-109':             'Documentation technique',
    'T-110':             'Formation de l\'équipe',
  };

  /* Fallback: derive a readable name from any raw string */
  function _humanize(raw){
    if(!raw) return 'Tâche sans titre';
    const str = String(raw).trim();
    if(TASK_NAMES[str]) return TASK_NAMES[str];
    /* Try to match partial keys */
    for(const [key, val] of Object.entries(TASK_NAMES)){
      if(str.toUpperCase().includes(key.toUpperCase())) return val;
    }
    /* Last resort: clean up the raw string */
    return str
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\b(T|WEB|MOB|DATA|ECOM|API|INFRA)\b/g, '')
      .trim() || 'Tâche non identifiée';
  }

  /* Resolve a user ID or raw name to a display name */
  function resolveUser(raw){
    if(!raw) return 'Utilisateur non assigné';
    const str = String(raw).trim();
    if(/^user_?\d+$/i.test(str)){
      const num = str.replace(/\D/g,'');
      const names = ['Ahmed Ben Ali','Wala Dghaies','Oliver Hansen','Andreas Meyer','Nielsen Erik','Elena Vasquez','Marc Dupont','Sara Kowalski','Yuki Tanaka','Rania Mrad'];
      return names[(parseInt(num)-1) % names.length] || `Utilisateur ${num}`;
    }
    return str;
  }

  /* Resolve a task ID/code to a readable name */
  function resolveTask(raw){
    return _humanize(raw);
  }

  /* Format a data row (from CSV) into human-readable object.
     Real CSV columns: Description, Task, Project, Client, User,
     Start, End, Duration, Duration (decimal), Billable, Tags      */
  function formatRow(row){
    /* ── Task name: use Description first (free-text label),
       fall back to Task column, then any legacy key              */
    const rawDesc = row['Description'] || row['description'] ||
                    row['Task']        || row['task']        ||
                    row['task_id']     || '';

    /* ── Clean up Jira-style prefixes so non-technical readers
       see a meaningful label instead of "AWA-13737 [...]"        */
    const taskName = _cleanDescription(rawDesc);

    /* ── User: Solidtime exports the display name directly        */
    const rawUser = row['User'] || row['user'] || row['member'] ||
                    row['user_id'] || '';

    /* ── Duration: "Duration (decimal)" column holds decimal hrs  */
    const decHours = parseFloat(
      row['Duration (decimal)'] || row['duration_decimal'] ||
      row['hours']              || row['duration']         || 0
    );

    /* ── Tags / status                                            */
    const rawTags   = row['Tags']   || row['tags']   || '';
    const rawStatus = row['status'] || row['state']  || rawTags || '';

    return {
      ...row,
      task_name:      taskName || 'Tâche sans titre',
      assigned_user:  resolveUser(rawUser),
      project_label:  TASK_NAMES[row['Project'] || row['project']] ||
                      row['Project'] || row['project'] || 'Projet inconnu',
      hours_label:    decHours > 0 ? `${decHours.toFixed(1)}h` : '—',
      hours_decimal:  decHours,
      status_label:   _statusLabel(rawStatus),
      tags_label:     rawTags,
      client_label:   row['Client'] || row['client'] || '',
      billable:       (row['Billable'] || row['billable'] || 'No').toLowerCase() === 'yes',
    };
  }

  /* Strip Jira ticket prefixes and brackets to get a readable label.
     "AWA-13737 [Microservice planning][Order] Decoupling order module"
     → "Decoupling order module"
     "AMA-2460 | Test Migration Laravel version 12"
     → "Test Migration Laravel version 12"                          */
  function _cleanDescription(raw){
    if(!raw) return '';
    let s = String(raw).trim();
    /* Remove leading Jira key: PROJ-1234 or PROJ-1234 | or PROJ-1234 : */
    s = s.replace(/^[A-Z]+-\d+\s*[\|\-:\[\]]*\s*/i, '');
    /* Remove bracketed sections like [Microservice planning][Order] */
    s = s.replace(/\[[^\]]*\]/g, '');
    /* Remove extra whitespace */
    s = s.replace(/\s+/g, ' ').trim();
    /* If after cleanup it's empty, return the original (truncated) */
    if(!s) return String(raw).slice(0,60);
    /* Capitalise first letter */
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function _statusLabel(raw){
    const map = {
      'done':'Terminé','completed':'Terminé','closed':'Terminé',
      'in_progress':'En cours','in-progress':'En cours','progress':'En cours','open':'En cours',
      'pending':'En attente','todo':'À faire','backlog':'Backlog',
      'review':'En révision','testing':'En test',
    };
    const key = String(raw).toLowerCase().trim();
    return map[key] || (raw ? raw : 'Statut inconnu');
  }

  /* Format all rows from a dataset */
  function formatAll(rows){
    return (rows || []).map(formatRow);
  }

  return { resolveTask, resolveUser, formatRow, formatAll };
})();

/* ════════════════════════════════════════════════════════════════
   GLOBAL PDF EXPORT ENGINE
   Each page can override exportPDF() or call this global builder.
════════════════════════════════════════════════════════════════ */
window.KpiPdfExport = (function(){

  function _esc(v){ return String(v == null ? '' : v); }

  /* Build a professional PDF report from any structured data */
  async function buildReport(opts = {}){
    const {
      title        = 'Rapport KPI Hub',
      subtitle     = '',
      sections     = [],   /* [{ heading, rows: [{label, value}] }] */
      author       = null,
      pageTitle    = document.title || 'KPI Hub',
    } = opts;

    const now  = new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
    const user = author || (function(){ const u=getUser(); return u?u.name||u.email:''; })();

    if(!window.jspdf){
      showToast('jsPDF non disponible sur cette page', '⚠');
      return false;
    }
    const { jsPDF } = window.jspdf;
    const pdf  = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const PW=210, PH=297, M=14, W=PW-M*2;
    let y = 0;

    /* ── Cover ── */
    pdf.setFillColor(8,15,30); pdf.rect(0,0,PW,PH,'F');
    pdf.setFillColor(30,111,217); pdf.rect(0,0,PW,4,'F');
    pdf.setFillColor(232,160,32); pdf.rect(0,4,PW,1.5,'F');

    pdf.setTextColor(91,163,245); pdf.setFontSize(11); pdf.setFont('helvetica','bold');
    pdf.text('KPI HUB · RAPPORT OFFICIEL', M, 24);
    pdf.setTextColor(214,232,255); pdf.setFontSize(30); pdf.setFont('helvetica','bold');
    pdf.text(title, M, 52);
    if(subtitle){
      pdf.setFontSize(14); pdf.setFont('helvetica','normal'); pdf.setTextColor(91,163,245);
      pdf.text(subtitle, M, 66);
    }
    pdf.setFontSize(9); pdf.setFont('helvetica','normal'); pdf.setTextColor(74,106,154);
    pdf.text(`Généré le ${now}${user?' · '+user:''}`, M, 82);
    pdf.setDrawColor(30,111,217); pdf.setLineWidth(0.3); pdf.line(M,90,PW-M,90);

    pdf.addPage();

    /* ── Content pages ── */
    function _header(pageLabel){
      pdf.setFillColor(8,15,30); pdf.rect(0,0,PW,18,'F');
      pdf.setFillColor(30,111,217); pdf.rect(0,0,PW,2,'F');
      pdf.setTextColor(91,163,245); pdf.setFontSize(8); pdf.setFont('helvetica','bold');
      pdf.text('KPI HUB · '+pageTitle.toUpperCase(), M, 8);
      pdf.setTextColor(74,106,154); pdf.setFont('helvetica','normal');
      pdf.text(pageLabel||now, PW-M, 8, {align:'right'});
      pdf.setDrawColor(74,106,154); pdf.setLineWidth(0.15); pdf.line(M,13,PW-M,13);
      y = 22;
    }
    function _footer(){
      pdf.setFontSize(7); pdf.setTextColor(74,106,154); pdf.setFont('helvetica','normal');
      pdf.text('KPI Hub · Confidentiel · Usage interne', M, PH-8);
      pdf.text('Page '+ pdf.getCurrentPageInfo().pageNumber, PW-M, PH-8, {align:'right'});
    }
    function _section(heading, color=[18,58,128]){
      if(y > PH-30){ _footer(); pdf.addPage(); _header('(suite)'); }
      pdf.setFillColor(...color); pdf.roundedRect(M, y, W, 7, 1.5,1.5,'F');
      pdf.setTextColor(214,232,255); pdf.setFontSize(9); pdf.setFont('helvetica','bold');
      pdf.text(heading, M+4, y+5); y += 12;
    }
    function _row(label, value, indent=0){
      if(y > PH-22){ _footer(); pdf.addPage(); _header('(suite)'); }
      pdf.setFontSize(9); pdf.setFont('helvetica','bold'); pdf.setTextColor(168,203,250);
      pdf.text(_esc(label)+':', M+3+indent, y);
      pdf.setFont('helvetica','normal'); pdf.setTextColor(214,232,255);
      const lines = pdf.splitTextToSize(_esc(value), W-70);
      pdf.text(lines, M+65+indent, y);
      y += Math.max(6, lines.length*5) + 2;
    }
    function _prose(text){
      if(!text) return;
      if(y > PH-22){ _footer(); pdf.addPage(); _header('(suite)'); }
      pdf.setFontSize(9); pdf.setFont('helvetica','normal'); pdf.setTextColor(168,203,250);
      const lines = pdf.splitTextToSize(_esc(text), W-6);
      pdf.text(lines, M+3, y); y += lines.length*5+4;
    }

    pdf.setFillColor(8,15,30); pdf.rect(0,0,PW,PH,'F');
    _header('');

    sections.forEach((sec, si) => {
      const colors = [[18,58,128],[10,100,60],[120,40,20],[50,20,120]];
      _section(sec.heading, colors[si % colors.length]);
      if(sec.prose) _prose(sec.prose);
      (sec.rows||[]).forEach(r => {
        if(typeof r === 'string') _prose(r);
        else _row(r.label, r.value, r.indent||0);
      });
      y += 4;
    });

    _footer();
    const slug = title.replace(/\s+/g,'-').toLowerCase();
    pdf.save(`kpihub-${slug}-${new Date().toISOString().slice(0,10)}.pdf`);
    return true;
  }

  return { buildReport };
})();

/* Default stub so pages without jsPDF don't crash */
if(typeof exportPDF === 'undefined'){
  window.exportPDF = function(){
    showToast('Export PDF non disponible sur cette page','⚠');
  };
}