import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App'
import { UploadProvider } from './UploadContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <UploadProvider>
      <App />
    </UploadProvider>
  </StrictMode>
)
