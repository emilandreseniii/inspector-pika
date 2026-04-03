import { describe, it, expect, vi } from 'vitest'
import { RailsRoutesExtractor } from '../railsRoutes'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): RailsRoutesExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Ruby', approach: 'rails_routes', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new RailsRoutesExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('RailsRoutesExtractor', () => {
  describe('resources', () => {
    it('generates full CRUD routes from resources', async () => {
      const extractor = makeExtractor({
        'config/routes.rb': `
Rails.application.routes.draw do
  resources :users
  resources :posts
end
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const endpoints = result.surfaces[0].endpoints

      // Users should have 7 CRUD routes
      const userEndpoints = endpoints.filter((e) => e.path.startsWith('/users'))
      expect(userEndpoints.length).toBeGreaterThanOrEqual(7)

      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users/:id')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'PUT' && e.path === '/users/:id')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'DELETE' && e.path === '/users/:id')).toBeDefined()
    })

    it('respects only: option', async () => {
      const extractor = makeExtractor({
        'config/routes.rb': `
Rails.application.routes.draw do
  resources :articles, only: [:index, :show, :create]
end
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints

      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/articles')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/articles/:id')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/articles')).toBeDefined()
      // Should not have PUT or DELETE
      expect(endpoints.find((e) => e.httpMethod === 'PUT')).toBeUndefined()
      expect(endpoints.find((e) => e.httpMethod === 'DELETE')).toBeUndefined()
    })
  })

  describe('namespace', () => {
    it('prefixes routes inside namespace', async () => {
      const extractor = makeExtractor({
        'config/routes.rb': `
Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      resources :users, only: [:index, :show]
    end
  end
end
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints

      expect(endpoints.find((e) => e.path === '/api/v1/users')).toBeDefined()
      expect(endpoints.find((e) => e.path === '/api/v1/users/:id')).toBeDefined()
    })
  })

  describe('explicit verb routes', () => {
    it('extracts get/post/put/delete routes', async () => {
      const extractor = makeExtractor({
        'config/routes.rb': `
Rails.application.routes.draw do
  get '/health', to: 'health#check'
  post '/login', to: 'sessions#create'
  delete '/logout', to: 'sessions#destroy'
  get '/users/:id/profile', to: 'users#profile'
end
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints

      expect(endpoints.find((e) => e.path === '/health' && e.httpMethod === 'GET')).toBeDefined()
      expect(endpoints.find((e) => e.path === '/login' && e.httpMethod === 'POST')).toBeDefined()
      expect(endpoints.find((e) => e.path === '/logout' && e.httpMethod === 'DELETE')).toBeDefined()

      const profile = endpoints.find((e) => e.path === '/users/:id/profile')
      expect(profile?.parameters.find((p) => p.name === 'id')).toBeDefined()
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'config/routes.rb': `
Rails.application.routes.draw do
  resources :users, only: [:index, :show]
  get '/health', to: 'health#check'
end
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(1)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
