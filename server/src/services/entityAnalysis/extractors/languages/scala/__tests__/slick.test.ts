import { describe, it, expect, vi } from 'vitest'
import { SlickExtractor } from '../slick'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SlickExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Scala', approach: 'slick', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SlickExtractor(ctx)
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

describe('SlickExtractor', () => {
  it('extracts table definitions from Slick Table subclasses', async () => {
    const extractor = makeExtractor({
      'src/main/scala/tables/UserTable.scala': `
import slick.jdbc.PostgresProfile.api._

class Users(tag: Tag) extends Table[User](tag, "users") {
  def id = column[Long]("id", O.PrimaryKey, O.AutoInc)
  def name = column[String]("name")
  def email = column[Option[String]]("email")
  def createdAt = column[java.time.LocalDateTime]("created_at")
  def * = (id, name, email, createdAt) <> (User.tupled, User.unapply)
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('users')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.type).toBe('bigint')

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email?.nullable).toBe(true)

    const name = entity.fields.find((f) => f.name === 'name')
    expect(name?.nullable).toBe(false)
  })

  it('returns empty for non-Slick files', async () => {
    const extractor = makeExtractor({
      'src/Foo.scala': `class Foo {}\n`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
