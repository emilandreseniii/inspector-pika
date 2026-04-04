import { describe, it, expect, vi } from 'vitest'
import { LumenExtractor } from '../lumen'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): LumenExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'lumen', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new LumenExtractor(ctx)
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

describe('LumenExtractor', () => {
  it('extracts routes from $router->get/post/... calls', async () => {
    const extractor = makeExtractor({
      'routes/web.php': `<?php
$router->get('/users', 'UserController@index');
$router->post('/users', 'UserController@store');
$router->get('/users/{id}', 'UserController@show');
$router->put('/users/{id}', 'UserController@update');
$router->delete('/users/{id}', 'UserController@destroy');
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.endpoints).toHaveLength(5)

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')
    expect(postUsers).toBeDefined()

    const getUserById = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users/{id}')
    expect(getUserById).toBeDefined()
    expect(getUserById?.parameters[0].name).toBe('id')
  })

  it('handles grouped routes with prefix', async () => {
    const extractor = makeExtractor({
      'routes/web.php': `<?php
$router->group(['prefix' => 'api/v1'], function () use ($router) {
    $router->get('/users', 'UserController@index');
    $router->post('/users', 'UserController@store');
});
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const getUsers = result.surfaces[0].endpoints.find(
      (e) => e.httpMethod === 'GET' && e.path === '/api/v1/users',
    )
    expect(getUsers).toBeDefined()

    const postUsers = result.surfaces[0].endpoints.find(
      (e) => e.httpMethod === 'POST' && e.path === '/api/v1/users',
    )
    expect(postUsers).toBeDefined()
  })

  it('returns empty when no lumen routes', async () => {
    const extractor = makeExtractor({
      'routes/web.php': `<?php\necho "hello";\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
