import { useState, useEffect, useRef } from 'react'

function SrGroup({ label, items, render }) {
  if (!items.length) return null
  return (
    <div className="sr-group">
      <div className="sr-group-label">{label}</div>
      {items.map((item, i) => <div key={i}>{render(item)}</div>)}
    </div>
  )
}

export default function SearchBar({ refreshKey, onSelectMovie, onSelectShow, onSelectChannel, onSelectTag }) {
  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState(null)
  const [allMovies, setAllMovies] = useState([])
  const [allShows,  setAllShows]  = useState([])
  const [channels,  setChannels]  = useState([])
  const wrapRef = useRef(null)

  useEffect(() => {
    fetch('/movies.json').then(r => r.json()).then(d => setAllMovies(d.movies ?? []))
    fetch('/tv.json').then(r => r.json()).then(d => setAllShows(d.shows ?? []))
    fetch('/api/show-channels').then(r => r.json()).then(d => setChannels(d.channels ?? []))
  }, [refreshKey])

  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (!q) { setResults(null); return }

    const movies = allMovies.filter(m =>
      m.title.toLowerCase().includes(q) ||
      m.director?.toLowerCase().includes(q) ||
      m.genre?.toLowerCase().includes(q) ||
      m.tags?.some(t => t.includes(q))
    ).slice(0, 5)

    const shows = allShows.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.channel?.toLowerCase().includes(q) ||
      s.tags?.some(t => t.includes(q))
    ).slice(0, 5)

    const live = channels.filter(ch =>
      ch.live && ch.name.toLowerCase().includes(q)
    ).slice(0, 3)

    const allTags = [...new Set([...allMovies, ...allShows].flatMap(i => i.tags ?? []))]
    const tags = allTags.filter(t => t.includes(q)).slice(0, 5)

    setResults({ movies, shows, live, tags })
  }, [query, allMovies, allShows, channels])

  // Close on outside click
  useEffect(() => {
    if (!results) return
    function onMouseDown(e) {
      if (!wrapRef.current?.contains(e.target)) clear()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [results])

  function clear() { setQuery(''); setResults(null) }

  function handleTagClick(tag) {
    const hasMovies = allMovies.some(m => m.tags?.includes(tag))
    onSelectTag(tag, hasMovies ? 'movies' : 'tv')
    clear()
  }

  const hasAny = results && Object.values(results).some(r => r.length > 0)

  return (
    <div id="search-wrap" ref={wrapRef}>
      <input
        id="search-input"
        type="search"
        placeholder="search…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && clear()}
        autoComplete="off"
      />
      {results && (
        <div id="search-dropdown">
          {!hasAny && <p className="sr-empty">no results</p>}

          <SrGroup label="movies" items={results.movies} render={m => (
            <button className="sr-item" onClick={() => { onSelectMovie(m); clear() }}>
              <span className="sr-title">{m.title}</span>
              {m.release_year && <span className="sr-sub">{m.release_year}</span>}
            </button>
          )} />

          <SrGroup label="tv shows" items={results.shows} render={s => (
            <button className="sr-item" onClick={() => { onSelectShow(s); clear() }}>
              <span className="sr-title">{s.title}</span>
              {s.channel && <span className="sr-sub">{s.channel}</span>}
            </button>
          )} />

          <SrGroup label="live" items={results.live} render={ch => (
            <button className="sr-item" onClick={() => { onSelectChannel(ch.key); clear() }}>
              <span className="sr-live-dot" />
              <span className="sr-title">{ch.name}</span>
            </button>
          )} />

          <SrGroup label="tags" items={results.tags} render={tag => (
            <button className="sr-item sr-tag-item" onClick={() => handleTagClick(tag)}>
              #{tag}
            </button>
          )} />
        </div>
      )}
    </div>
  )
}
