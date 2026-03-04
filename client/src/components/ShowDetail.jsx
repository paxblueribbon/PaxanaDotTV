import { useState } from 'react'
import EpisodeUploadModal from './EpisodeUploadModal'

export default function ShowDetail({ show, onSelect, onBack, onEpisodeUpdated, isAdmin, onTagClick }) {
  const [seasonIdx, setSeasonIdx] = useState(0)
  const [editEp, setEditEp]       = useState(null) // { id, episode_number, episode_title, season }

  // Non-admins only see seasons that contain at least one linked episode
  const visibleSeasons = isAdmin
    ? show.seasons
    : show.seasons.filter(s => s.episodes.some(ep => ep.embed_url.trim() !== ''))

  const season = visibleSeasons[seasonIdx] ?? visibleSeasons[0]

  function handleSuccess(episodeId, embedUrl) {
    setEditEp(null)
    onEpisodeUpdated(episodeId, embedUrl)
  }

  if (!season) {
    return (
      <div id="show-detail-view">
        <button id="back-btn" onClick={onBack}>← back</button>
        <div id="show-header">
          <img id="show-poster" src={show.image_url} alt={show.title} />
          <div id="show-info">
            <div id="show-title">{show.title}</div>
            <div id="show-channel">{show.channel}</div>
            {show.tags && show.tags.length > 0 && (
              <div className="media-tags" style={{ margin: '0.4rem 0' }}>
                {show.tags.map(tag => (
                  <button key={tag} className="media-tag" onClick={() => onTagClick?.(tag)}>{tag}</button>
                ))}
              </div>
            )}
            <p id="show-desc">{show.description}</p>
          </div>
        </div>
        <p style={{ color: '#444', fontSize: '0.8rem', marginTop: '1rem' }}>No episodes available yet.</p>
      </div>
    )
  }

  return (
    <div id="show-detail-view">
      <button id="back-btn" onClick={onBack}>← back</button>

      <div id="show-header">
        <img id="show-poster" src={show.image_url} alt={show.title} />
        <div id="show-info">
          <div id="show-title">{show.title}</div>
          <div id="show-channel">{show.channel}</div>
          {show.tags && show.tags.length > 0 && (
            <div className="media-tags" style={{ margin: '0.4rem 0' }}>
              {show.tags.map(tag => (
                <button key={tag} className="media-tag" onClick={() => onTagClick?.(tag)}>{tag}</button>
              ))}
            </div>
          )}
          <p id="show-desc">{show.description}</p>
        </div>
      </div>

      <div id="season-tabs">
        {visibleSeasons.map((s, i) => (
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
        {season.episodes
          .filter(ep => isAdmin || ep.embed_url.trim() !== '')
          .map(ep => {
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
                  : isAdmin && (
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
