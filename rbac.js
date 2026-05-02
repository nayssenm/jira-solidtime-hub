/* ════════════════════════════════════════════════════════════════
   KPI HUB — rbac.js  (Role-Based Access Control)
   ─────────────────────────────────────────────────────────────
   ROLES:
     owner      — full access (authenticated user who owns the data)
     viewer     — read + export PDF, no comments
     commenter  — read + export PDF + comment + DSS access
     restricted — read only, NO export, NO comments, NO DSS

   LOADING ORDER (in every page):
     <script src="rbac.js"></script>   ← must come BEFORE app.js
     <script src="app.js"></script>
════════════════════════════════════════════════════════════════ */

/* ── 1. PERMISSION MATRIX ─────────────────────────────────── */
const RBAC = {

  // Map every role to its allowed capabilities
  permissions: {
    owner:      ['view', 'export_pdf', 'comment', 'dss', 'manage'],
    viewer:     ['view', 'export_pdf'],
    commenter:  ['view', 'export_pdf', 'comment', 'dss'],
    restricted: ['view'],
  },

  /**
   * Resolve the current session role.
   * Priority order:
   *   1. ?share=<token>  — shared link with encoded role
   *   2. kpi_current_user in localStorage — authenticated owner
   *   3. Fallback: 'restricted' (safest default)
   */
  resolveRole() {
    // Check for share token in URL
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('share');
    if (token) {
      try {
        const data = JSON.parse(decodeURIComponent(escape(atob(token))));
        const age  = Date.now() - (data.ts || 0);
        // Expired tokens → restricted
        if (age > 7 * 24 * 60 * 60 * 1000) return 'restricted';
        // Map legacy "editor" to "commenter" for backward compat
        if (data.perm === 'editor') return 'commenter';
        if (this.permissions[data.perm]) return data.perm;
      } catch (_) { /* bad token → restricted */ }
      return 'restricted';
    }

    // Authenticated local user → owner
    const auth = localStorage.getItem('kpi_auth');
    if (auth === 'true') return 'owner';

    // Nobody → restricted
    return 'restricted';
  },

  /** Check a single capability for the current role */
  can(capability) {
    const role  = this.resolveRole();
    const perms = this.permissions[role] || [];
    return perms.includes(capability);
  },

  /** Shorthand helpers */
  canView()      { return this.can('view');       },
  canExport()    { return this.can('export_pdf'); },
  canComment()   { return this.can('comment');    },
  canAccessDSS() { return this.can('dss');        },
  canManage()    { return this.can('manage');     },

  /** Human-readable role label */
  roleLabel() {
    const labels = {
      owner:      'Propriétaire',
      viewer:     'Lecteur',
      commenter:  'Commentateur',
      restricted: 'Accès restreint',
    };
    return labels[this.resolveRole()] || 'Inconnu';
  },

  /** Role badge colour class (used for the UI badge) */
  roleBadgeClass() {
    const map = {
      owner:      'rbac-badge--owner',
      viewer:     'rbac-badge--viewer',
      commenter:  'rbac-badge--commenter',
      restricted: 'rbac-badge--restricted',
    };
    return map[this.resolveRole()] || 'rbac-badge--restricted';
  },
};

/* ── 2. UI ENFORCEMENT ────────────────────────────────────── */

/**
 * applyRBAC()
 * Call this once the DOM is ready on every page.
 * It reads the resolved role and:
 *   - shows/hides export buttons
 *   - shows/hides comment controls
 *   - shows/hides / disables DSS nav link
 *   - injects a role badge in the toolbar
 *   - sets data-role attribute on <html> for CSS hooks
 */
function applyRBAC() {
  const role = RBAC.resolveRole();

  // Attach role to <html> so CSS can do [data-role="restricted"] { … }
  document.documentElement.setAttribute('data-role', role);

  // ── a) Export PDF button ─────────────────────────────────
  _rbacToggleExport(RBAC.canExport());

  // ── b) Comment controls ──────────────────────────────────
  _rbacToggleComments(RBAC.canComment());

  // ── c) DSS nav link ─────────────────────────────────────
  _rbacToggleDSS(RBAC.canAccessDSS());

  // ── d) Role badge in toolbar ─────────────────────────────
  _rbacInjectBadge(role);

  // ── e) Update share-banner permission label ───────────────
  _rbacUpdateBanner(role);

  // ── f) Log for debugging ─────────────────────────────────
  console.info(`[RBAC] Role: ${role} | canExport: ${RBAC.canExport()} | canComment: ${RBAC.canComment()} | canDSS: ${RBAC.canAccessDSS()}`);
}

