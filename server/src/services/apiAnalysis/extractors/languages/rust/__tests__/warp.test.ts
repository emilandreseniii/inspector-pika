import { describe, it, expect, vi } from 'vitest'
import { WarpExtractor } from '../warp'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): WarpExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'warp', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new WarpExtractor(ctx)
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

describe('WarpExtractor', () => {
  it('extracts routes from warp filter combinators', async () => {
    const extractor = makeExtractor({
      'src/main.rs': `
use warp::Filter;

#[tokio::main]
async fn main() {
    let list_users = warp::path("users")
        .and(warp::get())
        .and_then(handlers::list_users);

    let get_user = warp::path!("users" / u32)
        .and(warp::get())
        .and_then(handlers::get_user);

    let create_user = warp::path("users")
        .and(warp::post())
        .and(warp::body::json())
        .and_then(handlers::create_user);

    let routes = list_users.or(get_user).or(create_user);
    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
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

    // warp::path!("users" / u32) should produce /users/{u32}
    const getUserById = surface.endpoints.find((e) => e.path?.startsWith('/users/'))
    expect(getUserById).toBeDefined()
    expect(getUserById?.httpMethod).toBe('GET')
  })

  it('returns empty when no warp usage', async () => {
    const extractor = makeExtractor({
      'src/main.rs': `
fn main() {
    println!("hello");
}
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
