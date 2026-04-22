<<<<<<< HEAD
/**
 * KPI Hub — Backend Server
 * Stack: Express · JWT · Firebase Admin · Nodemailer
 * ─────────────────────────────────────────────────────
 */
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const nodemailer   = require('nodemailer');
const fs           = require('fs');
const path         = require('path');
const csv          = require('csv-parser');

const app = express();

/* ═══════════════════════════════════════════════════
   FIREBASE ADMIN INIT (optional — comment out if not using)
═══════════════════════════════════════════════════ */
let firebaseAdmin = null;
let firebaseAuth  = null;

try {
  const admin = require('firebase-admin');
  const credPath = path.resolve(process.env.FIREBASE_CREDENTIAL_PATH || './serviceAccountKey.json');

  if (fs.existsSync(credPath)) {
    const serviceAccount = require(credPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId:  process.env.FIREBASE_PROJECT_ID,
    });
    firebaseAdmin = admin;
    firebaseAuth  = admin.auth();
    console.log('✅ Firebase Admin initialized');
  } else {
    console.warn('⚠  serviceAccountKey.json not found — Firebase features disabled');
  }
} catch (e) {
  console.warn('⚠  Firebase init skipped:', e.message);
}

/* ═══════════════════════════════════════════════════
   MIDDLEWARE
═══════════════════════════════════════════════════ */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin:      process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max:      10,
  message:  { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      100,
  message:  { error: 'Trop de requêtes.' },
});

app.use('/api/auth', authLimiter);
app.use('/api',      apiLimiter);

/* ═══════════════════════════════════════════════════
   IN-MEMORY USER STORE
   (Replace with a real DB — MongoDB, Postgres, etc.)
═══════════════════════════════════════════════════ */
const users       = new Map();  // email → user object
const accessCodes = new Map();  // email → { code, expiresAt }

/* ═══════════════════════════════════════════════════
   EMAIL (Nodemailer)
═══════════════════════════════════════════════════ */
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendAccessCode(email, code) {
  const html = `
    <div style="font-family:'DM Sans',sans-serif;max-width:480px;margin:auto;padding:40px 32px;
      background:#faf9f4;border-radius:16px;border:1px solid rgba(128,0,32,0.1);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:36px;height:36px;border-radius:9px;background:#800020;display:flex;align-items:center;justify-content:center;">
          <span style="color:white;font-size:18px;">📊</span>
        </div>
        <span style="font-family:Georgia,serif;font-size:20px;font-weight:500;color:#1a1210;">KPI <span style="color:#800020;">Hub</span></span>
      </div>
      <h2 style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#1a1210;margin-bottom:8px;">
        Votre code d'accès
      </h2>
      <p style="font-size:14px;color:#6b5c54;margin-bottom:24px;line-height:1.6;">
        Utilisez ce code pour finaliser la création de votre compte sur KPI Hub.
      </p>
      <div style="background:white;border:1px solid rgba(128,0,32,0.12);border-radius:12px;
        padding:24px;text-align:center;margin-bottom:24px;">
        <p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a89991;margin-bottom:8px;">Code d'accès</p>
        <p style="font-family:monospace;font-size:40px;font-weight:700;letter-spacing:8px;color:#800020;margin:0;">${code}</p>
        <p style="font-size:11px;color:#a89991;margin-top:8px;">Valide 10 minutes</p>
      </div>
      <p style="font-size:12px;color:#a89991;line-height:1.6;">
        Si vous n'avez pas demandé ce code, ignorez cet email.<br>
        Ne partagez jamais ce code avec quelqu'un d'autre.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || '"KPI Hub" <noreply@kpihub.io>',
    to:      email,
    subject: `${code} — Votre code d'accès KPI Hub`,
    html,
  });
}

/* ═══════════════════════════════════════════════════
   JWT HELPERS
═══════════════════════════════════════════════════ */
const JWT_SECRET  = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/* ─── Auth middleware ─── */
function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

/* ═══════════════════════════════════════════════════
   ROUTES — AUTH
═══════════════════════════════════════════════════ */

