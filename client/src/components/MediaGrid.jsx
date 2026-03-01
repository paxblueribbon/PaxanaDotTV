import { useState, useEffect } from 'react'

export default function MediaGrid({ section, onSelect }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    fetch(`/${section}.json`)
      .then(r => r.json())
      .then(data => setItems(data[section] ?? []))
      .catch(() => setItems([]))
  }, [section])

  return (
    <div id="media-grid-view">
      {items.length === 0
        ? <p id="no-media">Nothing here yet.</p>
        : <div id="media-grid">
            {items.map(item => (
              <div key={item.id} className="media-card" onClick={() => onSelect(item)}>
                <div className="poster-wrap">
                  <img src={item.poster_url} alt={item.title} loading="lazy" />
                </div>
                <div className="media-info">
                  <span className="media-title">{item.title}</span>
                  <span className="media-year">{item.release_year}</span>
                </div>
              </div>
            ))}
          </div>
      }
    </div>
  )
}
