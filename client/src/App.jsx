import { useState } from 'react'
import ChannelList from './components/ChannelList'
import Player from './components/Player'
import MediaGrid from './components/MediaGrid'
import ShowDetail from './components/ShowDetail'
import MegaPlayer from './components/MegaPlayer'
import UploadModal from './components/UploadModal'

export default function App() {
  const [section, setSection] = useState('movies')
  const [activeKey, setActiveKey] = useState(null)
  const [activeMovie, setActiveMovie] = useState(null)
  const [activeShow, setActiveShow] = useState(null)
  const [activeEpisode, setActiveEpisode] = useState(null) // { ep, seasonNum }
  const [showUpload, setShowUpload] = useState(false)
  const [moviesRefreshKey, setMoviesRefreshKey] = useState(0)

  const inDetail = activeKey || activeMovie || activeShow || activeEpisode

  function handleEpisodeSelect(ep, seasonNum) {
    setActiveEpisode({ ep, seasonNum })
  }

  function handleEpisodeUpdated(episodeId, embedUrl) {
    setActiveShow(show => ({
      ...show,
      seasons: show.seasons.map(s => ({
        ...s,
        episodes: s.episodes.map(ep =>
          ep.id === episodeId ? { ...ep, embed_url: embedUrl } : ep
        ),
      })),
    }))
  }

  function handleUploadSuccess() {
    setShowUpload(false)
    setMoviesRefreshKey(k => k + 1)
  }

  let view
  if (activeKey) {
    view = <Player channelKey={activeKey} onBack={() => setActiveKey(null)} />
  } else if (activeMovie) {
    view = (
      <MegaPlayer
        title={activeMovie.title}
        subtitle={`${activeMovie.director} · ${activeMovie.release_year} · ${activeMovie.genre}`}
        embedUrl={activeMovie.embed_url}
        onBack={() => setActiveMovie(null)}
      />
    )
  } else if (activeEpisode) {
    view = (
      <MegaPlayer
        title={activeShow.title}
        subtitle={`S${activeEpisode.seasonNum} E${activeEpisode.ep.episode_number} · ${activeEpisode.ep.episode_title}`}
        embedUrl={activeEpisode.ep.embed_url}
        onBack={() => setActiveEpisode(null)}
      />
    )
  } else if (activeShow) {
    view = (
      <ShowDetail
        show={activeShow}
        onSelect={handleEpisodeSelect}
        onBack={() => setActiveShow(null)}
        onEpisodeUpdated={handleEpisodeUpdated}
      />
    )
  } else if (section === 'live') {
    view = <ChannelList onWatch={setActiveKey} />
  } else if (section === 'movies') {
    view = <MediaGrid key={moviesRefreshKey} section="movies" dataKey="movies" onSelect={setActiveMovie} />
  } else {
    view = <MediaGrid section="tv" dataKey="shows" onSelect={setActiveShow} />
  }

  return (
    <>
      <header><span>Paxana</span>.TV</header>

      {!inDetail && (
        <nav id="section-nav">
          <button className={section === 'movies' ? 'active' : ''} onClick={() => setSection('movies')}>Movies</button>
          <button className={section === 'tv'     ? 'active' : ''} onClick={() => setSection('tv')}>TV</button>
          <button className={section === 'live'   ? 'active' : ''} onClick={() => setSection('live')}>Live</button>
        </nav>
      )}

      {view}

      {!inDetail && section === 'movies' && (
        <button id="upload-btn" onClick={() => setShowUpload(true)} title="Add movie">+</button>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      <footer>tune in. sit back. enjoy.</footer>
    </>
  )
}
