import { useState } from 'react'
import EpisodeUploadModal from './EpisodeUploadModal'

export default function ShowDetail({ show, onSelect, onBack, onEpisodeUpdated, onEpisodeDeleted, isAdmin, onTagClick }) {
  const [seasonIdx, setSeasonIdx] = useState(0)
  const [editEp, setEditEp]       = useState(null) // { id, episode_number, episode_title, season }

  function epHasVideo(ep) {
    return ep.video_source_type === 'direct' || ep.embed_url.trim() !== ''
  }

  // Non-admins only see seasons that contain at least one linked episode
  const visibleSeasons = isAdmin
    ? show.seasons
    : show.seasons.filter(s => s.episodes.some(epHasVideo))

  const season = visibleSeasons[seasonIdx] ?? visibleSeasons[0]

  function handleSuccess(episodeId, episode) {
    setEditEp(null)
    onEpisodeUpdated(episodeId, episode)
  }

  async function handleDeleteShow() {
    if (!confirm(`Remove "${show.title}" and all its episodes? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/shows/${show.id}`, { method: 'DELETE' })
    if (res.ok) onBack()
  }

  async function handleClearEpisode(e, epId) {
    e.stopPropagation()
    if (!confirm('Clear the video for this episode?')) return
    const res = await fetch(`/api/admin/episodes/${epId}`, { method: 'DELETE' })
    if (res.ok) onEpisodeUpdated(epId, { embed_url: '', video_source_type: 'mega', local_path: '' })
  }

  if (!season) {
    return (
      <div id="show-detail-view">
        <div className="show-nav-row">
          <button id="back-btn" onClick={onBack}>← back</button>
          {isAdmin && (
            <button className="show-delete-btn" onClick={handleDeleteShow}>remove show</button>
          )}
        </div>
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
      <div className="show-nav-row">
        <button id="back-btn" onClick={onBack}>← back</button>
        {isAdmin && (
          <button className="show-delete-btn" onClick={handleDeleteShow}>remove show</button>
        )}
      </div>

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
          .filter(ep => isAdmin || epHasVideo(ep))
          .map(ep => {
            const available = epHasVideo(ep)
            return (
              <div
                key={ep.episode_number}
                className={`episode-item${available ? '' : ' unavailable'}`}
                onClick={() => available && onSelect(ep, season.season)}
              >
                <span className="ep-num">E{ep.episode_number}</span>
                <span className="ep-title">{ep.episode_title}</span>
                {available ? (
                  <div className="ep-actions">
                    <span className="ep-watch">watch →</span>
                    {isAdmin && (
                      <>
                        <button
                          className="ep-admin-btn"
                          onClick={e => { e.stopPropagation(); setEditEp({ ...ep, season: season.season }) }}
                          title="Edit MEGA link"
                        >edit</button>
                        <button
                          className="ep-admin-btn ep-admin-btn-del"
                          onClick={e => handleClearEpisode(e, ep.id)}
                          title="Clear MEGA link"
                        >✕</button>
                      </>
                    )}
                  </div>
                ) : isAdmin && (
                  <button
                    className="ep-add"
                    onClick={e => { e.stopPropagation(); setEditEp({ ...ep, season: season.season }) }}
                  >
                    add →
                  </button>
                )}
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
