import { describe, it, expect, vi } from 'vitest'
import { ExposedExtractor } from '../exposed'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): ExposedExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Kotlin', approach: 'exposed', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new ExposedExtractor(ctx)
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

describe('ExposedExtractor', () => {
  it('extracts columns from a basic Table object', async () => {
    const extractor = makeExtractor({
      'src/db/Tables.kt': `
import org.jetbrains.exposed.sql.*

object Users : Table("users") {
    val id = integer("id").autoIncrement()
    val name = varchar("name", 255)
    val email = varchar("email", 255).uniqueIndex()
    val age = integer("age").nullable()
    override val primaryKey = PrimaryKey(id)
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('Users')
    expect(entity.tableName).toBe('users')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email?.isUnique).toBe(true)

    const age = entity.fields.find((f) => f.name === 'age')
    expect(age?.isNullable).toBe(true)
  })

  it('extracts IntIdTable with implicit id', async () => {
    const extractor = makeExtractor({
      'src/db/Posts.kt': `
import org.jetbrains.exposed.dao.id.IntIdTable

object Posts : IntIdTable("posts") {
    val title = varchar("title", 200)
    val authorId = integer("author_id").references(Users.id)
    val published = bool("published")
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.tableName).toBe('posts')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.dataType).toBe('integer')

    const authorId = entity.fields.find((f) => f.name === 'authorId')
    expect(authorId?.isForeignKey).toBe(true)
  })

  it('returns empty when no Table objects found', async () => {
    const extractor = makeExtractor({
      'src/Service.kt': `
class UserService {
    fun findAll(): List<User> = transaction { User.all().toList() }
}
`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
