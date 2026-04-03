import { describe, it, expect, vi } from 'vitest'
import { TypeOrmExtractor } from '../typeorm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): TypeOrmExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'typeorm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new TypeOrmExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      content.split('\n').forEach((text, i) => {
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

describe('TypeOrmExtractor', () => {
  describe('basic entity extraction', () => {
    it('extracts entities with @Column fields', async () => {
      const extractor = makeExtractor({
        'user.entity.ts': `
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  firstName: string

  @Column({ nullable: true })
  middleName?: string

  @Column({ unique: true })
  email: string
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const user = result.entities[0]
      expect(user.name).toBe('User')
      expect(user.tableName).toBe('user')
      expect(user.entityType).toBe('table')

      const id = user.fields.find((f) => f.name === 'id')
      expect(id?.isPK).toBe(true)
      expect(id?.nullable).toBe(false)

      const email = user.fields.find((f) => f.name === 'email')
      expect(email?.isUnique).toBe(true)

      const middleName = user.fields.find((f) => f.name === 'middleName')
      expect(middleName?.nullable).toBe(true)
    })

    it('uses explicit table name from @Entity("name")', async () => {
      const extractor = makeExtractor({
        'user.entity.ts': `
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  email: string
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].tableName).toBe('users')
    })

    it('uses explicit table name from @Entity({ name: "..." })', async () => {
      const extractor = makeExtractor({
        'post.entity.ts': `
@Entity({ name: 'blog_posts' })
export class Post {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  title: string
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].tableName).toBe('blog_posts')
    })
  })

  describe('column name derivation', () => {
    it('derives snake_case column name from camelCase property', async () => {
      const extractor = makeExtractor({
        'user.entity.ts': `
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  firstName: string
}
`,
      })

      const result = await extractor.extract()
      const firstName = result.entities[0].fields.find((f) => f.name === 'firstName')
      expect(firstName?.columnName).toBe('first_name')
    })

    it('uses explicit column name from @Column("name")', async () => {
      const extractor = makeExtractor({
        'user.entity.ts': `
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column('user_email')
  email: string
}
`,
      })

      const result = await extractor.extract()
      const email = result.entities[0].fields.find((f) => f.name === 'email')
      expect(email?.columnName).toBe('user_email')
    })
  })

  describe('relationships', () => {
    it('extracts @ManyToOne relationship', async () => {
      const extractor = makeExtractor({
        'post.entity.ts': `
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm'
import { User } from './user.entity'

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  title: string

  @ManyToOne(() => User, (user) => user.posts)
  author: User
}
`,
      })

      const result = await extractor.extract()
      const post = result.entities[0]
      const rel = post.relationships.find((r) => r.fieldName === 'author')
      expect(rel?.targetEntity).toBe('User')
      expect(rel?.cardinality).toBe('many_to_one')
    })

    it('extracts @OneToMany relationship', async () => {
      const extractor = makeExtractor({
        'user.entity.ts': `
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @OneToMany(() => Post, (post) => post.author)
  posts: Post[]
}
`,
      })

      const result = await extractor.extract()
      const user = result.entities[0]
      const rel = user.relationships.find((r) => r.fieldName === 'posts')
      expect(rel?.targetEntity).toBe('Post')
      expect(rel?.cardinality).toBe('one_to_many')
    })

    it('extracts @ManyToMany relationship', async () => {
      const extractor = makeExtractor({
        'post.entity.ts': `
@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number

  @ManyToMany(() => Tag, (tag) => tag.posts)
  tags: Tag[]
}
`,
      })

      const result = await extractor.extract()
      const rel = result.entities[0].relationships.find((r) => r.fieldName === 'tags')
      expect(rel?.cardinality).toBe('many_to_many')
      expect(rel?.targetEntity).toBe('Tag')
    })
  })

  describe('special column decorators', () => {
    it('handles @CreateDateColumn and @UpdateDateColumn', async () => {
      const extractor = makeExtractor({
        'user.entity.ts': `
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
`,
      })

      const result = await extractor.extract()
      const fields = result.entities[0].fields
      expect(fields.find((f) => f.name === 'createdAt')).toBeDefined()
      expect(fields.find((f) => f.name === 'updatedAt')).toBeDefined()
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.entity.ts': `
@Entity()
export class A {
  @PrimaryGeneratedColumn()
  id: number
  @Column()
  name: string
}
`,
        'b.entity.ts': `
@Entity()
export class B {
  @PrimaryGeneratedColumn()
  id: number
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
