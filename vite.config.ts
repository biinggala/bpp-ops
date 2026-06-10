import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build identifier baked into the bundle so the running version is visible in-app
const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'
const builtAt = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_ID__: JSON.stringify(`${sha} · ${builtAt} UTC`),
  },
})
