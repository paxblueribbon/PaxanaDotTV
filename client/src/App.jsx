import { useState, useEffect } from 'react'
import ChannelList from './components/ChannelList'
import Player from './components/Player'
import MediaGrid from './components/MediaGrid'
import ShowDetail from './components/ShowDetail'
import MegaPlayer from './components/MegaPlayer'
import UploadModal from './components/UploadModal'
import AddShowModal from './components/AddShowModal'
import AdminPanel from './components/AdminPanel'

export default function App() {
  const [user, setUser]             = useState(null)
  const [section, setSection]       = useState('movies')
  const [activeKey, setActiveKey]   = useState(null)
  const [activeMovie, setActiveMovie]   = useState(null)
  const [activeShow, setActiveShow]     = useState(null)
  const [activeEpisode, setActiveEpisode] = useState(null) // { ep, seasonNum }
  const [showUpload, setShowUpload]     = useState(false)
  const [showAddShow, setShowAddShow]   = useState(false)
  const [moviesRefreshKey, setMoviesRefreshKey] = useState(0)
  const [tvRefreshKey, setTvRefreshKey]         = useState(0)

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(data => setUser(data))
      .catch(() => {})
  }, [])

  const isAdmin  = user?.role === 'admin'
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

  function handleAddShowSuccess() {
    setShowAddShow(false)
    setTvRefreshKey(k => k + 1)
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
        isAdmin={isAdmin}
      />
    )
  } else if (section === 'live') {
    view = <ChannelList onWatch={setActiveKey} isAdmin={isAdmin} />
  } else if (section === 'admin') {
    view = user ? <AdminPanel user={user} /> : null
  } else if (section === 'movies') {
    view = <MediaGrid key={moviesRefreshKey} section="movies" dataKey="movies" onSelect={setActiveMovie} />
  } else {
    view = <MediaGrid key={tvRefreshKey} section="tv" dataKey="shows" onSelect={setActiveShow} />
  }

  return (
    <>
      <header>
        <span>Paxana</span>.TV
        {user && (
          <div id="header-user">
            <span id="header-username">{user.username}</span>
            <a href="/logout" id="header-logout">sign out</a>
          </div>
        )}
      </header>

      {!inDetail && (
        <nav id="section-nav">
          <button className={section === 'movies' ? 'active' : ''} onClick={() => setSection('movies')}>Movies</button>
          <button className={section === 'tv'     ? 'active' : ''} onClick={() => setSection('tv')}>TV</button>
          <button className={section === 'live'   ? 'active' : ''} onClick={() => setSection('live')}>Live</button>
          {isAdmin && (
            <button className={section === 'admin' ? 'active' : ''} onClick={() => setSection('admin')}>Admin</button>
          )}
        </nav>
      )}

      {view}

      {!inDetail && isAdmin && section === 'movies' && (
        <button id="upload-btn" onClick={() => setShowUpload(true)} title="Add movie">+</button>
      )}

      {!inDetail && isAdmin && section === 'tv' && (
        <button id="upload-btn" onClick={() => setShowAddShow(true)} title="Add show">+</button>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {showAddShow && (
        <AddShowModal
          onClose={() => setShowAddShow(false)}
          onSuccess={handleAddShowSuccess}
        />
      )}

      <footer>tune in. sit back. enjoy.</footer>
    </>
  )
}