/* ── POST /api/auth/signup ─────────────────────────
   Body: { email, password }
   → Generates a 6-digit code and sends it by email
─────────────────────────────────────────────────── */
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Email invalide' });

  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (min 6 chars)' });

  if (users.has(email))
    return res.status(409).json({ error: 'Cet email est déjà utilisé' });

  // Generate code
  const code      = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;  // 10 min

  // Store temporarily (overwrite if re-requested)
  accessCodes.set(email, {
    code,
    expiresAt,
    passwordHash: await bcrypt.hash(password, 12),
  });

  try {
    await sendAccessCode(email, code);
    res.json({ message: 'Code envoyé par email' });
  } catch (e) {
    console.error('Email error:', e.message);
    // In dev: return the code directly
    if (process.env.NODE_ENV !== 'production') {
      res.json({ message: 'Email non configuré (dev mode)', devCode: code });
    } else {
      res.status(500).json({ error: 'Erreur d\'envoi email. Vérifiez la config SMTP.' });
    }
  }
});

/* ── POST /api/auth/verify ─────────────────────────
   Body: { email, code }
   → Creates the account and returns a JWT
─────────────────────────────────────────────────── */
app.post('/api/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  const entry = accessCodes.get(email);

  if (!entry)              return res.status(400).json({ error: 'Aucune demande d\'inscription trouvée' });
  if (Date.now() > entry.expiresAt) { accessCodes.delete(email); return res.status(400).json({ error: 'Code expiré' }); }
  if (entry.code !== String(code))   return res.status(400).json({ error: 'Code incorrect' });

  // Create account
  const user = {
    email,
    passwordHash: entry.passwordHash,
    role:         'user',
    createdAt:    new Date().toISOString(),
    verified:     true,
  };
  users.set(email, user);
  accessCodes.delete(email);

  // Also create in Firebase if available
  if (firebaseAuth) {
    try {
      await firebaseAuth.createUser({ email, emailVerified: true });
    } catch (e) {
      console.warn('Firebase createUser:', e.message);
    }
  }

  const token = signToken({ email, role: user.role });
  res.json({ token, user: { email, role: user.role } });
});

/* ── POST /api/auth/login ──────────────────────────
   Body: { email, password, accessCode }
─────────────────────────────────────────────────── */
app.post('/api/auth/login', async (req, res) => {
  const { email, password, accessCode } = req.body;
  const user = users.get(email);

  if (!user)
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid)
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  // accessCode check: for demo, we skip it if not set
  // In production: store the code per user after signup verification
  const token = signToken({ email, role: user.role });
  res.json({ token, user: { email, role: user.role } });
});

/* ── POST /api/auth/firebase-login ────────────────
   Body: { idToken }  ← Firebase client-side token
─────────────────────────────────────────────────── */
app.post('/api/auth/firebase-login', async (req, res) => {
  if (!firebaseAuth)
    return res.status(503).json({ error: 'Firebase non configuré' });

  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken manquant' });

  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    const email   = decoded.email;

    // Upsert user
    if (!users.has(email)) {
      users.set(email, { email, role: 'user', createdAt: new Date().toISOString(), verified: true, firebaseUid: decoded.uid });
    }

    const token = signToken({ email, role: 'user', uid: decoded.uid });
    res.json({ token, user: { email, role: 'user' } });
  } catch (e) {
    res.status(401).json({ error: 'Token Firebase invalide' });
  }
});

/* ── GET /api/auth/me ──────────────────────────── */
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = users.get(req.user.email);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ email: user.email, role: user.role, createdAt: user.createdAt });
});

/* ═══════════════════════════════════════════════════
   ROUTES — DASHBOARD DATA
═══════════════════════════════════════════════════ */

/** Read CSV and return as JSON */
function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`CSV file not found: ${filePath}`));
    }
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => results.push(row))
      .on('end',  ()  => resolve(results))
      .on('error', reject);
  });
}

