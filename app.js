/* ════════════════════════════════════════════════════════════════
   KPI HUB — SHARED APP.JS
   Handles: dark mode · nav · toolbar · share modal · toast · auth
════════════════════════════════════════════════════════════════ */

/* ── THEME ──────────────────────────────────────────────────── */
(function(){
  const saved = localStorage.getItem('kpi-theme');
  if(saved) document.documentElement.setAttribute('data-theme', saved);
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

/* Populate nav user info wherever #navAvatar, #navName exist */
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

  // ── Detect file:// protocol (opened directly as a file, not via server) ──
  const isFileProtocol = window.location.protocol === 'file:';

  let url;
  if(isFileProtocol){
    // Can't share file:// URLs — show warning and build an instructional URL
    const fileName = window.location.pathname.split('/').pop(); // e.g. "data-warehouse.html"
    url = `http://localhost:5500/${fileName}?share=${token}`;
    const inp = document.getElementById('shareLinkInp');
    if(inp) inp.value = url;
    document.getElementById('linkRow').style.display = 'flex';
    const sn = document.getElementById('shareNote');
    if(sn){
      sn.innerHTML = `⚠️ <strong>Vous êtes en mode fichier local</strong>.<br>
        Le lien ci-dessus fonctionne uniquement si vous lancez un serveur local.<br>
        <strong>Solution :</strong> ouvrez ce dossier avec <em>VS Code Live Server</em> (port 5500)
        ou exécutez <code>python -m http.server 8080</code> dans le terminal,
        puis remplacez <code>localhost:5500</code> par votre URL réelle.`;
      sn.style.display = 'block';
      sn.style.color   = '#fbbf24';
      sn.style.background = 'rgba(251,191,36,0.08)';
      sn.style.border  = '1px solid rgba(251,191,36,0.25)';
      sn.style.borderRadius = '8px';
      sn.style.padding = '10px 12px';
      sn.style.fontSize = '11px';
      sn.style.lineHeight = '1.7';
    }
    return;
  }

  // Normal HTTP(S) mode — use the actual current URL
  const base = window.location.href.split('?')[0].split('#')[0];
  url = `${base}?share=${token}`;

  const inp = document.getElementById('shareLinkInp');
  if(inp) inp.value = url;
  document.getElementById('linkRow').style.display = 'flex';

  const labels = { viewer: 'Lecteur', editor: 'Éditeur', restricted: 'Accès restreint' };
  const sn = document.getElementById('shareNote');
  if(sn){
    sn.textContent = `Lien valide 7 jours · Permission : ${labels[_sharePerm]}`;
    sn.style.display = 'block';
    sn.style.color   = '';
    sn.style.background = '';
    sn.style.border  = '';
    sn.style.padding = '';
  }
}
async function copyShareLink(){
  const val = document.getElementById('shareLinkInp')?.value;
  if(!val) return;
  try{ await navigator.clipboard.writeText(val); }
  catch{ const ta=document.createElement('textarea');ta.value=val;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta); }
  const btn = document.getElementById('copyBtn');
  if(btn){ btn.innerHTML='<span>✓</span>';setTimeout(()=>btn.innerHTML='<span>📋</span>',2500); }
  showToast('Lien copié !');
}

/* Handle incoming share token — runs on ALL pages */
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
    const labels = { viewer:'Lecteur', editor:'Éditeur', restricted:'Accès restreint' };

    if(age > 7*24*60*60*1000){
      if(banner){
        banner.style.background='rgba(248,113,113,0.1)';
        banner.style.borderColor='rgba(248,113,113,0.3)';
      }
      if(txtEl)  txtEl.textContent = '⚠ Ce lien a expiré (7 jours max)';
      if(permEl){ permEl.textContent='Expiré'; permEl.style.color='#f87171'; }
    }else{
      if(txtEl) txtEl.textContent = 'Vous consultez ce dashboard via un lien partagé';
      if(permEl) permEl.textContent = labels[data.perm] || data.perm;
      // Viewer = read only, disable filters if restricted
      if(data.perm === 'restricted'){
        // Mark page as restricted so pages can optionally hide editing controls
        document.documentElement.setAttribute('data-share-perm','restricted');
      }
    }
    if(banner) banner.classList.add('show');
  }catch(err){
    console.warn('Share token parse error:', err);
    showToast('Lien de partage invalide ou corrompu','⚠');
  }
})();

/* ── KEYBOARD ───────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closeShare();
});

/* ── PDF EXPORT (shared) ────────────────────────────────────── */
/* Each page calls exportPDF() which is defined per-page.
   This stub prevents errors on pages that don't load jsPDF yet. */
if(typeof exportPDF === 'undefined'){
  window.exportPDF = function(){
    showToast('PDF non disponible sur cette page','⚠');
  };
}

/* ── COUNTER ANIMATION ──────────────────────────────────────── */
function animNum(id, target, dec=0){
  const el = document.getElementById(id);
  if(!el) return;
  const dur = 1000, start = performance.now();
  function f(now){
    const p = Math.min((now-start)/dur,1), e = 1-Math.pow(1-p,3);
    el.textContent = dec ? (target*e).toFixed(dec) : Math.round(target*e);
    if(p<1) requestAnimationFrame(f);
  }
  requestAnimationFrame(f);
}
