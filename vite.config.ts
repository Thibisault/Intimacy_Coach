import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠️ nom EXACT de ton repo GitHub
const BASE = '/Intimacy_Coach/'

export default defineConfig({
  base: BASE,
  build: { outDir: 'docs' }, // on sort le build dans /docs pour Pages
  plugins: [react()],
})
