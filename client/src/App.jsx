import { useState, useEffect } from 'react'
import ChannelList from './components/ChannelList'
import Player from './components/Player'
import MediaGrid from './components/MediaGrid'
import ShowDetail from './components/ShowDetail'
import MegaPlayer from './components/MegaPlayer'
import UploadModal from './components/UploadModal'
import AddShowModal from './components/AddShowModal'
import AdminPanel from './components/AdminPanel'
import RecommendModal from './components/RecommendModal'
import SearchBar from './components/SearchBar'
import UploadQueue from './components/UploadQueue'

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
  const [showRecommend, setShowRecommend]       = useState(false)
  const [tagFilter, setTagFilter]               = useState(null) // { tag, section }

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(data => setUser(data))
      .catch(() => {})
  }, [])

  const isAdmin  = user?.role === 'admin'
  const inDetail = activeKey || activeMovie || activeShow || activeEpisode

  function handleTagClick(tag, targetSection) {
    setActiveMovie(null)
    setActiveShow(null)
    setActiveEpisode(null)
    setActiveKey(null)
    setSection(targetSection)
    setTagFilter({ tag, section: targetSection })
  }

  function handleSearchMovie(movie) {
    setActiveShow(null); setActiveEpisode(null); setActiveKey(null)
    setActiveMovie(movie)
  }

  function handleSearchShow(show) {
    setActiveMovie(null); setActiveEpisode(null); setActiveKey(null)
    setActiveShow(show)
  }

  function handleSearchChannel(key) {
    setActiveMovie(null); setActiveShow(null); setActiveEpisode(null)
    setSection('live')
    setActiveKey(key)
  }

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

  function handleEpisodeDeleted(episodeId) {
    setActiveShow(show => ({
      ...show,
      seasons: show.seasons.map(s => ({
        ...s,
        episodes: s.episodes.filter(ep => ep.id !== episodeId),
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
        tags={activeMovie.tags}
        onTagClick={tag => handleTagClick(tag, 'movies')}
      />
    )
  } else if (activeEpisode) {
    view = (
      <MegaPlayer
        title={activeShow.title}
        subtitle={`S${activeEpisode.seasonNum} E${activeEpisode.ep.episode_number} · ${activeEpisode.ep.episode_title}`}
        embedUrl={activeEpisode.ep.embed_url}
        onBack={() => setActiveEpisode(null)}
        tags={activeShow.tags}
        onTagClick={tag => handleTagClick(tag, 'tv')}
      />
    )
  } else if (activeShow) {
    view = (
      <ShowDetail
        show={activeShow}
        onSelect={handleEpisodeSelect}
        onBack={() => setActiveShow(null)}
        onEpisodeUpdated={handleEpisodeUpdated}
        onEpisodeDeleted={handleEpisodeDeleted}
        isAdmin={isAdmin}
        onTagClick={tag => handleTagClick(tag, 'tv')}
      />
    )
  } else if (section === 'live') {
    view = <ChannelList onWatch={setActiveKey} isAdmin={isAdmin} />
  } else if (section === 'admin') {
    view = user ? <AdminPanel user={user} /> : null
  } else if (section === 'movies') {
    view = (
      <MediaGrid
        key={moviesRefreshKey}
        section="movies" dataKey="movies"
        onSelect={setActiveMovie}
        tagFilter={tagFilter?.section === 'movies' ? tagFilter.tag : null}
        onClearTag={() => setTagFilter(null)}
        onTagClick={tag => setTagFilter({ tag, section: 'movies' })}
        isAdmin={isAdmin}
      />
    )
  } else {
    view = (
      <MediaGrid
        key={tvRefreshKey}
        section="tv" dataKey="shows"
        onSelect={setActiveShow}
        tagFilter={tagFilter?.section === 'tv' ? tagFilter.tag : null}
        onClearTag={() => setTagFilter(null)}
        onTagClick={tag => setTagFilter({ tag, section: 'tv' })}
      />
    )
  }

  return (
    <>
      <header>
        <span id="site-title">Paxana<span className="tv-suffix">.TV</span></span>
        <SearchBar
          refreshKey={moviesRefreshKey + tvRefreshKey}
          onSelectMovie={handleSearchMovie}
          onSelectShow={handleSearchShow}
          onSelectChannel={handleSearchChannel}
          onSelectTag={handleTagClick}
        />
        {user && (
          <div id="header-user">
            <span id="header-username">{user.username}</span>
            <a href="/logout" id="header-logout">sign out</a>
          </div>
        )}
      </header>

      {!inDetail && (
        <nav id="section-nav">
          <button className={section === 'movies' ? 'active' : ''} onClick={() => { setSection('movies'); setTagFilter(null) }}>Movies</button>
          <button className={section === 'tv'     ? 'active' : ''} onClick={() => { setSection('tv');     setTagFilter(null) }}>TV</button>
          <button className={section === 'live'   ? 'active' : ''} onClick={() => { setSection('live');   setTagFilter(null) }}>Live</button>
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

      {!inDetail && !isAdmin && (section === 'movies' || section === 'tv') && (
        <button id="suggest-btn" onClick={() => setShowRecommend(true)}>suggest a title</button>
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

      {showRecommend && (
        <RecommendModal onClose={() => setShowRecommend(false)} />
      )}

      <UploadQueue />
    </>
  )
}
