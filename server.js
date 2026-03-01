const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');

const execAsync = promisify(exec);

// Remote MEGA folder for uploaded movies (override with MEGA_FOLDER env var)
const MEGA_FOLDER = (process.env.MEGA_FOLDER || '/Movies').replace(/['"\\`]/g, '');
const MOVIES_JSON = path.join(__dirname, 'public', 'movies.json');

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
// Requires MEGAcmd installed and authenticated on the host (`mega-login` once).
app.post('/api/movies', upload.single('file'), async (req, res) => {
  const { title, director, year, genre, poster_url } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  if (!title)    return res.status(400).json({ error: 'Title is required' });

  const uploadPath  = req.file.path;                          // e.g. /tmp/1234567890.mp4
  const remotePath  = `${MEGA_FOLDER}/${req.file.filename}`;  // e.g. /Movies/1234567890.mp4

  try {
    // Ensure remote folder exists (ignore error if it already does)
    try { await execAsync(`mega-mkdir -p "${MEGA_FOLDER}"`); } catch (_) {}

    // Upload file to MEGA
    await execAsync(`mega-put "${uploadPath}" "${MEGA_FOLDER}/"`);

    // Create public export link – output like:
    //   Exported /Movies/1234.mp4: https://mega.nz/file/ABC123#key
    const { stdout } = await execAsync(`mega-export -a "${remotePath}"`);
    const match = stdout.match(/https?:\/\/mega\.nz\/file\/([^\s]+)/);
    if (!match) throw new Error(`Unexpected mega-export output: ${stdout.trim()}`);
    const embedUrl = match[1]; // "ID#key"

    // Read existing movies.json (or start fresh)
    let data = { movies: [] };
    if (fs.existsSync(MOVIES_JSON)) {
      data = JSON.parse(fs.readFileSync(MOVIES_JSON, 'utf8'));
    }

    const newId = data.movies.length > 0
      ? Math.max(...data.movies.map(m => Number(m.id))) + 1
      : 1;

    const movie = {
      id:           newId,
      title:        title.trim(),
      director:     (director    || '').trim(),
      release_year: year ? parseInt(year, 10) : null,
      genre:        (genre       || '').trim(),
      poster_url:   (poster_url  || '').trim(),
      embed_url:    embedUrl,
    };

    data.movies.push(movie);
    fs.writeFileSync(MOVIES_JSON, JSON.stringify(data, null, 2));

    res.json({ success: true, movie });
  } catch (err) {
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
