import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles/global.css'
import './styles/components.css'
import './styles/dashboard.css'
import './styles/notepad.css'
import './styles/swarm.css'
import './styles/hermes.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
