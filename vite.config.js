import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isContent = process.env.BUILD_TARGET === 'content'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  build: {
    // Background clears dist first; content preserves it
    emptyOutDir: !isContent,
    outDir: 'dist',
    target: 'es2020',
    minify: false,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: isContent
        ? resolve(__dirname, 'src/content/content.js')
        : resolve(__dirname, 'src/background/background.js'),
      output: {
        entryFileNames: isContent ? 'content.js' : 'background.js',
        // IIFE: single self-contained bundle, no dynamic imports
        // This is required for MV3 — service workers can't use import()
        format: 'iife',
        name: isContent ? 'NoTweetContent' : 'NoTweetBG',
        inlineDynamicImports: true,
      },
    },
  },
})
