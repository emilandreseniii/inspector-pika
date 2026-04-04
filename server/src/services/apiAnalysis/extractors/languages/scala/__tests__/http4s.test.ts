import { describe, it, expect, vi } from 'vitest'
import { Http4sExtractor } from '../http4s'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): Http4sExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Scala', approach: 'http4s', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new Http4sExtractor(ctx)
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

describe('Http4sExtractor', () => {
  it('extracts routes from HttpRoutes.of partial function', async () => {
    const extractor = makeExtractor({
      'src/main/scala/routes/UserRoutes.scala': `
import org.http4s._
import org.http4s.dsl.io._

object UserRoutes {
  def routes[F[_]]: HttpRoutes[F] = HttpRoutes.of[F] {
    case GET -> Root / "users"       => Ok(listUsers)
    case GET -> Root / "users" / id  => Ok(getUser(id))
    case POST -> Root / "users"      => Created(createUser)
    case DELETE -> Root / "users" / id => NoContent()
  }
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

    const getUserById = surface.endpoints.find((e) => e.path === '/users/{id}')
    expect(getUserById).toBeDefined()
    expect(getUserById?.httpMethod).toBe('GET')
    expect(getUserById?.parameters[0].name).toBe('id')

    const deleteUser = surface.endpoints.find((e) => e.httpMethod === 'DELETE' && e.path === '/users/{id}')
    expect(deleteUser).toBeDefined()
  })

  it('returns empty for non-http4s files', async () => {
    const extractor = makeExtractor({
      'src/Foo.scala': `object Foo {}\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
