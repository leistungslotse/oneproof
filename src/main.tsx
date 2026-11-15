import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const wurzel = document.getElementById('root')
if (!wurzel) throw new Error('Die Seite hat kein Element mit der ID „root“.')

createRoot(wurzel).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