/* ── GET /api/dashboard ────────────────────────────
   Returns the full CSV dataset + computed KPIs
   Supports query params: project, user, status, from, to
─────────────────────────────────────────────────── */
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const csvPath = path.resolve(process.env.CSV_PATH || '../output/dashboard_dataset.csv');

  let data;
  try {
    data = await readCSV(csvPath);
  } catch (e) {
    // Return demo data if CSV missing
    data = generateDemoData();
  }

  // Apply filters from query params
  const { project, user, status, from, to } = req.query;
  let filtered = data.filter(row => {
    if (project && row.Project !== project) return false;
    if (user    && row.User    !== user)    return false;
    if (status  && (row.Status || '').toLowerCase().replace(' ', '_') !== status) return false;
    const m = (row.month_solid || '').slice(0, 7);
    if (from && m < from) return false;
    if (to   && m > to)   return false;
    return true;
  });

  // Compute KPIs
  const totalHours    = filtered.reduce((s, r) => s + Number(r.duration_hours || 0), 0);
  const totalProjects = new Set(filtered.map(r => r.Project)).size;
  const totalUsers    = new Set(filtered.map(r => r.User)).size;
  const totalTickets  = filtered.length;

  const statusCounts = { done: 0, in_progress: 0, pending: 0 };
  filtered.forEach(r => {
    const s = (r.Status || '').toLowerCase().replace(' ', '_');
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  });

  // Hours per project
  const byProject = {};
  filtered.forEach(r => { byProject[r.Project] = (byProject[r.Project] || 0) + Number(r.duration_hours || 0); });

  // Hours per user
  const byUser = {};
  filtered.forEach(r => { byUser[r.User] = (byUser[r.User] || 0) + Number(r.duration_hours || 0); });

  // Monthly
  const monthly = {};
  filtered.forEach(r => {
    const m = (r.month_solid || '').slice(0, 7);
    if (m) monthly[m] = (monthly[m] || 0) + Number(r.duration_hours || 0);
  });

  res.json({
    kpi: { totalHours: +totalHours.toFixed(1), totalProjects, totalUsers, totalTickets, statusCounts },
    byProject,
    byUser,
    monthly,
    records: filtered,
    filters: { projects: [...new Set(data.map(r => r.Project))].sort(), users: [...new Set(data.map(r => r.User))].sort() },
  });
});

/* ── GET /api/share/validate ───────────────────────
   Query: token
   Validates a share token without auth
─────────────────────────────────────────────────── */
app.get('/api/share/validate', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token manquant' });

  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(token))));
    const age  = Date.now() - data.ts;
    if (age > 7 * 24 * 60 * 60 * 1000)
      return res.status(410).json({ error: 'Lien expiré', expired: true });
    res.json({ valid: true, perm: data.perm, id: data.id });
  } catch {
    res.status(400).json({ error: 'Token invalide' });
  }
});

/* ═══════════════════════════════════════════════════
   DEMO DATA GENERATOR
═══════════════════════════════════════════════════ */
function generateDemoData() {
  const P = ['Alpha Platform', 'Beta Analytics', 'Client Portal', 'Data Pipeline', 'E-Commerce Suite'];
  const U = ['Alice Martin', 'Bob Dupont', 'Claire Petit', 'David Simon', 'Eva Thomas', 'Frank Morel'];
  const S = ['done', 'in_progress', 'pending'];
  const M = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08'];
  const rows = [];
  for (let i = 0; i < 300; i++) {
    rows.push({
      Project:        P[i % P.length],
      User:           U[i % U.length],
      Status:         S[i % 3],
      duration_hours: (Math.random() * 10 + 0.5).toFixed(1),
      month_solid:    M[i % M.length],
    });
  }
  return rows;
}

/* ═══════════════════════════════════════════════════
   HEALTH CHECK
═══════════════════════════════════════════════════ */
app.get('/api/health', (req, res) => {
  res.json({
    status:   'ok',
    firebase: !!firebaseAuth,
    email:    !!(process.env.SMTP_USER),
    time:     new Date().toISOString(),
  });
});

/* ═══════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════ */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 KPI Hub Backend running on http://localhost:${PORT}`);
  console.log(`   Firebase : ${firebaseAuth ? '✅ enabled' : '❌ disabled'}`);
  console.log(`   Email    : ${process.env.SMTP_USER ? '✅ configured' : '⚠  not configured'}`);
  console.log(`   JWT      : ✅ ready\n`);
});