/* ── Internal helpers ─────────────────────────────────────── */

function _rbacToggleExport(allowed) {
  // Target every element marked with data-rbac="export" or id="pdfBtn"
  const targets = [
    ...document.querySelectorAll('[data-rbac="export"]'),
    document.getElementById('pdfBtn'),
  ].filter(Boolean);

  targets.forEach(el => {
    if (!allowed) {
      el.setAttribute('disabled', '');
      el.title = 'Export PDF non disponible avec votre niveau d\'accès';
      el.style.opacity   = '0.38';
      el.style.cursor    = 'not-allowed';
      el.style.pointerEvents = 'none';
      // Wrap click prevention as belt-and-suspenders
      el.addEventListener('click', _rbacBlockExport, true);
    } else {
      el.removeAttribute('disabled');
      el.title = '';
      el.style.opacity   = '';
      el.style.cursor    = '';
      el.style.pointerEvents = '';
      el.removeEventListener('click', _rbacBlockExport, true);
    }
  });
}

function _rbacBlockExport(e) {
  e.stopImmediatePropagation();
  e.preventDefault();
  if (typeof showToast === 'function') {
    showToast('Export PDF désactivé — accès restreint', '🔒');
  }
}

function _rbacToggleComments(allowed) {
  // Hide / show every element marked data-rbac="comment"
  document.querySelectorAll('[data-rbac="comment"]').forEach(el => {
    el.style.display = allowed ? '' : 'none';
  });

  // Also handle the "+ Annotation" button in DSS toolbar
  const annBtn = document.querySelector('[onclick="openNewComment()"]');
  if (annBtn) {
    if (!allowed) {
      annBtn.setAttribute('disabled', '');
      annBtn.style.opacity = '0.38';
      annBtn.style.pointerEvents = 'none';
      annBtn.title = 'Commentaires réservés aux Commentateurs';
    } else {
      annBtn.removeAttribute('disabled');
      annBtn.style.opacity = '';
      annBtn.style.pointerEvents = '';
      annBtn.title = '';
    }
  }

  // Hide reply buttons in annotation cards (injected dynamically)
  // We expose a global flag that buildAnnotCard() checks
  window.__rbacCanComment = allowed;
}

function _rbacToggleDSS(allowed) {
  // Nav links pointing to collaborative-dss.html
  document.querySelectorAll('a[href="collaborative-dss.html"]').forEach(el => {
    if (!allowed) {
      el.style.opacity      = '0.38';
      el.style.pointerEvents = 'none';
      el.style.cursor       = 'not-allowed';
      el.title              = 'Module DSS réservé aux Commentateurs et Propriétaires';
      el.setAttribute('data-rbac-blocked', 'true');
    } else {
      el.style.opacity       = '';
      el.style.pointerEvents = '';
      el.style.cursor        = '';
      el.title               = '';
      el.removeAttribute('data-rbac-blocked');
    }
  });
}

function _rbacInjectBadge(role) {
  // Insert a small role badge in the toolbar-right area
  const toolbarRight = document.querySelector('.toolbar-right');
  if (!toolbarRight) return;

  // Avoid duplicate
  if (document.getElementById('rbacRoleBadge')) return;

  const icons = { owner:'👑', viewer:'👁', commenter:'💬', restricted:'🔒' };
  const badge = document.createElement('span');
  badge.id        = 'rbacRoleBadge';
  badge.className = `rbac-badge ${RBAC.roleBadgeClass()}`;
  badge.textContent = `${icons[role] || '🔒'} ${RBAC.roleLabel()}`;
  badge.title     = `Votre rôle sur cette page : ${RBAC.roleLabel()}`;

  // Insert before the first child of toolbar-right
  toolbarRight.insertBefore(badge, toolbarRight.firstChild);
}

function _rbacUpdateBanner(role) {
  // Update the share-banner permission chip if visible
  const permEl = document.getElementById('sharePerm');
  if (permEl && permEl.textContent) {
    permEl.textContent = RBAC.roleLabel();
  }
}

