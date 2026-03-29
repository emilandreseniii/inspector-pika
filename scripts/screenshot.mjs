import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = 'http://localhost:5173'

const datetime = new Date().toISOString().replace(/:/g, '-').slice(0, 19)
const outDir = path.join(__dirname, '..', 'docs', 'screenshots', datetime)
fs.mkdirSync(outDir, { recursive: true })

const pages = [
  { name: '01-home-repo-list',       url: '/',                    waitFor: 'tbody tr',                title: 'Home – Repository List' },
  { name: '02-jobs-list',            url: '/jobs',                waitFor: 'table',                   title: 'Jobs List' },
  { name: '03-repo-cayenne',         url: '/repositories/32',     waitFor: '.content, main, #root',   title: 'Repository: apache/cayenne (languages + entities)' },
  { name: '04-repo-guacamole',       url: '/repositories/750',    waitFor: '.content, main, #root',   title: 'Repository: apache/guacamole-client (packages + entities)' },
  { name: '05-repo-syncope',         url: '/repositories/550',    waitFor: '.content, main, #root',   title: 'Repository: apache/syncope (92 entities)' },
  { name: '06-repo-zookeeper',       url: '/repositories/1',      waitFor: '.content, main, #root',   title: 'Repository: apache/zookeeper (not yet analyzed)' },
  { name: '07-job-running',          url: '/jobs/55',             waitFor: 'table',                   title: 'Job Detail: Running (analyze_dependencies apache/spark)' },
  { name: '08-job-failed',           url: '/jobs/48',             waitFor: 'table',                   title: 'Job Detail: Failed (analyze_dependencies apache/guacamole-client)' },
  { name: '09-job-completed-org',    url: '/jobs/54',             waitFor: 'table',                   title: 'Job Detail: Completed (explore_github_org apache)' },
  { name: '10-job-completed-deps',   url: '/jobs/49',             waitFor: 'table',                   title: 'Job Detail: Completed (analyze_dependencies apache/guacamole-client)' },
]

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

const results = []

for (const p of pages) {
  const page = await context.newPage()
  try {
    console.log(`Capturing: ${p.name}  →  ${p.url}`)
    await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'networkidle', timeout: 20000 })
    // Extra settle time for data to load
    await page.waitForTimeout(2500)
    const file = `${p.name}.png`
    await page.screenshot({ path: path.join(outDir, file), fullPage: true })
    results.push({ ...p, file })
    console.log(`  ✓ saved ${file}`)
  } catch (err) {
    console.error(`  ✗ ${p.name}: ${err.message}`)
  }
  await page.close()
}

await browser.close()

// Write results manifest for the calling process to use
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ datetime, pages: results }, null, 2))
console.log(`\nDone. ${results.length} screenshots in docs/screenshots/${datetime}/`)
