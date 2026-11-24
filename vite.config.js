import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Installable PWA with an offline app shell, so the khata opens with no internet.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Khata AI',
        short_name: 'Khata AI',
        description: 'A private, offline-first credit ledger (khata) for small shops, with hybrid on-device + cloud AI.',
        theme_color: '#146c43',
        background_color: '#f6f2ea',
        display: 'standalone',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
  ],
})
