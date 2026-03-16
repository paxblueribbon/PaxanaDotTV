require('dotenv').config();
// megajs uses the Web Crypto API (globalThis.crypto.getRandomValues).
// Polyfill for Node versions that don't expose it as a global.
if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;
const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const multer = require('multer');
const { Storage } = require('megajs');
const ffmpegPath = require('ffmpeg-static');
const os = require('os');

// ── Auth ──────────────────────────────────────────────────────────────────────
const SESSION_COOKIE = 'paxana_session';
const SESSION_DAYS   = 7;

const { scrypt, randomBytes, timingSafeEqual } = crypto;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return resolve(false);
    scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else {
        try { resolve(timingSafeEqual(Buffer.from(hash, 'hex'), key)); }
        catch { resolve(false); }
      }
    });
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const [k, ...v] = pair.split('=');
    if (k.trim()) out[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return out;
}

function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return db.getSession(token); // { token, user_id, username, role, expires_at }
}

function setSessionCookie(res, token) {
  const maxAge  = SESSION_DAYS * 24 * 60 * 60;
  const secure  = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`);
}

const PUBLIC_PATHS = new Set(['/login', '/logout', '/setup']);

function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/register/')) return next();

  // Before any users exist, redirect to first-run setup
  if (db.getUserCount() === 0) return res.redirect('/setup');

  const session = getSessionUser(req);
  if (!session) {
    // API callers get JSON 401 instead of a redirect
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login');
  }
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  });
}

// Purge expired sessions once an hour
setInterval(() => db.deleteExpiredSessions(), 60 * 60 * 1000);

// Walks (or creates) a chain of MEGA directories and returns the deepest node.
async function getMegaSubfolder(storage, ...parts) {
  let node = storage.root;
  for (const name of parts) {
    let child = (node.children || []).find(f => f.directory && f.name === name);
    if (!child) child = await node.mkdir(name);
    node = child;
  }
  return node;
}

// ── Show streaming ─────────────────────────────────────────────────────────────
const SHOWS_DIR  = path.join(__dirname, 'shows');
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.flv', '.ts']);

if (!fs.existsSync(SHOWS_DIR)) fs.mkdirSync(SHOWS_DIR, { recursive: true });

// Running ffmpeg child processes, keyed by channel key
const ffmpegProcesses = new Map();

function showNameToKey(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getShowFolders() {
  return fs.readdirSync(SHOWS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function getVideoFiles(showDir) {
  return fs.readdirSync(showDir)
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

// Generates an ffmpeg concat file listing all episodes.
// Always regenerates so newly added files are picked up on next launch.
function buildConcatFile(showDir, videoFiles) {
  const concatPath = path.join(showDir, 'concat.txt');
  const lines = [
    'ffconcat version 1.0',
    // Unquoted paths with backslash escaping — avoids the concat demuxer
    // misinterpreting \' (backslash-apostrophe) inside single-quoted strings.
    ...videoFiles.map(f => {
      const full = path.join(showDir, f);
      const esc  = full.replace(/\\/g, '\\\\').replace(/[ '[\]]/g, '\\$&');
      return `file ${esc}`;
    }),
  ];
  fs.writeFileSync(concatPath, lines.join('\n') + '\n', 'utf8');
  return concatPath;
}

// ── TMDB helper ───────────────────────────────────────────────────────────────
function tmdbGet(apiPath) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return Promise.reject(new Error('TMDB_API_KEY not set'));
  return new Promise((resolve, reject) => {
    const sep = apiPath.includes('?') ? '&' : '?';
    const url = `https://api.themoviedb.org/3${apiPath}${sep}api_key=${key}`;
    https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.success === false) reject(new Error(data.status_message || 'TMDB error'));
          else resolve(data);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Database (also handles migration from any legacy JSON files)
const db = require('./db');

