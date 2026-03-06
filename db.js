'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'paxana.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
    invited_by    INTEGER REFERENCES users(id),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT    NOT NULL UNIQUE,
    role       TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    used_by    INTEGER REFERENCES users(id),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT    NOT NULL CHECK(type IN ('movie','show')),
    tmdb_id      TEXT,
    title        TEXT    NOT NULL,
    note         TEXT    NOT NULL DEFAULT '',
    submitted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','noted','dismissed')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    director     TEXT    NOT NULL DEFAULT '',
    release_year INTEGER,
    genre        TEXT    NOT NULL DEFAULT '',
    poster_url   TEXT    NOT NULL DEFAULT '',
    embed_url    TEXT    NOT NULL DEFAULT '',
    added_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    channel     TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    image_url   TEXT NOT NULL DEFAULT '',
    added_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id        INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    season         INTEGER NOT NULL DEFAULT 1,
    episode_number INTEGER NOT NULL,
    episode_title  TEXT    NOT NULL DEFAULT '',
    embed_url      TEXT    NOT NULL DEFAULT '',
    added_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Schema migrations ─────────────────────────────────────────────────────────
try { db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT'); } catch (_) {}
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS media_tags (
    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    media_type TEXT    NOT NULL CHECK(media_type IN ('movie','show')),
    media_id   INTEGER NOT NULL,
    PRIMARY KEY (tag_id, media_type, media_id)
  );
`);

// ── Migration from JSON files ─────────────────────────────────────────────────
// Tries both data/ and public/ as source locations. Renames originals to .bak.
function migrateJsonIfNeeded() {
  const hasMovies = db.prepare('SELECT 1 FROM movies LIMIT 1').get();
  const hasShows  = db.prepare('SELECT 1 FROM shows  LIMIT 1').get();

  // Locate the best available JSON source (prefer data/ over public/)
  function findJson(name) {
    for (const dir of [DATA_DIR, path.join(__dirname, 'public')]) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  if (!hasMovies) {
    const src = findJson('movies.json');
    if (src) {
      const { movies = [] } = JSON.parse(fs.readFileSync(src, 'utf8'));
      const ins = db.prepare(`
        INSERT INTO movies (title, director, release_year, genre, poster_url, embed_url)
        VALUES (@title, @director, @release_year, @genre, @poster_url, @embed_url)
      `);
      db.transaction(() => movies.forEach(m => ins.run(m)))();
      fs.renameSync(src, src + '.bak');
      console.log(`[db] Migrated ${movies.length} movies from ${src}`);
    }
  }

  if (!hasShows) {
    const src = findJson('tv.json');
    if (src) {
      const { shows = [] } = JSON.parse(fs.readFileSync(src, 'utf8'));
      const insShow = db.prepare(`
        INSERT INTO shows (title, channel, description, image_url)
        VALUES (@title, @channel, @description, @image_url)
      `);
      const insEp = db.prepare(`
        INSERT INTO episodes (show_id, season, episode_number, episode_title, embed_url)
        VALUES (@show_id, @season, @episode_number, @episode_title, @embed_url)
      `);
      db.transaction(() => {
        for (const show of shows) {
          const { lastInsertRowid: showId } = insShow.run(show);
          for (const s of (show.seasons || [])) {
            for (const ep of (s.episodes || [])) {
              insEp.run({
                show_id:        showId,
                season:         s.season,
                episode_number: ep.episode_number,
                episode_title:  ep.episode_title  || '',
                embed_url:      ep.embed_url       || '',
              });
            }
          }
        }
      })();
      fs.renameSync(src, src + '.bak');
      console.log(`[db] Migrated ${shows.length} shows from ${src}`);
    }
  }
}

migrateJsonIfNeeded();

// ── Query helpers ─────────────────────────────────────────────────────────────
function getAllMovies() {
  const movies = db.prepare('SELECT * FROM movies ORDER BY added_at DESC').all();
  const tagMap = {};
  db.prepare('SELECT mt.media_id, t.name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_type = ?').all('movie')
    .forEach(r => { (tagMap[r.media_id] ??= []).push(r.name); });
  return movies.map(m => ({ ...m, tags: tagMap[m.id] || [] }));
}

function addMovie({ title, director, release_year, genre, poster_url, embed_url }) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO movies (title, director, release_year, genre, poster_url, embed_url)
    VALUES (@title, @director, @release_year, @genre, @poster_url, @embed_url)
  `).run({ title, director, release_year, genre, poster_url, embed_url });
  return db.prepare('SELECT * FROM movies WHERE id = ?').get(lastInsertRowid);
}

