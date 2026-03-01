import { useState, useRef } from 'react'

const FIELDS = [
  { name: 'title',      label: 'title',       type: 'text',   required: true  },
  { name: 'director',   label: 'director',    type: 'text',   required: false },
  { name: 'year',       label: 'year',        type: 'number', required: false },
  { name: 'genre',      label: 'genre',       type: 'text',   required: false },
  { name: 'poster_url', label: 'poster url',  type: 'url',    required: false },
]

export default function UploadModal({ onClose, onSuccess }) {
  const [fields, setFields]   = useState({ title: '', director: '', year: '', genre: '', poster_url: '' })
  const [file, setFile]       = useState(null)
  const [status, setStatus]   = useState('idle') // idle | uploading | error
  const [errorMsg, setErrorMsg] = useState('')
  const fileRef = useRef()

  function handleField(e) {
    setFields(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file)           return setErrorMsg('Select a video file first.')
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
    <div id="modal-backdrop" onClick={e => e.target.id === 'modal-backdrop' && onClose()}>
      <div id="upload-modal">
        <div id="modal-header">
          <span>add movie</span>
          <button id="modal-close" onClick={onClose} disabled={status === 'uploading'}>✕</button>
        </div>

        <form id="upload-form" onSubmit={handleSubmit}>
          <label id="file-label" className={file ? 'has-file' : ''}>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              onChange={e => setFile(e.target.files[0] || null)}
              disabled={status === 'uploading'}
            />
            {file ? file.name : 'choose video file'}
          </label>

          {FIELDS.map(f => (
            <input
              key={f.name}
              name={f.name}
              type={f.type}
              placeholder={f.label + (f.required ? ' *' : '')}
              value={fields[f.name]}
              onChange={handleField}
              disabled={status === 'uploading'}
              autoComplete="off"
            />
          ))}

          {errorMsg && <p id="upload-error">{errorMsg}</p>}

          {status === 'uploading' && (
            <p id="upload-status">uploading to MEGA — this may take a while for large files…</p>
          )}

          <div id="modal-actions">
            <button type="button" onClick={onClose} disabled={status === 'uploading'}>cancel</button>
            <button type="submit" id="upload-submit" disabled={status === 'uploading'}>
              {status === 'uploading' ? 'uploading…' : 'upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
