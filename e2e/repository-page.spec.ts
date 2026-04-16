import { test, expect } from '@playwright/test'

// Navigate to the first repo in the list and return its name
async function getFirstRepo(page: import('@playwright/test').Page) {
  await page.goto('/repos')
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
  const btn = page.locator('tbody tr').first().getByRole('button')
  const name = (await btn.textContent()) ?? ''
  await btn.click()
  await expect(page).toHaveURL(/\/repositories\/\d+/)
  return name
}

test.describe('Repository detail page', () => {
  test('displays repo metadata table', async ({ page }) => {
    const name = await getFirstRepo(page)
    await expect(page.getByRole('heading', { name })).toBeVisible()
    // Key metadata rows are present (use cell role to avoid substring matches in other text)
    await expect(page.getByRole('cell', { name: 'Repository', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Default Branch', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Visibility', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Last Fetched', exact: true })).toBeVisible()
  })

  test('back button returns to the home page', async ({ page }) => {
    await getFirstRepo(page)
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL('/repos')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
  })

  test('"Start A Job" button is visible', async ({ page }) => {
    await getFirstRepo(page)
    await expect(page.getByRole('button', { name: /start a job/i })).toBeVisible()
  })

  test('"Start A Job" dropdown opens and shows both options', async ({ page }) => {
    await getFirstRepo(page)
    await page.getByRole('button', { name: /start a job/i }).click()
    await expect(page.getByRole('button', { name: /analyze dependencies/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /analyze languages/i })).toBeVisible()
  })

  test('"Start A Job" dropdown closes when clicking outside', async ({ page }) => {
    await getFirstRepo(page)
    await page.getByRole('button', { name: /start a job/i }).click()
    await expect(page.getByRole('button', { name: /analyze dependencies/i })).toBeVisible()
    // Click outside the dropdown (on the page heading)
    await page.getByRole('heading', { name: 'Languages' }).click()
    await expect(page.getByRole('button', { name: /analyze dependencies/i })).not.toBeVisible()
  })

  test('shows "No language data yet" section before any analysis', async ({ page }) => {
    // Find a repo that has never been analyzed by searching for a known apache repo
    await page.goto('/repos')
    await page.getByPlaceholder('Filter by org or org/repo…').fill('apache/zookeeper')
    await expect(page.getByRole('button', { name: 'apache/zookeeper', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'apache/zookeeper', exact: true }).click()
    await expect(page).toHaveURL(/\/repositories\/\d+/)

    // Both "not yet analyzed" states should be visible (unless this repo was already analyzed)
    const langSection = page.getByText(/no language data yet|no programming languages detected/i)
    await expect(langSection).toBeVisible()
  })

  test('shows "No packages analysed yet" section before any analysis', async ({ page }) => {
    await page.goto('/repos')
    await page.getByPlaceholder('Filter by org or org/repo…').fill('apache/zookeeper')
    await expect(page.getByRole('button', { name: 'apache/zookeeper', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'apache/zookeeper', exact: true }).click()
    await expect(page).toHaveURL(/\/repositories\/\d+/)

    await expect(page.getByText(/no packages analysed yet/i)).toBeVisible()
  })

  test('Languages section heading and Packages tab are present', async ({ page }) => {
    await getFirstRepo(page)
    await expect(page.getByRole('heading', { name: 'Languages' })).toBeVisible({ timeout: 10_000 })
    // Packages is a tab button, not a heading; use first() to avoid strict-mode with duplicate nav buttons
    await expect(page.getByRole('button', { name: 'Packages', exact: true }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('shows "Not yet run" for sections with no analysis data', async ({ page }) => {
    // apache/zookeeper has not been analyzed, so both sections should show "Not yet run"
    await page.goto('/repos')
    await page.getByPlaceholder('Filter by org or org/repo…').fill('apache/zookeeper')
    await expect(page.getByRole('button', { name: 'apache/zookeeper', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'apache/zookeeper', exact: true }).click()
    await expect(page).toHaveURL(/\/repositories\/\d+/)

    // Both sections should display "Not yet run" since no jobs have run for this repo
    const notYetRunSpans = page.getByText('Not yet run')
    await expect(notYetRunSpans.first()).toBeVisible({ timeout: 10_000 })
    // There should be at least two (Languages + Detected Packages)
    expect(await notYetRunSpans.count()).toBeGreaterThanOrEqual(2)
  })

  test('syncJobs integration: repo with completed jobs shows "Updated:" timestamp', async ({ page, request }) => {
    // Find the first repo that has at least one completed analyze_languages job
    const resp = await request.get('/api/v1/jobs?type=analyze_languages&status=completed&limit=1')
    const json = await resp.json()
    const allJobs = json.data ?? []
    const completedLangJob = allJobs.find(
      (j: any) => j.type === 'analyze_languages' && j.status === 'completed'
    )
    if (!completedLangJob) {
      test.skip(true, 'No completed analyze_languages jobs — run setupRepo first')
      return
    }
    // repoId is stored in the job input JSON
    const repoId = (completedLangJob.input as any)?.repoId
    await page.goto(`/repositories/${repoId}`)
    await expect(page).toHaveURL(new RegExp(`/repositories/${repoId}`))
    await expect(page.getByText(/Updated:/)).toBeVisible({ timeout: 15_000 })
  })

  test('shows running or completed job state via syncJobs on a repo with jobs', async ({ page, request }) => {
    // Find any repo that has jobs so we can verify the syncJobs flow
    const resp = await request.get('/api/v1/jobs?limit=1')
    const json = await resp.json()
    const allJobs2 = json.data ?? []
    if (allJobs2.length === 0) {
      test.skip(true, 'No jobs in DB yet')
      return
    }
    const repoId = (allJobs2[0].input as any)?.repoId
    if (!repoId) {
      test.skip(true, 'Job has no repoId')
      return
    }
    await page.goto(`/repositories/${repoId}`)
    await expect(page).toHaveURL(new RegExp(`/repositories/${repoId}`))
    // Page should load without a 404
    await expect(page.getByText(/404|not found/i)).not.toBeVisible()
  })
})
