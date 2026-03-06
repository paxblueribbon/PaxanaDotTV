import { useState, useEffect } from 'react'
import MovieLinkModal from './MovieLinkModal'

export default function MediaGrid({ section, dataKey, onSelect, tagFilter, onClearTag, onTagClick, isAdmin }) {
  const [items, setItems]       = useState([])
  const [editMovie, setEditMovie] = useState(null)

  useEffect(() => {
    fetch(`/${section}.json`)
      .then(r => r.json())
      .then(data => setItems(data[dataKey] ?? []))
      .catch(() => setItems([]))
  }, [section, dataKey])

  const getImage = item => item.poster_url || item.image_url
  const getSub   = item => item.release_year || item.channel || ''
  const filtered = tagFilter ? items.filter(item => item.tags?.includes(tagFilter)) : items

  async function handleDeleteMovie(e, movie) {
    e.stopPropagation()
    if (!confirm(`Remove "${movie.title}"? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/movies/${movie.id}`, { method: 'DELETE' })
    if (res.ok) setItems(prev => prev.filter(m => m.id !== movie.id))
  }

  function handleMovieUpdated(id, embedUrl) {
    setItems(prev => prev.map(m => m.id === id ? { ...m, embed_url: embedUrl } : m))
    setEditMovie(null)
  }

  return (
    <div id="media-grid-view">
      {tagFilter && (
        <div id="tag-filter-bar">
          <span>tagged: <strong>{tagFilter}</strong></span>
          <button id="tag-filter-clear" onClick={onClearTag}>×</button>
        </div>
      )}
      {filtered.length === 0
        ? <p id="no-media">{tagFilter ? `No ${dataKey} tagged "${tagFilter}".` : 'Nothing here yet.'}</p>
        : <div id="media-grid">
            {filtered.map(item => (
              <div key={item.id} className="media-card" onClick={() => onSelect(item)}>
                <div className="poster-wrap">
                  <img src={getImage(item)} alt={item.title} loading="lazy" />
                  {isAdmin && section === 'movies' && (
                    <div className="admin-card-actions" onClick={e => e.stopPropagation()}>
                      <button
                        className="admin-card-btn"
                        onClick={e => { e.stopPropagation(); setEditMovie(item) }}
                        title="Edit MEGA link"
                      >edit</button>
                      <button
                        className="admin-card-btn admin-card-btn-del"
                        onClick={e => handleDeleteMovie(e, item)}
                        title="Remove movie"
                      >✕</button>
                    </div>
                  )}
                </div>
                <div className="media-info">
                  <span className="media-title">{item.title}</span>
                  <span className="media-year">{getSub(item)}</span>
                  {item.tags && item.tags.length > 0 && (
                    <div className="media-tags">
                      {item.tags.map(tag => (
                        <button
                          key={tag}
                          className={`media-tag${tag === tagFilter ? ' active' : ''}`}
                          onClick={e => { e.stopPropagation(); onTagClick?.(tag) }}
                        >{tag}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
      }
      {editMovie && (
        <MovieLinkModal
          movie={editMovie}
          onClose={() => setEditMovie(null)}
          onSuccess={handleMovieUpdated}
        />
      )}
    </div>
  )
}