module.exports = app;
=======
/**
 * KPI Hub — Backend Server
 * Stack: Express · JWT · Firebase Admin · Nodemailer
 * ─────────────────────────────────────────────────────
 */
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const nodemailer   = require('nodemailer');
const fs           = require('fs');
const path         = require('path');
const csv          = require('csv-parser');

const app = express();

/* ═══════════════════════════════════════════════════
   FIREBASE ADMIN INIT (optional — comment out if not using)
═══════════════════════════════════════════════════ */
let firebaseAdmin = null;
let firebaseAuth  = null;

try {
  const admin = require('firebase-admin');
  const credPath = path.resolve(process.env.FIREBASE_CREDENTIAL_PATH || './serviceAccountKey.json');

  if (fs.existsSync(credPath)) {
    const serviceAccount = require(credPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId:  process.env.FIREBASE_PROJECT_ID,
    });
    firebaseAdmin = admin;
    firebaseAuth  = admin.auth();
    console.log('✅ Firebase Admin initialized');
  } else {
    console.warn('⚠  serviceAccountKey.json not found — Firebase features disabled');
  }
} catch (e) {
  console.warn('⚠  Firebase init skipped:', e.message);
}

/* ═══════════════════════════════════════════════════
   MIDDLEWARE
═══════════════════════════════════════════════════ */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin:      process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max:      10,
  message:  { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      100,
  message:  { error: 'Trop de requêtes.' },
});

app.use('/api/auth', authLimiter);
app.use('/api',      apiLimiter);

/* ═══════════════════════════════════════════════════
   IN-MEMORY USER STORE
   (Replace with a real DB — MongoDB, Postgres, etc.)
═══════════════════════════════════════════════════ */
const users       = new Map();  // email → user object
const accessCodes = new Map();  // email → { code, expiresAt }

/* ═══════════════════════════════════════════════════
   EMAIL (Nodemailer)
═══════════════════════════════════════════════════ */
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendAccessCode(email, code) {
  const html = `
    <div style="font-family:'DM Sans',sans-serif;max-width:480px;margin:auto;padding:40px 32px;
      background:#faf9f4;border-radius:16px;border:1px solid rgba(128,0,32,0.1);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:36px;height:36px;border-radius:9px;background:#800020;display:flex;align-items:center;justify-content:center;">
          <span style="color:white;font-size:18px;">📊</span>
        </div>
        <span style="font-family:Georgia,serif;font-size:20px;font-weight:500;color:#1a1210;">KPI <span style="color:#800020;">Hub</span></span>
      </div>
      <h2 style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#1a1210;margin-bottom:8px;">
        Votre code d'accès
      </h2>
      <p style="font-size:14px;color:#6b5c54;margin-bottom:24px;line-height:1.6;">
        Utilisez ce code pour finaliser la création de votre compte sur KPI Hub.
      </p>
      <div style="background:white;border:1px solid rgba(128,0,32,0.12);border-radius:12px;
        padding:24px;text-align:center;margin-bottom:24px;">
        <p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a89991;margin-bottom:8px;">Code d'accès</p>
        <p style="font-family:monospace;font-size:40px;font-weight:700;letter-spacing:8px;color:#800020;margin:0;">${code}</p>
        <p style="font-size:11px;color:#a89991;margin-top:8px;">Valide 10 minutes</p>
      </div>
      <p style="font-size:12px;color:#a89991;line-height:1.6;">
        Si vous n'avez pas demandé ce code, ignorez cet email.<br>
        Ne partagez jamais ce code avec quelqu'un d'autre.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || '"KPI Hub" <noreply@kpihub.io>',
    to:      email,
    subject: `${code} — Votre code d'accès KPI Hub`,
    html,
  });
}

/* ═══════════════════════════════════════════════════
   JWT HELPERS
═══════════════════════════════════════════════════ */
const JWT_SECRET  = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/* ─── Auth middleware ─── */
function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

/* ═══════════════════════════════════════════════════
   ROUTES — AUTH
═══════════════════════════════════════════════════ */

