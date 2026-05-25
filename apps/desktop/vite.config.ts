import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors into their own chunks so the WebView can parse them
        // independently (and so lazy-loaded views — DependencyGraph, Settings,
        // detail markdown — pull their vendor weight only when first opened).
        // See #263 / .tiki/research/desktop-performance.md.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@xyflow') || id.includes('dagre')) return 'graph'
          if (id.includes('@xterm')) return 'xterm'
          if (
            id.includes('react-markdown') ||
            id.includes('rehype-highlight') ||
            id.includes('highlight.js') ||
            id.includes('remark-gfm') ||
            id.includes('hast') ||
            id.includes('mdast') ||
            id.includes('micromark') ||
            id.includes('unist')
          ) {
            return 'markdown'
          }
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('@dnd-kit')) return 'dnd'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
})
