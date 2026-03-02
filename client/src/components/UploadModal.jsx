import { useState, useRef } from 'react'

const FIELDS = [
  { name: 'title',      label: 'title',       type: 'text',   required: true  },
  { name: 'director',   label: 'director',    type: 'text',   required: false },
  { name: 'year',       label: 'year',        type: 'number', required: false },
  { name: 'genre',      label: 'genre',       type: 'text',   required: false },
  { name: 'poster_url', label: 'poster url',  type: 'url',    required: false },
]

export default function UploadModal({ onClose, onSuccess }) {
  const [fields, setFields]     = useState({ title: '', director: '', year: '', genre: '', poster_url: '' })
  const [file, setFile]         = useState(null)
  const [status, setStatus]     = useState('idle') // idle | looking-up | uploading | error
  const [errorMsg, setErrorMsg] = useState('')
  const [tmdbId, setTmdbId]     = useState('')
  const fileRef = useRef()

  const busy = status === 'uploading'

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

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file)                return setErrorMsg('Select a video file first.')
    if (!fields.title.trim()) return setErrorMsg('Title is required.')

    setStatus('uploading')
    setErrorMsg('')

    const body = new FormData()
    body.append('file', file)
    Object.entries(fields).forEach(([k, v]) => body.append(k, v))

    try {
      const res  = await fetch('/api/movies', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onSuccess(data.movie)
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  return (
    <div id="modal-backdrop" onClick={e => e.target.id === 'modal-backdrop' && !busy && onClose()}>
      <div id="upload-modal">
        <div id="modal-header">
          <span>add movie</span>
          <button id="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <form id="upload-form" onSubmit={handleSubmit}>
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

          {status === 'uploading' && (
            <p id="upload-status">uploading to MEGA — this may take a while for large files…</p>
          )}

          <div id="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>cancel</button>
            <button type="submit" id="upload-submit" disabled={busy}>
              {busy ? 'uploading…' : 'upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
