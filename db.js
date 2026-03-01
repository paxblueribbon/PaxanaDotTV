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
  return db.prepare('SELECT * FROM movies ORDER BY added_at DESC').all();
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

  return shows.map(show => {
    const eps     = episodes.filter(e => e.show_id === show.id);
    const seasons = [...new Set(eps.map(e => e.season))].sort((a, b) => a - b);
    return {
      ...show,
      seasons: seasons.map(s => ({
        season:   s,
        episodes: eps
          .filter(e => e.season === s)
          .map(({ episode_number, episode_title, embed_url }) =>
            ({ episode_number, episode_title, embed_url })
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

module.exports = { getAllMovies, addMovie, getAllShows, importFromJson };
