import { useUploads } from '../UploadContext'

export default function UploadQueue() {
  const { uploads, dismiss } = useUploads()
  if (!uploads.length) return null

  return (
    <div id="upload-queue">
      {uploads.map(u => (
        <div key={u.id} className={`uq-item uq-${u.status}`}>
          <div className="uq-top">
            <span className="uq-label" title={u.label}>{u.label}</span>
            {u.status !== 'uploading' && (
              <button className="uq-dismiss" onClick={() => dismiss(u.id)}>✕</button>
            )}
          </div>

          {u.status === 'uploading' && (
            <div className="uq-bar-wrap">
              <div
                className={`uq-bar${u.progress === 'processing' ? ' indeterminate' : ''}`}
                style={u.progress !== 'processing' ? { width: `${u.progress}%` } : {}}
              />
            </div>
          )}

          <span className="uq-detail">
            {u.status === 'uploading' && (u.progress === 'processing' ? 'processing…' : `${u.progress}%`)}
            {u.status === 'done'  && 'done ✓'}
            {u.status === 'error' && `failed: ${u.error}`}
          </span>
        </div>
      ))}
    </div>
  )
}
