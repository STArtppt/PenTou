import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'
import { pentouServerPlugin } from './vite-plugins/pentouServerPlugin'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    pentouServerPlugin(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    // Pre-compress static assets at build time; the prod Node server
    // negotiates by Accept-Encoding (see docker-deploy architecture §7).
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
    viteCompression({ algorithm: 'gzip', ext: '.gz' }),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        // Standalone login entry — must stay React/MUI-free; see PRD US-02 AC8.
        login: path.resolve(__dirname, 'login.html'),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
          if (id.includes('/motion/') || id.includes('/framer-motion/')) return 'motion'
          if (id.includes('/react-markdown/') || id.includes('/remark-') || id.includes('/micromark') || id.includes('/mdast-') || id.includes('/unified/') || id.includes('/unist-')) return 'markdown'
          if (id.includes('/react-dnd') || id.includes('/dnd-core/')) return 'dnd'
          if (id.includes('/lucide-react/')) return 'icons'
        },
      },
    },
  },
})
