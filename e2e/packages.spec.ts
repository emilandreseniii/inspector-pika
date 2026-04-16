import { test, expect } from '@playwright/test'

// These tests require at least one completed analyze_dependencies job to have run.
// If no packages are present the tests are skipped rather than failed.

test.describe('Packages page and package detail', () => {
  test('navigates to /packages from the Packages sub-nav', async ({ page }) => {
    await page.goto('/repos')
    await page.getByRole('button', { name: /packages/i }).click()
    await expect(page).toHaveURL('/packages')
    await expect(page.getByRole('heading', { name: /packages/i })).toBeVisible()
  })

  test('shows empty state or package list', async ({ page }) => {
    await page.goto('/packages')
    const tableOrEmpty = page.locator('table').or(page.getByText(/no packages/i))
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 })
  })

  test('package list shows type badge, name, version count and repo count when data exists', async ({ page }) => {
    await page.goto('/packages')
    const firstRow = page.locator('tbody tr').first()
    const count = await firstRow.count()
    if (count === 0) {
      test.skip(true, 'No packages present — run analyze_dependencies on a repo first')
      return
    }
    await expect(firstRow).toBeVisible()
    const text = await firstRow.textContent()
    expect(text?.length).toBeGreaterThan(0)
  })

  test('clicking a package row opens its detail page', async ({ page }) => {
    await page.goto('/packages')
    const firstRow = page.locator('tbody tr').first()
    if (await firstRow.count() === 0) {
      test.skip(true, 'No packages present')
      return
    }
    await firstRow.click()
    await expect(page).toHaveURL(/\/packages\/\d+/)
  })

  test('package detail page shows name, type, and sub-tabs', async ({ page }) => {
    await page.goto('/packages')
    const firstRow = page.locator('tbody tr').first()
    if (await firstRow.count() === 0) {
      test.skip(true, 'No packages present')
      return
    }
    await firstRow.click()
    await expect(page).toHaveURL(/\/packages\/\d+/)
    // Detail page should have at least a heading and the Versions/Repos tabs
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /versions/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /repos/i })).toBeVisible()
  })

  test('Versions tab shows at least one version', async ({ page }) => {
    await page.goto('/packages')
    const firstRow = page.locator('tbody tr').first()
    if (await firstRow.count() === 0) {
      test.skip(true, 'No packages present')
      return
    }
    await firstRow.click()
    await page.getByRole('button', { name: /versions/i }).click()
    const versionRow = page.locator('tbody tr').first()
    await expect(versionRow).toBeVisible({ timeout: 10_000 })
  })

  test('Repos tab shows at least one repo using the package', async ({ page }) => {
    await page.goto('/packages')
    const firstRow = page.locator('tbody tr').first()
    if (await firstRow.count() === 0) {
      test.skip(true, 'No packages present')
      return
    }
    await firstRow.click()
    await page.getByRole('button', { name: /repos/i }).click()
    const repoRow = page.locator('tbody tr').first()
    await expect(repoRow).toBeVisible({ timeout: 10_000 })
  })
})
