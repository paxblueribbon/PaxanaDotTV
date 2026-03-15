import { useState, useRef } from 'react'
import { useUploads } from '../UploadContext'

const FIELDS = [
  { name: 'title',      label: 'title',       type: 'text',   required: true  },
  { name: 'director',   label: 'director',    type: 'text',   required: false },
  { name: 'year',       label: 'year',        type: 'number', required: false },
  { name: 'genre',      label: 'genre',       type: 'text',   required: false },
  { name: 'poster_url', label: 'poster url',  type: 'url',    required: false },
]

export default function UploadModal({ onClose, onSuccess }) {
  const { startUpload } = useUploads()

  const [mode, setMode]         = useState('upload') // 'upload' | 'url'
  const [fields, setFields]     = useState({ title: '', director: '', year: '', genre: '', poster_url: '' })
  const [file, setFile]         = useState(null)
  const [megaUrl, setMegaUrl]   = useState('')
  const [status, setStatus]     = useState('idle') // idle | looking-up | saving | error
  const [errorMsg, setErrorMsg] = useState('')
  const [tmdbId, setTmdbId]     = useState('')
  const fileRef = useRef()

  const busy = status === 'saving'

  function handleField(e) {
    setFields(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleTmdbLookup() {
    const id = tmdbId.trim()
    if (!id) return setErrorMsg('Enter a TMDB movie ID first.')
    setStatus('looking-up')
    setErrorMsg('')
    try {
      const res  = await fetch(`/api/tmdb/movie/${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'TMDB lookup failed')
      setFields(f => ({
        title:      data.title      || f.title,
        director:   data.director   || f.director,
        year:       data.year       || f.year,
        genre:      data.genre      || f.genre,
        poster_url: data.poster_url || f.poster_url,
      }))
      setStatus('idle')
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  async function handleSubmitUrl(e) {
    e.preventDefault()
    if (!megaUrl.trim())      return setErrorMsg('Paste a MEGA link or bare ID#key.')
    if (!fields.title.trim()) return setErrorMsg('Title is required.')
    setStatus('saving')
    setErrorMsg('')
    try {
      const res  = await fetch('/api/movies/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, embed_url: megaUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      onSuccess(data.movie)
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  function handleSubmitFile(e) {
    e.preventDefault()
    if (!file)                return setErrorMsg('Select a video file first.')
    if (!fields.title.trim()) return setErrorMsg('Title is required.')

    const body = new FormData()
    body.append('file', file)
    Object.entries(fields).forEach(([k, v]) => body.append(k, v))

    startUpload({
      label:     fields.title || file.name,
      url:       '/api/movies',
      body,
      onSuccess: data => onSuccess(data.movie),
    })
    onClose()
  }

  return (
    <div id="modal-backdrop" onClick={e => e.target.id === 'modal-backdrop' && !busy && onClose()}>
      <div id="upload-modal">
        <div id="modal-header">
          <span>add movie</span>
          <button id="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div id="ep-mode-tabs">
          <button
            className={`ep-mode-btn${mode === 'url'    ? ' active' : ''}`}
            onClick={() => { setMode('url');    setErrorMsg('') }}
            disabled={busy}
          >mega link / id</button>
          <button
            className={`ep-mode-btn${mode === 'upload' ? ' active' : ''}`}
            onClick={() => { setMode('upload'); setErrorMsg('') }}
            disabled={busy}
          >upload file</button>
        </div>

        <form id="upload-form" onSubmit={mode === 'url' ? handleSubmitUrl : handleSubmitFile}>
          {mode === 'url' && (
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
              autoComplete="off"
            />
          )}

          {mode === 'upload' && (
            <label id="file-label" className={file ? 'has-file' : ''}>
              <input
                ref={fileRef}
                type="file"
                accept="video/*,.mkv"
                onChange={e => setFile(e.target.files[0] || null)}
                disabled={busy}
              />
              {file ? file.name : 'choose video file'}
            </label>
          )}

          <div className="tmdb-row">
            <input
              type="text"
              placeholder="TMDB movie ID  (e.g. 27205)"
              value={tmdbId}
              onChange={e => setTmdbId(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
            <button
              type="button"
              className="tmdb-lookup-btn"
              onClick={handleTmdbLookup}
              disabled={busy || status === 'looking-up'}
            >
              {status === 'looking-up' ? '…' : 'lookup'}
            </button>
          </div>

          {FIELDS.map(f => (
            <input
              key={f.name}
              name={f.name}
              type={f.type}
              placeholder={f.label + (f.required ? ' *' : '')}
              value={fields[f.name]}
              onChange={handleField}
              disabled={busy}
              autoComplete="off"
            />
          ))}

          {errorMsg && <p id="upload-error">{errorMsg}</p>}

          {busy && mode === 'url' && (
            <p id="upload-status">saving…</p>
          )}

          <div id="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>cancel</button>
            <button type="submit" id="upload-submit" disabled={busy}>
              {busy ? 'saving…' : (mode === 'upload' ? 'upload' : 'save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
