import { useState } from 'react'
import EpisodeUploadModal from './EpisodeUploadModal'

export default function ShowDetail({ show, onSelect, onBack, onEpisodeUpdated }) {
  const [seasonIdx, setSeasonIdx] = useState(0)
  const [editEp, setEditEp]       = useState(null) // { id, episode_number, episode_title, season }

  const season = show.seasons[seasonIdx]

  function handleSuccess(episodeId, embedUrl) {
    setEditEp(null)
    onEpisodeUpdated(episodeId, embedUrl)
  }

  return (
    <div id="show-detail-view">
      <button id="back-btn" onClick={onBack}>← back</button>

      <div id="show-header">
        <img id="show-poster" src={show.image_url} alt={show.title} />
        <div id="show-info">
          <div id="show-title">{show.title}</div>
          <div id="show-channel">{show.channel}</div>
          <p id="show-desc">{show.description}</p>
        </div>
      </div>

      <div id="season-tabs">
        {show.seasons.map((s, i) => (
          <button
            key={s.season}
            className={i === seasonIdx ? 'active' : ''}
            onClick={() => setSeasonIdx(i)}
          >
            S{s.season}
          </button>
        ))}
      </div>

      <div id="episode-list">
        {season.episodes.map(ep => {
          const available = ep.embed_url.trim() !== ''
          return (
            <div
              key={ep.episode_number}
              className={`episode-item${available ? '' : ' unavailable'}`}
              onClick={() => available && onSelect(ep, season.season)}
            >
              <span className="ep-num">E{ep.episode_number}</span>
              <span className="ep-title">{ep.episode_title}</span>
              {available
                ? <span className="ep-watch">watch →</span>
                : (
                  <button
                    className="ep-add"
                    onClick={e => { e.stopPropagation(); setEditEp({ ...ep, season: season.season }) }}
                  >
                    add →
                  </button>
                )
              }
            </div>
          )
        })}
      </div>

      {editEp && (
        <EpisodeUploadModal
          episode={editEp}
          onClose={() => setEditEp(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
