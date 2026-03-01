import { useState } from 'react'

export default function AddShowModal({ onClose, onSuccess }) {
  const [tmdbId, setTmdbId]     = useState('')
  const [status, setStatus]     = useState('idle')   // idle | adding | error
  const [errorMsg, setErrorMsg] = useState('')

  const busy = status === 'adding'

  async function handleSubmit(e) {
    e.preventDefault()
    const id = tmdbId.trim()
    if (!id) return setErrorMsg('Enter a TMDB show ID.')
    setStatus('adding')
    setErrorMsg('')
    try {
      const res  = await fetch('/api/shows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdb_id: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add show')
      onSuccess(data.show)
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  return (
    <div id="modal-backdrop" onClick={e => e.target.id === 'modal-backdrop' && !busy && onClose()}>
      <div id="upload-modal">
        <div id="modal-header">
          <span>add show</span>
          <button id="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <form id="upload-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="TMDB show ID  (e.g. 1399)"
            value={tmdbId}
            onChange={e => setTmdbId(e.target.value)}
            disabled={busy}
            autoFocus
            autoComplete="off"
          />

          {errorMsg && <p id="upload-error">{errorMsg}</p>}
          {busy && <p id="upload-status">fetching from TMDB and building episode list…</p>}

          <div id="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>cancel</button>
            <button type="submit" id="upload-submit" disabled={busy}>
              {busy ? 'adding…' : 'add show'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
