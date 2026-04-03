import { describe, it, expect, vi } from 'vitest'
import { NestJsExtractor } from '../nestjs'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): NestJsExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'nestjs', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new NestJsExtractor(ctx)
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

describe('NestJsExtractor', () => {
  describe('basic controller extraction', () => {
    it('extracts routes from a NestJS controller', async () => {
      const extractor = makeExtractor({
        'cats.controller.ts': `
import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common'

@Controller('cats')
export class CatsController {
  @Get()
  findAll() { return [] }

  @Get(':id')
  findOne(@Param('id') id: string) { return {} }

  @Post()
  create(@Body() dto: CreateCatDto) { return {} }

  @Delete(':id')
  remove(@Param('id') id: string) { return null }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('CatsController')
      expect(surface.apiStyle).toBe('http')
      expect(surface.basePath).toBe('/cats')
      expect(surface.endpoints).toHaveLength(4)

      const getAll = surface.endpoints.find((e) => e.operationName === 'findAll')
      expect(getAll?.httpMethod).toBe('GET')
      expect(getAll?.path).toBe('/cats')

      const getOne = surface.endpoints.find((e) => e.operationName === 'findOne')
      expect(getOne?.httpMethod).toBe('GET')
      expect(getOne?.path).toBe('/cats/:id')
    })

    it('handles @Controller() with no path', async () => {
      const extractor = makeExtractor({
        'app.controller.ts': `
@Controller()
export class AppController {
  @Get('health')
  health() { return 'ok' }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.path).toBe('/health')
    })
  })

  describe('parameter extraction', () => {
    it('extracts @Param, @Query, @Body decorators', async () => {
      const extractor = makeExtractor({
        'items.controller.ts': `
@Controller('items')
export class ItemsController {
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('include') include?: string,
  ) { return {} }

  @Post()
  create(@Body() dto: CreateItemDto) { return {} }
}
`,
      })

      const result = await extractor.extract()

      const findOne = result.surfaces[0].endpoints.find((e) => e.operationName === 'findOne')
      const params = findOne?.parameters ?? []
      expect(params.find((p) => p.name === 'id')?.location).toBe('path')
      expect(params.find((p) => p.name === 'include')?.location).toBe('query')

      const create = result.surfaces[0].endpoints.find((e) => e.operationName === 'create')
      expect(create?.parameters.find((p) => p.location === 'body')?.name).toBe('dto')
    })
  })

  describe('HTTP method decorators', () => {
    it('handles all common HTTP method decorators', async () => {
      const extractor = makeExtractor({
        'test.controller.ts': `
@Controller('test')
export class TestController {
  @Get() get() {}
  @Post() post() {}
  @Put(':id') put() {}
  @Delete(':id') del() {}
  @Patch(':id') patch() {}
}
`,
      })

      const result = await extractor.extract()
      const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('PUT')
      expect(methods).toContain('DELETE')
      expect(methods).toContain('PATCH')
    })
  })

  describe('path joining', () => {
    it('correctly joins controller prefix with method path', async () => {
      const extractor = makeExtractor({
        'users.controller.ts': `
@Controller('/api/v1/users')
export class UsersController {
  @Get()
  list() {}

  @Get(':id')
  get() {}

  @Post()
  create() {}
}
`,
      })

      const result = await extractor.extract()
      const paths = result.surfaces[0].endpoints.map((e) => e.path)
      expect(paths).toContain('/api/v1/users')
      expect(paths).toContain('/api/v1/users/:id')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.controller.ts': `
@Controller('a')
export class AController {
  @Get() findAll() {}
  @Post() create() {}
}
`,
        'b.controller.ts': `
@Controller('b')
export class BController {
  @Get() findAll() {}
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
