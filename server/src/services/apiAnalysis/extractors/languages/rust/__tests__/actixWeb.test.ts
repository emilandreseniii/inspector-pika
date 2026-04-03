import { describe, it, expect, vi } from 'vitest'
import { ActixWebExtractor } from '../actixWeb'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): ActixWebExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'actix_web', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new ActixWebExtractor(ctx)
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

describe('ActixWebExtractor', () => {
  it('extracts routes from #[get] / #[post] attributes', async () => {
    const extractor = makeExtractor({
      'src/handlers.rs': `
use actix_web::{get, post, delete, web, HttpResponse};

#[get("/users")]
async fn list_users() -> HttpResponse { HttpResponse::Ok().finish() }

#[post("/users")]
async fn create_user() -> HttpResponse { HttpResponse::Created().finish() }

#[delete("/users/{id}")]
async fn delete_user(path: web::Path<i32>) -> HttpResponse { HttpResponse::Ok().finish() }
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const endpoints = result.surfaces[0].endpoints

    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'DELETE' && e.path === '/users/{id}')).toBeDefined()
  })

  it('extracts path parameters from {param} style', async () => {
    const extractor = makeExtractor({
      'src/handlers.rs': `
#[get("/users/{userId}/posts/{postId}")]
async fn get_post() -> HttpResponse { HttpResponse::Ok().finish() }
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters.find((p) => p.name === 'userId')).toBeDefined()
    expect(ep.parameters.find((p) => p.name === 'postId')).toBeDefined()
  })

  it('extracts handler function name', async () => {
    const extractor = makeExtractor({
      'src/handlers.rs': `
#[get("/health")]
async fn health_check() -> HttpResponse { HttpResponse::Ok().finish() }
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.operationName).toBe('health_check')
  })
})
