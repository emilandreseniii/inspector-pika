import { describe, it, expect, vi } from 'vitest'
import { DoobieExtractor } from '../doobie'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): DoobieExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Scala', approach: 'doobie', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new DoobieExtractor(ctx)
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

describe('DoobieExtractor', () => {
  it('extracts case classes used as query result types', async () => {
    const extractor = makeExtractor({
      'src/main/scala/repo/UserRepo.scala': `
import doobie._
import doobie.implicits._

case class User(id: Long, name: String, email: Option[String])

object UserRepo {
  def listUsers: ConnectionIO[List[User]] =
    sql"SELECT id, name, email FROM users".query[User].to[List]

  def getUser(id: Long): ConnectionIO[Option[User]] =
    sql"SELECT id, name, email FROM users WHERE id = $id".query[User].option
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('users')
    expect(entity.fields).toHaveLength(3)

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.type).toBe('bigint')

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email?.nullable).toBe(true)
  })

  it('returns empty for non-doobie files', async () => {
    const extractor = makeExtractor({
      'src/Foo.scala': `case class Foo(id: Int)\n`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
