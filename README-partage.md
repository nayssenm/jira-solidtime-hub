# 🔗 Pourquoi le lien de partage ne fonctionne pas — Explication complète

---

## 🔍 Le problème : `file://` vs `http://`

Quand vous ouvrez `dashboard.html` en **double-cliquant dessus** dans votre explorateur de fichiers,
votre navigateur l'ouvre avec le protocole `file://` :

```
file:///C:/Users/vous/projet/dashboard.html
```

Le lien généré ressemble alors à :
```
file:///C:/Users/vous/projet/dashboard.html?share=eyJwZXJtIjoiL...
```

**Problème :** Ce lien `file://` pointe vers un fichier LOCAL sur VOTRE ordinateur.
Quand vous l'envoyez à quelqu'un, leur navigateur cherche ce fichier sur LEUR propre disque dur
→ il n'existe pas → **"Page introuvable"**.

---

## ✅ La solution : utiliser un serveur local

Les liens de partage ne fonctionnent que si la page est servie via `http://` (un vrai serveur).

### Option A — VS Code Live Server (recommandé, 0 configuration)

1. Installez l'extension **Live Server** dans VS Code  
   → Extensions (Ctrl+Shift+X) → cherchez "Live Server" → Installer

2. Ouvrez votre dossier de projet dans VS Code  
   → Fichier > Ouvrir le dossier → sélectionnez le dossier contenant vos `.html`

3. Clic droit sur `dashboard.html` → **"Open with Live Server"**  
   → Votre navigateur s'ouvre sur `http://127.0.0.1:5500/dashboard.html`

4. Le lien généré sera maintenant :
   ```
   http://127.0.0.1:5500/dashboard.html?share=eyJwZXJt...
   ```

> ⚠️ Ce lien fonctionne **uniquement sur votre réseau local** (même Wi-Fi).
> Pour partager avec quelqu'un en dehors, voir Option C.

---

### Option B — Python (aucune installation requise)

1. Ouvrez un terminal dans votre dossier de projet
2. Exécutez :
   ```bash
   # Python 3
   python -m http.server 8080

   # Python 2
   python -m SimpleHTTPServer 8080
   ```
3. Ouvrez `http://localhost:8080/dashboard.html`

---

### Option C — Partager via internet (Netlify Drop, GitHub Pages...)

Pour partager avec quelqu'un **hors de votre réseau** :

#### Netlify Drop (le plus simple, gratuit, 30 secondes)
1. Allez sur **https://app.netlify.com/drop**
2. Glissez-déposez votre dossier entier
3. Vous obtenez une URL comme `https://amazing-name-123.netlify.app`
4. Vos liens de partage fonctionneront partout dans le monde :
   ```
   https://amazing-name-123.netlify.app/dashboard.html?share=TOKEN
   ```

#### GitHub Pages
1. Créez un dépôt GitHub public
2. Poussez vos fichiers
3. Settings > Pages > Branch: main > Save
4. URL : `https://username.github.io/repo-name/dashboard.html`

---

## 📋 Résumé rapide

| Méthode | URL générée | Fonctionne pour |
|---|---|---|
| Fichier direct (double-clic) | `file:///C:/...` | ❌ Personne d'autre |
| Live Server / Python | `http://localhost:5500` | ✅ Votre réseau local |
| Netlify / GitHub Pages | `https://...netlify.app` | ✅ Tout le monde |

---

## 🛠 Vérification rapide

Ouvrez la console du navigateur (F12) et tapez :
```javascript
window.location.protocol
```

- `"file:"` → vous êtes en mode fichier local → les liens ne fonctionneront pas
- `"http:"` → vous avez un serveur → les liens fonctionneront

---

## 📁 Structure des fichiers (important)

Tous ces fichiers doivent être **dans le même dossier** :

```
mon-projet/
├── kpi.html
├── dashboard.html
├── data-warehouse.html
├── login.html
├── signup.html
├── styles.css          ← CSS partagé
├── app.js              ← JS partagé
└── output/             ← vos fichiers CSV
    ├── kpi_user.csv
    ├── kpi_project.csv
    ├── kpi_status_project_pivot.csv
    ├── kpi_monthly.csv
    └── dashboard_dataset.csv
```

Si un fichier manque ou est dans un sous-dossier différent, les liens `href` et les imports CSS/JS
ne fonctionneront pas.
