import { test, expect } from '@playwright/test'

// Active sub-tab: border-bottom-color is #fd8c73 → rgb(253, 140, 115)
// Inactive sub-tab: border-bottom-color is transparent → rgba(0, 0, 0, 0)
const ACTIVE_COLOR = 'rgb(253, 140, 115)'
const INACTIVE_COLOR = 'rgba(0, 0, 0, 0)'

test.describe('Navigation', () => {
  test('loads the home page with Explore tab active', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Inspector Pika').first()).toBeVisible()
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
    await expect(page).toHaveURL('/repos')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
  })

  test('unknown route redirects to home', async ({ page }) => {
    await page.goto('/does-not-exist')
    await expect(page).toHaveURL('/repos')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
  })
})

test.describe('Sub-tab underline behaviour', () => {
  test('Repos sub-tab is underlined on /repos, others are not', async ({ page }) => {
    await page.goto('/repos')
    await expect(page.getByRole('button', { name: 'Repos' })).toHaveCSS('border-bottom-color', ACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Orgs' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Packages' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
  })

  test('Orgs sub-tab is underlined on /orgs, others are not', async ({ page }) => {
    await page.goto('/orgs')
    await expect(page.getByRole('button', { name: 'Orgs' })).toHaveCSS('border-bottom-color', ACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Repos' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Packages' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
  })

  test('Packages sub-tab is underlined on /packages, others are not', async ({ page }) => {
    await page.goto('/packages')
    await expect(page.getByRole('button', { name: 'Packages' })).toHaveCSS('border-bottom-color', ACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Repos' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Orgs' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
  })

  test('switching from Repos to Orgs removes Repos underline', async ({ page }) => {
    await page.goto('/repos')
    await page.getByRole('button', { name: 'Orgs' }).click()
    await expect(page).toHaveURL('/orgs')
    await expect(page.getByRole('button', { name: 'Orgs' })).toHaveCSS('border-bottom-color', ACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Repos' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
  })

  test('switching from Orgs to Packages removes Orgs underline', async ({ page }) => {
    await page.goto('/orgs')
    await page.getByRole('button', { name: 'Packages' }).click()
    await expect(page).toHaveURL('/packages')
    await expect(page.getByRole('button', { name: 'Packages' })).toHaveCSS('border-bottom-color', ACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Orgs' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
  })

  test('switching from Packages to Repos removes Packages underline', async ({ page }) => {
    await page.goto('/packages')
    await page.getByRole('button', { name: 'Repos' }).click()
    await expect(page).toHaveURL('/repos')
    await expect(page.getByRole('button', { name: 'Repos' })).toHaveCSS('border-bottom-color', ACTIVE_COLOR)
    await expect(page.getByRole('button', { name: 'Packages' })).toHaveCSS('border-bottom-color', INACTIVE_COLOR)
  })
})
