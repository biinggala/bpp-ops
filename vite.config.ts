import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

// Build identifier baked into the bundle so the running version is visible in-app
const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'
const builtAt = new Date().toISOString().slice(0, 16).replace('T', ' ')

/**
 * The version the desktop shell checks itself against.
 *
 * The shell loads this deployment, so the deployment is already the thing that
 * knows what the current build is — no update server, no second place to bump.
 *
 * `downloads` is the same idea pointed the other way: at people using the web
 * who have no app yet. The installers cannot be linked on the release page —
 * that is behind the repository's login and most of the team has no GitHub
 * account — so the release workflow copies them into this deployment, which is
 * public, under fixed names. Fixed, so this file never carries a version in a
 * path and the previous release's file is simply replaced.
 */
const desktopVersion: Plugin = {
  name: 'desktop-version',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'desktop-version.json',
      source: JSON.stringify({
        version: pkg.version,
        url: 'https://github.com/biinggala/bpp-ops/releases/latest',
        downloads: {
          mac: '/downloads/bpp-ops.dmg',
          windows: '/downloads/bpp-ops-setup.exe',
        },
      }),
    })
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), desktopVersion],
  define: {
    __BUILD_ID__: JSON.stringify(`${sha} · ${builtAt} UTC`),
  },
})
