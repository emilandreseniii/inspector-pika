import { test, expect } from '@playwright/test'

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
  })

  test('renders the storage limits form with pre-populated values', async ({ page }) => {
    // Labels are not for-linked; select by type and position
    const maxDiskField = page.locator('input[type="number"]').first()
    const intervalField = page.locator('input[type="number"]').nth(1)
    await expect(maxDiskField).toBeVisible()
    await expect(intervalField).toBeVisible()
    // Fields should have numeric values already
    const maxDisk = await maxDiskField.inputValue()
    expect(Number(maxDisk)).toBeGreaterThan(0)
  })

  test('Save button updates disk settings', async ({ page }) => {
    const field = page.locator('input[type="number"]').first()
    const original = await field.inputValue()

    // Change to a new value and save
    const newValue = String(Number(original) + 1)
    await field.fill(newValue)
    await page.getByRole('button', { name: /save settings/i }).click()

    // Wait for save confirmation before asserting
    await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5_000 })
    await expect(field).toHaveValue(newValue)

    // Restore original
    await field.fill(original)
    await page.getByRole('button', { name: /save settings/i }).click()
    await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5_000 })
  })

  test('Disk Usage section is visible', async ({ page }) => {
    await expect(page.getByText(/disk usage/i)).toBeVisible()
  })

  test('Disk cache table or empty state is shown', async ({ page }) => {
    // Either a table of cloned repos or an "empty" message is acceptable
    const tableOrEmpty = page.locator('table').or(page.getByText(/no tracked entries/i))
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 })
  })
})
