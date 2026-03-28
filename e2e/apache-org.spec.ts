import { test, expect } from '@playwright/test'

// Apache has hundreds of repos — the global 10-min timeout covers this.
// We only need a generous per-assertion timeout for the "completed" badge.
const COMPLETED_TIMEOUT = 8 * 60 * 1000

test.describe('Apache Organization Explorer', () => {
  test('submits an org job for apache and waits for completion', async ({ page }) => {
    // ── 1. Open the Jobs tab ──────────────────────────────────────────────────
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible()

    // ── 2. Open the Start-a-Job modal ─────────────────────────────────────────
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await expect(page.getByRole('heading', { name: 'Start a Job' })).toBeVisible()

    // ── 3. Select "Explore GitHub Organization" ───────────────────────────────
    await page.getByText('Explore GitHub Organization').click()
    await expect(page.getByPlaceholder('e.g. vercel')).toBeVisible()

    // ── 4. Enter "apache" and submit ──────────────────────────────────────────
    await page.getByPlaceholder('e.g. vercel').fill('apache')
    await page.getByRole('button', { name: 'Start Job' }).click()

    // Modal should close after successful job creation
    await expect(page.getByRole('heading', { name: 'Start a Job' })).not.toBeVisible({ timeout: 10_000 })

    // ── 5. Job row appears in the table (newest job is first row) ───────────────
    await expect(page.locator('tbody tr').first().getByRole('cell', { name: 'Explore org: apache' })).toBeVisible()

    // ── 6. Wait for the job to reach "completed" ──────────────────────────────
    // Jobs are sorted newest-first; our new job is the first row
    const newestRow = page.locator('tbody tr').first()
    await expect(newestRow.getByText('completed')).toBeVisible({ timeout: COMPLETED_TIMEOUT })

    // No "failed" badge on that row
    await expect(newestRow.getByText('failed')).not.toBeVisible()
  })

  test('apache repos appear on the Explore tab after the job completes', async ({ page }) => {
    // ── 1. Ensure a completed apache org job exists ───────────────────────────
    await page.goto('/jobs')
    const completedApacheJobs = page.locator('tr', { has: page.getByText('Explore org: apache') })
      .filter({ hasText: 'completed' })
    const alreadyDone = await completedApacheJobs.count()

    if (alreadyDone === 0) {
      await page.getByRole('button', { name: '+ Start a Job' }).click()
      await page.getByText('Explore GitHub Organization').click()
      await page.getByPlaceholder('e.g. vercel').fill('apache')
      await page.getByRole('button', { name: 'Start Job' }).click()
      await expect(page.getByRole('heading', { name: 'Start a Job' })).not.toBeVisible({ timeout: 10_000 })
      // Wait for the newest (first) row to complete
      await expect(page.locator('tbody tr').first().getByText('completed')).toBeVisible({ timeout: COMPLETED_TIMEOUT })
    }

    // ── 2. Navigate to Explore tab ────────────────────────────────────────────
    await page.getByRole('button', { name: 'Explore' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()

    // ── 3. Repos table is populated ───────────────────────────────────────────
    await expect(page.locator('table')).toBeVisible()
    await expect(page.locator('tbody tr').first()).toBeVisible()
    const rowCount = await page.locator('tbody tr').count()
    expect(rowCount).toBeGreaterThan(0)

    // ── 4. Well-known Apache repos are present (use search to find them) ────────
    const searchBox = page.getByPlaceholder('Filter by org or org/repo…')
    for (const repo of ['apache/kafka', 'apache/spark', 'apache/hadoop']) {
      await searchBox.fill(repo)
      await expect(page.getByRole('button', { name: repo, exact: true })).toBeVisible()
    }
    await searchBox.fill('')

    // ── 5. Spot-check providers are all "github" (first 20 rows) ─────────────
    const providerCells = page.locator('tbody tr td:nth-child(2)')
    const count = await providerCells.count()
    for (let i = 0; i < Math.min(count, 20); i++) {
      await expect(providerCells.nth(i)).toHaveText('github')
    }
  })

  test('clicking an apache repo opens its detail page', async ({ page }) => {
    // ── 1. Go to the Explore tab ──────────────────────────────────────────────
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()

    // ── 2. Wait for at least one repo row ─────────────────────────────────────
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })

    // ── 3. Click the first repo link ──────────────────────────────────────────
    const firstBtn = page.locator('tbody tr').first().getByRole('button')
    const repoName = await firstBtn.textContent()
    await firstBtn.click()

    // ── 4. Detail page loads with repo info ───────────────────────────────────
    await expect(page).toHaveURL(/\/repositories\/\d+/)
    await expect(page.getByRole('heading', { name: repoName! })).toBeVisible()
    await expect(page.getByRole('button', { name: /back/i })).toBeVisible()

    // ── 5. Back button returns to Explore tab ─────────────────────────────────
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL('/')
  })
})
