import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import './styles.css'
import './app.css'
import './motion.css'
import { AmbientScene, PlaygroundScene } from './scenes'

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <AmbientScene />
      <PlaygroundScene />
    </BrowserRouter>
  </StrictMode>
)
