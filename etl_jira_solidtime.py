"""
etl_jira_solidtime.py  —  KPI Hub ETL  (version corrigée complète)
Génère : dashboard.html · kpi.html · data_warehouse.html
Run    : python etl_jira_solidtime.py   (depuis le dossier contenant /data)

CORRECTIONS APPLIQUÉES :
  1. F-strings Python 3.12 : tout le JS est sorti des f-strings → raw strings + concaténation
  2. Double-division par 3600 sur Original estimate supprimée
  3. Task_key extrait de Description (pas Task qui est toujours vide)
  4. Status exporté en anglais (done/in_progress/pending/other)
  5. Gestion NaN complète partout
  6. Nouveaux KPIs : ratio Test/Dev, réunion/exécution, client
"""
import pandas as pd, numpy as np, os, json

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
JIRA_PATH  = os.path.join(BASE_DIR, "data", "jira_rescue_team.csv")
SOLID_PATH = os.path.join(BASE_DIR, "data", "solidtime_data.csv")
OUT_DIR    = os.path.join(BASE_DIR, "output")
os.makedirs(OUT_DIR, exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════
# 1. LOAD
# ═══════════════════════════════════════════════════════════════════════
jira  = pd.read_csv(JIRA_PATH)
solid = pd.read_csv(SOLID_PATH)
print(f"JIRA {jira.shape}  ·  SOLIDTIME {solid.shape}")

# ═══════════════════════════════════════════════════════════════════════
# 2. CLEAN SOLIDTIME
# ═══════════════════════════════════════════════════════════════════════
solid = solid.drop_duplicates().dropna(subset=["User", "Start", "End"])
# FIX #1: no unit='ms' — Solidtime exports ISO strings, not Unix ms
solid["Start"] = pd.to_datetime(solid["Start"], errors="coerce")
solid["End"]   = pd.to_datetime(solid["End"],   errors="coerce")
solid = solid.dropna(subset=["Start", "End"])
solid["Duration (decimal)"] = pd.to_numeric(solid["Duration (decimal)"], errors="coerce")
solid = solid[solid["Duration (decimal)"] > 0].copy()

solid["User"]           = solid["User"].str.strip().str.title()
solid["Project"]        = solid["Project"].fillna("Inconnu").str.strip().str.upper()
solid["Client"]         = solid["Client"].fillna("Non renseigné").astype(str)
solid["Tags"]           = solid["Tags"].fillna("Non tagué").astype(str)
solid["Billable"]       = solid["Billable"].fillna("No").astype(str)
solid["duration_hours"] = solid["Duration (decimal)"]
solid["month_solid"]    = solid["Start"].dt.to_period("M").astype(str)

# FIX #2: keys are in Description, Task column is always empty in Solidtime export
solid["Task_key"] = (
    solid["Description"].astype(str)
    .str.extract(r"([A-Z]{2,}-\d+)", expand=False)
)
print(f"  Task_key extraits : {solid['Task_key'].notna().sum()}")

# ═══════════════════════════════════════════════════════════════════════
# 3. CLEAN JIRA
# ═══════════════════════════════════════════════════════════════════════
jira = jira.drop_duplicates().dropna(subset=["Issue key", "Status"])
jira["Issue key"] = (
    jira["Issue key"].astype(str).str.upper()
    .str.strip().str.replace("_", "-", regex=False)
)
jira["Status"]   = jira["Status"].str.strip().str.lower()
jira["Assignee"] = jira["Assignee"].fillna("Non assigné").astype(str)

# Safe column access with defaults
def safe_col(df, col, default="Non définie"):
    if col in df.columns:
        return df[col].fillna(default).astype(str)
    return pd.Series(default, index=df.index)

jira["Custom field (Criticité)"]     = safe_col(jira, "Custom field (Criticité)")
jira["Custom field (Equipe Dédiée)"] = safe_col(jira, "Custom field (Equipe Dédiée)")
jira["Issue Type"]                   = safe_col(jira, "Issue Type", "—")
jira["Summary"]                      = safe_col(jira, "Summary", "")

# FIX #3: Jira Original estimate is in seconds → convert to hours ONCE (no re-division)
if "Original estimate" in jira.columns:
    jira["orig_est_h"] = pd.to_numeric(jira["Original estimate"], errors="coerce").fillna(0) / 3600
else:
    jira["orig_est_h"] = 0.0

# ═══════════════════════════════════════════════════════════════════════
# 4. MERGE
# ═══════════════════════════════════════════════════════════════════════
merged = pd.merge(solid, jira, left_on="Task_key", right_on="Issue key", how="left")

STATUS_MAP = {
    "déployé":                  "done",
    "terminé":                  "done",
    "en cours":                 "in_progress",
    "validation en cours":      "in_progress",
    "en revue":                 "in_progress",
    "en attente de revue":      "pending",
    "en attente de validation": "pending",
}
merged["Status_raw"]   = merged["Status"].fillna("non lié").astype(str)
merged["Status_clean"] = merged["Status_raw"].map(STATUS_MAP).fillna("other")
# FIX #4: overwrite Status with JS-readable English value
merged["Status"] = merged["Status_clean"]

matched = merged[merged["Issue key"].notna()].copy()
print(f"  Merge : {len(matched)} lignes liées · {dict(merged['Status_clean'].value_counts())}")

# ═══════════════════════════════════════════════════════════════════════
# 5. KPI COMPUTATIONS
# ═══════════════════════════════════════════════════════════════════════

# ── 5a. Tags (explode multi-tag) ──────────────────────────────────────
TAG_CAT = {
    "Réunion":       ["Réunion", "Client Communication", "Meeting"],
    "Développement": ["Feature Development", "Bug Fixing", "Optimization", "Unclassified"],
    "Test":          ["Testing", "Test Automation"],
    "Documentation": ["Documentation", "Reporting"],
    "Formation":     ["Training and Development"],
}

def cat_of(tag):
    for cat, tags in TAG_CAT.items():
        if tag in tags:
            return cat
    return "Autre"

solid_ex = solid.copy()
solid_ex["Tag"] = solid_ex["Tags"].str.split(", ")
solid_ex = solid_ex.explode("Tag").copy()
solid_ex["Tag"]       = solid_ex["Tag"].str.strip().fillna("Non tagué")
solid_ex["Catégorie"] = solid_ex["Tag"].apply(cat_of)

kpi_tags = (
    solid_ex.groupby("Tag")["duration_hours"]
    .sum().sort_values(ascending=False).reset_index()
    
)
kpi_cat = (
    solid_ex.groupby("Catégorie")["duration_hours"]
    .sum().sort_values(ascending=False).reset_index()
    
)

# ── 5b. Facturable ────────────────────────────────────────────────────
total_h = float(solid["duration_hours"].sum())
kpi_bill = (
    solid.groupby("Billable")["duration_hours"].sum()
    .reset_index()
)
kpi_bill["pct"] = (kpi_bill["duration_hours"] / total_h * 100).round(1)

# ── 5c. Client ────────────────────────────────────────────────────────
kpi_client = (
    solid.groupby("Client")["duration_hours"].sum()
    .sort_values(ascending=False).reset_index()
    
)

# ── 5d. Estimation accuracy (FIX: orig_est_h already hours, no /3600) ─
actual_per_key = (
    merged[merged["Task_key"].notna()]
    .groupby("Task_key")["duration_hours"].sum().reset_index()
    .rename(columns={"Task_key": "Issue key", "duration_hours": "actual_hours"})
)
est_df = (
    jira[["Issue key", "orig_est_h", "Issue Type", "Custom field (Criticité)", "Assignee"]]
    .merge(actual_per_key, on="Issue key", how="inner")
)
est_df = est_df[est_df["orig_est_h"] > 0].copy()
est_df["delta_h"]   = (est_df["actual_hours"] - est_df["orig_est_h"]).round(2)
est_df["delta_pct"] = (est_df["delta_h"] / est_df["orig_est_h"] * 100).round(1)
est_df["over"]      = est_df["delta_pct"] > 0

kpi_est = {
    "n_tickets":        int(len(est_df)),
    "ecart_moyen_pct":  round(float(est_df["delta_pct"].mean())   if len(est_df) else 0, 1),
    "taux_depassement": round(float(est_df["over"].mean() * 100)  if len(est_df) else 0, 1),
    "ecart_moyen_h":    round(float(est_df["delta_h"].mean())     if len(est_df) else 0, 2),
    "median_pct":       round(float(est_df["delta_pct"].median()) if len(est_df) else 0, 1),
}

# ── 5e. Issue Type ────────────────────────────────────────────────────
kpi_itype = (
    matched.groupby("Issue Type")["duration_hours"]
    .agg(duration_hours="sum", tickets="count")
    .sort_values("duration_hours", ascending=False).reset_index()
)

# ── 5f. Criticité ─────────────────────────────────────────────────────
kpi_crit = (
    matched.groupby("Custom field (Criticité)")["duration_hours"]
    .sum().sort_values(ascending=False).reset_index()
    .rename(columns={"Custom field (Criticité)": "criticite", "duration_hours": "h"})
)

# ── 5g. User / Project / Monthly / MoM ───────────────────────────────
kpi_user = (merged.groupby("User")["duration_hours"].sum()
            .sort_values(ascending=False).reset_index()
            )
kpi_project = (merged.groupby("Project")["duration_hours"].sum()
               .sort_values(ascending=False).reset_index())
kpi_monthly = (merged.groupby("month_solid")["duration_hours"].sum()
               .reset_index().sort_values("month_solid"))
kpi_m_proj  = (merged.groupby(["month_solid", "Project"])["duration_hours"].sum()
               .reset_index().sort_values(["month_solid", "Project"])
               )

# ── 5h. Status pivot ──────────────────────────────────────────────────
kpi_status_proj  = merged.groupby(["Project", "Status_clean"]).size().reset_index(name="count")
kpi_status_pivot = kpi_status_proj.pivot_table(
    index="Project", columns="Status_clean", values="count", fill_value=0
)
kpi_status_pivot.columns.name = None
for col in ("done", "in_progress", "pending", "other"):
    if col not in kpi_status_pivot.columns:
        kpi_status_pivot[col] = 0
kpi_status_pivot = kpi_status_pivot.reset_index()

# ── 5i. Ratios ────────────────────────────────────────────────────────
def cat_h(cat_name):
    row = kpi_cat.loc[kpi_cat["Catégorie"] == cat_name, "duration_hours"]
    return float(row.sum()) if len(row) else 0.0

h_test = cat_h("Test")
h_dev  = cat_h("Développement")
h_meet = cat_h("Réunion")
ratio_test_dev   = round(h_test / h_dev * 100, 1)  if h_dev  > 0 else 0.0
ratio_meet_exec  = round(h_meet / (total_h - h_meet) * 100, 1) if (total_h - h_meet) > 0 else 0.0

print(f"  KPIs: {total_h:.0f}h · {len(kpi_user)} users · {len(kpi_project)} projets")
print(f"  Estimation: {kpi_est['n_tickets']} tickets · dépassement {kpi_est['taux_depassement']}%")
print(f"  Ratio Test/Dev: {ratio_test_dev}% · Réunion/Exec: {ratio_meet_exec}%")

# ═══════════════════════════════════════════════════════════════════════
# 6. HELPERS
# ═══════════════════════════════════════════════════════════════════════
def jdump(df):
    """Serialize a DataFrame to a JSON string (for JS injection)."""
    return df.to_json(orient="records", force_ascii=False)

def jscalar(v):
    """JSON-encode a Python scalar/dict/list."""
    return json.dumps(v, ensure_ascii=False)

# ═══════════════════════════════════════════════════════════════════════
# 7. SHARED HTML ASSETS
#    All CSS/JS in raw strings — NO f-string brace escaping needed.
#    Data is injected via string concatenation, never inside f-strings.
# ═══════════════════════════════════════════════════════════════════════
SHARED_CSS = """<style>
:root{--burg:#800020;--burg2:#a3254a;--rose:#c96e80;--teal:#2a9d8f;--blue:#3a86b8;--gold:#c9a84c;--violet:#7b5ea7;--ease:cubic-bezier(.4,0,.2,1);}
[data-theme="dark"]{--bg:#09060a;--surf:rgba(255,255,255,.045);--surf2:rgba(255,255,255,.07);--border:rgba(255,255,255,.09);--text:#f0ebe6;--text2:#b8a9a0;--text3:#6e5e58;--nav-bg:rgba(9,6,10,.96);--sh:0 2px 20px rgba(0,0,0,.45);--ibg:rgba(255,255,255,.05);--badge:rgba(128,0,32,.25);--badge-c:#e8a0b0;--stripe:rgba(255,255,255,.02);}
[data-theme="light"]{--bg:#faf9f4;--surf:#fff;--surf2:#f7f5ee;--border:rgba(128,0,32,.12);--text:#1a1210;--text2:#6b5c54;--text3:#a89991;--nav-bg:rgba(250,249,244,.96);--sh:0 2px 14px rgba(26,18,16,.06);--ibg:#f7f5ee;--badge:rgba(128,0,32,.08);--badge-c:#800020;--stripe:rgba(128,0,32,.03);}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{scroll-behavior:smooth;}
body{font-family:"DM Sans",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased;overflow-x:hidden;transition:background .4s,color .4s;}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 80% 50% at 10% -5%,rgba(128,0,32,.05) 0%,transparent 60%),radial-gradient(ellipse 60% 40% at 90% 105%,rgba(128,0,32,.04) 0%,transparent 50%);}
nav{position:sticky;top:0;z-index:200;height:56px;background:var(--nav-bg);backdrop-filter:blur(24px);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 32px;transition:background .4s;}
.nl{display:flex;align-items:center;gap:10px;text-decoration:none;margin-right:24px;flex-shrink:0;}
.nm{width:30px;height:30px;border-radius:8px;background:var(--burg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(128,0,32,.38);}
.nm svg{width:15px;height:15px;fill:white;}
.nt{font-family:"Cormorant Garamond",serif;font-size:17px;font-weight:500;color:var(--text);}
.nt em{color:var(--burg);font-style:normal;}
.nlinks{display:flex;align-items:center;gap:2px;flex:1;}
.nlink{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:9px;font-size:13px;font-weight:500;color:var(--text2);text-decoration:none;transition:background .2s,color .2s;}
.nlink:hover{background:var(--surf2);color:var(--text);}
.nlink.active{background:var(--burg);color:white;}
.nr{display:flex;align-items:center;gap:8px;margin-left:auto;}
.tog{display:flex;align-items:center;gap:5px;cursor:pointer;padding:4px;user-select:none;}
.togtr{position:relative;width:34px;height:19px;background:rgba(255,255,255,.12);border-radius:10px;border:1px solid var(--border);transition:background .3s;flex-shrink:0;}
.togtr::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#c96e80;transition:transform .3s var(--ease);box-shadow:0 1px 3px rgba(0,0,0,.2);}
[data-theme="light"] .togtr::after{background:#800020;transform:translateX(15px);}
.togic{font-size:12px;}
.wrap{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:32px 32px 80px;}
.sdiv{display:flex;align-items:center;gap:12px;margin:28px 0 18px;font-family:"DM Mono",monospace;font-size:9px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);}
.sdiv::after{content:"";flex:1;height:1px;background:var(--border);}
.sdot{width:6px;height:6px;border-radius:50%;background:var(--burg);box-shadow:0 0 6px rgba(128,0,32,.5);flex-shrink:0;}
.card{background:var(--surf);border:1px solid var(--border);border-radius:14px;box-shadow:var(--sh);transition:background .4s,border-color .4s;}
.kgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px;}
.kcard{padding:20px;position:relative;overflow:hidden;cursor:default;transition:transform .3s,box-shadow .3s;}
.kcard::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--burg),var(--rose));opacity:0;transition:opacity .3s;}
.kcard:hover{transform:translateY(-3px);}
.kcard:hover::before{opacity:1;}
.kicon{width:32px;height:32px;border-radius:8px;background:var(--badge);display:flex;align-items:center;justify-content:center;font-size:14px;margin-bottom:12px;}
.klbl{font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);margin-bottom:4px;}
.kval{font-family:"Cormorant Garamond",serif;font-size:34px;font-weight:300;line-height:1;color:var(--text);letter-spacing:-.02em;}
.ksub{font-size:10px;color:var(--text3);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ktip{font-size:10px;color:var(--rose);margin-top:3px;}
.cgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
.cgrid.full{grid-template-columns:1fr;}
.ccard{padding:22px;}
.chead{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;}
.ctitle{font-family:"Cormorant Garamond",serif;font-size:17px;font-weight:500;color:var(--text);}
.csub{font-size:11px;color:var(--text3);margin-top:2px;}
.cbadge{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:20px;background:var(--badge);color:var(--badge-c);white-space:nowrap;}
canvas{max-height:300px;}
.fbar{padding:13px 17px;display:flex;flex-wrap:wrap;gap:11px;align-items:flex-end;margin-bottom:18px;}
.fg{display:flex;flex-direction:column;gap:4px;min-width:115px;}
.fg label{font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);font-family:"DM Mono",monospace;}
.fg select,.fg input{padding:7px 10px;border-radius:9px;border:1px solid var(--border);background:var(--ibg);color:var(--text);font-family:"DM Sans",sans-serif;font-size:12px;outline:none;cursor:pointer;transition:border-color .2s;-webkit-appearance:none;appearance:none;}
.fg select option{background:#1c1515;}
[data-theme="light"] .fg select option{background:#fff;}
.fg select:focus{border-color:var(--burg);box-shadow:0 0 0 3px rgba(128,0,32,.1);}
.fright{margin-left:auto;display:flex;align-items:flex-end;gap:8px;}
.rc{font-size:11px;color:var(--text3);white-space:nowrap;padding-bottom:2px;}
.rc strong{color:var(--text);font-weight:600;}
.rbtn,.ebtn{padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text3);font-size:11px;cursor:pointer;transition:all .2s;font-family:"DM Sans",sans-serif;}
.rbtn:hover{color:var(--burg);border-color:var(--burg);}
.ebtn{background:var(--burg);color:white;border-color:var(--burg);}
.ebtn:hover{opacity:.85;}
.tw{overflow-x:auto;}
.thead{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.thead h3{font-family:"Cormorant Garamond",serif;font-size:17px;font-weight:500;color:var(--text);}
.thead p{font-size:11px;color:var(--text3);margin-top:2px;}
table{width:100%;border-collapse:collapse;font-size:12px;min-width:600px;}
thead tr{background:var(--surf2);}
th{text-align:left;padding:9px 13px;font-family:"DM Mono",monospace;font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);white-space:nowrap;cursor:pointer;}
th:hover{color:var(--burg);}
td{padding:9px 13px;color:var(--text2);border-bottom:1px solid rgba(255,255,255,.04);}
tr:nth-child(even) td{background:var(--stripe);}
tr:hover td{background:rgba(128,0,32,.07);color:var(--text);}
tr:last-child td{border-bottom:none;}
.badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:500;}
.bdone{background:rgba(34,197,94,.15);color:#4ade80;}
.bprog{background:rgba(128,0,32,.15);color:#e8a0b0;}
.bpend{background:rgba(201,168,76,.15);color:#c9a84c;}
.both{background:rgba(110,94,88,.15);color:#a89991;}
.pbar-wrap{display:flex;align-items:center;gap:6px;}
.pbar{flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden;}
.pfill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--burg),var(--rose));}
.toast{position:fixed;top:18px;right:18px;z-index:9999;background:rgba(9,6,10,.97);border:1px solid rgba(255,255,255,.1);color:white;padding:10px 16px;border-radius:11px;font-size:12px;backdrop-filter:blur(12px);display:flex;align-items:center;gap:8px;transform:translateY(-60px);opacity:0;transition:all .38s var(--ease);pointer-events:none;max-width:280px;}
.toast.show{transform:translateY(0);opacity:1;}
@media(max-width:860px){.cgrid{grid-template-columns:1fr !important;}.wrap{padding:16px 16px 60px;}}
@media(max-width:640px){.kgrid{grid-template-columns:1fr 1fr;}.nlinks .nlink:not(.active){display:none;}}
</style>"""

# NAV: placeholder replaced per page
SHARED_NAV = """<nav>
  <a class="nl" href="dashboard.html">
    <div class="nm"><svg viewBox="0 0 24 24"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 4h2v-2h2v2h2v2h-2v2h-2v-2h-2z"/></svg></div>
    <span class="nt">KPI <em>Hub</em></span>
  </a>
  <div class="nlinks">___NAV_LINKS___</div>
  <div class="nr">
    <div class="tog" onclick="toggleTheme()">
      <span class="togic">&#9728;&#65039;</span><div class="togtr"></div><span class="togic">&#127769;</span>
    </div>
  </div>
</nav>"""

# ALL shared JS as a raw string — no {{ }} escaping, no f-string, pure JS
SHARED_JS_BLOCK = r"""<script>
function toggleTheme(){
  var d=document.documentElement;
  var n=d.getAttribute("data-theme")==="dark"?"light":"dark";
  d.setAttribute("data-theme",n);localStorage.setItem("kh-theme",n);
}
(function(){var t=localStorage.getItem("kh-theme");if(t)document.documentElement.setAttribute("data-theme",t);})();

function showToast(msg,icon){
  if(!icon)icon="&#10003;";
  var t=document.getElementById("toast");
  t.innerHTML="<span>"+icon+"</span> "+msg;
  t.classList.add("show");clearTimeout(t._t);
  t._t=setTimeout(function(){t.classList.remove("show");},3200);
}

/* Chart.js defaults */
Chart.defaults.font.family="DM Sans,sans-serif";
Chart.defaults.font.size=11;
Chart.defaults.color="#a89991";
Chart.defaults.plugins.legend.labels.usePointStyle=true;
Chart.defaults.plugins.legend.labels.padding=14;
Chart.defaults.plugins.legend.labels.boxWidth=8;
Chart.defaults.plugins.tooltip.backgroundColor="rgba(9,6,10,.94)";
Chart.defaults.plugins.tooltip.titleFont={family:"Cormorant Garamond,serif",size:13};
Chart.defaults.plugins.tooltip.bodyFont={family:"DM Sans,sans-serif",size:11};
Chart.defaults.plugins.tooltip.padding=10;
Chart.defaults.plugins.tooltip.cornerRadius=8;
Chart.defaults.scale.grid.color="rgba(128,0,32,0.06)";
Chart.defaults.scale.border.dash=[4,4];

var C={b:"#800020",b2:"#a3254a",r:"#c96e80",t:"#c9a84c",m:"#2a9d8f",v:"#7b5ea7",g:"#6e5e58",bl:"#3a86b8"};
var PAL=[C.b,C.b2,C.r,C.t,C.m,C.v,C.bl,"#9a7a60","#e8a0b0","#48cae4"];

/* Animated counter */
function animNum(id,target,dec){
  if(!dec)dec=0;
  var el=document.getElementById(id);if(!el)return;
  var dur=900,start=performance.now();
  function f(now){
    var p=Math.min((now-start)/dur,1),e=1-Math.pow(1-p,3);
    el.textContent=dec?(target*e).toFixed(dec):Math.round(target*e).toLocaleString();
    if(p<1)requestAnimationFrame(f);
  }
  requestAnimationFrame(f);
}

/* CSV export helper */
function csvExport(rows,filename){
  if(!rows.length)return;
  var keys=Object.keys(rows[0]);
  var lines=[keys.join(",")].concat(rows.map(function(r){
    return keys.map(function(k){
      var v=r[k];if(v===null||v===undefined)return"";
      var s=String(v);
      return(s.indexOf(",")>=0||s.indexOf('"')>=0)?'"'+s.replace(/"/g,'""')+'"':s;
    }).join(",");
  }));
  var blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8;"});
  var a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download=filename;a.click();
  showToast("Export CSV t\u00e9l\u00e9charg\u00e9 !");
}

/* Reusable chart builders */
function hbar(id,labels,vals){
  var el=document.getElementById(id);if(!el)return null;
  return new Chart(el,{
    type:"bar",
    data:{labels:labels,datasets:[{data:vals,
      backgroundColor:labels.map(function(_,i){return PAL[i%PAL.length];}),
      maxBarThickness:26,borderRadius:5,borderSkipped:"bottom"}]},
    options:{responsive:true,indexAxis:"y",
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){return " "+ctx.parsed.x.toFixed(1)+"h";}}}},
      scales:{x:{beginAtZero:true,ticks:{callback:function(v){return v+"h";}}},y:{ticks:{font:{size:10}}}}}
  });
}
function vbar(id,labels,vals){
  var el=document.getElementById(id);if(!el)return null;
  return new Chart(el,{
    type:"bar",
    data:{labels:labels,datasets:[{data:vals,
      backgroundColor:labels.map(function(_,i){return PAL[i%PAL.length];}),
      maxBarThickness:34,borderRadius:5,borderSkipped:"bottom"}]},
    options:{responsive:true,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){return " "+ctx.parsed.y.toFixed(1)+"h";}}}},
      scales:{x:{ticks:{maxRotation:35}},y:{beginAtZero:true,ticks:{callback:function(v){return v+"h";}}}}}
  });
}
function donut(id,labels,vals,colors){
  var el=document.getElementById(id);if(!el)return null;
  var tot=vals.reduce(function(a,b){return a+b;},0);
  return new Chart(el,{
    type:"doughnut",
    data:{labels:labels,datasets:[{data:vals,backgroundColor:colors||PAL,borderWidth:0,hoverOffset:5}]},
    options:{responsive:true,cutout:"60%",
      plugins:{legend:{position:"bottom"},tooltip:{callbacks:{label:function(ctx){
        var pct=tot>0?((ctx.parsed/tot)*100).toFixed(1):0;
        return " "+ctx.label+": "+ctx.parsed.toFixed(1)+"h ("+pct+"%)";
      }}}}}
  });
}
function lineChart(id,labels,vals){
  var el=document.getElementById(id);if(!el)return null;
  return new Chart(el,{
    type:"line",
    data:{labels:labels,datasets:[{label:"Heures",data:vals,
      borderColor:C.b,backgroundColor:"rgba(128,0,32,.07)",
      borderWidth:2.5,pointBackgroundColor:C.b,pointBorderColor:"#fff",
      pointBorderWidth:2,pointRadius:4,fill:true,tension:.42}]},
    options:{responsive:true,plugins:{legend:{display:false}},
      scales:{x:{ticks:{maxRotation:35}},y:{beginAtZero:true,ticks:{callback:function(v){return v+"h";}}}}}
  });
}
function stackedBar(id,labels,datasets){
  var el=document.getElementById(id);if(!el)return null;
  return new Chart(el,{
    type:"bar",data:{labels:labels,datasets:datasets},
    options:{responsive:true,plugins:{legend:{position:"top",align:"end"}},
      scales:{x:{stacked:true,ticks:{maxRotation:35}},y:{stacked:true,beginAtZero:true,ticks:{callback:function(v){return v+"h";}}}}}
  });
}
</script>"""


def build_page(title, nav_active, body_html, data_js, charts_js):
    """
    Assemble a complete standalone HTML page.
    Uses string concatenation — never f-strings for JS — to avoid
    Python 3.12 f-string brace parsing errors.
    """
    nav_defs = {
        "kpi":  ("&#128202; KPI",          "kpi.html"),
        "dash": ("&#128200; Dashboard",     "dashboard.html"),
        "dw":   ("&#128452; Data Warehouse","data_warehouse.html"),
    }
    links = ""
    for key, (label, href) in nav_defs.items():
        cls = "nlink active" if key == nav_active else "nlink"
        links += f'<a class="{cls}" href="{href}">{label}</a>\n'

    head = (
        '<!DOCTYPE html>'
        '<html lang="fr" data-theme="dark"><head>'
        '<meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
        f'<title>{title} \u2014 KPI Hub</title>'
        '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'
        '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600'
        '&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">'
        + SHARED_CSS
        + '</head><body>'
        + SHARED_NAV.replace("___NAV_LINKS___", links)
        + '<div class="toast" id="toast"></div>'
        + '<div class="wrap">'
        + body_html
        + '</div>'
        + SHARED_JS_BLOCK
        + '<script>'
        + data_js
        + charts_js
        + '</script>'
        + '</body></html>'
    )
    return head


# ═══════════════════════════════════════════════════════════════════════
# 8. DASHBOARD HTML
# ═══════════════════════════════════════════════════════════════════════
def generate_dashboard_html():
    users  = sorted(merged["User"].dropna().unique().tolist())
    projs  = sorted(merged["Project"].dropna().unique().tolist())
    months = sorted(merged["month_solid"].dropna().unique().tolist())

    uopts  = "".join(f'<option value="{u}">{u}</option>' for u in users)
    popts  = "".join(f'<option value="{p}">{p}</option>' for p in projs)
    mopts  = "".join(f'<option value="{m}">{m}</option>' for m in months)

    th = round(total_h, 1)

    body = f"""
<div class="sdiv"><div class="sdot"></div>Vue d'ensemble</div>
<div class="kgrid">
  <div class="card kcard" title="Somme totale des heures Solidtime">
    <div class="kicon">&#9201;</div><div class="klbl">Total Heures</div>
    <div class="kval" id="kvH">&#8212;</div><div class="ksub" id="kvHs">toutes activités</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#128101;</div><div class="klbl">Utilisateurs</div>
    <div class="kval" id="kvU">&#8212;</div><div class="ksub" id="kvUs">membres actifs</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#128193;</div><div class="klbl">Projets</div>
    <div class="kval" id="kvP">&#8212;</div><div class="ksub" id="kvPs">actifs</div>
  </div>
  <div class="card kcard" title="Issues Jira distinctes trackées">
    <div class="kicon">&#127243;</div><div class="klbl">Tickets Jira</div>
    <div class="kval" id="kvK">&#8212;</div><div class="ksub" id="kvKs">issues liées</div>
  </div>
  <div class="card kcard" title="% tickets estimés où réel dépasse estimation">
    <div class="kicon">&#128202;</div><div class="klbl">Taux dépassement</div>
    <div class="kval">{kpi_est["taux_depassement"]}%</div>
    <div class="ksub">sur {kpi_est["n_tickets"]} tickets estimés</div>
    <div class="ktip">Écart moy : {kpi_est["ecart_moyen_pct"]:+.1f}%</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#9878;&#65039;</div><div class="klbl">Médiane écart</div>
    <div class="kval">{kpi_est["median_pct"]:+.0f}%</div>
    <div class="ksub">estimation vs réel</div>
  </div>
</div>

<div class="sdiv"><div class="sdot"></div>Filtres</div>
<div class="card fbar">
  <div class="fg"><label>Utilisateur</label>
    <select id="fU"><option value="">Tous</option>{uopts}</select></div>
  <div class="fg"><label>Projet</label>
    <select id="fP"><option value="">Tous</option>{popts}</select></div>
  <div class="fg"><label>Statut</label>
    <select id="fS">
      <option value="">Tous</option>
      <option value="done">&#10003; Done</option>
      <option value="in_progress">&#8635; In Progress</option>
      <option value="pending">&#9203; Pending</option>
      <option value="other">&#9675; Non lié Jira</option>
    </select></div>
  <div class="fg"><label>Mois début</label>
    <select id="fMf"><option value="">Début</option>{mopts}</select></div>
  <div class="fg"><label>Mois fin</label>
    <select id="fMt"><option value="">Fin</option>{mopts}</select></div>
  <div class="fright">
    <span class="rc"><strong id="rc">&#8212;</strong> entrées</span>
    <button class="rbtn" onclick="rst()">&#10005; Reset</button>
    <button class="ebtn" onclick="doExp()">&#11015; CSV</button>
  </div>
</div>

<div class="sdiv"><div class="sdot"></div>Charge de travail</div>
<div class="cgrid">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Heures par Projet</div><div class="csub">Volume total filtré</div>
  </div><span class="cbadge">Projets</span></div><canvas id="cProj"></canvas></div>
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Top Utilisateurs</div><div class="csub">Heures par membre</div>
  </div><span class="cbadge">Users</span></div><canvas id="cUser"></canvas></div>
</div>

<div class="sdiv"><div class="sdot"></div>Analyse statuts</div>
<div class="cgrid">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Répartition globale</div><div class="csub">Distribution des statuts</div>
  </div><span class="cbadge">Status</span></div><canvas id="cPie"></canvas></div>
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Statut par Projet</div><div class="csub">Vue empilée</div>
  </div><span class="cbadge">Stacked</span></div><canvas id="cStack"></canvas></div>
</div>

<div class="sdiv"><div class="sdot"></div>Activité &amp; Facturation</div>
<div class="cgrid">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Catégories d'activité</div><div class="csub">Réunion · Dev · Test · Doc</div>
  </div><span class="cbadge">Tags</span></div><canvas id="cCat"></canvas></div>
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Facturable vs Non-facturable</div><div class="csub">Analyse de facturation</div>
  </div><span class="cbadge">Billing</span></div><canvas id="cBill"></canvas></div>
</div>

<div class="sdiv"><div class="sdot"></div>Tendances temporelles</div>
<div class="cgrid full">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Activité Mensuelle</div><div class="csub">Évolution des heures</div>
  </div><span class="cbadge">Tendance</span></div><canvas id="cMonth" style="max-height:260px;"></canvas></div>
</div>
<div class="cgrid full">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Évolution par Projet (MoM)</div><div class="csub">Heures mensuelles empilées</div>
  </div><span class="cbadge">MoM</span></div><canvas id="cMoM" style="max-height:280px;"></canvas></div>
</div>
"""

    # Inject data via concatenation — never inside f-strings
    raw_j  = merged[["User","Project","Status","duration_hours","month_solid",
                      "Billable","Tags","Task_key"]].rename(
                          columns={"duration_hours":"h","month_solid":"m","Task_key":"k"}
                      ).to_json(orient="records", force_ascii=False)
    cat_j  = jdump(kpi_cat)
    bill_j = jdump(kpi_bill)
    sp_j   = jdump(kpi_status_pivot)
    mp_j   = jdump(kpi_m_proj)
    mon_j  = jdump(kpi_monthly)
    est_j  = jscalar(kpi_est)

    data_js = (
        "var RAW=" + raw_j + ";"
        "var CAT_D=" + cat_j + ";"
        "var BILL_D=" + bill_j + ";"
        "var SP_D=" + sp_j + ";"
        "var MP_D=" + mp_j + ";"
        "var MON_D=" + mon_j + ";"
        "var EST=" + est_j + ";"
        f"var TH={th};"
        f"var NU={int(merged['User'].nunique())};"
        f"var NP_={int(merged['Project'].nunique())};"
        f"var NK={int(merged['Task_key'].nunique())};"
    )

    # All charts JS in raw string — pure JavaScript, no Python brace escaping
    charts_js = r"""
var _charts={};
function da(){Object.values(_charts).forEach(function(c){c.destroy();});_charts={};}

function gf(){
  var u=document.getElementById("fU").value,
      p=document.getElementById("fP").value,
      s=document.getElementById("fS").value,
      mf=document.getElementById("fMf").value,
      mt=document.getElementById("fMt").value;
  return RAW.filter(function(d){
    if(u&&d.User!==u)return false;
    if(p&&d.Project!==p)return false;
    if(s&&d.Status!==s)return false;
    if(mf&&d.m<mf)return false;
    if(mt&&d.m>mt)return false;
    return true;
  });
}
function rst(){["fU","fP","fS","fMf","fMt"].forEach(function(id){document.getElementById(id).value="";});upd();}
function doExp(){csvExport(gf(),"dashboard_export.csv");}

function upd(){
  var d=gf();
  var th=d.reduce(function(s,r){return s+Number(r.h||0);},0);
  var nu=new Set(d.map(function(r){return r.User;})).size;
  var np=new Set(d.map(function(r){return r.Project;})).size;
  var nk=new Set(d.filter(function(r){return r.k;}).map(function(r){return r.k;})).size;
  animNum("kvH",th,1);animNum("kvU",nu);animNum("kvP",np);animNum("kvK",nk);
  document.getElementById("kvHs").textContent=d.length.toLocaleString()+" entr\u00e9es";
  document.getElementById("kvUs").textContent=nu+" membres";
  document.getElementById("kvPs").textContent=np+" projets";
  document.getElementById("kvKs").textContent=nk+" issues";
  document.getElementById("rc").textContent=d.length.toLocaleString();
  da();

  /* Aggregate by project, user, status, month */
  var byP={},byU={},sc={done:0,in_progress:0,pending:0,other:0},mo={};
  d.forEach(function(r){
    var h=Number(r.h||0);
    byP[r.Project]=(byP[r.Project]||0)+h;
    byU[r.User]=(byU[r.User]||0)+h;
    var st=r.Status||"other";
    if(sc.hasOwnProperty(st))sc[st]++;else sc.other++;
    if(r.m)mo[r.m]=(mo[r.m]||0)+h;
  });

  var pL=Object.keys(byP).sort(function(a,b){return byP[b]-byP[a];});
  var uL=Object.keys(byU).sort(function(a,b){return byU[b]-byU[a];}).slice(0,10);
  var moK=Object.keys(mo).sort();

  _charts.proj=vbar("cProj",pL,pL.map(function(k){return +byP[k].toFixed(1);}));
  _charts.user=hbar("cUser",uL,uL.map(function(k){return +byU[k].toFixed(1);}));

  _charts.pie=donut("cPie",
    ["Done","In Progress","Pending","Non li\u00e9 Jira"],
    [sc.done,sc.in_progress,sc.pending,sc.other],
    [C.b,C.r,C.t,C.g]
  );

  var spL=SP_D.map(function(r){return r.Project;});
  _charts.stack=stackedBar("cStack",spL,[
    {label:"Done",      data:SP_D.map(function(r){return r.done||0;}),      backgroundColor:C.b,maxBarThickness:30,borderRadius:2},
    {label:"In Progress",data:SP_D.map(function(r){return r.in_progress||0;}),backgroundColor:C.r,maxBarThickness:30},
    {label:"Pending",   data:SP_D.map(function(r){return r.pending||0;}),   backgroundColor:C.t,maxBarThickness:30}
  ]);

  _charts.cat=donut("cCat",
    CAT_D.map(function(r){return r["Cat\u00e9gorie"];}),
    CAT_D.map(function(r){return +r.heures.toFixed(1);}),
    [C.b,C.m,C.r,C.t,C.v,C.g]
  );

  var bH=BILL_D.reduce(function(o,r){o[r.Billable]=r.heures;return o;},{});
  _charts.bill=donut("cBill",
    ["Non facturable","Facturable"],
    [+(bH["No"]||0).toFixed(1),+(bH["Yes"]||0).toFixed(1)],
    [C.b,C.m]
  );

  _charts.month=lineChart("cMonth",moK,moK.map(function(k){return +(mo[k]||0).toFixed(1);}));

  /* Month-over-Month stacked bar */
  var aP=[],aM=[];
  MP_D.forEach(function(r){
    if(aP.indexOf(r.Project)<0)aP.push(r.Project);
    if(aM.indexOf(r.month_solid)<0)aM.push(r.month_solid);
  });
  aP.sort();aM.sort();
  var mDS=aP.map(function(p,i){
    return {
      label:p,
      data:aM.map(function(m){
        var row=MP_D.find(function(r){return r.Project===p&&r.month_solid===m;});
        return row?+row.heures.toFixed(1):0;
      }),
      backgroundColor:PAL[i%PAL.length],
      maxBarThickness:28,borderRadius:2
    };
  });
  _charts.mom=stackedBar("cMoM",aM,mDS);
}

["fU","fP","fS","fMf","fMt"].forEach(function(id){
  document.getElementById(id).addEventListener("change",upd);
});
upd();
"""
    return build_page("Dashboard", "dash", body, data_js, charts_js)


# ═══════════════════════════════════════════════════════════════════════
# 9. KPI HTML
# ═══════════════════════════════════════════════════════════════════════
def generate_kpi_html():
    th    = round(total_h, 1)
    top_u = kpi_user.iloc[0]["User"]       if len(kpi_user)    else "—"
    top_p = kpi_project.iloc[0]["Project"] if len(kpi_project) else "—"
    nk    = int(merged["Task_key"].nunique())

    # Estimation table — pure HTML string, safe in f-string (no JS braces)
    erows = ""
    if len(est_df):
        for _, r in est_df.head(30).iterrows():
            sign = "+" if r["delta_pct"] > 0 else ""
            cls  = "bprog" if r["delta_pct"] > 0 else "bdone"
            erows += (
                "<tr>"
                f"<td style='font-family:DM Mono,monospace;color:var(--rose);font-size:10px;'>{r['Issue key']}</td>"
                f"<td>{r['Issue Type']}</td>"
                f"<td style='font-family:DM Mono,monospace;'>{r['orig_est_h']:.1f}h</td>"
                f"<td style='font-family:DM Mono,monospace;'>{r['actual_hours']:.1f}h</td>"
                f"<td><span class='badge {cls}'>{sign}{r['delta_pct']:.1f}%</span></td>"
                "</tr>"
            )
    else:
        erows = "<tr><td colspan='5' style='text-align:center;color:var(--text3);padding:24px;'>Aucune donnée d'estimation disponible</td></tr>"

    body = f"""
<div class="sdiv"><div class="sdot"></div>Indicateurs clés</div>
<div class="kgrid">
  <div class="card kcard" title="Somme de toutes les entrées Solidtime">
    <div class="kicon">&#9201;</div><div class="klbl">Total Heures</div>
    <div class="kval">{th:,.0f}</div><div class="ksub">{merged['duration_hours'].count():,} entrées</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#128101;</div><div class="klbl">Membres actifs</div>
    <div class="kval">{merged['User'].nunique()}</div><div class="ksub">Top : {top_u}</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#128193;</div><div class="klbl">Projets</div>
    <div class="kval">{merged['Project'].nunique()}</div><div class="ksub">Top : {top_p}</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#127243;</div><div class="klbl">Tickets Jira</div>
    <div class="kval">{nk}</div><div class="ksub">issues trackées</div>
  </div>
  <div class="card kcard" title="% tickets où réel dépasse estimé">
    <div class="kicon">&#128202;</div><div class="klbl">Taux dépassement</div>
    <div class="kval">{kpi_est["taux_depassement"]}%</div>
    <div class="ksub">sur {kpi_est["n_tickets"]} tickets</div>
    <div class="ktip">Écart moy : {kpi_est["ecart_moyen_pct"]:+.1f}% / {kpi_est["ecart_moyen_h"]:+.2f}h</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#9878;&#65039;</div><div class="klbl">Médiane écart</div>
    <div class="kval">{kpi_est["median_pct"]:+.0f}%</div>
    <div class="ksub">estimation vs réel</div>
  </div>
  <div class="card kcard" title="Heures Test / Heures Développement">
    <div class="kicon">&#129514;</div><div class="klbl">Ratio Test/Dev</div>
    <div class="kval">{ratio_test_dev}%</div>
    <div class="ksub">{h_test:.0f}h test · {h_dev:.0f}h dev</div>
  </div>
  <div class="card kcard" title="Heures réunion / heures d'exécution">
    <div class="kicon">&#128172;</div><div class="klbl">Réunion/Exécution</div>
    <div class="kval">{ratio_meet_exec}%</div>
    <div class="ksub">{h_meet:.0f}h réunion sur {total_h:.0f}h total</div>
  </div>
</div>

<div class="sdiv"><div class="sdot"></div>Productivité</div>
<div class="cgrid">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Top Utilisateurs</div><div class="csub">Heures totales par membre</div>
  </div><span class="cbadge">Top 20</span></div><canvas id="cUser"></canvas></div>
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Heures par Projet</div><div class="csub">Distribution du volume</div>
  </div><span class="cbadge">Projets</span></div><canvas id="cProj"></canvas></div>
</div>

<div class="sdiv"><div class="sdot"></div>Qualité &amp; Activité</div>
<div class="cgrid">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Top Tags Solidtime</div><div class="csub">Heures par activité</div>
  </div><span class="cbadge">Tags</span></div><canvas id="cTags"></canvas></div>
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Issue Type Jira</div><div class="csub">Heures par type (tickets liés)</div>
  </div><span class="cbadge">Jira</span></div><canvas id="cItype"></canvas></div>
</div>

<div class="sdiv"><div class="sdot"></div>Criticité &amp; Tendances</div>
<div class="cgrid">
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Heures par Criticité</div><div class="csub">Critique · Majeur · Medium · Mineur</div>
  </div><span class="cbadge">Criticité</span></div><canvas id="cCrit"></canvas></div>
  <div class="card ccard"><div class="chead"><div>
    <div class="ctitle">Activité Mensuelle</div><div class="csub">Time series mois par mois</div>
  </div><span class="cbadge">Tendance</span></div><canvas id="cMonth"></canvas></div>
</div>

<div class="sdiv"><div class="sdot"></div>Estimation vs Réel — Top 30 tickets</div>
<div class="card">
  <div class="thead"><div>
    <h3>Précision des estimations</h3>
    <p>Tickets avec Original Estimate Jira + heures Solidtime · Écart moy : {kpi_est["ecart_moyen_pct"]:+.1f}% · Dépassement : {kpi_est["taux_depassement"]}%</p>
  </div></div>
  <div class="tw"><table>
    <thead><tr>
      <th>Issue Key</th><th>Type</th>
      <th title="Original Estimate Jira en heures">Estimé (h)</th>
      <th title="Heures réelles Solidtime">Réel (h)</th>
      <th>Écart %</th>
    </tr></thead>
    <tbody>{erows}</tbody>
  </table></div>
</div>
"""

    ud_j = jdump(kpi_user.head(20).rename(columns={"duration_hours": "h"}))
    pd_j = jdump(kpi_project.rename(columns={"duration_hours": "h"}))
    md_j = jdump(kpi_monthly.rename(columns={"duration_hours": "h"}))
    tg_j = jdump(kpi_tags.head(15).rename(columns={"duration_hours": "h"}))
    it_j = jdump(kpi_itype.rename(columns={"duration_hours": "h", "tickets": "n"}))
    cr_j = jdump(kpi_crit.rename(columns={"criticite": "c", "duration_hours": "h"}))

    data_js = (
        "var UD=" + ud_j + ";"
        "var PD=" + pd_j + ";"
        "var MD=" + md_j + ";"
        "var TG=" + tg_j + ";"
        "var IT=" + it_j + ";"
        "var CR=" + cr_j + ";"
    )

    charts_js = r"""
hbar("cUser",UD.map(function(r){return r.User;}),UD.map(function(r){return +r.h.toFixed(1);}));
vbar("cProj",PD.map(function(r){return r.Project;}),PD.map(function(r){return +r.h.toFixed(1);}));
hbar("cTags",TG.map(function(r){return r.Tag;}),TG.map(function(r){return +r.h.toFixed(1);}));
hbar("cItype",IT.map(function(r){return r["Issue Type"];}),IT.map(function(r){return +r.h.toFixed(1);}));
hbar("cCrit",CR.map(function(r){return r.c;}),CR.map(function(r){return +r.h.toFixed(1);}));
lineChart("cMonth",MD.map(function(r){return r.month_solid;}),MD.map(function(r){return +r.h.toFixed(1);}));
"""
    return build_page("KPI Overview", "kpi", body, data_js, charts_js)


# ═══════════════════════════════════════════════════════════════════════
# 10. DATA WAREHOUSE HTML
# ═══════════════════════════════════════════════════════════════════════
def generate_data_warehouse_html():
    th_   = round(total_h, 1)
    top_u = merged.groupby("User")["duration_hours"].sum().idxmax()    if len(merged) else "—"
    top_p = merged.groupby("Project")["duration_hours"].sum().idxmax() if len(merged) else "—"
    nk_   = int(merged["Task_key"].nunique())

    users  = sorted(merged["User"].dropna().unique().tolist())
    projs  = sorted(merged["Project"].dropna().unique().tolist())
    months = sorted(merged["month_solid"].dropna().unique().tolist())

    uopts = "".join(f'<option value="{u}">{u}</option>' for u in users)
    popts = "".join(f'<option value="{p}">{p}</option>' for p in projs)
    mopts = "".join(f'<option value="{m}">{m}</option>' for m in months)

    # Build table data — select available columns
    want_cols = ["User","Project","Client","month_solid","duration_hours","Status",
                 "Billable","Tags","Task_key","Issue Type",
                 "Custom field (Criticité)","Custom field (Equipe Dédiée)","Summary","Assignee"]
    cols = [c for c in want_cols if c in merged.columns]
    tdf  = merged[cols].copy()
    tdf["duration_hours"] = tdf["duration_hours"].round(2)
    tdf  = tdf.fillna("").infer_objects(copy=False)
    raw_j = tdf.to_json(orient="records", force_ascii=False)

    # Star schema node helper
    def dim_node(color_rgb, label_color, icon, label, fields_html, extra_style=""):
        return (
            f'<div style="background:rgba({color_rgb},.08);border:1px solid rgba({color_rgb},.3);'
            f'border-radius:13px;padding:15px 17px;transition:all .3s;{extra_style}"'
            f' onmouseover="this.style.boxShadow=\'0 0 26px rgba({color_rgb},.28)\';'
            f'document.getElementById(\'fb\').style.borderColor=\'rgba(201,110,128,.65)\'"'
            f' onmouseout="this.style.boxShadow=\'\';document.getElementById(\'fb\').style.borderColor=\'\'">'
            f'<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:.16em;'
            f'text-transform:uppercase;color:#{label_color};margin-bottom:7px;">{icon} Dimension</div>'
            f'<div style="font-family:\'Cormorant Garamond\',serif;font-size:16px;color:var(--text);margin-bottom:9px;">{label}</div>'
            f'<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text2);">{fields_html}</div>'
            f'</div>'
        )

    def vline():
        return '<div style="display:flex;align-items:center;justify-content:center;"><div style="width:1px;height:80px;background:linear-gradient(to bottom,transparent,rgba(128,0,32,.38),transparent);"></div></div>'

    def hline_r():
        return '<div style="display:flex;align-items:center;justify-content:flex-end;padding-right:7px;"><div style="flex:1;height:2px;background:linear-gradient(90deg,rgba(42,157,143,.5),rgba(201,110,128,.3));position:relative;"><div style="position:absolute;top:-4px;right:0;width:8px;height:8px;border-radius:50%;background:var(--rose);box-shadow:0 0 7px rgba(201,110,128,.5);"></div></div></div>'

    def hline_l():
        return '<div style="display:flex;align-items:center;justify-content:flex-start;padding-left:7px;"><div style="flex:1;height:2px;background:linear-gradient(90deg,rgba(201,110,128,.3),rgba(58,134,184,.5));position:relative;"><div style="position:absolute;top:-4px;left:0;width:8px;height:8px;border-radius:50%;background:var(--rose);box-shadow:0 0 7px rgba(201,110,128,.5);"></div></div></div>'

    body = f"""
<div style="margin-bottom:28px;">
  <div style="font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--burg);margin-bottom:6px;">Architecture données</div>
  <h1 style="font-family:'Cormorant Garamond',serif;font-size:36px;font-weight:300;color:var(--text);letter-spacing:-.02em;">Data Warehouse <em style="font-style:italic;color:var(--burg);">Modèle en Étoile</em></h1>
  <p style="font-size:13px;color:var(--text3);margin-top:8px;max-width:560px;line-height:1.7;">Source : <strong style="color:var(--teal)">Jira</strong> + <strong style="color:var(--blue)">SolidTime</strong>. Table centrale <code style="color:var(--rose);font-family:'DM Mono',monospace;">fact_time_tracking</code> reliée à 4 dimensions.</p>
</div>

<div class="kgrid">
  <div class="card kcard">
    <div class="kicon">&#9201;</div><div class="klbl">Total Heures</div>
    <div class="kval" id="kvH">{th_:,.0f}</div><div class="ksub" id="kvHs">toutes entrées filtrées</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#128081;</div><div class="klbl">Top Utilisateur</div>
    <div class="kval" style="font-size:20px;padding-top:4px;">{top_u.split()[0] if top_u != "—" else "—"}</div>
    <div class="ksub">{top_u}</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#127942;</div><div class="klbl">Top Projet</div>
    <div class="kval" style="font-size:20px;padding-top:4px;">{top_p.split()[0] if top_p != "—" else "—"}</div>
    <div class="ksub">{top_p}</div>
  </div>
  <div class="card kcard">
    <div class="kicon">&#127243;</div><div class="klbl">Tickets Jira</div>
    <div class="kval">{nk_}</div><div class="ksub">issues distinctes</div>
  </div>
</div>

<div class="sdiv"><div class="sdot"></div>Schéma en étoile</div>
<div class="card" style="margin-bottom:28px;padding:32px 20px;position:relative;overflow:hidden;">
  <style>@keyframes factPulse{{0%,100%{{box-shadow:0 0 34px rgba(128,0,32,.17);}}50%{{box-shadow:0 0 54px rgba(128,0,32,.32);}}}}</style>
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 60% 60% at 50% 50%,rgba(128,0,32,.06) 0%,transparent 70%);pointer-events:none;"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;max-width:820px;margin:0 auto;align-items:center;position:relative;z-index:2;">
    {dim_node("42,157,143","2a9d8f","&#128309;","dim_user","&#128273; <span style='color:#c9a84c;'>user_id</span> INT<br>&#183; username VARCHAR<br>&#183; email VARCHAR<br>&#183; role VARCHAR")}
    {vline()}
    {dim_node("58,134,184","3a86b8","&#128311;","dim_project","&#128273; <span style='color:#c9a84c;'>project_id</span> INT<br>&#183; project_name VARCHAR<br>&#183; client VARCHAR<br>&#183; status VARCHAR")}
    {hline_r()}
    <div id="fb" style="background:rgba(128,0,32,.1);border:1.5px solid rgba(128,0,32,.42);border-radius:14px;padding:18px 20px;text-align:center;transition:all .3s;animation:factPulse 3s ease-in-out infinite;">
      <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:var(--rose);margin-bottom:7px;">&#11088; Table de Faits</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:19px;color:var(--text);margin-bottom:9px;">fact_time_tracking</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;">
        <span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(128,0,32,.18);border:1px solid rgba(128,0,32,.35);color:var(--rose);">user_id &#128279;</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(128,0,32,.18);border:1px solid rgba(128,0,32,.35);color:var(--rose);">project_id &#128279;</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(128,0,32,.18);border:1px solid rgba(128,0,32,.35);color:var(--rose);">task_id &#128279;</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(128,0,32,.18);border:1px solid rgba(128,0,32,.35);color:var(--rose);">date_id &#128279;</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);color:#c9a84c;">duration_hours</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--text2);">status</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--text2);">billable</span>
      </div>
    </div>
    {hline_l()}
    {dim_node("123,94,167","7b5ea7","&#128313;","dim_task","&#128273; <span style='color:#c9a84c;'>task_id</span> INT<br>&#183; task_name VARCHAR<br>&#183; issue_type VARCHAR<br>&#183; priority VARCHAR")}
    {vline()}
    {dim_node("201,168,76","c9a84c","&#128256;","dim_date","&#128273; <span style='color:#c9a84c;'>date_id</span> INT<br>&#183; full_date DATE<br>&#183; month VARCHAR<br>&#183; quarter INT &#183; year INT")}
  </div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);justify-content:center;font-family:'DM Mono',monospace;font-size:10px;color:var(--text3);">
    <span style="color:#c9a84c;">&#128273; Clé primaire</span>
    <span style="color:var(--rose);">&#128279; Clé étrangère</span>
    <span style="color:#2a9d8f;">&#9632; dim_user</span>
    <span style="color:#3a86b8;">&#9632; dim_project</span>
    <span style="color:#7b5ea7;">&#9632; dim_task</span>
    <span style="color:#c9a84c;">&#9632; dim_date</span>
    <span style="color:var(--burg);">&#11088; fact_time_tracking</span>
  </div>
</div>

<div class="sdiv"><div class="sdot"></div>Données brutes filtrables</div>
<div class="card fbar">
  <div class="fg"><label>Utilisateur</label><select id="fU" onchange="upd()"><option value="">Tous</option>{uopts}</select></div>
  <div class="fg"><label>Projet</label><select id="fP" onchange="upd()"><option value="">Tous</option>{popts}</select></div>
  <div class="fg"><label>Statut</label>
    <select id="fS" onchange="upd()">
      <option value="">Tous</option>
      <option value="done">&#10003; Done</option>
      <option value="in_progress">&#8635; In Progress</option>
      <option value="pending">&#9203; Pending</option>
      <option value="other">&#9675; Non lié Jira</option>
    </select></div>
  <div class="fg"><label>Mois</label><select id="fM" onchange="upd()"><option value="">Tous</option>{mopts}</select></div>
  <div class="fg"><label>Lien Jira</label>
    <select id="fJ" onchange="upd()">
      <option value="">Tous</option>
      <option value="yes">Liés Jira</option>
      <option value="no">Sans Jira</option>
    </select></div>
  <div class="fright">
    <span class="rc"><strong id="rc">&#8212;</strong> lignes</span>
    <button class="rbtn" onclick="rst()">&#10005; Reset</button>
    <button class="ebtn" onclick="doExp()">&#11015; Export CSV</button>
  </div>
</div>

<div class="card">
  <div class="thead"><div>
    <h3>fact_time_tracking</h3>
    <p id="tdesc">Données Solidtime + Jira mergées · {len(tdf):,} lignes totales</p>
  </div></div>
  <div class="tw">
    <table>
      <thead><tr>
        <th onclick="sb('User')">Utilisateur &#8597;</th>
        <th onclick="sb('Project')">Projet &#8597;</th>
        <th onclick="sb('month_solid')">Mois &#8597;</th>
        <th onclick="sb('duration_hours')">Durée &#8597;</th>
        <th onclick="sb('Status')">Statut &#8597;</th>
        <th onclick="sb('Task_key')">Ticket &#8597;</th>
        <th onclick="sb('Issue Type')">Type</th>
        <th>Criticité</th>
        <th>Tags</th>
      </tr></thead>
      <tbody id="tb"></tbody>
    </table>
  </div>
  <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
    <span id="pgi" style="font-size:11px;color:var(--text3);">&#8212;</span>
    <div id="pgc" style="display:flex;gap:4px;"></div>
  </div>
</div>
"""

    data_js = "var RAW=" + raw_j + ";"

    charts_js = r"""
var SB_MAP={done:"bdone",in_progress:"bprog",pending:"bpend",other:"both"};
var SL_MAP={done:"&#10003; Done",in_progress:"&#8635; In Progress",pending:"&#9203; Pending",other:"&#9675; Autre"};
var CRIT_COLOR={"&#128308; Critique":"#f87171","&#128992; Majeur":"#fb923c","&#127997; Medium":"#fbbf24","&#128309; Mineure":"#60a5fa"};
var fil=RAW.slice(),sk="duration_hours",sd=-1,page=1,PS=15;

function gf(){
  var u=document.getElementById("fU").value,p=document.getElementById("fP").value,
      s=document.getElementById("fS").value,m=document.getElementById("fM").value,
      j=document.getElementById("fJ").value;
  return RAW.filter(function(r){
    if(u&&r.User!==u)return false;
    if(p&&r.Project!==p)return false;
    if(s&&r.Status!==s)return false;
    if(m&&r.month_solid!==m)return false;
    if(j==="yes"&&!r.Task_key)return false;
    if(j==="no"&&r.Task_key)return false;
    return true;
  });
}
function rst(){["fU","fP","fS","fM","fJ"].forEach(function(id){document.getElementById(id).value="";});upd();}
function doExp(){csvExport(fil,"data_warehouse_export.csv");}
function sb(k){if(sk===k)sd*=-1;else{sk=k;sd=-1;}upd();}
function rdr(){
  var tot=fil.length,pages=Math.max(1,Math.ceil(tot/PS));
  page=Math.min(page,pages);
  var sl=fil.slice((page-1)*PS,page*PS);
  document.getElementById("rc").textContent=tot.toLocaleString();
  document.getElementById("pgi").textContent="Page "+page+"/"+pages+" \u2014 "+((page-1)*PS+1)+"\u2013"+Math.min(page*PS,tot)+" sur "+tot;
  var th=fil.reduce(function(s,r){return s+Number(r.duration_hours||0);},0);
  document.getElementById("kvH").textContent=th.toFixed(1);
  document.getElementById("kvHs").textContent=tot.toLocaleString()+" entr\u00e9es filtr\u00e9es";
  var cc=document.getElementById("tb");
  cc.innerHTML=sl.map(function(r){
    var h=Number(r.duration_hours||0).toFixed(2);
    var st=r.Status||"other",bd=SB_MAP[st]||"both",lbl=SL_MAP[st]||st;
    var crit=r["Custom field (Crit\u00e9)"]||r["Custom field (Critica)"]||"&#8212;";
    var tags=(r.Tags||"").split(", ").filter(Boolean).map(function(t){
      return '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,.06);color:var(--text3);">'+t+'</span>';
    }).join(" ");
    return "<tr>"
      +"<td style='font-weight:500;color:var(--text);'>"+(r.User||"&#8212;")+"</td>"
      +"<td style='color:var(--blue);font-weight:500;'>"+(r.Project||"&#8212;")+"</td>"
      +"<td style='font-family:DM Mono,monospace;font-size:11px;'>"+(r.month_solid||"&#8212;")+"</td>"
      +"<td><div class='pbar-wrap'><div class='pbar'><div class='pfill' style='width:"+Math.min(Number(r.duration_hours||0)/12*100,100)+"%'></div></div>"
       +"<span style='font-family:DM Mono,monospace;font-size:11px;min-width:38px;color:var(--gold);'>"+h+"h</span></div></td>"
      +"<td><span class='badge "+bd+"'>"+lbl+"</span></td>"
      +"<td style='font-family:DM Mono,monospace;font-size:10px;color:var(--rose);'>"+(r.Task_key||"&#8212;")+"</td>"
      +"<td style='font-size:11px;'>"+(r["Issue Type"]||"&#8212;")+"</td>"
      +"<td style='font-size:11px;'>"+crit+"</td>"
      +"<td>"+tags+"</td>"
      +"</tr>";
  }).join("");
  var ctrl=document.getElementById("pgc");
  if(pages<=1){ctrl.innerHTML="";return;}
  var h2='<button onclick="gp('+(page-1)+')" '+(page===1?"disabled ":"")
    +'style="width:27px;height:27px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text3);cursor:pointer;">&#8249;</button>';
  for(var i=1;i<=pages;i++){
    if(pages>7&&Math.abs(i-page)>2&&i!==1&&i!==pages){
      if(i===page-3||i===page+3)h2+='<button disabled style="border:none;background:transparent;color:var(--text3);">&#8230;</button>';
      continue;
    }
    h2+='<button onclick="gp('+i+')" style="width:27px;height:27px;border-radius:7px;border:1px solid var(--border);background:'
        +(i===page?"var(--burg)":"transparent")+';color:'+(i===page?"white":"var(--text3)")+';cursor:pointer;">'+i+'</button>';
  }
  h2+='<button onclick="gp('+(page+1)+')" '+(page===pages?"disabled ":"")
    +'style="width:27px;height:27px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text3);cursor:pointer;">&#8250;</button>';
  ctrl.innerHTML=h2;
}
function gp(p){page=p;rdr();}
function upd(){
  fil=gf().sort(function(a,b){
    var va=a[sk]||"",vb=b[sk]||"";
    return typeof va==="number"?(va-vb)*sd:String(va).localeCompare(String(vb))*sd;
  });
  page=1;rdr();
}
upd();
"""
    return build_page("Data Warehouse", "dw", body, data_js, charts_js)


# ═══════════════════════════════════════════════════════════════════════
# 11. WRITE ALL OUTPUTS
# ═══════════════════════════════════════════════════════════════════════
print("\nGénération HTML...")
for fname, fn in [
    ("dashboard.html",      generate_dashboard_html),
    ("kpi.html",            generate_kpi_html),
    ("data_warehouse.html", generate_data_warehouse_html),
]:
    html = fn()
    path = os.path.join(OUT_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    kb = os.path.getsize(path) // 1024
    print(f"  ✅ {fname:<28} ({kb} KB)")

# CSV exports for external dashboard (if needed)
merged[["User","Project","Status","duration_hours","month_solid",
        "Task_key","Billable","Tags","Client"]].to_csv(
    os.path.join(OUT_DIR, "dashboard_dataset.csv"), index=False)
kpi_user.to_csv(   os.path.join(OUT_DIR, "kpi_user.csv"),   index=False)
kpi_project.to_csv(os.path.join(OUT_DIR, "kpi_project.csv"),index=False)
kpi_monthly.to_csv(os.path.join(OUT_DIR, "kpi_monthly.csv"),index=False)
kpi_status_pivot.to_csv(os.path.join(OUT_DIR, "kpi_status_project_pivot.csv"), index=False)
print("  ✅ CSV files exported")
print()
print("═══════════════════════════════════════════════════════")
print(f"✅ ETL terminé · {total_h:,.0f}h · {merged['User'].nunique()} users · {merged['Project'].nunique()} projets")
print(f"   {kpi_est['n_tickets']} tickets estimés · Dépassement : {kpi_est['taux_depassement']}%")
print(f"   Ratio Test/Dev : {ratio_test_dev}% · Réunion/Exec : {ratio_meet_exec}%")
print(f"   Ouvrez output/dashboard.html dans votre navigateur")
print("═══════════════════════════════════════════════════════")
