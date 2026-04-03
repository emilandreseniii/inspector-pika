import { describe, it, expect, vi } from 'vitest'
import { GrapeExtractor } from '../grape'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): GrapeExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Ruby', approach: 'grape', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GrapeExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      content.split('\n').forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text })
      })
    }
    return hits
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('GrapeExtractor', () => {
  it('extracts routes from a Grape API class', async () => {
    const extractor = makeExtractor({
      'api/v1/users_api.rb': `
module API
  module V1
    class UsersAPI < Grape::API
      format :json
      prefix :api

      namespace :users do
        get do
          User.all
        end

        post do
          User.create(params)
        end

        namespace ':id' do
          get do
            User.find(params[:id])
          end

          put do
            User.find(params[:id]).update(params)
          end

          delete do
            User.find(params[:id]).destroy
          end
        end
      end
    end
  end
end
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.length).toBeGreaterThanOrEqual(2)
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path.includes('/users'))).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path.includes('/users'))).toBeDefined()
  })

  it('handles all HTTP methods', async () => {
    const extractor = makeExtractor({
      'api.rb': `
class API < Grape::API
  get '/a' do; end
  post '/b' do; end
  put '/c' do; end
  patch '/d' do; end
  delete '/e' do; end
end
`,
    })

    const result = await extractor.extract()
    const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('PUT')
    expect(methods).toContain('PATCH')
    expect(methods).toContain('DELETE')
  })

  it('extracts :param path parameters', async () => {
    const extractor = makeExtractor({
      'api.rb': `
class UsersAPI < Grape::API
  namespace :users do
    namespace ':id' do
      get do; end
    end
  end
end
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters.find((p) => p.name === 'id')).toBeDefined()
  })
})
