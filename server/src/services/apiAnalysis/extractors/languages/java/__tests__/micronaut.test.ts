import { describe, it, expect, vi } from 'vitest'
import { MicronautExtractor } from '../micronaut'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): MicronautExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'micronaut', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new MicronautExtractor(ctx)
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

describe('MicronautExtractor', () => {
  it('extracts routes from a basic @Controller class', async () => {
    const extractor = makeExtractor({
      'UserController.java': `
package com.example;

import io.micronaut.http.annotation.*;

@Controller("/users")
public class UserController {

    @Get
    public List<User> list() { return userService.list(); }

    @Get("/{id}")
    public User get(@PathVariable Long id) { return userService.find(id); }

    @Post
    public User create(@Body UserDto dto) { return userService.create(dto); }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.name).toBe('UserController')
    expect(surface.basePath).toBe('/users')
    expect(surface.packageOrModule).toBe('com.example')
    expect(surface.endpoints).toHaveLength(3)

    const [list, get, create] = surface.endpoints
    expect(list.httpMethod).toBe('GET')
    expect(list.path).toBe('/users')

    expect(get.httpMethod).toBe('GET')
    expect(get.path).toBe('/users/{id}')
    expect(get.parameters).toHaveLength(1)
    expect(get.parameters[0]).toMatchObject({ name: 'id', location: 'path', required: true })

    expect(create.httpMethod).toBe('POST')
    expect(create.parameters[0]).toMatchObject({ name: 'dto', location: 'body', required: true })
  })

  it('extracts @QueryValue and @Header parameters', async () => {
    const extractor = makeExtractor({
      'SearchController.java': `
package com.example;

import io.micronaut.http.annotation.*;

@Controller("/search")
public class SearchController {

    @Get
    public List<Result> search(
            @QueryValue String q,
            @QueryValue(value = "limit") Integer limit,
            @Header("X-Api-Key") String apiKey) {
        return searchService.search(q, limit);
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.httpMethod).toBe('GET')
    expect(ep.parameters).toHaveLength(3)
    expect(ep.parameters[0]).toMatchObject({ name: 'q', location: 'query' })
    expect(ep.parameters[1]).toMatchObject({ name: 'limit', location: 'query' })
    expect(ep.parameters[2]).toMatchObject({ name: 'X-Api-Key', location: 'header' })
  })

  it('returns empty surfaces when no @Controller annotation is present', async () => {
    const extractor = makeExtractor({
      'Service.java': `
public class UserService {
    public User find(Long id) { return repo.findById(id); }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
