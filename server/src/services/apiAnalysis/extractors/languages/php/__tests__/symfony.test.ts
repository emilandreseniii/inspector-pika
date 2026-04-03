import { describe, it, expect, vi } from 'vitest'
import { SymfonyExtractor } from '../symfony'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SymfonyExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'symfony', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SymfonyExtractor(ctx)
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

describe('SymfonyExtractor', () => {
  it('extracts routes from #[Route] PHP 8 attributes', async () => {
    const extractor = makeExtractor({
      'src/Controller/UserController.php': `<?php

namespace App\\Controller;

use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;
use Symfony\\Component\\Routing\\Attribute\\Route;

class UserController extends AbstractController
{
    #[Route('/users', name: 'user_list', methods: ['GET'])]
    public function index(): Response
    {
        return $this->json([]);
    }

    #[Route('/users', name: 'user_create', methods: ['POST'])]
    public function create(): Response
    {
        return $this->json([]);
    }

    #[Route('/users/{id}', name: 'user_show', methods: ['GET'])]
    public function show(int $id): Response
    {
        return $this->json([]);
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const endpoints = result.surfaces[0].endpoints

    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users/{id}')).toBeDefined()
  })

  it('extracts path parameters', async () => {
    const extractor = makeExtractor({
      'src/Controller/PostController.php': `<?php
class PostController
{
    #[Route('/users/{userId}/posts/{postId}', methods: ['GET'])]
    public function show(int $userId, int $postId): Response {}
}
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters.find((p) => p.name === 'userId')).toBeDefined()
    expect(ep.parameters.find((p) => p.name === 'postId')).toBeDefined()
  })

  it('handles multiple HTTP methods on one route', async () => {
    const extractor = makeExtractor({
      'src/Controller/ApiController.php': `<?php
class ApiController
{
    #[Route('/items/{id}', methods: ['GET', 'HEAD'])]
    public function getItem(): Response {}
}
`,
    })

    const result = await extractor.extract()
    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.find((e) => e.httpMethod === 'GET')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'HEAD')).toBeDefined()
  })
})
