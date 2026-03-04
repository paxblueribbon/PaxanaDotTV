import { useState, useEffect } from 'react'

export default function MediaGrid({ section, dataKey, onSelect, tagFilter, onClearTag, onTagClick }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    fetch(`/${section}.json`)
      .then(r => r.json())
      .then(data => setItems(data[dataKey] ?? []))
      .catch(() => setItems([]))
  }, [section, dataKey])

  const getImage = item => item.poster_url || item.image_url
  const getSub   = item => item.release_year || item.channel || ''
  const filtered = tagFilter ? items.filter(item => item.tags?.includes(tagFilter)) : items

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
    </div>
  )
}
