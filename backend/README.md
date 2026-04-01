# KPI Hub — Backend Setup

## Quick Start

```bash
cd backend
npm install
cp .env.example .env
# → Edit .env with your credentials
npm run dev
```

Server runs on **http://localhost:3001**

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/signup` | ❌ | Register → sends email code |
| POST | `/api/auth/verify` | ❌ | Verify code → returns JWT |
| POST | `/api/auth/login` | ❌ | Login → returns JWT |
| POST | `/api/auth/firebase-login` | ❌ | Firebase ID token → JWT |
| GET  | `/api/auth/me` | ✅ JWT | Current user info |
| GET  | `/api/dashboard` | ✅ JWT | Data + KPIs (with filters) |
| GET  | `/api/share/validate` | ❌ | Validate share token |
| GET  | `/api/health` | ❌ | Server health check |

---

## Setup Steps

### 1. Email (Nodemailer)

**Option A — Gmail:**
1. Enable 2FA on your Google account
2. Go to: myaccount.google.com/apppasswords
3. Create an "App Password" → copy the 16-char code
4. Set in `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your.email@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx
   ```

**Option B — Mailtrap (dev/testing):**
1. Create free account at https://mailtrap.io
2. Go to Email Testing → Inboxes → your inbox → SMTP Settings
3. Copy the credentials to `.env`

---

### 2. Firebase Admin (optional)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a project (or use existing)
3. Project Settings → Service Accounts → **Generate New Private Key**
4. Save the JSON as `backend/serviceAccountKey.json`
5. Set in `.env`:
   ```
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CREDENTIAL_PATH=./serviceAccountKey.json
   ```

**Client-side Firebase (in your HTML):**
```html
<script src="https://www.gstatic.com/firebasejs/10.x.x/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.x.x/firebase-auth-compat.js"></script>
<script>
  firebase.initializeApp({
    apiKey:    "...",
    authDomain:"your-project.firebaseapp.com",
    projectId: "your-project-id",
  });

  // Google Sign-In
  async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result   = await firebase.auth().signInWithPopup(provider);
    const idToken  = await result.user.getIdToken();

    // Send to your backend
    const res = await fetch('http://localhost:3001/api/auth/firebase-login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ idToken }),
    });
    const { token } = await res.json();
    localStorage.setItem('kpi_jwt', token);
    window.location.href = 'dashboard.html';
  }
</script>
```

---

### 3. Connect Frontend to Backend API

In `dashboard.html`, replace the CSV loading with:

```javascript
const token = localStorage.getItem('kpi_jwt');

const res = await fetch('http://localhost:3001/api/dashboard', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const data = await res.json();

// data.kpi          → KPI summary
// data.byProject    → hours per project
// data.byUser       → hours per user
// data.monthly      → monthly activity
// data.records      → full filtered records
// data.filters      → available project/user lists
```

---

### 4. JWT Flow

```
signup  → POST /api/auth/signup   → email with code sent
verify  → POST /api/auth/verify   → account created + JWT returned
login   → POST /api/auth/login    → JWT returned

Store JWT in localStorage('kpi_jwt')
Send in every request: Authorization: Bearer <token>
```

---

### 5. Production Deployment

```bash
# Use PM2 for process management
npm install -g pm2
pm2 start server.js --name kpi-backend
pm2 save
pm2 startup

# Or deploy to Railway / Render / Heroku:
# - Set environment variables in dashboard
# - Connect GitHub repo
# - Done!
```
