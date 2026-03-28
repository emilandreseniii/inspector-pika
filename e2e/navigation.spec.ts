import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('loads the home page with Explore tab active', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Inspector Pika' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Explore' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Jobs' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
  })

  test('switches to Jobs tab', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Jobs' }).click()
    await expect(page).toHaveURL('/jobs')
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Start a Job' })).toBeVisible()
  })

  test('switches back to Explore tab', async ({ page }) => {
    await page.goto('/jobs')
    await page.getByRole('button', { name: 'Explore' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
  })

  test('unknown route redirects to home', async ({ page }) => {
    await page.goto('/does-not-exist')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
  })
})
