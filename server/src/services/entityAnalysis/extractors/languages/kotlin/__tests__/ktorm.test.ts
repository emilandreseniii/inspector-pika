import { describe, it, expect, vi } from 'vitest'
import { KtormExtractor } from '../ktorm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): KtormExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Kotlin', approach: 'ktorm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new KtormExtractor(ctx)
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

describe('KtormExtractor', () => {
  it('extracts columns from a basic Table object', async () => {
    const extractor = makeExtractor({
      'src/db/Tables.kt': `
import org.ktorm.schema.*

object Employees : Table<Employee>("t_employee") {
    val id = int("id").primaryKey().bindTo { it.id }
    val name = varchar("name").bindTo { it.name }
    val hireDate = date("hire_date").bindTo { it.hireDate }
    val salary = decimal("salary").bindTo { it.salary }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('Employees')
    expect(entity.tableName).toBe('t_employee')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.dataType).toBe('integer')

    const salary = entity.fields.find((f) => f.name === 'salary')
    expect(salary?.dataType).toBe('float')
  })

  it('extracts foreign key references', async () => {
    const extractor = makeExtractor({
      'src/db/Tables.kt': `
object Employees : Table<Employee>("t_employee") {
    val id = int("id").primaryKey().bindTo { it.id }
    val departmentId = int("department_id").references(Departments) { it.department }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const deptId = result.entities[0].fields.find((f) => f.name === 'departmentId')
    expect(deptId?.isForeignKey).toBe(true)
  })

  it('uses snake_case of object name when no table name given', async () => {
    const extractor = makeExtractor({
      'src/db/Tables.kt': `
object UserProfiles : Table<UserProfile>() {
    val id = int("id").primaryKey().bindTo { it.id }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].tableName).toBe('user_profiles')
  })

  it('returns empty when no Table objects found', async () => {
    const extractor = makeExtractor({
      'src/Service.kt': `
class UserService {
    fun findAll(): List<User> = database.from(Users).select().map { }
}
`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
