import { describe, it, expect, vi } from 'vitest'
import { RocketExtractor } from '../rocket'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): RocketExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'rocket', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new RocketExtractor(ctx)
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

describe('RocketExtractor', () => {
  it('extracts routes from Rocket handler attributes', async () => {
    const extractor = makeExtractor({
      'src/main.rs': `
use rocket::serde::json::Json;
use rocket::launch;

#[get("/users")]
pub async fn list_users() -> Json<Vec<User>> {
    Json(User::all())
}

#[get("/users/<id>")]
pub async fn get_user(id: i64) -> Option<Json<User>> {
    User::find(id).map(Json)
}

#[post("/users")]
pub async fn create_user(dto: Json<UserDto>) -> Json<User> {
    Json(User::create(dto.into_inner()))
}

#[delete("/users/<id>")]
pub async fn delete_user(id: i64) -> rocket::http::Status {
    User::delete(id);
    rocket::http::Status::NoContent
}

#[launch]
fn rocket() -> _ {
    rocket::build().mount("/", routes![list_users, get_user, create_user, delete_user])
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(4)

    expect(eps[0]).toMatchObject({ httpMethod: 'GET', path: '/users', operationName: 'list_users' })
    expect(eps[1]).toMatchObject({ httpMethod: 'GET', path: '/users/<id>', operationName: 'get_user' })
    expect(eps[1].parameters).toEqual([{ name: 'id', location: 'path', required: true }])
    expect(eps[2]).toMatchObject({ httpMethod: 'POST', path: '/users', operationName: 'create_user' })
    expect(eps[3]).toMatchObject({ httpMethod: 'DELETE', path: '/users/<id>' })
  })

  it('extracts query params from route attribute query string', async () => {
    const extractor = makeExtractor({
      'src/search.rs': `
use rocket::launch;

#[get("/search?<q>&<limit>")]
pub fn search(q: String, limit: Option<u32>) -> String {
    format!("search: {} limit: {:?}", q, limit)
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.path).toBe('/search')
    expect(ep.parameters).toContainEqual({ name: 'q', location: 'query', required: false })
    expect(ep.parameters).toContainEqual({ name: 'limit', location: 'query', required: false })
  })

  it('returns empty surfaces for non-Rocket files with same attribute names', async () => {
    const extractor = makeExtractor({
      'src/lib.rs': `
// A file with #[get] but not Rocket
#[get(key = "foo")]
fn config_value() -> String {
    "bar".to_string()
}
`,
    })
    const result = await extractor.extract()
    // Should be empty because isRocketFile returns false
    expect(result.surfaces).toHaveLength(0)
  })
})
