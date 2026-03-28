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
})