function getAllShows() {
  const shows    = db.prepare('SELECT * FROM shows ORDER BY added_at DESC').all();
  const episodes = db.prepare(
    'SELECT * FROM episodes ORDER BY show_id, season, episode_number'
  ).all();
  const tagMap = {};
  db.prepare('SELECT mt.media_id, t.name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_type = ?').all('show')
    .forEach(r => { (tagMap[r.media_id] ??= []).push(r.name); });

  return shows.map(show => {
    const eps     = episodes.filter(e => e.show_id === show.id);
    const seasons = [...new Set(eps.map(e => e.season))].sort((a, b) => a - b);
    return {
      ...show,
      tags: tagMap[show.id] || [],
      seasons: seasons.map(s => ({
        season:   s,
        episodes: eps
          .filter(e => e.season === s)
          .map(({ id, episode_number, episode_title, embed_url }) =>
            ({ id, episode_number, episode_title, embed_url })
          ),
      })),
    };
  });
}

// ── Temporary import helper (call once, then remove) ─────────────────────────
function importFromJson(moviesPath, tvPath) {
  const result = { movies: { imported: 0, skipped: 0 }, shows: { imported: 0, skipped: 0 } };

  if (fs.existsSync(moviesPath)) {
    const { movies = [] } = JSON.parse(fs.readFileSync(moviesPath, 'utf8'));
    const exists = db.prepare('SELECT 1 FROM movies WHERE embed_url = ?');
    const ins    = db.prepare(`
      INSERT INTO movies (title, director, release_year, genre, poster_url, embed_url)
      VALUES (@title, @director, @release_year, @genre, @poster_url, @embed_url)
    `);
    db.transaction(() => {
      for (const m of movies) {
        if (exists.get(m.embed_url)) { result.movies.skipped++; }
        else { ins.run(m); result.movies.imported++; }
      }
    })();
  }

  if (fs.existsSync(tvPath)) {
    const { shows = [] } = JSON.parse(fs.readFileSync(tvPath, 'utf8'));
    const showExists = db.prepare('SELECT id FROM shows WHERE title = ?');
    const insShow    = db.prepare(`
      INSERT INTO shows (title, channel, description, image_url)
      VALUES (@title, @channel, @description, @image_url)
    `);
    const insEp = db.prepare(`
      INSERT INTO episodes (show_id, season, episode_number, episode_title, embed_url)
      VALUES (@show_id, @season, @episode_number, @episode_title, @embed_url)
    `);
    db.transaction(() => {
      for (const show of shows) {
        const existing = showExists.get(show.title);
        if (existing) { result.shows.skipped++; continue; }
        const { lastInsertRowid: showId } = insShow.run(show);
        for (const s of (show.seasons || [])) {
          for (const ep of (s.episodes || [])) {
            insEp.run({
              show_id: showId, season: s.season,
              episode_number: ep.episode_number,
              episode_title:  ep.episode_title || '',
              embed_url:      ep.embed_url     || '',
            });
          }
        }
        result.shows.imported++;
      }
    })();
  }

  return result;
}

function updateEpisodeUrl(id, embedUrl) {
  db.prepare('UPDATE episodes SET embed_url = ? WHERE id = ?').run(embedUrl, id);
  return db.prepare('SELECT * FROM episodes WHERE id = ?').get(id);
}

function updateMovieUrl(id, embedUrl) {
  db.prepare('UPDATE movies SET embed_url = ? WHERE id = ?').run(embedUrl, id);
  return db.prepare('SELECT * FROM movies WHERE id = ?').get(id);
}

function deleteMovie(id) {
  db.prepare('DELETE FROM movies WHERE id = ?').run(id);
}

function deleteShow(id) {
  db.prepare('DELETE FROM shows WHERE id = ?').run(id);
}

function clearEpisodeUrl(id) {
  db.prepare("UPDATE episodes SET embed_url = '' WHERE id = ?").run(id);
  return db.prepare('SELECT * FROM episodes WHERE id = ?').get(id);
}

