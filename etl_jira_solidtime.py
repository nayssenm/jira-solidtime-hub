import pandas as pd
import os

# -----------------------------
# 1. PATHS
# -----------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

jira_path = os.path.join(BASE_DIR, "data", "jira_rescue_team.csv")
solid_path = os.path.join(BASE_DIR, "data", "solidtime_data.csv")

output_dir = os.path.join(BASE_DIR, "output")
os.makedirs(output_dir, exist_ok=True)

# -----------------------------
# 2. LOAD
# -----------------------------
jira = pd.read_csv(jira_path)
solid = pd.read_csv(solid_path)

print("JIRA shape:", jira.shape)
print("SOLIDTIME shape:", solid.shape)

# -----------------------------
# 3. CLEAN SOLIDTIME
# -----------------------------
solid = solid.drop_duplicates()
solid = solid.dropna(subset=['User', 'Start', 'End'])

solid['Start'] = pd.to_datetime(solid['Start'], unit='ms', errors='coerce')
solid['End'] = pd.to_datetime(solid['End'], unit='ms', errors='coerce')
solid = solid.dropna(subset=['Start', 'End'])

solid['Duration (decimal)'] = pd.to_numeric(solid['Duration (decimal)'], errors='coerce')
solid = solid[solid['Duration (decimal)'] > 0]

solid['User'] = solid['User'].str.strip().str.lower()
solid['Project'] = solid['Project'].str.strip().str.upper()

# 🔥 EXTRACTION ULTRA ROBUSTE
solid['Task'] = solid['Task'].fillna("").astype(str).str.upper()

# capture ARV-123 ou ARV123 ou ARV_123
solid['Task_key'] = solid['Task'].str.extract(r'([A-Z]+[-_]?\d+)')

# normalisation
solid['Task_key'] = solid['Task_key'].str.replace('_', '-', regex=False)

print("\nDEBUG TASK:")
print(solid[['Task', 'Task_key']].head(10))
print("Task_key non null:", solid['Task_key'].notna().sum())

# Dates
solid['year_solid'] = solid['Start'].dt.year
solid['month_solid'] = solid['Start'].dt.month

solid['duration_hours'] = solid['Duration (decimal)']

# -----------------------------
# 4. CLEAN JIRA
# -----------------------------
jira = jira.drop_duplicates()
jira = jira.dropna(subset=['Issue key', 'Created', 'Status'])

jira['Issue key'] = jira['Issue key'].astype(str).str.upper().str.strip()
jira['Issue key'] = jira['Issue key'].str.replace('_', '-', regex=False)

jira['Status'] = jira['Status'].str.strip().str.lower()

print("\nDEBUG JIRA KEYS:")
print(jira['Issue key'].head(10))

# -----------------------------
# 🔥 TEST MATCH AVANT MERGE
# -----------------------------
common = set(solid['Task_key'].dropna()) & set(jira['Issue key'])
print("\nClés communes trouvées:", len(common))

# -----------------------------
# 5. MERGE
# -----------------------------
merged = pd.merge(
    solid,
    jira,
    left_on='Task_key',
    right_on='Issue key',
    how='left'
)

matches = merged['Issue key'].notna().sum()
print("MATCHES APRÈS MERGE:", matches)

# -----------------------------
# 🔥 SÉCURITÉ ANTI-VIDE
# -----------------------------
merged['Status'] = merged['Status'].fillna('non lié')

# -----------------------------
# 6. NORMALISATION STATUS
# -----------------------------
status_mapping = {
    'déployé': 'done',
    'terminé': 'done',

    'en cours': 'in_progress',
    'validation en cours': 'in_progress',
    'en revue': 'in_progress',

    'en attente de revue': 'pending',
    'en attente de validation': 'pending'
}

merged['Status_clean'] = merged['Status'].map(status_mapping)
merged['Status_clean'] = merged['Status_clean'].fillna('other')

print("\nDEBUG STATUS:")
print(merged['Status_clean'].value_counts())

# -----------------------------
# 7. KPI STATUS PAR PROJET
# -----------------------------
kpi_status_project = merged.groupby(
    ['Project', 'Status_clean']
).size().reset_index(name='count')

# 🔥 pivot sécurisé
kpi_status_project_pivot = kpi_status_project.pivot_table(
    index='Project',
    columns='Status_clean',
    values='count',
    fill_value=0 
)

# -----------------------------
# 8. EXPORT
# -----------------------------
merged.to_csv(os.path.join(output_dir, "dashboard_dataset.csv"), index=False)

kpi_status_project.to_csv(
    os.path.join(output_dir, "kpi_status_project.csv"),
    index=False
)

kpi_status_project_pivot.to_csv(
    os.path.join(output_dir, "kpi_status_project_pivot.csv")
)

print("\n✅ EXPORT TERMINÉ AVEC SUCCÈS !")
