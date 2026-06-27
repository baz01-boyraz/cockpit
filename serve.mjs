/**
 * Static localhost server for the built renderer.
 *
 * The frontend-design workflow requires serving over http://localhost (never a
 * file:// URL). This serves the electron-vite renderer build (out/renderer) so
 * the React cockpit can be screenshotted exactly as it renders in the app — the
 * renderer falls back to its in-browser mock bridge when Electron isn't present.
 *
 * Usage:  npm run build   (produces out/renderer)
 *         node serve.mjs   ->  http://localhost:3000
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', 'out', 'renderer')
const port = Number(process.env.PORT ?? 3000)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

async function tryFile(path) {
  try {
    const s = await stat(path)
    if (s.isFile()) return path
  } catch {
    /* not found */
  }
  return null
}

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let rel = normalize(url).replace(/^(\.\.[/\\])+/, '')
    if (rel === '/' || rel === '\\') rel = '/index.html'

    let filePath = join(root, rel)
    // SPA-style fallback to index.html for unknown routes
    if (!(await tryFile(filePath))) filePath = join(root, 'index.html')

    const data = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(data)
  } catch (err) {
    res.writeHead(500)
    res.end(`server error: ${err instanceof Error ? err.message : String(err)}`)
  }
})

server.listen(port, () => {
  console.log(`▸ baz-cockpit renderer served at http://localhost:${port}`)
  console.log(`  (serving ${root})`)
  console.log(`  build first with:  npm run build`)
})
