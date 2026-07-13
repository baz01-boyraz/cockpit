import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles/global.css'
import './styles/components.css'
import './styles/usage.css'
import './styles/scorecard.css'
import './styles/chat.css'
import './styles/terminals.css'
import './styles/git.css'
import './styles/memory.css'
import './styles/dashboard.css'
import './styles/notepad.css'
import './styles/swarm.css'
import './styles/council-view.css'
import './styles/council-verdict.css'
import './styles/audit.css'
import './styles/sentinel.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