// Extracts the bare 'ID#key' from a full MEGA URL, or returns null for unrecognised input.
// Handles mega.nz/file/…, mega.nz/embed/…, and legacy mega.nz/#!/… formats.
function extractMegaId(url) {
  const match = url.match(/mega\.nz\/(?:file|embed|#!)\/([^\s?]+)/);
  return match ? match[1] : null;
}

// Lazily-initialised MEGA storage session (cached for the process lifetime)
let _megaStorage = null;
async function getMegaStorage() {
  if (_megaStorage) return _megaStorage;
  const email    = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;
  if (!email || !password) throw new Error('Set MEGA_EMAIL and MEGA_PASSWORD env vars');
  _megaStorage = await new Storage({ email, password }).ready;
  return _megaStorage;
}

// Remuxes an MKV into an MP4 container using stream-copy (no re-encode).
// Returns the path of the new .mp4 temp file.
function convertToMp4(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace(/\.[^.]+$/, '_converted.mp4');
    const binary = process.env.FFMPEG_PATH || ffmpegPath;
    const proc = spawn(binary, [
      '-i', inputPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', outputPath,
    ], { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg MKV→MP4 conversion failed (exit ${code})`));
    });
  });
}

const uploadStorage = multer.diskStorage({
  destination: '/tmp',
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '') || '.mp4';
    cb(null, `${Date.now()}${ext}`);
  },
});
const upload = multer({ storage: uploadStorage });

const HTTP_PORT = process.env.PORT || 3000;
const RTMP_PORT = 1935;
const MEDIA_ROOT = path.join(__dirname, 'media');

// Tracks which stream keys are currently publishing
const activeStreams   = new Set();
// Pending removal timers, cancelled if the stream reconnects within the grace period.
// Kept as a safety net in case of brief RTMP hiccups.
const streamEndTimers = new Map();
const STREAM_END_GRACE_MS = 15_000;

// Ensure media directory exists
if (!fs.existsSync(MEDIA_ROOT)) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

// ── RTMP / HLS server ────────────────────────────────────────────────────────
const nms = new NodeMediaServer({
  rtmp: {
    port: RTMP_PORT,
    host: '127.0.0.1', // localhost only — ffmpeg pushes locally, no public RTMP
    chunk_size: 4096,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    // node-media-server's own HTTP is only used internally for HLS transcoding
    port: 8888,
    host: '127.0.0.1',
    allow_origin: '*',
    mediaroot: MEDIA_ROOT,
  },
  trans: {
    ffmpeg: process.env.FFMPEG_PATH || ffmpegPath,
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=4:hls_list_size=10:hls_flags=delete_segments]',
        hlsKeep: false,
        dash: false,
        // Stream copy — ffmpeg encodes before pushing RTMP, so no re-encode needed here.
        vc: 'copy',
        ac: 'copy',
      },
    ],
  },
});

nms.run();

nms.on('prePublish', (id, streamPath, args) => {
  const key = streamPath.split('/').pop();
  // Cancel any pending removal — stream reconnected within grace period
  if (streamEndTimers.has(key)) {
    clearTimeout(streamEndTimers.get(key));
    streamEndTimers.delete(key);
  }
  activeStreams.add(key);
  console.log(`[RTMP] Stream started: ${streamPath}`);
});

nms.on('donePublish', (id, streamPath, args) => {
  const key = streamPath.split('/').pop();
  console.log(`[RTMP] Stream dropped: ${streamPath} — waiting ${STREAM_END_GRACE_MS / 1000}s before marking offline`);
  const timer = setTimeout(() => {
    activeStreams.delete(key);
    streamEndTimers.delete(key);
    console.log(`[RTMP] Stream confirmed ended: ${streamPath}`);
  }, STREAM_END_GRACE_MS);
  streamEndTimers.set(key, timer);
});

// ── Express (viewer frontend + HLS files) ────────────────────────────────────
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(requireAuth);

// Shared base styles for all server-rendered auth pages
function authPageHtml({ title, heading, body, error = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title || 'Paxana.TV'}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100dvh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #0a0a0a; color: #f0f0f0;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    header { font-size: 2rem; font-weight: 700; letter-spacing: -.5px; margin-bottom: 2rem; }
    header span { color: #e63946; }
    .card {
      display: flex; flex-direction: column; gap: .75rem;
      background: #141414; border: 1px solid #222; border-radius: 10px;
      padding: 2rem; width: min(340px, 90vw);
    }
    .card h2 { font-size: .85rem; letter-spacing: .1em; text-transform: uppercase; color: #666; margin-bottom: .25rem; }
    .info { font-size: .85rem; color: #888; }
    input[type=text], input[type=password] {
      padding: .6rem .8rem; border-radius: 6px; border: 1px solid #333;
      background: #1e1e1e; color: #f0f0f0; font-size: 1rem; outline: none; width: 100%;
    }
    input[type=text]:focus, input[type=password]:focus { border-color: #e63946; }
    button[type=submit] {
      padding: .65rem; border-radius: 6px; border: none;
      background: #e63946; color: #fff; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: opacity .15s; margin-top: .25rem;
    }
    button[type=submit]:hover { opacity: .85; }
    .err { color: #e63946; font-size: .875rem; text-align: center; }
    footer { margin-top: 3rem; font-size: .8rem; color: #444; }
  </style>
</head>
<body>
  <header><span>Paxana</span>.TV</header>
  <div class="card">
    ${heading ? `<h2>${heading}</h2>` : ''}
    ${body}
    ${error ? `<p class="err">${error}</p>` : ''}
  </div>
  <footer>tune in. sit back. enjoy.</footer>
</body>
</html>`;
}

// ── First-run setup ───────────────────────────────────────────────────────────
app.get('/setup', (req, res) => {
  if (db.getUserCount() > 0) return res.redirect('/');
  res.send(authPageHtml({
    heading: 'create admin account',
    body: `<p class="info">No accounts exist yet. Create the first admin to get started.</p>
    <form method="POST" action="/setup">
      <input type="text"     name="username" placeholder="username"         autocomplete="username"         autofocus required><br><br>
      <input type="password" name="password" placeholder="password"         autocomplete="new-password"     required><br><br>
      <input type="password" name="confirm"  placeholder="confirm password" autocomplete="new-password"     required><br><br>
      <button type="submit">Create admin account</button>
    </form>`,
  }));
});

app.post('/setup', async (req, res) => {
  if (db.getUserCount() > 0) return res.redirect('/');
  const { username, password, confirm } = req.body;
  const fail = msg => res.status(400).send(authPageHtml({ heading: 'create admin account', body: `<form method="POST" action="/setup"><input type="text" name="username" value="${(username||'').replace(/"/g,'')}" placeholder="username" required><br><br><input type="password" name="password" placeholder="password" required><br><br><input type="password" name="confirm" placeholder="confirm password" required><br><br><button type="submit">Create admin account</button></form>`, error: msg }));
  if (!username || !password) return fail('Username and password are required.');
  if (password !== confirm)   return fail('Passwords do not match.');
  if (password.length < 8)    return fail('Password must be at least 8 characters.');
  try {
    const hash = await hashPassword(password);
    const user = db.createUser({ username: username.trim(), passwordHash: hash, role: 'admin', invitedBy: null });
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    db.createSession({ token, userId: user.id, expiresAt });
    setSessionCookie(res, token);
    res.redirect('/');
  } catch (err) {
    const msg = err.message.includes('UNIQUE') ? 'Username already taken.' : err.message;
    fail(msg);
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (db.getUserCount() === 0) return res.redirect('/setup');
  res.send(authPageHtml({
    body: `<form method="POST" action="/login">
      <input type="text"     name="username" placeholder="username" autocomplete="username"         autofocus required>
      <br><br>
      <input type="password" name="password" placeholder="password" autocomplete="current-password" required>
      <br><br>
      <button type="submit">Sign in</button>
    </form>`,
  }));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const fail = msg => res.status(401).send(authPageHtml({
    body: `<form method="POST" action="/login"><input type="text" name="username" value="${(username||'').replace(/"/g,'')}" placeholder="username" autocomplete="username" required><br><br><input type="password" name="password" placeholder="password" autocomplete="current-password" required><br><br><button type="submit">Sign in</button></form>`,
    error: msg,
  }));
  if (!username || !password) return fail('Username and password are required.');
  const user = db.getUserByUsername(username);
  if (!user) return fail('Invalid username or password.');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return fail('Invalid username or password.');
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  db.createSession({ token, userId: user.id, expiresAt });
  db.updateLastLogin(user.id);
  setSessionCookie(res, token);
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.deleteSession(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.redirect('/login');
});

// ── Invite registration ───────────────────────────────────────────────────────
app.get('/register/:token', (req, res) => {
  const invite = db.getInvite(req.params.token);
  if (!invite) return res.status(410).send(authPageHtml({ heading: 'invalid invite', body: '<p class="info">This invite link is invalid or has expired.</p>' }));
  res.send(authPageHtml({
    heading: 'create account',
    body: `<p class="info">You've been invited by <strong>${invite.created_by_name}</strong> as a <strong>${invite.role}</strong>.</p>
    <form method="POST" action="/register/${req.params.token}">
      <input type="text"     name="username" placeholder="choose a username"  autocomplete="username"     autofocus required><br><br>
      <input type="password" name="password" placeholder="password"           autocomplete="new-password" required><br><br>
      <input type="password" name="confirm"  placeholder="confirm password"   autocomplete="new-password" required><br><br>
      <button type="submit">Create account</button>
    </form>`,
  }));
});

app.post('/register/:token', async (req, res) => {
  const invite = db.getInvite(req.params.token);
  if (!invite) return res.status(410).send(authPageHtml({ heading: 'invalid invite', body: '<p class="info">This invite link is invalid or has expired.</p>' }));
  const { username, password, confirm } = req.body;
  const fail = msg => res.status(400).send(authPageHtml({
    heading: 'create account',
    body: `<p class="info">You've been invited as a <strong>${invite.role}</strong>.</p><form method="POST" action="/register/${req.params.token}"><input type="text" name="username" value="${(username||'').replace(/"/g,'')}" placeholder="choose a username" autocomplete="username" required><br><br><input type="password" name="password" placeholder="password" autocomplete="new-password" required><br><br><input type="password" name="confirm" placeholder="confirm password" autocomplete="new-password" required><br><br><button type="submit">Create account</button></form>`,
    error: msg,
  }));
  if (!username || !password) return fail('Username and password are required.');
  if (password !== confirm)   return fail('Passwords do not match.');
  if (password.length < 8)    return fail('Password must be at least 8 characters.');
  try {
    const hash = await hashPassword(password);
    const user = db.createUser({ username: username.trim(), passwordHash: hash, role: invite.role, invitedBy: invite.created_by });
    db.markInviteUsed(req.params.token, user.id);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    db.createSession({ token, userId: user.id, expiresAt });
    db.updateLastLogin(user.id);
    setSessionCookie(res, token);
    res.redirect('/');
  } catch (err) {
    fail(err.message.includes('UNIQUE') ? 'Username already taken.' : err.message);
  }
});

// ── Current user ─────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  res.json({ id: req.user.user_id, username: req.user.username, role: req.user.role });
});

// ── Admin API ─────────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (_req, res) => {
  res.json({ users: db.getAllUsers() });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.user_id) return res.status(400).json({ error: "You can't delete your own account." });
  db.deleteUser(id);
  res.json({ success: true });
});

app.post('/api/admin/invites', requireAdmin, (req, res) => {
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.createInvite({ token, role, createdBy: req.user.user_id, expiresAt });
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${origin}/register/${token}` });
});

// ── Recommendations ───────────────────────────────────────────────────────────
app.post('/api/recommendations', express.json(), (req, res) => {
  const { type, tmdb_id, title, note } = req.body;
  if (!type || !['movie', 'show'].includes(type)) return res.status(400).json({ error: 'type must be "movie" or "show"' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const rec = db.createRecommendation({
      type,
      tmdbId:      (tmdb_id || '').trim() || null,
      title:       title.trim(),
      note:        (note || '').trim(),
      submittedBy: req.user.user_id,
    });
    res.json({ success: true, recommendation: rec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/recommendations', requireAdmin, (_req, res) => {
  res.json({ recommendations: db.getAllRecommendations() });
});

app.patch('/api/admin/recommendations/:id', requireAdmin, express.json(), (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const status = req.body.status;
  if (!['pending', 'noted', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.updateRecommendationStatus(id, status);
  res.json({ success: true });
});

app.delete('/api/admin/recommendations/:id', requireAdmin, (req, res) => {
  db.deleteRecommendation(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// ── Movie link / removal ──────────────────────────────────────────────────────
// PATCH /api/admin/movies/:id   body: { embed_url }   — update MEGA link
app.patch('/api/admin/movies/:id', requireAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid movie id' });
  let { embed_url } = req.body;
  if (!embed_url || !embed_url.trim()) return res.status(400).json({ error: 'embed_url is required' });
  embed_url = embed_url.trim();
  const megaId = extractMegaId(embed_url);
  if (megaId) embed_url = megaId;
  try {
    const movie = db.updateMovieUrl(id, embed_url);
    res.json({ success: true, movie });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/movies/:id
app.delete('/api/admin/movies/:id', requireAdmin, (req, res) => {
  db.deleteMovie(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// DELETE /api/admin/shows/:id
app.delete('/api/admin/shows/:id', requireAdmin, (req, res) => {
  db.deleteShow(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// DELETE /api/admin/episodes/:id  — clears the MEGA link (does not remove the episode row)
app.delete('/api/admin/episodes/:id', requireAdmin, (req, res) => {
  const episode = db.clearEpisodeUrl(parseInt(req.params.id, 10));
  res.json({ success: true, episode });
});

// ── Tag management ────────────────────────────────────────────────────────────
app.patch('/api/admin/movies/:id/tags', requireAdmin, express.json(), (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
  db.setTagsForMedia('movie', id, tags);
  res.json({ success: true });
});

app.patch('/api/admin/shows/:id/tags', requireAdmin, express.json(), (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
  db.setTagsForMedia('show', id, tags);
  res.json({ success: true });
});

app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const memTotal   = os.totalmem();
  const memFree    = os.freemem();
  const cpuCount   = os.cpus().length;
  const loadAvg1m  = os.loadavg()[0];
  res.json({
    uptime:        process.uptime(),
    loadAvg1m,
    cpuCount,
    cpuLoadPct:    Math.min(100, (loadAvg1m / cpuCount) * 100),
    memTotal,
    memFree,
    memUsed:       memTotal - memFree,
    memUsedPct:    ((memTotal - memFree) / memTotal) * 100,
    activeStreams:  activeStreams.size,
  });
});

// Serve catalogue data from the database
app.get('/movies.json', (_req, res) => res.json({ movies: db.getAllMovies() }));
app.get('/tv.json',     (_req, res) => res.json({ shows:  db.getAllShows()  }));

// TEMPORARY: import existing JSON files into the DB — remove after use
// Usage: visit http://localhost:3000/api/import-json in a browser
// Place movies.json / tv.json in the data/ folder first.
app.get('/api/import-json', (req, res) => {
  const result = db.importFromJson(
    path.join(__dirname, 'data', 'movies.json'),
    path.join(__dirname, 'data', 'tv.json')
  );
  res.json({ ok: true, result });
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve HLS segments from the media root
app.use('/hls', express.static(MEDIA_ROOT, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

// List all live channels
app.get('/channels', (req, res) => {
  const channels = [...activeStreams].map(key => ({
    key,
    hlsUrl: `/hls/live/${key}/index.m3u8`,
  }));
  res.json({ channels });
});

// Check if a specific channel is live
app.get('/status/:channel', (req, res) => {
  const { channel } = req.params;
  const live = activeStreams.has(channel);
  res.json({ live, streamKey: channel });
});

// ── Movie upload ──────────────────────────────────────────────────────────────
// POST /api/movies  multipart/form-data
//   file       – video file (required)
//   title      – movie title (required)
//   director   – director name
//   year       – release year
//   genre      – genre string
//   poster_url – URL to poster image
//
// Requires MEGA_EMAIL and MEGA_PASSWORD env vars.
app.post('/api/movies', requireAdmin, upload.single('file'), async (req, res) => {
  const { title, director, year, genre, poster_url } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  if (!title)    return res.status(400).json({ error: 'Title is required' });

  if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(503).json({ error: 'MEGA credentials not configured — set MEGA_EMAIL and MEGA_PASSWORD, or use the "mega link / id" tab instead' });
  }

  const uploadPath = req.file.path;
  let   convertedPath = null;

  try {
    const isMkv    = path.extname(req.file.filename).toLowerCase() === '.mkv';
    if (isMkv) {
      console.log(`[MEGA] Converting MKV→MP4: ${req.file.filename}`);
      convertedPath = await convertToMp4(uploadPath);
    }
    const filePath = convertedPath || uploadPath;

    const storage  = await getMegaStorage();
    const folder   = await getMegaSubfolder(storage, 'Videos', 'Movies');
    const safeName = title.trim().replace(/[^\w\s.()\-]/g, '').replace(/\s+/g, '_') + '.mp4';
    const { size } = fs.statSync(filePath);
    const megaFile = await folder.upload(
      { name: safeName, size },
      fs.createReadStream(filePath)
    ).complete;

    console.log(`[MEGA] Uploaded: Videos/Movies/${safeName}`);

    // Get public share link → 'https://mega.nz/file/ID#key'
    const url      = await megaFile.link();
    const embedUrl = extractMegaId(url);
    if (!embedUrl) throw new Error(`Unexpected MEGA link format: ${url}`);

    const movie = db.addMovie({
      title:        title.trim(),
      director:     (director   || '').trim(),
      release_year: year ? parseInt(year, 10) : null,
      genre:        (genre      || '').trim(),
      poster_url:   (poster_url || '').trim(),
      embed_url:    embedUrl,
    });

    res.json({ success: true, movie });
  } catch (err) {
    // Reset cached session so the next request gets a fresh one
    _megaStorage = null;
    const cause = err.cause?.message || err.cause?.code;
    const msg = err.message === 'fetch failed'
      ? `Could not reach MEGA${cause ? ` (${cause})` : ''} — check network access and your MEGA_EMAIL / MEGA_PASSWORD credentials`
      : err.message;
    res.status(500).json({ error: msg });
  } finally {
    try { fs.unlinkSync(uploadPath); } catch (_) {}
    if (convertedPath) try { fs.unlinkSync(convertedPath); } catch (_) {}
  }
});

// ── Movie from MEGA URL ───────────────────────────────────────────────────────
// POST /api/movies/from-url  application/json
//   embed_url  – full MEGA URL or bare ID#key (required)
//   title      – movie title (required)
//   director, year, genre, poster_url – optional metadata
app.post('/api/movies/from-url', requireAdmin, express.json(), (req, res) => {
  const { title, director, year, genre, poster_url, embed_url } = req.body;
  if (!title)     return res.status(400).json({ error: 'Title is required' });
  if (!embed_url) return res.status(400).json({ error: 'embed_url is required' });

  const megaId = extractMegaId(embed_url.trim()) || embed_url.trim();
  try {
    const movie = db.addMovie({
      title:        title.trim(),
      director:     (director   || '').trim(),
      release_year: year ? parseInt(year, 10) : null,
      genre:        (genre      || '').trim(),
      poster_url:   (poster_url || '').trim(),
      embed_url:    megaId,
    });
    res.json({ success: true, movie });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TMDB movie lookup ─────────────────────────────────────────────────────────
// GET /api/tmdb/movie/:tmdbId — returns pre-formatted fields for the upload modal
app.get('/api/tmdb/movie/:tmdbId', requireAuth, async (req, res) => {
  try {
    const info = await tmdbGet(`/movie/${req.params.tmdbId}?append_to_response=credits`);
    const director = (info.credits?.crew || []).find(c => c.job === 'Director')?.name || '';
    res.json({
      title:      info.title || '',
      director,
      year:       info.release_date ? info.release_date.slice(0, 4) : '',
      genre:      (info.genres || []).map(g => g.name).join(', '),
      poster_url: info.poster_path ? `https://image.tmdb.org/t/p/w500${info.poster_path}` : '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Add show from TMDB ────────────────────────────────────────────────────────
// POST /api/shows   body: { tmdb_id }
app.post('/api/shows', requireAdmin, async (req, res) => {
  const tmdbId = String(req.body.tmdb_id || '').trim();
  if (!tmdbId) return res.status(400).json({ error: 'tmdb_id is required' });

  try {
    // Fetch show info
    const info = await tmdbGet(`/tv/${tmdbId}`);

    const showData = {
      title:       info.name,
      channel:     info.networks?.[0]?.name || '',
      description: info.overview || '',
      image_url:   info.poster_path
        ? `https://image.tmdb.org/t/p/w500${info.poster_path}`
        : '',
    };

    // Fetch episodes for every season (skip season 0 — specials)
    const regularSeasons = (info.seasons || []).filter(s => s.season_number > 0);
    const seasons = await Promise.all(
      regularSeasons.map(s => tmdbGet(`/tv/${tmdbId}/season/${s.season_number}`))
    );

    const show = db.addShowWithEpisodes(showData, seasons);
    res.json({ success: true, show });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Episode MEGA-link / upload ─────────────────────────────────────────────────
// PATCH /api/episodes/:id   body: { embed_url }   — set MEGA ID directly
app.patch('/api/episodes/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid episode id' });

  let { embed_url } = req.body;
  if (!embed_url || !embed_url.trim()) return res.status(400).json({ error: 'embed_url is required' });

  // Accept full MEGA URL (https://mega.nz/file/ID#key) or bare ID#key
  embed_url = embed_url.trim();
  const megaId = extractMegaId(embed_url);
  if (megaId) embed_url = megaId;

  try {
    const episode = db.updateEpisodeUrl(id, embed_url);
    res.json({ success: true, episode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/episodes/:id/upload   multipart: { file }   — upload to MEGA then set embed_url
app.post('/api/episodes/:id/upload', requireAdmin, upload.single('file'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid episode id' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(503).json({ error: 'MEGA credentials not configured — set MEGA_EMAIL and MEGA_PASSWORD, or use the "mega link / id" tab instead' });
  }

  const uploadPath = req.file.path;
  let   convertedPath = null;

  try {
    const isMkv = path.extname(req.file.filename).toLowerCase() === '.mkv';
    if (isMkv) {
      console.log(`[MEGA] Converting MKV→MP4: ${req.file.filename}`);
      convertedPath = await convertToMp4(uploadPath);
    }
    const filePath = convertedPath || uploadPath;

    const storage  = await getMegaStorage();

    // Look up episode + show for proper naming/subfolder
    const epInfo = db.getEpisodeInfo(id);

    let safeName, folder;
    if (epInfo) {
      const sanitize  = str => str.replace(/[/\\:*?"<>|]/g, '').trim();
      const showTitle = sanitize(epInfo.show_title);
      const epTitle   = sanitize(epInfo.episode_title);
      const season    = String(epInfo.season).padStart(2, '0');
      const epNum     = String(epInfo.episode_number).padStart(2, '0');
      safeName = `${showTitle} - S${season}E${epNum}${epTitle ? ` - ${epTitle}` : ''}.mp4`;
      folder   = await getMegaSubfolder(storage, 'Videos', 'TV', showTitle);
    } else {
      safeName = `ep_${id}_${Date.now()}.mp4`;
      folder   = await getMegaSubfolder(storage, 'Videos', 'TV');
    }

    const { size } = fs.statSync(filePath);
    const megaFile = await folder.upload(
      { name: safeName, size },
      fs.createReadStream(filePath)
    ).complete;

    console.log(`[MEGA] Uploaded episode: Videos/TV/${epInfo ? epInfo.show_title + '/' : ''}${safeName}`);

    const url    = await megaFile.link();
    const megaId = extractMegaId(url);
    if (!megaId) throw new Error(`Unexpected MEGA link format: ${url}`);

    const episode = db.updateEpisodeUrl(id, megaId);
    res.json({ success: true, episode });
  } catch (err) {
    _megaStorage = null;
    const cause = err.cause?.message || err.cause?.code;
    const msg = err.message === 'fetch failed'
      ? `Could not reach MEGA${cause ? ` (${cause})` : ''} — check network access and your MEGA_EMAIL / MEGA_PASSWORD credentials`
      : err.message;
    res.status(500).json({ error: msg });
  } finally {
    try { fs.unlinkSync(uploadPath); } catch (_) {}
    if (convertedPath) try { fs.unlinkSync(convertedPath); } catch (_) {}
  }
});

// ── Show channel management ────────────────────────────────────────────────────
// GET /api/show-channels — list all show folders with live status
app.get('/api/show-channels', (req, res) => {
  try {
    const channels = getShowFolders().map(name => {
      const key      = showNameToKey(name);
      const showDir  = path.join(SHOWS_DIR, name);
      const videos   = getVideoFiles(showDir);
      return { name, key, live: activeStreams.has(key), episodeCount: videos.length };
    });
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Keys that were intentionally stopped — don't auto-restart these.
const stoppedChannels = new Set();

function launchFfmpeg(key, name, concatPath, rtmpUrl) {
  if (stoppedChannels.has(key)) return; // stop was requested, don't restart
  const binary = process.env.FFMPEG_PATH || ffmpegPath;

  const proc = spawn(binary, [
    '-re',
    '-fflags', '+genpts',
    '-stream_loop', '-1',
    '-f', 'concat', '-safe', '0',
    '-i', concatPath,
    '-c:v', 'libx264', '-b:v', '2000k', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-x264opts', `threads=2:keyint=120:min-keyint=120:scenecut=0`,
    '-pix_fmt', 'yuv420p',
    '-vf', 'fps=30',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-f', 'flv', rtmpUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderrBuf = '';
  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString('utf8');
    let nl;
    while ((nl = stderrBuf.indexOf('\n')) !== -1) {
      process.stderr.write(`[ffmpeg/${key}] ${stderrBuf.slice(0, nl + 1)}`);
      stderrBuf = stderrBuf.slice(nl + 1);
    }
  });
  proc.stderr.on('end', () => {
    if (stderrBuf) process.stderr.write(`[ffmpeg/${key}] ${stderrBuf}\n`);
  });

  proc.on('error', err => {
    console.error(`[ffmpeg] Failed to start "${name}":`, err.message);
    ffmpegProcesses.delete(key);
  });
  proc.on('exit', (code, signal) => {
    console.log(`[ffmpeg] "${name}" exited (code=${code} signal=${signal})`);
    ffmpegProcesses.delete(key);
    if (!stoppedChannels.has(key)) {
      console.log(`[ffmpeg] Auto-restarting "${name}" in 2s…`);
      setTimeout(() => launchFfmpeg(key, name, concatPath, rtmpUrl), 2000);
    }
  });

  ffmpegProcesses.set(key, proc);
  console.log(`[ffmpeg] Launched "${name}" → ${rtmpUrl} (pid=${proc.pid})`);
}

// POST /api/show-channels/:key/launch — build concat file and start ffmpeg
app.post('/api/show-channels/:key/launch', requireAdmin, (req, res) => {
  const { key } = req.params;

  if (ffmpegProcesses.has(key)) return res.status(409).json({ error: 'Already launching or live' });

  const name = getShowFolders().find(n => showNameToKey(n) === key);
  if (!name) return res.status(404).json({ error: 'Show folder not found' });

  const showDir = path.join(SHOWS_DIR, name);
  const videos  = getVideoFiles(showDir);
  if (videos.length === 0) return res.status(400).json({ error: 'No video files in show folder' });

  const concatPath = buildConcatFile(showDir, videos);
  const rtmpUrl    = `rtmp://localhost/live/${key}`;

  stoppedChannels.delete(key);
  launchFfmpeg(key, name, concatPath, rtmpUrl);
  res.json({ success: true, key });
});

// POST /api/show-channels/:key/stop — kill ffmpeg for this channel
app.post('/api/show-channels/:key/stop', requireAdmin, (req, res) => {
  const { key } = req.params;
  const proc    = ffmpegProcesses.get(key);
  if (!proc) return res.status(404).json({ error: 'No stream process for this channel' });
  stoppedChannels.add(key);   // prevent auto-restart
  proc.kill('SIGTERM');
  ffmpegProcesses.delete(key);
  res.json({ success: true });
});

app.listen(HTTP_PORT, () => {
  console.log(`
┌──────────────────────────────────────────────────────┐
│              Paxana.TV  –  on the air                │
├──────────────────────────────────────────────────────┤
│  Viewer URL : http://localhost:${HTTP_PORT}                  │
│  RTMP ingest: rtmp://localhost/live/<channel-key>    │
│  HLS output : /hls/live/<channel-key>/index.m3u8    │
└──────────────────────────────────────────────────────┘
`);
});
