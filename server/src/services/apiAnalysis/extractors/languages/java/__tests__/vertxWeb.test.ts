import { describe, it, expect, vi } from 'vitest'
import { VertxWebExtractor } from '../vertxWeb'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): VertxWebExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'vertx_web', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new VertxWebExtractor(ctx)
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

describe('VertxWebExtractor', () => {
  it('extracts routes from Vert.x Web router', async () => {
    const extractor = makeExtractor({
      'src/main/java/com/example/MainVerticle.java': `
package com.example;

import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;

public class MainVerticle extends AbstractVerticle {

  @Override
  public void start(Promise<Void> startPromise) {
    Router router = Router.router(vertx);

    router.get("/users").handler(this::listUsers);
    router.post("/users").handler(this::createUser);
    router.get("/users/:id").handler(this::getUser);
    router.delete("/users/:id").handler(this::deleteUser);
    router.route(HttpMethod.PUT, "/users/:id").handler(this::updateUser);
  }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.framework).toBe('vertx_web')

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST')
    expect(postUsers?.path).toBe('/users')

    const getById = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users/:id')
    expect(getById?.parameters[0].name).toBe('id')

    const put = surface.endpoints.find((e) => e.httpMethod === 'PUT' && e.path === '/users/:id')
    expect(put).toBeDefined()
  })

  it('returns empty when no Vert.x router patterns', async () => {
    const extractor = makeExtractor({
      'src/main/java/Service.java': `
public class Service {
  public void doSomething() {}
}
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
