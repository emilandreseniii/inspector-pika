import { test, expect } from '@playwright/test'

test.describe('Start Job modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible()
  })

  // ── Opening and closing ────────────────────────────────────────────────────

  test('opens when "+ Start a Job" is clicked', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await expect(page.getByRole('heading', { name: 'Start a Job' })).toBeVisible()
  })

  test('shows both job type options', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await expect(page.getByText('Explore GitHub Repository')).toBeVisible()
    await expect(page.getByText('Explore GitHub Organization')).toBeVisible()
  })

  test('closes when the ✕ button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByRole('button', { name: '✕' }).click()
    await expect(page.getByRole('heading', { name: 'Start a Job' })).not.toBeVisible()
  })

  test('closes when the Cancel button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Repository').click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Start a Job' })).not.toBeVisible()
  })

  test('closes when clicking outside the modal overlay', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await expect(page.getByRole('heading', { name: 'Start a Job' })).toBeVisible()
    // Click the semi-transparent overlay (top-left corner, outside the modal box)
    await page.mouse.click(5, 5)
    await expect(page.getByRole('heading', { name: 'Start a Job' })).not.toBeVisible()
  })

  // ── Explore GitHub Repository flow ─────────────────────────────────────────

  test('Explore GitHub Repository: shows correct input placeholder', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Repository').click()
    await expect(page.getByPlaceholder('e.g. facebook/react')).toBeVisible()
  })

  test('Explore GitHub Repository: Submit is disabled when input is empty', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Repository').click()
    await expect(page.getByRole('button', { name: 'Start Job' })).toBeDisabled()
  })

  test('Explore GitHub Repository: Submit is enabled after typing', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Repository').click()
    await page.getByPlaceholder('e.g. facebook/react').fill('owner/repo')
    await expect(page.getByRole('button', { name: 'Start Job' })).toBeEnabled()
  })

  test('Explore GitHub Repository: invalid format shows validation error', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Repository').click()
    await page.getByPlaceholder('e.g. facebook/react').fill('noslash')
    await page.getByRole('button', { name: 'Start Job' }).click()
    await expect(page.getByText(/must be in owner\/repo format/i)).toBeVisible()
  })

  test('Explore GitHub Repository: back button returns to type selection', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Repository').click()
    await expect(page.getByPlaceholder('e.g. facebook/react')).toBeVisible()
    await page.getByRole('button', { name: /← back/i }).click()
    await expect(page.getByText('Explore GitHub Repository')).toBeVisible()
    await expect(page.getByText('Explore GitHub Organization')).toBeVisible()
  })

  // ── Explore GitHub Organization flow ───────────────────────────────────────

  test('Explore GitHub Organization: shows correct input placeholder', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Organization').click()
    await expect(page.getByPlaceholder('e.g. vercel')).toBeVisible()
  })

  test('Explore GitHub Organization: Submit is disabled when input is empty', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Organization').click()
    await expect(page.getByRole('button', { name: 'Start Job' })).toBeDisabled()
  })

  test('Explore GitHub Organization: back button returns to type selection', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Organization').click()
    await page.getByRole('button', { name: /← back/i }).click()
    await expect(page.getByText('Explore GitHub Repository')).toBeVisible()
  })

  // ── Successful submission ──────────────────────────────────────────────────

  test('submitting a valid repo closes the modal and adds a job row', async ({ page }) => {
    await page.getByRole('button', { name: '+ Start a Job' }).click()
    await page.getByText('Explore GitHub Repository').click()
    await page.getByPlaceholder('e.g. facebook/react').fill('anthropics/anthropic-sdk-python')
    await page.getByRole('button', { name: 'Start Job' }).click()
    await expect(page.getByRole('heading', { name: 'Start a Job' })).not.toBeVisible({ timeout: 10_000 })
    await expect(page.locator('tbody tr').first()).toBeVisible()
  })
})
