/* Shared report actions: theme, quick share, and light print export. */
(function(){
  function currentTheme(){
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function applySavedTheme(){
    const saved = localStorage.getItem('kpi-theme');
    if(saved) document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme(){
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('kpi-theme', next);
    if(typeof window.onReportThemeChange === 'function') window.onReportThemeChange(next);
  }

  function notify(message, icon){
    if(typeof window.showToast === 'function') return window.showToast(message, icon || '✓');
    if(typeof window.toast === 'function') return window.toast(message, icon || '✓');
  }

  async function quickShare(){
    const url = window.location.href.split('?')[0];
    const title = document.title || 'KPI Hub Report';
    if(navigator.share){
      try{
        await navigator.share({ title, url });
        notify('Rapport partagé avec succès !');
        return;
      }catch(e){
        if(e.name === 'AbortError') return;
      }
    }
    try{
      await navigator.clipboard.writeText(url);
      notify('Lien copié dans le presse-papier !');
    }catch(e){
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      notify('Lien copié !');
    }
  }

  function applyIncomingShare(){
    const token = new URLSearchParams(window.location.search).get('share');
    if(!token) return;
    const banner = document.getElementById('shareBanner');
    const txt = document.getElementById('shareBannerText');
    const perm = document.getElementById('sharePerm');
    try{
      const data = JSON.parse(decodeURIComponent(escape(atob(token))));
      const labels = { viewer:'Lecteur', commenter:'Commentateur', editor:'Commentateur', restricted:'Accès restreint' };
      if(txt) txt.textContent = 'Vous consultez ce rapport via un lien partagé';
      if(perm) perm.textContent = labels[data.perm] || data.perm || 'Lecteur';
      if(banner) banner.classList.add('show');
    }catch(e){
      if(txt) txt.textContent = 'Lien de partage invalide';
      if(perm) perm.textContent = 'Erreur';
      if(banner) banner.classList.add('show');
    }
  }

  function exportLightPrint(label){
    const saved = currentTheme();
    document.documentElement.setAttribute('data-theme', 'light');
    document.title = `KPI-Hub - ${label || 'Rapport'} ${new Date().toLocaleDateString('fr-FR')}`;
    setTimeout(function(){
      window.print();
      document.documentElement.setAttribute('data-theme', localStorage.getItem('kpi-theme') || saved);
      if(typeof window.onReportThemeChange === 'function') window.onReportThemeChange(currentTheme());
    }, 300);
  }

  window.KpiReportActions = { applySavedTheme, toggleTheme, quickShare, applyIncomingShare, exportLightPrint };
  window.quickShare = quickShare;
})();
