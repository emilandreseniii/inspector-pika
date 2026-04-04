import { describe, it, expect, vi } from 'vitest'
import { PlugRouterExtractor } from '../plugRouter'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): PlugRouterExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Elixir', approach: 'plug_router', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new PlugRouterExtractor(ctx)
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

describe('PlugRouterExtractor', () => {
  it('extracts routes from Plug.Router module', async () => {
    const extractor = makeExtractor({
      'lib/myapp/router.ex': `
defmodule MyApp.Router do
  use Plug.Router

  plug :match
  plug :dispatch

  get "/users" do
    send_resp(conn, 200, Jason.encode!(list_users()))
  end

  get "/users/:id" do
    send_resp(conn, 200, get_user(id))
  end

  post "/users" do
    send_resp(conn, 201, "Created")
  end

  match _, do: send_resp(conn, 404, "Not found")
end
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')
    expect(postUsers).toBeDefined()

    const getUserById = surface.endpoints.find((e) => e.path === '/users/{id}')
    expect(getUserById).toBeDefined()
    expect(getUserById?.parameters[0].name).toBe('id')
  })

  it('returns empty for non-Plug.Router files', async () => {
    const extractor = makeExtractor({
      'lib/foo.ex': `defmodule Foo do\nend\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
