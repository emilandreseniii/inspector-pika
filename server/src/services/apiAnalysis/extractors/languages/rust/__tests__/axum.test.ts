import { describe, it, expect, vi } from 'vitest'
import { AxumExtractor } from '../axum'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): AxumExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'axum', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new AxumExtractor(ctx)
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

describe('AxumExtractor', () => {
  it('extracts routes from Router::new().route() chains', async () => {
    const extractor = makeExtractor({
      'src/main.rs': `
use axum::{Router, routing::{get, post, delete}};

async fn list_users() {}
async fn create_user() {}
async fn delete_user() {}

pub fn routes() -> Router {
    Router::new()
        .route("/users", get(list_users))
        .route("/users", post(create_user))
        .route("/users/:id", delete(delete_user))
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const endpoints = result.surfaces[0].endpoints

    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'DELETE' && e.path === '/users/:id')).toBeDefined()
  })

  it('extracts path parameters', async () => {
    const extractor = makeExtractor({
      'src/routes.rs': `
Router::new()
    .route("/users/:userId/posts/:postId", get(get_post))
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters.find((p) => p.name === 'userId')).toBeDefined()
    expect(ep.parameters.find((p) => p.name === 'postId')).toBeDefined()
  })

  it('handles multiple verbs on same route', async () => {
    const extractor = makeExtractor({
      'src/lib.rs': `
Router::new()
    .route("/items", get(list).post(create))
`,
    })

    const result = await extractor.extract()
    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.find((e) => e.httpMethod === 'GET')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST')).toBeDefined()
  })
})
