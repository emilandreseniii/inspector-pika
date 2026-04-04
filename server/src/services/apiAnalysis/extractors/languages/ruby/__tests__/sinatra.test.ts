import { describe, it, expect, vi } from 'vitest'
import { SinatraExtractor } from '../sinatra'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SinatraExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Ruby', approach: 'sinatra', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SinatraExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      const lines = content.split('\n')
      lines.forEach((text, i) => {
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

describe('SinatraExtractor', () => {
  it('extracts routes from modular Sinatra::Base subclass', async () => {
    const extractor = makeExtractor({
      'app.rb': `
require 'sinatra/base'

class MyApp < Sinatra::Base
  get '/users' do
    json User.all
  end

  get '/users/:id' do
    json User.find(params[:id])
  end

  post '/users' do
    user = User.create(params)
    json user
  end

  delete '/users/:id' do
    User.find(params[:id]).destroy
  end
end
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.name).toBe('MyApp')
    expect(surface.endpoints).toHaveLength(4)

    const [list, show, create, destroy] = surface.endpoints
    expect(list).toMatchObject({ httpMethod: 'GET', path: '/users' })
    expect(show).toMatchObject({ httpMethod: 'GET', path: '/users/:id' })
    expect(show.parameters).toEqual([{ name: 'id', location: 'path', required: true }])
    expect(create).toMatchObject({ httpMethod: 'POST', path: '/users' })
    expect(destroy).toMatchObject({ httpMethod: 'DELETE', path: '/users/:id' })
  })

  it('extracts routes from classic (top-level DSL) style', async () => {
    const extractor = makeExtractor({
      'app.rb': `
require 'sinatra'

get '/hello' do
  'Hello World!'
end

post '/hello' do
  "Hello #{params[:name]}!"
end

get '/items/:category/:id' do
  "Item #{params[:id]} in #{params[:category]}"
end
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(3)
    expect(eps[0]).toMatchObject({ httpMethod: 'GET', path: '/hello' })
    expect(eps[1]).toMatchObject({ httpMethod: 'POST', path: '/hello' })
    expect(eps[2]).toMatchObject({ httpMethod: 'GET', path: '/items/:category/:id' })
    expect(eps[2].parameters).toHaveLength(2)
    expect(eps[2].parameters[0]).toMatchObject({ name: 'category', location: 'path' })
    expect(eps[2].parameters[1]).toMatchObject({ name: 'id', location: 'path' })
  })

  it('returns empty surfaces when no Sinatra routes found', async () => {
    const extractor = makeExtractor({
      'helper.rb': `
module ApplicationHelper
  def format_date(date)
    date.strftime('%Y-%m-%d')
  end
end
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
