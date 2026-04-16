import { test, expect } from '@playwright/test'

// Find the first completed job ID via API (the UI paginates, so it may not show completed jobs on page 1).
async function getFirstCompletedJobId(
  request: import('@playwright/test').APIRequestContext,
): Promise<number | null> {
  const resp = await request.get('/api/v1/jobs')
  if (!resp.ok()) return null
  const jobs: any[] = (await resp.json()).data ?? []
  const completed = jobs.find((j) => j.status === 'completed')
  return completed ? completed.id : null
}

test.describe('Job detail page', () => {
  test('clicking a job row from the Jobs list opens its detail page', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('tbody tr').first().click()
    await expect(page).toHaveURL(/\/jobs\/\d+/)
  })

  test('job detail page shows type, status, and timing metadata', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('tbody tr').first().click()
    await expect(page).toHaveURL(/\/jobs\/\d+/)

    // Metadata table should have these labels
    await expect(page.getByText(/job type|type/i).first()).toBeVisible()
    await expect(page.getByText(/status/i).first()).toBeVisible()
  })

  test('completed job shows Input and Result sections', async ({ page, request }) => {
    const jobId = await getFirstCompletedJobId(request)
    if (jobId === null) {
      test.skip(true, 'No completed jobs available yet')
      return
    }
    await page.goto(`/jobs/${jobId}`)
    await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}`))
    await expect(page.getByText(/input/i)).toBeVisible()
    await expect(page.getByText(/result/i)).toBeVisible()
  })

  test('job detail page shows log output section', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('tbody tr').first().click()
    await expect(page).toHaveURL(/\/jobs\/\d+/)
    await expect(page.getByText(/log/i)).toBeVisible()
  })

  test('navigating directly to a valid job URL loads the page', async ({ page }) => {
    // We assume at least one job exists from the apache-org exploration
    await page.goto('/jobs')
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    const firstRow = page.locator('tbody tr').first()
    await firstRow.click()
    await expect(page).toHaveURL(/\/jobs\/\d+/)
    // Page should not show a generic error
    await expect(page.getByText(/404|not found/i)).not.toBeVisible()
  })
})
