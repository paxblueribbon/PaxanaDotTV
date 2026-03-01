const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');

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
