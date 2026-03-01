import { useState } from 'react'
import ChannelList from './components/ChannelList'
import Player from './components/Player'

export default function App() {
  const [activeKey, setActiveKey] = useState(null)

  return (
    <>
      <header><span>Paxana</span>.TV</header>

      {activeKey
        ? <Player channelKey={activeKey} onBack={() => setActiveKey(null)} />
        : <ChannelList onWatch={setActiveKey} />
      }

      <footer>tune in. sit back. enjoy.</footer>
    </>
  )
}
