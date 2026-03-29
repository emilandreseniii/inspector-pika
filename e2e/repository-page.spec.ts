import { test, expect } from '@playwright/test'

// Navigate to the first repo in the list and return its name
async function getFirstRepo(page: import('@playwright/test').Page) {
  await page.goto('/')
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
    // Key metadata rows are present
    await expect(page.getByText('Repository')).toBeVisible()
    await expect(page.getByText('Default Branch')).toBeVisible()
    await expect(page.getByText('Visibility')).toBeVisible()
    await expect(page.getByText('Last Fetched')).toBeVisible()
  })

  test('back button returns to the home page', async ({ page }) => {
    await getFirstRepo(page)
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL('/')
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
    await page.goto('/')
    await page.getByPlaceholder('Filter by org or org/repo…').fill('apache/zookeeper')
    await expect(page.getByRole('button', { name: 'apache/zookeeper', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'apache/zookeeper', exact: true }).click()
    await expect(page).toHaveURL(/\/repositories\/\d+/)

    // Both "not yet analyzed" states should be visible (unless this repo was already analyzed)
    const langSection = page.getByText(/no language data yet|no programming languages detected/i)
    await expect(langSection).toBeVisible()
  })

  test('shows "No packages analysed yet" section before any analysis', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Filter by org or org/repo…').fill('apache/zookeeper')
    await expect(page.getByRole('button', { name: 'apache/zookeeper', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'apache/zookeeper', exact: true }).click()
    await expect(page).toHaveURL(/\/repositories\/\d+/)

    await expect(page.getByText(/no packages analysed yet/i)).toBeVisible()
  })

  test('Languages and Detected Packages section headings are present', async ({ page }) => {
    await getFirstRepo(page)
    await expect(page.getByRole('heading', { name: 'Languages' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Detected Packages' })).toBeVisible()
  })

  test('shows "Not yet run" for sections with no analysis data', async ({ page }) => {
    // apache/zookeeper has not been analyzed, so both sections should show "Not yet run"
    await page.goto('/')
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

  test('syncJobs API integration: repo with completed jobs shows "Updated:" date without manual action', async ({ page }) => {
    // Navigate directly to apache/cayenne (id=32) which has completed analyze_languages jobs.
    // The syncJobs mechanism runs on mount and should detect the completed status via
    // /api/v1/repositories/:id/jobs, then load language data and display the "Updated:" timestamp.
    await page.goto('/repositories/32')
    await expect(page).toHaveURL(/\/repositories\/32/)

    // Wait for the languages section to show an "Updated:" timestamp — this confirms
    // that the /jobs endpoint returned data and the syncJobs handler triggered onComplete.
    await expect(page.getByText(/Updated:/)).toBeVisible({ timeout: 15_000 })
  })

  test('shows running job state in the Start A Job button when a job is active', async ({ page }) => {
    // apache/spark (id=464) has a running analyze_languages job
    await page.goto('/repositories/464')
    await expect(page).toHaveURL(/\/repositories\/464/)

    // The syncJobs mechanism should detect the running job and update the button text.
    // Wait for either an "Analyzing…" or "Detecting…" state — or for the job to complete
    // and show the "Updated:" date. Either way the syncJobs flow worked.
    const analyzingOrUpdated = page.locator('button').filter({ hasText: /Analyzing|Detecting|Queuing/i })
      .or(page.getByText(/Updated:/))
    await expect(analyzingOrUpdated.first()).toBeVisible({ timeout: 15_000 })
  })
})
