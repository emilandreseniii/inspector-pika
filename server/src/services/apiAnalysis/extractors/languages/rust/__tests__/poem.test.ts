import { describe, it, expect, vi } from 'vitest'
import { PoemExtractor } from '../poem'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): PoemExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'poem', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new PoemExtractor(ctx)
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

describe('PoemExtractor', () => {
  it('extracts routes from Route::new().at() chain', async () => {
    const extractor = makeExtractor({
      'src/main.rs': `
use poem::{Route, Server, listener::TcpListener, web::Path};

#[handler]
async fn list_users() -> String { "users".to_string() }

#[handler]
async fn get_user(Path(id): Path<u32>) -> String { id.to_string() }

#[handler]
async fn create_user() -> String { "created".to_string() }

#[tokio::main]
async fn main() {
    let app = Route::new()
        .at("/users", get(list_users).post(create_user))
        .at("/users/:id", get(get_user));
    Server::new(TcpListener::bind("0.0.0.0:3000")).run(app).await.unwrap();
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')
    expect(postUsers).toBeDefined()

    const getUserById = surface.endpoints.find((e) => e.path === '/users/:id')
    expect(getUserById).toBeDefined()
    expect(getUserById?.httpMethod).toBe('GET')
    expect(getUserById?.parameters).toHaveLength(1)
    expect(getUserById?.parameters[0].name).toBe('id')
  })

  it('returns empty when no poem usage', async () => {
    const extractor = makeExtractor({
      'src/main.rs': `fn main() { println!("hello"); }`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
