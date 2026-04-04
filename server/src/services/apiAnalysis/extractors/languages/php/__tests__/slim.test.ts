import { describe, it, expect, vi } from 'vitest'
import { SlimExtractor } from '../slim'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SlimExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'slim', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SlimExtractor(ctx)
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

describe('SlimExtractor', () => {
  it('extracts basic Slim routes', async () => {
    const extractor = makeExtractor({
      'app.php': `
<?php
use Slim\\Factory\\AppFactory;

$app = AppFactory::create();

$app->get('/users', function ($request, $response) {
    return $response->withJson(User::all());
});

$app->get('/users/{id}', function ($request, $response, $args) {
    return $response->withJson(User::find($args['id']));
});

$app->post('/users', function ($request, $response) {
    $user = User::create($request->getParsedBody());
    return $response->withJson($user, 201);
});

$app->delete('/users/{id}', function ($request, $response, $args) {
    User::find($args['id'])->delete();
    return $response->withStatus(204);
});

$app->run();
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(4)
    expect(eps[0]).toMatchObject({ httpMethod: 'GET', path: '/users' })
    expect(eps[1]).toMatchObject({ httpMethod: 'GET', path: '/users/{id}' })
    expect(eps[1].parameters).toEqual([{ name: 'id', location: 'path', required: true }])
    expect(eps[2]).toMatchObject({ httpMethod: 'POST', path: '/users' })
    expect(eps[3]).toMatchObject({ httpMethod: 'DELETE', path: '/users/{id}' })
  })

  it('handles group routes with prefix', async () => {
    const extractor = makeExtractor({
      'routes.php': `
<?php
use Slim\\Factory\\AppFactory;

$app = AppFactory::create();

$app->group('/api/v1', function ($group) {
    $group->get('/products', 'ProductController:index');
    $group->post('/products', 'ProductController:store');
    $group->get('/products/{id}', 'ProductController:show');
});

$app->run();
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(3)
    expect(eps[0]).toMatchObject({ path: '/api/v1/products', httpMethod: 'GET' })
    expect(eps[1]).toMatchObject({ path: '/api/v1/products', httpMethod: 'POST' })
    expect(eps[2]).toMatchObject({ path: '/api/v1/products/{id}', httpMethod: 'GET' })
  })

  it('returns empty surfaces when no Slim routes found', async () => {
    const extractor = makeExtractor({
      'helper.php': `
<?php
function formatDate($date) {
    return date('Y-m-d', strtotime($date));
}
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