/* ── POST /api/auth/signup ─────────────────────────
   Body: { email, password }
   → Generates a 6-digit code and sends it by email
─────────────────────────────────────────────────── */
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Email invalide' });

  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (min 6 chars)' });

  if (users.has(email))
    return res.status(409).json({ error: 'Cet email est déjà utilisé' });

  // Generate code
  const code      = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;  // 10 min

  // Store temporarily (overwrite if re-requested)
  accessCodes.set(email, {
    code,
    expiresAt,
    passwordHash: await bcrypt.hash(password, 12),
  });

  try {
    await sendAccessCode(email, code);
    res.json({ message: 'Code envoyé par email' });
  } catch (e) {
    console.error('Email error:', e.message);
    // In dev: return the code directly
    if (process.env.NODE_ENV !== 'production') {
      res.json({ message: 'Email non configuré (dev mode)', devCode: code });
    } else {
      res.status(500).json({ error: 'Erreur d\'envoi email. Vérifiez la config SMTP.' });
    }
  }
});

/* ── POST /api/auth/verify ─────────────────────────
   Body: { email, code }
   → Creates the account and returns a JWT
─────────────────────────────────────────────────── */
app.post('/api/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  const entry = accessCodes.get(email);

  if (!entry)              return res.status(400).json({ error: 'Aucune demande d\'inscription trouvée' });
  if (Date.now() > entry.expiresAt) { accessCodes.delete(email); return res.status(400).json({ error: 'Code expiré' }); }
  if (entry.code !== String(code))   return res.status(400).json({ error: 'Code incorrect' });

  // Create account
  const user = {
    email,
    passwordHash: entry.passwordHash,
    role:         'user',
    createdAt:    new Date().toISOString(),
    verified:     true,
  };
  users.set(email, user);
  accessCodes.delete(email);

  // Also create in Firebase if available
  if (firebaseAuth) {
    try {
      await firebaseAuth.createUser({ email, emailVerified: true });
    } catch (e) {
      console.warn('Firebase createUser:', e.message);
    }
  }

  const token = signToken({ email, role: user.role });
  res.json({ token, user: { email, role: user.role } });
});

/* ── POST /api/auth/login ──────────────────────────
   Body: { email, password, accessCode }
─────────────────────────────────────────────────── */
app.post('/api/auth/login', async (req, res) => {
  const { email, password, accessCode } = req.body;
  const user = users.get(email);

  if (!user)
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid)
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  // accessCode check: for demo, we skip it if not set
  // In production: store the code per user after signup verification
  const token = signToken({ email, role: user.role });
  res.json({ token, user: { email, role: user.role } });
});

/* ── POST /api/auth/firebase-login ────────────────
   Body: { idToken }  ← Firebase client-side token
─────────────────────────────────────────────────── */
app.post('/api/auth/firebase-login', async (req, res) => {
  if (!firebaseAuth)
    return res.status(503).json({ error: 'Firebase non configuré' });

  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken manquant' });

  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    const email   = decoded.email;

    // Upsert user
    if (!users.has(email)) {
      users.set(email, { email, role: 'user', createdAt: new Date().toISOString(), verified: true, firebaseUid: decoded.uid });
    }

    const token = signToken({ email, role: 'user', uid: decoded.uid });
    res.json({ token, user: { email, role: 'user' } });
  } catch (e) {
    res.status(401).json({ error: 'Token Firebase invalide' });
  }
});

/* ── GET /api/auth/me ──────────────────────────── */
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = users.get(req.user.email);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ email: user.email, role: user.role, createdAt: user.createdAt });
});

/* ═══════════════════════════════════════════════════
   ROUTES — DASHBOARD DATA
═══════════════════════════════════════════════════ */

/** Read CSV and return as JSON */
function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`CSV file not found: ${filePath}`));
    }
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => results.push(row))
      .on('end',  ()  => resolve(results))
      .on('error', reject);
  });
}

