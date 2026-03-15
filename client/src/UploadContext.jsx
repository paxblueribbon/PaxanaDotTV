import { createContext, useContext, useState, useRef } from 'react'

const Ctx = createContext(null)

function xhrUpload(url, body, onProgress, onServerReceived) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.upload.onload = () => onServerReceived()
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300) resolve(data)
        else reject(new Error(data.error || 'Upload failed'))
      } catch { reject(new Error('Upload failed')) }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(body)
  })
}

export function UploadProvider({ children }) {
  const [uploads, setUploads] = useState([])
  const nextId = useRef(1)

  function startUpload({ label, url, body, onSuccess }) {
    const id = nextId.current++
    const update = patch =>
      setUploads(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u))

    setUploads(prev => [...prev, { id, label, progress: 0, status: 'uploading', error: null }])

    xhrUpload(
      url,
      body,
      pct => update({ progress: pct }),
      ()  => update({ progress: 'mega' }),
    ).then(data => {
      update({ status: 'done' })
      onSuccess?.(data)
    }).catch(err => {
      update({ status: 'error', error: err.message })
    })
  }

  function dismiss(id) {
    setUploads(prev => prev.filter(u => u.id !== id))
  }

  return (
    <Ctx.Provider value={{ uploads, startUpload, dismiss }}>
      {children}
    </Ctx.Provider>
  )
}

export function useUploads() {
  return useContext(Ctx)
}
