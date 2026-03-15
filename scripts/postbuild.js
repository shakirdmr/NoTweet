/**
 * Copies manifest.json and icons/ from public/ into dist/.
 * Runs automatically after `npm run build`.
 */
import { cpSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root    = resolve(__dirname, '..')
const distDir = resolve(root, 'dist')

mkdirSync(distDir, { recursive: true })

// Copy manifest.json
cpSync(
  resolve(root, 'public/manifest.json'),
  resolve(distDir, 'manifest.json')
)
console.log('✓ manifest.json → dist/')

// Copy icons directory
cpSync(
  resolve(root, 'public/icons'),
  resolve(distDir, 'icons'),
  { recursive: true }
)
console.log('✓ icons/ → dist/icons/')

// Copy NoTweet.png logo
cpSync(
  resolve(root, 'public/NoTweet.png'),
  resolve(distDir, 'NoTweet.png')
)
console.log('✓ NoTweet.png → dist/')

console.log('Build complete. Load the dist/ folder in chrome://extensions')
