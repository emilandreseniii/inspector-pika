import { describe, it, expect, vi } from 'vitest'
import { AkkaHttpExtractor } from '../akkaHttp'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): AkkaHttpExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Scala', approach: 'akka_http', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new AkkaHttpExtractor(ctx)
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

describe('AkkaHttpExtractor', () => {
  it('extracts routes from Akka HTTP directive DSL', async () => {
    const extractor = makeExtractor({
      'src/main/scala/routes/UserRoutes.scala': `
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.model.StatusCodes

trait UserRoutes {
  val userRoutes =
    pathPrefix("users") {
      pathEnd {
        get {
          complete(listUsers())
        } ~
        post {
          entity(as[User]) { user =>
            complete(createUser(user))
          }
        }
      } ~
      path(LongNumber) { id =>
        get {
          complete(getUser(id))
        } ~
        delete {
          complete(deleteUser(id))
        }
      }
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
  })

  it('returns empty for non-Akka HTTP files', async () => {
    const extractor = makeExtractor({
      'src/Foo.scala': `object Foo { def main(args: Array[String]): Unit = {} }\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
