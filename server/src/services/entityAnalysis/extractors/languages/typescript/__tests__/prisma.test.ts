import { describe, it, expect, vi } from 'vitest'
import { PrismaExtractor } from '../prisma'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): PrismaExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'prisma', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new PrismaExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async (pattern: string) => {
    return Object.keys(files).filter((f) => {
      if (pattern.includes('schema.prisma')) return f.endsWith('schema.prisma')
      if (pattern.includes('*.prisma')) return f.endsWith('.prisma')
      return false
    })
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('PrismaExtractor', () => {
  describe('basic model extraction', () => {
    it('extracts models with scalar fields', async () => {
      const extractor = makeExtractor({
        'prisma/schema.prisma': `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const user = result.entities[0]
      expect(user.name).toBe('User')
      expect(user.tableName).toBe('user')
      expect(user.entityType).toBe('table')
      expect(user.confidence).toBe('high')

      const id = user.fields.find((f) => f.name === 'id')
      expect(id?.isPK).toBe(true)
      expect(id?.nullable).toBe(false)
      expect(id?.type).toBe('integer')

      const email = user.fields.find((f) => f.name === 'email')
      expect(email?.isUnique).toBe(true)
      expect(email?.type).toBe('string')

      const name = user.fields.find((f) => f.name === 'name')
      expect(name?.nullable).toBe(true)
    })

    it('extracts multiple models', async () => {
      const extractor = makeExtractor({
        'prisma/schema.prisma': `
model User {
  id    Int    @id
  email String
  posts Post[]
}

model Post {
  id       Int    @id
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)
      expect(result.entities.map((e) => e.name)).toContain('User')
      expect(result.entities.map((e) => e.name)).toContain('Post')
    })
  })

  describe('@@map table name override', () => {
    it('uses @@map value as table name', async () => {
      const extractor = makeExtractor({
        'schema.prisma': `
model BlogPost {
  id    Int    @id
  title String

  @@map("blog_posts")
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].tableName).toBe('blog_posts')
    })
  })

  describe('@map field column override', () => {
    it('maps @map attribute to columnName', async () => {
      const extractor = makeExtractor({
        'schema.prisma': `
model User {
  id        Int    @id
  firstName String @map("first_name")
  lastName  String @map("last_name")
}
`,
      })

      const result = await extractor.extract()
      const user = result.entities[0]
      expect(user.fields.find((f) => f.name === 'firstName')?.columnName).toBe('first_name')
      expect(user.fields.find((f) => f.name === 'lastName')?.columnName).toBe('last_name')
    })
  })

  describe('relationships', () => {
    it('extracts many_to_one relations from @relation fields', async () => {
      const extractor = makeExtractor({
        'schema.prisma': `
model Post {
  id       Int    @id
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
}
`,
      })

      const result = await extractor.extract()
      const post = result.entities[0]
      const rel = post.relationships.find((r) => r.fieldName === 'author')
      expect(rel?.targetEntity).toBe('User')
      expect(rel?.cardinality).toBe('many_to_one')
    })

    it('extracts one_to_many from array relation fields', async () => {
      const extractor = makeExtractor({
        'schema.prisma': `
model User {
  id    Int    @id
  email String
  posts Post[] @relation("UserPosts")
}
`,
      })

      const result = await extractor.extract()
      const user = result.entities[0]
      const rel = user.relationships.find((r) => r.fieldName === 'posts')
      expect(rel?.targetEntity).toBe('Post')
      expect(rel?.cardinality).toBe('one_to_many')
    })
  })

  describe('field types', () => {
    it('maps Prisma scalar types correctly', async () => {
      const extractor = makeExtractor({
        'schema.prisma': `
model TypeTest {
  id        Int      @id
  name      String
  active    Boolean
  score     Float
  amount    Decimal
  big       BigInt
  ts        DateTime
  data      Json
  blob      Bytes
}
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      const typeMap: Record<string, string> = {}
      for (const f of entity.fields) typeMap[f.name] = f.type ?? ''

      expect(typeMap['name']).toBe('string')
      expect(typeMap['active']).toBe('boolean')
      expect(typeMap['score']).toBe('float')
      expect(typeMap['amount']).toBe('decimal')
      expect(typeMap['big']).toBe('bigint')
      expect(typeMap['ts']).toBe('datetime')
      expect(typeMap['data']).toBe('json')
      expect(typeMap['blob']).toBe('bytes')
    })
  })

  describe('snake_case table names', () => {
    it('converts PascalCase model name to snake_case', async () => {
      const extractor = makeExtractor({
        'schema.prisma': `
model UserProfile {
  id Int @id
}

model BlogPost {
  id Int @id
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities.find((e) => e.name === 'UserProfile')?.tableName).toBe('user_profile')
      expect(result.entities.find((e) => e.name === 'BlogPost')?.tableName).toBe('blog_post')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'schema.prisma': `
model A {
  id Int @id
}
model B {
  id Int @id
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(1)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
