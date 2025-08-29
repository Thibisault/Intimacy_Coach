import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerSW } from 'virtual:pwa-register'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)

// Register PWA service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', import.meta.url)).catch(()=>{})
  })
}


const updateSW = registerSW({ immediate: true })
