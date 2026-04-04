import { describe, it, expect, vi } from 'vitest'
import { BeanieExtractor } from '../beanie'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): BeanieExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'beanie', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new BeanieExtractor(ctx)
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

describe('BeanieExtractor', () => {
  it('extracts fields from a Document class', async () => {
    const extractor = makeExtractor({
      'app/models/user.py': `
from beanie import Document
from typing import Optional
from datetime import datetime

class User(Document):
    name: str
    email: str
    age: Optional[int] = None
    created_at: datetime

    class Settings:
        name = "users"
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('User')
    expect(entity.tableName).toBe('users')
    expect(entity.entityType).toBe('document')

    const name = entity.fields.find((f) => f.name === 'name')
    expect(name?.dataType).toBe('string')

    const age = entity.fields.find((f) => f.name === 'age')
    expect(age?.isNullable).toBe(true)
  })

  it('extracts Link relationships', async () => {
    const extractor = makeExtractor({
      'app/models/post.py': `
from beanie import Document, Link
from typing import List

class Post(Document):
    title: str
    content: str
    author: Link[User]
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    const authorRel = entity.relationships.find((r) => r.name === 'author')
    expect(authorRel?.targetEntity).toBe('User')
    expect(authorRel?.cardinality).toBe('many_to_one')
  })

  it('returns empty when no Document classes', async () => {
    const extractor = makeExtractor({
      'app/service.py': `
class UserService:
    def get_all(self):
        return []
`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
