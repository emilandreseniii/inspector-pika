import { test, expect } from '@playwright/test'

test.describe('Search and pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
  })

  // ── Search ─────────────────────────────────────────────────────────────────

  test('filtering by org name shows only matching repos', async ({ page }) => {
    const searchBox = page.getByPlaceholder('Filter by org or org/repo…')
    await searchBox.fill('apache')

    // All visible rows should contain "apache"
    const rows = page.locator('tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = await rows.nth(i).textContent()
      expect(text?.toLowerCase()).toContain('apache')
    }
  })

  test('filtering by org/repo shows only matching repos', async ({ page }) => {
    const searchBox = page.getByPlaceholder('Filter by org or org/repo…')
    await searchBox.fill('apache/kafka')
    await expect(page.getByRole('button', { name: 'apache/kafka', exact: true })).toBeVisible()
    // Should be a very small result set
    const count = await page.locator('tbody tr').count()
    expect(count).toBeLessThan(10)
  })

  test('org name suggestions appear when typing', async ({ page }) => {
    const searchBox = page.getByPlaceholder('Filter by org or org/repo…')
    await searchBox.fill('apa')
    // Suggestions should appear — look for the suggestions dropdown
    await expect(page.getByText('apache', { exact: true })).toBeVisible({ timeout: 3000 })
  })

  test('clearing the search restores all results', async ({ page }) => {
    const searchBox = page.getByPlaceholder('Filter by org or org/repo…')
    const initialCount = await page.locator('tbody tr').count()

    await searchBox.fill('apache/kafka')
    const filteredCount = await page.locator('tbody tr').count()
    expect(filteredCount).toBeLessThan(initialCount)

    await searchBox.fill('')
    const restoredCount = await page.locator('tbody tr').count()
    expect(restoredCount).toBe(initialCount)
  })

  test('no results message appears for a query that matches nothing', async ({ page }) => {
    await page.getByPlaceholder('Filter by org or org/repo…').fill('zzz-no-match-xyz')
    await expect(page.getByText(/no repositories match/i)).toBeVisible()
    await expect(page.locator('tbody')).not.toBeVisible()
  })

  // ── Pagination ─────────────────────────────────────────────────────────────

  test('first page shows exactly PAGE_SIZE (25) rows', async ({ page }) => {
    // With 3000+ apache repos in DB, unfiltered list should have exactly 25 rows per page
    const count = await page.locator('tbody tr').count()
    expect(count).toBe(25)
  })

  test('next page button shows a different set of repos', async ({ page }) => {
    const firstPageFirst = await page.locator('tbody tr').first().textContent()

    // Find and click the next-page button
    await page.getByRole('button', { name: 'Next →', exact: true }).click()

    const secondPageFirst = await page.locator('tbody tr').first().textContent()
    expect(secondPageFirst).not.toBe(firstPageFirst)
  })

  test('previous page button returns to first page', async ({ page }) => {
    const firstPageFirst = await page.locator('tbody tr').first().textContent()

    await page.getByRole('button', { name: 'Next →', exact: true }).click()
    await page.getByRole('button', { name: '← Prev', exact: true }).click()

    const backToFirst = await page.locator('tbody tr').first().textContent()
    expect(backToFirst).toBe(firstPageFirst)
  })

  test('changing the search resets to page 1', async ({ page }) => {
    // Go to page 2
    await page.getByRole('button', { name: 'Next →', exact: true }).click()
    const page2First = await page.locator('tbody tr').first().textContent()

    // Type in search box — should snap back to page 1 (different repos)
    await page.getByPlaceholder('Filter by org or org/repo…').fill('apache')
    const afterSearchFirst = await page.locator('tbody tr').first().textContent()
    expect(afterSearchFirst).not.toBe(page2First)
  })
})
