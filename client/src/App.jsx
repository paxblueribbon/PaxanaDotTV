import { useState } from 'react'
import ChannelList from './components/ChannelList'
import Player from './components/Player'
import MediaGrid from './components/MediaGrid'
import MegaPlayer from './components/MegaPlayer'

export default function App() {
  const [activeKey, setActiveKey] = useState(null)
  const [section, setSection] = useState('live')
  const [activeMedia, setActiveMedia] = useState(null)

  const inPlayer = activeKey || activeMedia

  return (
    <>
      <header><span>Paxana</span>.TV</header>

      {!inPlayer && (
        <nav id="section-nav">
          <button className={section === 'live' ? 'active' : ''} onClick={() => setSection('live')}>Live</button>
          <button className={section === 'movies' ? 'active' : ''} onClick={() => setSection('movies')}>Movies</button>
          <button className={section === 'tv' ? 'active' : ''} onClick={() => setSection('tv')}>TV</button>
        </nav>
      )}

      {activeKey
        ? <Player channelKey={activeKey} onBack={() => setActiveKey(null)} />
        : activeMedia
          ? <MegaPlayer item={activeMedia} onBack={() => setActiveMedia(null)} />
          : section === 'live'
            ? <ChannelList onWatch={setActiveKey} />
            : <MediaGrid section={section} onSelect={setActiveMedia} />
      }

      <footer>tune in. sit back. enjoy.</footer>
    </>
  )
}
