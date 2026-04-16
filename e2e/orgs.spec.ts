import { test, expect } from '@playwright/test'

// These tests assume that the apache org has already been explored (see apache-org.spec.ts).

test.describe('Orgs page', () => {
  test('renders at least one organisation', async ({ page }) => {
    await page.goto('/orgs')
    await expect(page.getByRole('heading', { name: /org/i })).toBeVisible()
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
  })

  test('each org row shows name and repo count', async ({ page }) => {
    await page.goto('/orgs')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    const firstRow = page.locator('tbody tr').first()
    // Row should contain non-empty text (org name + count)
    const text = await firstRow.textContent()
    expect(text?.trim().length).toBeGreaterThan(0)
  })

  test('clicking an org navigates to /orgs/:owner', async ({ page }) => {
    await page.goto('/orgs')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    // Org rows use onClick on <tr> directly — no inner button/link
    await page.locator('tbody tr').first().click()
    await expect(page).toHaveURL(/\/orgs\/[^/]+$/)
  })

  test('org detail page lists repos belonging to that org', async ({ page }) => {
    await page.goto('/orgs/apache')
    await expect(page).toHaveURL('/orgs/apache')
    await expect(page.getByRole('heading', { name: /apache/i })).toBeVisible()
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
  })

  test('clicking a repo in org detail navigates to its repository page', async ({ page }) => {
    await page.goto('/orgs/apache')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    // Repo rows use onClick on <tr> directly — no inner button/link
    await page.locator('tbody tr').first().click()
    await expect(page).toHaveURL(/\/repositories\/\d+/)
  })
})
