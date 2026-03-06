import { useState } from 'react'

export default function MovieLinkModal({ movie, onClose, onSuccess }) {
  const [megaUrl, setMegaUrl] = useState(movie.embed_url || '')
  const [status, setStatus]   = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const busy = status === 'saving'

  async function handleSave(e) {
    e.preventDefault()
    if (!megaUrl.trim()) return setErrorMsg('Paste a MEGA link or bare ID#key.')
    setStatus('saving')
    setErrorMsg('')
    try {
      const res  = await fetch(`/api/admin/movies/${movie.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ embed_url: megaUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      onSuccess(movie.id, data.movie.embed_url)
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  return (
    <div id="modal-backdrop" onClick={e => e.target.id === 'modal-backdrop' && !busy && onClose()}>
      <div id="upload-modal">
        <div id="modal-header">
          <span>{movie.title}</span>
          <button id="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <form id="upload-form" onSubmit={handleSave}>
          <input
            type="text"
            placeholder="https://mega.nz/file/… or ID#key"
            value={megaUrl}
            onChange={e => {
              const val = e.target.value
              const m = val.match(/mega\.nz\/(?:file|embed|#!)\/([^\s?]+)/)
              setMegaUrl(m ? m[1] : val)
            }}
            disabled={busy}
            autoFocus
            autoComplete="off"
          />

          {errorMsg && <p id="upload-error">{errorMsg}</p>}
          {busy && <p id="upload-status">saving…</p>}

          <div id="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>cancel</button>
            <button type="submit" id="upload-submit" disabled={busy}>
              {busy ? 'saving…' : 'save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
