export default function MegaPlayer({ item, onBack }) {
  const embedUrl = `https://mega.nz/embed/${item.embed_url}`

  return (
    <div id="mega-player-view">
      <button id="back-btn" onClick={onBack}>← back</button>
      <div id="mega-stage">
        <iframe
          src={embedUrl}
          title={item.title}
          allowFullScreen
          allow="autoplay"
          frameBorder="0"
        />
      </div>
      <div id="mega-meta">
        <span id="mega-title">{item.title}</span>
        <span id="mega-sub">{item.director} · {item.release_year} · {item.genre}</span>
      </div>
    </div>
  )
}