/* ── GET /api/dashboard ────────────────────────────
   Returns the full CSV dataset + computed KPIs
   Supports query params: project, user, status, from, to
─────────────────────────────────────────────────── */
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const csvPath = path.resolve(process.env.CSV_PATH || '../output/dashboard_dataset.csv');

  let data;
  try {
    data = await readCSV(csvPath);
  } catch (e) {
    // Return demo data if CSV missing
    data = generateDemoData();
  }

  // Apply filters from query params
  const { project, user, status, from, to } = req.query;
  let filtered = data.filter(row => {
    if (project && row.Project !== project) return false;
    if (user    && row.User    !== user)    return false;
    if (status  && (row.Status || '').toLowerCase().replace(' ', '_') !== status) return false;
    const m = (row.month_solid || '').slice(0, 7);
    if (from && m < from) return false;
    if (to   && m > to)   return false;
    return true;
  });

  // Compute KPIs
  const totalHours    = filtered.reduce((s, r) => s + Number(r.duration_hours || 0), 0);
  const totalProjects = new Set(filtered.map(r => r.Project)).size;
  const totalUsers    = new Set(filtered.map(r => r.User)).size;
  const totalTickets  = filtered.length;

  const statusCounts = { done: 0, in_progress: 0, pending: 0 };
  filtered.forEach(r => {
    const s = (r.Status || '').toLowerCase().replace(' ', '_');
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  });

  // Hours per project
  const byProject = {};
  filtered.forEach(r => { byProject[r.Project] = (byProject[r.Project] || 0) + Number(r.duration_hours || 0); });

  // Hours per user
  const byUser = {};
  filtered.forEach(r => { byUser[r.User] = (byUser[r.User] || 0) + Number(r.duration_hours || 0); });

  // Monthly
  const monthly = {};
  filtered.forEach(r => {
    const m = (r.month_solid || '').slice(0, 7);
    if (m) monthly[m] = (monthly[m] || 0) + Number(r.duration_hours || 0);
  });

  res.json({
    kpi: { totalHours: +totalHours.toFixed(1), totalProjects, totalUsers, totalTickets, statusCounts },
    byProject,
    byUser,
    monthly,
    records: filtered,
    filters: { projects: [...new Set(data.map(r => r.Project))].sort(), users: [...new Set(data.map(r => r.User))].sort() },
  });
});

/* ── GET /api/share/validate ───────────────────────
   Query: token
   Validates a share token without auth
─────────────────────────────────────────────────── */
app.get('/api/share/validate', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token manquant' });

  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(token))));
    const age  = Date.now() - data.ts;
    if (age > 7 * 24 * 60 * 60 * 1000)
      return res.status(410).json({ error: 'Lien expiré', expired: true });
    res.json({ valid: true, perm: data.perm, id: data.id });
  } catch {
    res.status(400).json({ error: 'Token invalide' });
  }
});

/* ═══════════════════════════════════════════════════
   DEMO DATA GENERATOR
═══════════════════════════════════════════════════ */
function generateDemoData() {
  const P = ['Alpha Platform', 'Beta Analytics', 'Client Portal', 'Data Pipeline', 'E-Commerce Suite'];
  const U = ['Alice Martin', 'Bob Dupont', 'Claire Petit', 'David Simon', 'Eva Thomas', 'Frank Morel'];
  const S = ['done', 'in_progress', 'pending'];
  const M = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08'];
  const rows = [];
  for (let i = 0; i < 300; i++) {
    rows.push({
      Project:        P[i % P.length],
      User:           U[i % U.length],
      Status:         S[i % 3],
      duration_hours: (Math.random() * 10 + 0.5).toFixed(1),
      month_solid:    M[i % M.length],
    });
  }
  return rows;
}

/* ═══════════════════════════════════════════════════
   HEALTH CHECK
═══════════════════════════════════════════════════ */
app.get('/api/health', (req, res) => {
  res.json({
    status:   'ok',
    firebase: !!firebaseAuth,
    email:    !!(process.env.SMTP_USER),
    time:     new Date().toISOString(),
  });
});

/* ═══════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════ */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 KPI Hub Backend running on http://localhost:${PORT}`);
  console.log(`   Firebase : ${firebaseAuth ? '✅ enabled' : '❌ disabled'}`);
  console.log(`   Email    : ${process.env.SMTP_USER ? '✅ configured' : '⚠  not configured'}`);
  console.log(`   JWT      : ✅ ready\n`);
});

module.exports = app;
>>>>>>> 55bb3c6c647ea5d653ac19d09b1573e10a5f1164
