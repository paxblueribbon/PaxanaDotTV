import { useState, useRef } from 'react'

export default function EpisodeUploadModal({ episode, onClose, onSuccess }) {
  const [mode, setMode]       = useState('url')   // 'url' | 'upload'
  const [megaUrl, setMegaUrl] = useState('')
  const [file, setFile]       = useState(null)
  const [status, setStatus]   = useState('idle')  // idle | saving | error
  const [errorMsg, setErrorMsg] = useState('')
  const fileRef = useRef()

  const busy     = status === 'saving'
  const epLabel  = `S${episode.season} E${episode.episode_number}${episode.episode_title ? ' · ' + episode.episode_title : ''}`

  async function handleSetUrl(e) {
    e.preventDefault()
    if (!megaUrl.trim()) return setErrorMsg('Paste a MEGA link or bare ID#key.')
    setStatus('saving')
    setErrorMsg('')
    try {
      const res  = await fetch(`/api/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embed_url: megaUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      onSuccess(episode.id, data.episode.embed_url)
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) return setErrorMsg('Select a video file first.')
    setStatus('saving')
    setErrorMsg('')
    const body = new FormData()
    body.append('file', file)
    try {
      const res  = await fetch(`/api/episodes/${episode.id}/upload`, { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onSuccess(episode.id, data.episode.embed_url)
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  return (
    <div id="modal-backdrop" onClick={e => e.target.id === 'modal-backdrop' && !busy && onClose()}>
      <div id="upload-modal">
        <div id="modal-header">
          <span>{epLabel}</span>
          <button id="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div id="ep-mode-tabs">
          <button className={`ep-mode-btn${mode === 'url'    ? ' active' : ''}`} onClick={() => { setMode('url');    setErrorMsg('') }} disabled={busy}>mega link / id</button>
          <button className={`ep-mode-btn${mode === 'upload' ? ' active' : ''}`} onClick={() => { setMode('upload'); setErrorMsg('') }} disabled={busy}>upload file</button>
        </div>

        <form id="upload-form" onSubmit={mode === 'url' ? handleSetUrl : handleUpload}>
          {mode === 'url' ? (
            <input
              type="text"
              placeholder="https://mega.nz/file/… or ID#key"
              value={megaUrl}
              onChange={e => setMegaUrl(e.target.value)}
              disabled={busy}
              autoFocus
              autoComplete="off"
            />
          ) : (
            <label id="file-label" className={file ? 'has-file' : ''}>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                onChange={e => setFile(e.target.files[0] || null)}
                disabled={busy}
              />
              {file ? file.name : 'choose video file'}
            </label>
          )}

          {errorMsg && <p id="upload-error">{errorMsg}</p>}
          {busy && (
            <p id="upload-status">
              {mode === 'upload' ? 'uploading to MEGA — this may take a while for large files…' : 'saving…'}
            </p>
          )}

          <div id="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>cancel</button>
            <button type="submit" id="upload-submit" disabled={busy}>
              {busy
                ? (mode === 'upload' ? 'uploading…' : 'saving…')
                : (mode === 'upload' ? 'upload' : 'save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
