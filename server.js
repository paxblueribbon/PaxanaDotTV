const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Storage } = require('megajs');
const ffmpegPath = require('ffmpeg-static');

// MEGA folder name (no leading slash) — override with MEGA_FOLDER env var
const MEGA_FOLDER_NAME = (process.env.MEGA_FOLDER || 'Movies').replace(/^\/+/, '');

// Database (also handles migration from any legacy JSON files)
const db = require('./db');

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
const activeStreams = new Set();

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
        // Force audio re-encode: fixes slowed-down audio caused by VLC RTMP
        // timestamp drift being passed through in stream-copy mode.
        ac: 'aac',
        acParam: ['-ar', '44100'],
        // Force CFR video re-encode: fixes stuttering caused by variable frame
        // timestamps in the RTMP stream. GOP kept at 120 frames (4s @ 30fps)
        // to stay aligned with HLS segment boundaries.
        vc: 'libx264',
        vcParam: ['-vsync', 'cfr', '-r', '30', '-g', '120', '-sc_threshold', '0'],
      },
    ],
  },
});

nms.run();

nms.on('prePublish', (id, streamPath, args) => {
  const key = streamPath.split('/').pop();
  activeStreams.add(key);
  console.log(`[RTMP] Stream started: ${streamPath}`);
});

nms.on('donePublish', (id, streamPath, args) => {
  const key = streamPath.split('/').pop();
  activeStreams.delete(key);
  console.log(`[RTMP] Stream ended: ${streamPath}`);
});

// ── Express (viewer frontend + HLS files) ────────────────────────────────────
const app = express();

app.use(express.json());

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

  try {
    const storage = await getMegaStorage();

    // Find or create the uploads folder under root
    let folder = (storage.root.children || []).find(
      f => f.directory && f.name === MEGA_FOLDER_NAME
    );
    if (!folder) folder = await storage.root.mkdir(MEGA_FOLDER_NAME);

    // Stream the file to MEGA; name it after the movie title
    const ext      = path.extname(req.file.filename);
    const safeName = title.trim().replace(/[^\w\s.()\-]/g, '').replace(/\s+/g, '_') + ext;
    const { size } = fs.statSync(uploadPath);
    const megaFile = await folder.upload(
      { name: safeName, size },
      fs.createReadStream(uploadPath)
    ).complete;

    console.log(`[MEGA] Uploaded: ${MEGA_FOLDER_NAME}/${safeName}`);

    // Get public share link → 'https://mega.nz/file/ID#key'
    const url   = await megaFile.link();
    const match = url.match(/mega\.nz\/(?:file|#!)\/([^\s]+)/);
    if (!match) throw new Error(`Unexpected MEGA link format: ${url}`);
    const embedUrl = match[1]; // "ID#key"

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
  }
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

VLC command (use any name for <channel-key>):
  vlc <file> \\
    --sout '#transcode{vcodec=h264,vb=2000,acodec=aac,ab=128,venc=x264{keyint=120,min-keyint=120,scenecut=0}}:standard{access=rtmp,mux=ffmpeg{mux=flv},dst=rtmp://localhost/live/<channel-key>}' \\
    --loop

`);
});
