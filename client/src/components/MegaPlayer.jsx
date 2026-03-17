function buildEmbedUrl(raw) {
  const s = raw.trim()
  // Normalize any full Mega URL (file, embed, legacy #!) to an embed URL.
  // A bare ID#key is passed through directly.
  const match = s.match(/mega\.nz\/(?:file|embed|#!)\/([^\s?]+)/)
  return `https://mega.nz/embed/${match ? match[1] : s}`
}

export default function MegaPlayer({ title, subtitle, embedUrl, onBack, tags, onTagClick }) {
  return (
    <div id="mega-player-view">
      <button id="back-btn" onClick={onBack}>← back</button>
      <div id="mega-stage">
        <iframe
          src={buildEmbedUrl(embedUrl)}
          title={title}
          allowFullScreen
          allow="autoplay"
          frameBorder="0"
        />
      </div>
      <div id="mega-meta">
        <span id="mega-title">{title}</span>
        <span id="mega-sub">{subtitle}</span>
        {tags && tags.length > 0 && (
          <div className="media-tags">
            {tags.map(tag => (
              <button key={tag} className="media-tag" onClick={() => onTagClick?.(tag)}>{tag}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
