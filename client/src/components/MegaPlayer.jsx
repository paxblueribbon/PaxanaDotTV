function buildEmbedUrl(raw) {
  const s = raw.trim()
  if (s.startsWith('https://')) return s
  return `https://mega.nz/embed/${s}`
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
