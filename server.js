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

// ── Simple password auth ──────────────────────────────────────────────────────
const SITE_PASSWORD = process.env.SITE_PASSWORD || 'paxana';
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
const AUTH_COOKIE   = 'paxana_auth';

if (!process.env.SITE_PASSWORD) {
  console.warn('[auth] SITE_PASSWORD not set — using default "paxana". Set it in your env!');
}

function makeToken() {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(SITE_PASSWORD).digest('hex');
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const [k, ...v] = pair.split('=');
    if (k.trim()) out[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return out;
}

function requireAuth(req, res, next) {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (parseCookies(req)[AUTH_COOKIE] === makeToken()) return next();
  res.redirect('/login');
}

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
    ...videoFiles.map(f => `file '${path.join(showDir, f).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`),
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
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    // node-media-server's own HTTP is disabled; Express handles everything
    port: 8888,
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

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Paxana.TV</title>
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
    form {
      display: flex; flex-direction: column; gap: .75rem;
      background: #141414; border: 1px solid #222; border-radius: 10px;
      padding: 2rem; width: min(320px, 90vw);
    }
    input[type=password] {
      padding: .6rem .8rem; border-radius: 6px; border: 1px solid #333;
      background: #1e1e1e; color: #f0f0f0; font-size: 1rem; outline: none;
    }
    input[type=password]:focus { border-color: #e63946; }
    button {
      padding: .65rem; border-radius: 6px; border: none;
      background: #e63946; color: #fff; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: opacity .15s;
    }
    button:hover { opacity: .85; }
    .err { color: #e63946; font-size: .875rem; text-align: center; }
    footer { margin-top: 3rem; font-size: .8rem; color: #444; }
  </style>
</head>
<body>
  <header><span>Paxana</span>.TV</header>
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
    {{error}}
    <button type="submit">Enter</button>
  </form>
  <footer>tune in. sit back. enjoy.</footer>
</body>
</html>`;

app.get('/login', (req, res) => {
  res.send(LOGIN_HTML.replace('{{error}}', ''));
});

app.post('/login', (req, res) => {
  if (req.body.password === SITE_PASSWORD) {
    const token   = makeToken();
    const maxAge  = 7 * 24 * 60 * 60; // 1 week in seconds
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict`);
    return res.redirect('/');
  }
  res.status(401).send(LOGIN_HTML.replace('{{error}}', '<p class="err">Incorrect password</p>'));
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.redirect('/login');
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
app.post('/api/movies', upload.single('file'), async (req, res) => {
  const { title, director, year, genre, poster_url } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  if (!title)    return res.status(400).json({ error: 'Title is required' });

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
    res.status(500).json({ error: err.message });
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
app.post('/api/movies/from-url', requireAuth, express.json(), (req, res) => {
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
app.post('/api/shows', async (req, res) => {
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
app.patch('/api/episodes/:id', (req, res) => {
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
app.post('/api/episodes/:id/upload', upload.single('file'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid episode id' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

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
    const folder   = await getMegaSubfolder(storage, 'Videos', 'TV');
    const safeName = `ep_${id}_${Date.now()}.mp4`;
    const { size } = fs.statSync(filePath);
    const megaFile = await folder.upload(
      { name: safeName, size },
      fs.createReadStream(filePath)
    ).complete;

    console.log(`[MEGA] Uploaded episode: Videos/TV/${safeName}`);

    const url    = await megaFile.link();
    const megaId = extractMegaId(url);
    if (!megaId) throw new Error(`Unexpected MEGA link format: ${url}`);

    const episode = db.updateEpisodeUrl(id, megaId);
    res.json({ success: true, episode });
  } catch (err) {
    _megaStorage = null;
    res.status(500).json({ error: err.message });
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

// POST /api/show-channels/:key/launch — build concat file and start ffmpeg
app.post('/api/show-channels/:key/launch', (req, res) => {
  const { key } = req.params;

  if (ffmpegProcesses.has(key)) return res.status(409).json({ error: 'Already launching or live' });

  const name = getShowFolders().find(n => showNameToKey(n) === key);
  if (!name) return res.status(404).json({ error: 'Show folder not found' });

  const showDir    = path.join(SHOWS_DIR, name);
  const videos     = getVideoFiles(showDir);
  if (videos.length === 0) return res.status(400).json({ error: 'No video files in show folder' });

  const concatPath = buildConcatFile(showDir, videos);
  const rtmpUrl    = `rtmp://localhost/live/${key}`;
  const binary     = process.env.FFMPEG_PATH || ffmpegPath;

  const proc = spawn(binary, [
    '-re',
    '-stream_loop', '-1',
    '-f', 'concat', '-safe', '0',
    '-i', concatPath,
    '-c:v', 'libx264', '-b:v', '2000k', '-preset', 'veryfast',
    '-x264opts', 'keyint=120:min-keyint=120:scenecut=0',
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
  });

  ffmpegProcesses.set(key, proc);
  console.log(`[ffmpeg] Launched "${name}" → ${rtmpUrl} (pid=${proc.pid})`);
  res.json({ success: true, key, pid: proc.pid });
});

// POST /api/show-channels/:key/stop — kill ffmpeg for this channel
app.post('/api/show-channels/:key/stop', (req, res) => {
  const { key }  = req.params;
  const proc     = ffmpegProcesses.get(key);
  if (!proc) return res.status(404).json({ error: 'No stream process for this channel' });
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
