require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const PROCESSOR_BASE = process.env.PROCESSOR_BASE || 'http://localhost:8080';

// Use encrypted mock BigQuery-backed user store (demo)
const mockBQ = require('./mockBigQuery');
mockBQ.init({ storePath: require('path').join(__dirname, 'mock_bq_store.json'), key: process.env.ENCRYPTION_KEY });

// Ensure demo user exists
if (!mockBQ.findUser('db_admin')) {
  mockBQ.addUser('db_admin', process.env.DEMO_PASSWORD || 'password', 'DB Admin');
}

passport.use(new LocalStrategy((username, password, done) => {
  const user = mockBQ.findUser(username);
  if (!user) return done(null, false, { message: 'Incorrect username' });
  bcrypt.compare(password, user.passwordHash, (err, ok) => {
    if (err) return done(err);
    if (!ok) return done(null, false, { message: 'Incorrect password' });
    return done(null, user);
  });
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = users.find(u => u.id === id);
  done(null, user || false);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'dev-secret', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Serve frontend static files
const frontendDir = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// Login page route (static file)
app.get('/login', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));

app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login?error=1'
}));

app.get('/logout', (req, res) => {
  req.logout(() => {});
  req.session.destroy(() => res.redirect('/'));
});

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  // For API clients you might allow a service token; for demo redirect to /login
  return res.status(401).json({ error: 'unauthenticated' });
}

// Proxy endpoints to the processor service, preserving body and headers
app.post('/api/ingest', ensureAuth, async (req, res) => {
  try {
    const resp = await axios.post(`${PROCESSOR_BASE}/ingest`);
    res.status(resp.status).json(resp.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: 'processor_ingest_failed', detail: err.message });
  }
});

app.post('/api/events', ensureAuth, async (req, res) => {
  try {
    const resp = await axios.post(`${PROCESSOR_BASE}/events`, req.body, { headers: { 'Content-Type': 'application/json' } });
    res.status(resp.status).json(resp.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: 'processor_events_failed', detail: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const resp = await axios.get(`${PROCESSOR_BASE}/health`);
    res.status(resp.status).json(resp.data);
  } catch (err) {
    res.status(500).json({ status: 'unreachable', detail: err.message });
  }
});

// Simple clients endpoint (mock) — replace with a real data API
app.get('/api/clients', ensureAuth, (req, res) => {
  res.json([
    { client_id: 'eu-001', name: 'Apex Bank Europe', jurisdiction: 'DE', risk_tier: 'HIGH' },
    { client_id: 'eu-002', name: 'Northstar Wealth', jurisdiction: 'FR', risk_tier: 'MEDIUM' },
    { client_id: 'eu-003', name: 'Helio Insurance Group', jurisdiction: 'NL', risk_tier: 'HIGH' },
  ]);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT} (proxying ${PROCESSOR_BASE})`));