/* ── 3. GUARD: exportPDF wrapper ──────────────────────────── */
/**
 * Wraps the page-level exportPDF() so that even if the button
 * somehow gets clicked, the function itself refuses to run
 * when the role doesn't allow it.
 *
 * Called once per page after the page defines its own exportPDF().
 */
function rbacGuardExport() {
  if (typeof window._originalExportPDF === 'undefined' && typeof exportPDF === 'function') {
    window._originalExportPDF = window.exportPDF;
    window.exportPDF = function () {
      if (!RBAC.canExport()) {
        showToast('Export PDF désactivé — accès restreint', '🔒');
        return;
      }
      window._originalExportPDF.apply(this, arguments);
    };
  }
}

/* ── 4. GUARD: DSS comment actions ───────────────────────── */
/**
 * Patches openNewComment() in collaborative-dss.html so that
 * non-commenters cannot open the annotation form even if they
 * somehow click the button.
 */
function rbacGuardComments() {
  if (typeof window.openNewComment === 'function' && !window._rbacCommentGuarded) {
    const original = window.openNewComment;
    window.openNewComment = function () {
      if (!RBAC.canComment()) {
        showToast('Annotations réservées aux Commentateurs', '🔒');
        return;
      }
      original.apply(this, arguments);
    };
    window._rbacCommentGuarded = true;
  }

  if (typeof window.submitReply === 'function' && !window._rbacReplyGuarded) {
    const orig = window.submitReply;
    window.submitReply = function () {
      if (!RBAC.canComment()) {
        showToast('Réponses réservées aux Commentateurs', '🔒');
        return;
      }
      orig.apply(this, arguments);
    };
    window._rbacReplyGuarded = true;
  }

  if (typeof window.resolveComment === 'function' && !window._rbacResolveGuarded) {
    const orig = window.resolveComment;
    window.resolveComment = function () {
      if (!RBAC.canComment()) {
        showToast('Action réservée aux Commentateurs', '🔒');
        return;
      }
      orig.apply(this, arguments);
    };
    window._rbacResolveGuarded = true;
  }
}

/* ── 5. CSS (injected dynamically) ───────────────────────── */
(function injectRBACStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Role badge in toolbar */
    .rbac-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 20px;
      font-family: var(--font-m, 'DM Mono', monospace);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .06em;
      border: 1px solid;
      white-space: nowrap;
      flex-shrink: 0;
      margin-right: 4px;
      transition: opacity .3s;
    }
    .rbac-badge--owner      { background: rgba(30,111,217,.15); color: #5BA3F5; border-color: rgba(30,111,217,.30); }
    .rbac-badge--viewer     { background: rgba(12,184,122,.12); color: #34D399; border-color: rgba(12,184,122,.25); }
    .rbac-badge--commenter  { background: rgba(232,160,32,.12); color: #F5C842; border-color: rgba(232,160,32,.25); }
    .rbac-badge--restricted { background: rgba(232,82,42,.12);  color: #FF7A52; border-color: rgba(232,82,42,.25);  }

    /* CSS hooks for per-role hiding */
    [data-role="restricted"] [data-rbac="export"],
    [data-role="restricted"] #pdfBtn {
      opacity: .38 !important;
      pointer-events: none !important;
      cursor: not-allowed !important;
    }
    [data-role="restricted"] [data-rbac="comment"],
    [data-role="viewer"]     [data-rbac="comment"] {
      display: none !important;
    }
    [data-role="restricted"] a[href="collaborative-dss.html"],
    [data-role="viewer"]     a[href="collaborative-dss.html"] {
      opacity: .38 !important;
      pointer-events: none !important;
      cursor: not-allowed !important;
    }

    /* Tooltip-style cursor on blocked elements */
    [data-rbac-blocked="true"] { cursor: not-allowed !important; }
  `;
  document.head.appendChild(style);
})();

/* ── 6. AUTO-INIT: run after DOM is interactive ───────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyRBAC();
    // Guard wrappers run slightly later so page scripts have time to define their functions
    setTimeout(() => {
      rbacGuardExport();
      rbacGuardComments();
    }, 0);
  });
} else {
  applyRBAC();
  setTimeout(() => {
    rbacGuardExport();
    rbacGuardComments();
  }, 0);
}