// showData: { title, channel, description, image_url }
// seasons:  [{ season_number, episodes: [{ episode_number, name }] }]
function addShowWithEpisodes(showData, seasons) {
  return db.transaction(() => {
    const { lastInsertRowid: showId } = db.prepare(`
      INSERT INTO shows (title, channel, description, image_url)
      VALUES (@title, @channel, @description, @image_url)
    `).run(showData);

    const insEp = db.prepare(`
      INSERT INTO episodes (show_id, season, episode_number, episode_title, embed_url)
      VALUES (@show_id, @season, @episode_number, @episode_title, @embed_url)
    `);

    for (const { season_number, episodes } of seasons) {
      for (const ep of episodes) {
        insEp.run({
          show_id:        showId,
          season:         season_number,
          episode_number: ep.episode_number,
          episode_title:  ep.name || '',
          embed_url:      '',
        });
      }
    }

    return db.prepare('SELECT * FROM shows WHERE id = ?').get(showId);
  })();
}

// ── User / session / invite helpers ───────────────────────────────────────────

function getUserCount() {
  return db.prepare('SELECT COUNT(*) as n FROM users').get().n;
}

function createUser({ username, passwordHash, role, invitedBy }) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, password_hash, role, invited_by) VALUES (?, ?, ?, ?)'
  ).run(username, passwordHash, role, invitedBy || null);
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(lastInsertRowid);
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

function getUserById(id) {
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
}

function getAllUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at, u.last_login_at, inv.username AS invited_by_name
    FROM users u
    LEFT JOIN users inv ON inv.id = u.invited_by
    ORDER BY u.created_at ASC
  `).all();
}

function updateLastLogin(userId) {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
}

function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function createSession({ token, userId, expiresAt }) {
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
}

function getSession(token) {
  return db.prepare(`
    SELECT s.token, s.expires_at, u.id AS user_id, u.username, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function deleteExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

function createInvite({ token, role, createdBy, expiresAt }) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO invites (token, role, created_by, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, role, createdBy, expiresAt);
  return db.prepare('SELECT * FROM invites WHERE id = ?').get(lastInsertRowid);
}

function getInvite(token) {
  return db.prepare(`
    SELECT i.*, u.username AS created_by_name
    FROM invites i
    JOIN users u ON u.id = i.created_by
    WHERE i.token = ? AND i.used_by IS NULL AND i.expires_at > datetime('now')
  `).get(token);
}

function markInviteUsed(token, userId) {
  db.prepare('UPDATE invites SET used_by = ? WHERE token = ?').run(userId, token);
}

// ── Recommendation helpers ────────────────────────────────────────────────────

function createRecommendation({ type, tmdbId, title, note, submittedBy }) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO recommendations (type, tmdb_id, title, note, submitted_by) VALUES (?, ?, ?, ?, ?)'
  ).run(type, tmdbId || null, title, note || '', submittedBy);
  return db.prepare('SELECT * FROM recommendations WHERE id = ?').get(lastInsertRowid);
}

function getAllRecommendations() {
  return db.prepare(`
    SELECT r.*, u.username AS submitted_by_name
    FROM recommendations r
    JOIN users u ON u.id = r.submitted_by
    ORDER BY r.created_at DESC
  `).all();
}

function updateRecommendationStatus(id, status) {
  db.prepare('UPDATE recommendations SET status = ? WHERE id = ?').run(status, id);
}

function deleteRecommendation(id) {
  db.prepare('DELETE FROM recommendations WHERE id = ?').run(id);
}

// ── Tag helpers ───────────────────────────────────────────────────────────────

function setTagsForMedia(type, id, tagNames) {
  const normalized = [...new Set(tagNames.map(t => t.trim().toLowerCase()).filter(Boolean))];
  db.transaction(() => {
    db.prepare('DELETE FROM media_tags WHERE media_type = ? AND media_id = ?').run(type, id);
    for (const name of normalized) {
      db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
      const tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name);
      db.prepare('INSERT OR IGNORE INTO media_tags (tag_id, media_type, media_id) VALUES (?, ?, ?)').run(tag.id, type, id);
    }
  })();
}

module.exports = {
  getAllMovies, addMovie, updateMovieUrl, deleteMovie, getAllShows, deleteShow, updateEpisodeUrl, clearEpisodeUrl, addShowWithEpisodes, importFromJson,
  getUserCount, createUser, getUserByUsername, getUserById, getAllUsers, deleteUser, updateLastLogin,
  createSession, getSession, deleteSession, deleteExpiredSessions,
  createInvite, getInvite, markInviteUsed,
  createRecommendation, getAllRecommendations, updateRecommendationStatus, deleteRecommendation,
  setTagsForMedia,
};
