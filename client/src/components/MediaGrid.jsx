import { useState, useEffect } from 'react'

export default function MediaGrid({ section, dataKey, onSelect }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    fetch(`/${section}.json`)
      .then(r => r.json())
      .then(data => setItems(data[dataKey] ?? []))
      .catch(() => setItems([]))
  }, [section, dataKey])

  const getImage = item => item.poster_url || item.image_url
  const getSub   = item => item.release_year || item.channel || ''

  return (
    <div id="media-grid-view">
      {items.length === 0
        ? <p id="no-media">Nothing here yet.</p>
        : <div id="media-grid">
            {items.map(item => (
              <div key={item.id} className="media-card" onClick={() => onSelect(item)}>
                <div className="poster-wrap">
                  <img src={getImage(item)} alt={item.title} loading="lazy" />
                </div>
                <div className="media-info">
                  <span className="media-title">{item.title}</span>
                  <span className="media-year">{getSub(item)}</span>
                  {item.tags && item.tags.length > 0 && (
                    <div className="media-tags">
                      {item.tags.map(tag => <span key={tag} className="media-tag">{tag}</span>)}
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
