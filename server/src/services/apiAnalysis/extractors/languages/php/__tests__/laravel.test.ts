import { describe, it, expect, vi } from 'vitest'
import { LaravelExtractor } from '../laravel'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): LaravelExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'laravel', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new LaravelExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('LaravelExtractor', () => {
  it('extracts explicit verb routes', async () => {
    const extractor = makeExtractor({
      'routes/api.php': `<?php

use Illuminate\\Support\\Facades\\Route;

Route::get('/users', [UserController::class, 'index']);
Route::post('/users', [UserController::class, 'store']);
Route::get('/users/{id}', [UserController::class, 'show']);
Route::put('/users/{id}', [UserController::class, 'update']);
Route::delete('/users/{id}', [UserController::class, 'destroy']);
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const endpoints = result.surfaces[0].endpoints

    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users/{id}')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'PUT' && e.path === '/users/{id}')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'DELETE' && e.path === '/users/{id}')).toBeDefined()
  })

  it('extracts Route::resource() as CRUD routes', async () => {
    const extractor = makeExtractor({
      'routes/api.php': `<?php
Route::resource('photos', PhotoController::class);
`,
    })

    const result = await extractor.extract()
    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/photos')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/photos')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/photos/{id}')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'PUT' && e.path === '/photos/{id}')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'DELETE' && e.path === '/photos/{id}')).toBeDefined()
  })

  it('respects Route::prefix() groups', async () => {
    const extractor = makeExtractor({
      'routes/api.php': `<?php
Route::prefix('api/v1')->group(function () {
    Route::get('/users', [UserController::class, 'index']);
    Route::post('/users', [UserController::class, 'store']);
});
`,
    })

    const result = await extractor.extract()
    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.find((e) => e.path === '/api/v1/users' && e.httpMethod === 'GET')).toBeDefined()
    expect(endpoints.find((e) => e.path === '/api/v1/users' && e.httpMethod === 'POST')).toBeDefined()
  })

  it('extracts path parameters', async () => {
    const extractor = makeExtractor({
      'routes/api.php': `<?php
Route::get('/users/{userId}/posts/{postId}', [PostController::class, 'show']);
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters.find((p) => p.name === 'userId')).toBeDefined()
    expect(ep.parameters.find((p) => p.name === 'postId')).toBeDefined()
  })
})
