/**
 * Puppeteer screenshot helper for the localhost visual-review workflow.
 *
 * Usage:
 *   node screenshot.mjs                         -> shoots http://localhost:3000
 *   node screenshot.mjs http://localhost:3000 dashboard
 *   node screenshot.mjs http://localhost:3000 git --click=[data-nav=git]
 *
 * Screenshots auto-increment into ./temporary screenshots/ and are never
 * overwritten. Paths are project-local (adapted from the Windows-specific
 * reference) so this runs the same on macOS/Linux.
 */
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const root = join(fileURLToPath(import.meta.url), '..')
const outDir = join(root, 'temporary screenshots')

const args = process.argv.slice(2)
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:3000'
const label = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? ''
const clickArg = args.find((a) => a.startsWith('--click='))?.slice('--click='.length)
const waitArg = Number(args.find((a) => a.startsWith('--wait='))?.slice('--wait='.length) ?? 1400)

async function nextIndex() {
  await mkdir(outDir, { recursive: true })
  const files = await readdir(outDir).catch(() => [])
  const nums = files
    .map((f) => /^screenshot-(\d+)/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
  return (nums.length ? Math.max(...nums) : 0) + 1
}

const run = async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1512, height: 945, deviceScaleFactor: 2 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise((r) => setTimeout(r, waitArg))

    if (clickArg) {
      await page.click(clickArg).catch((e) => console.warn(`click(${clickArg}) failed: ${e.message}`))
      await new Promise((r) => setTimeout(r, 900))
    }

    const idx = await nextIndex()
    const name = label ? `screenshot-${idx}-${label}.png` : `screenshot-${idx}.png`
    const file = join(outDir, name)
    await page.screenshot({ path: file })
    console.log(`✓ saved ${join('temporary screenshots', name)}  (${url}${label ? ` · ${label}` : ''})`)
  } finally {
    await browser.close()
  }
}

run().catch((err) => {
  console.error('screenshot failed:', err.message)
  process.exit(1)
})
