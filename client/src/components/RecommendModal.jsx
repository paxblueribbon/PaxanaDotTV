import { useState } from 'react'

export default function RecommendModal({ onClose }) {
  const [type, setType]     = useState('movie')
  const [tmdbId, setTmdbId] = useState('')
  const [title, setTitle]   = useState('')
  const [note, setNote]     = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')
  const [done, setDone]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return setError('Please enter a title.')
    setBusy(true)
    setError('')
    try {
      const res  = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, tmdb_id: tmdbId.trim() || null, title: title.trim(), note: note.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="modal-backdrop" onClick={e => e.target.id === 'modal-backdrop' && !busy && onClose()}>
      <div id="upload-modal">
        <div id="modal-header">
          <span>suggest a title</span>
          <button id="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        {done ? (
          <div className="recommend-done">
            <p>Thanks! Your suggestion has been sent.</p>
            <div id="modal-actions">
              <button onClick={onClose}>close</button>
            </div>
          </div>
        ) : (
          <form id="upload-form" onSubmit={handleSubmit}>
            <div id="ep-mode-tabs">
              <button
                type="button"
                className={`ep-mode-btn${type === 'movie' ? ' active' : ''}`}
                onClick={() => setType('movie')}
                disabled={busy}
              >movie</button>
              <button
                type="button"
                className={`ep-mode-btn${type === 'show' ? ' active' : ''}`}
                onClick={() => setType('show')}
                disabled={busy}
              >tv show</button>
            </div>

            <input
              type="text"
              placeholder="TMDB ID  (optional — e.g. 27205)"
              value={tmdbId}
              onChange={e => setTmdbId(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />

            <input
              type="text"
              placeholder="title *"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={busy}
              autoComplete="off"
              autoFocus
            />

            <input
              type="text"
              placeholder="note  (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />

            {error && <p id="upload-error">{error}</p>}

            <div id="modal-actions">
              <button type="button" onClick={onClose} disabled={busy}>cancel</button>
              <button type="submit" id="upload-submit" disabled={busy}>
                {busy ? 'sending…' : 'suggest'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
