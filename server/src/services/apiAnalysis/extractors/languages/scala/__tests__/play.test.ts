import { describe, it, expect, vi } from 'vitest'
import { PlayExtractor } from '../play'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): PlayExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Scala', approach: 'play', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new PlayExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async (pattern: string) => {
    if (pattern === '**/conf/routes') {
      return Object.keys(files).filter((f) => f.endsWith('/routes') || f === 'conf/routes')
    }
    return []
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('PlayExtractor', () => {
  it('extracts routes from conf/routes file', async () => {
    const extractor = makeExtractor({
      'conf/routes': `# Routes
# This file defines all application routes (Higher priority routes first)

GET     /                           controllers.HomeController.index()
GET     /users                      controllers.UserController.list()
POST    /users                      controllers.UserController.create()
GET     /users/:id                  controllers.UserController.show(id: Long)
PUT     /users/:id                  controllers.UserController.update(id: Long)
DELETE  /users/:id                  controllers.UserController.delete(id: Long)
GET     /assets/*file               controllers.Assets.versioned(path="/public", file: Asset)
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.apiStyle).toBe('http')

    const listUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(listUsers).toBeDefined()

    const createUser = surface.endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')
    expect(createUser).toBeDefined()

    const showUser = surface.endpoints.find((e) => e.path === '/users/{id}' && e.httpMethod === 'GET')
    expect(showUser).toBeDefined()
    expect(showUser?.parameters[0].name).toBe('id')
    expect(showUser?.parameters[0].location).toBe('path')
  })

  it('returns empty for empty routes file', async () => {
    const extractor = makeExtractor({
      'conf/routes': `# Empty routes file\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
