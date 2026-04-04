import { describe, it, expect, vi } from 'vitest'
import { MikroOrmExtractor } from '../mikroOrm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): MikroOrmExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'mikro_orm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new MikroOrmExtractor(ctx)
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

describe('MikroOrmExtractor', () => {
  it('extracts entities with @Entity and @Property decorators', async () => {
    const extractor = makeExtractor({
      'src/entities/User.ts': `
import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core'

@Entity()
export class User {
  @PrimaryKey()
  id!: number

  @Property()
  name!: string

  @Property({ nullable: true })
  email?: string | null

  @Property({ unique: true })
  username!: string
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('User')
    expect(entity.tableName).toBe('user')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id).toBeDefined()
    expect(id?.isPrimaryKey).toBe(true)

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email).toBeDefined()
    expect(email?.isNullable).toBe(true)

    const username = entity.fields.find((f) => f.name === 'username')
    expect(username?.isUnique).toBe(true)
  })

  it('extracts relationships', async () => {
    const extractor = makeExtractor({
      'src/entities/Post.ts': `
import { Entity, PrimaryKey, Property, ManyToOne, OneToMany } from '@mikro-orm/core'

@Entity({ tableName: 'posts' })
export class Post {
  @PrimaryKey()
  id!: number

  @Property()
  title!: string

  @ManyToOne(() => User)
  author!: User

  @OneToMany(() => Comment, c => c.post)
  comments = new Collection<Comment>(this)
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)
    const entity = result.entities[0]
    expect(entity.tableName).toBe('posts')
    expect(entity.relationships).toHaveLength(2)

    const authorRel = entity.relationships.find((r) => r.type === 'many_to_one')
    expect(authorRel?.targetEntityName).toBe('User')

    const commentsRel = entity.relationships.find((r) => r.type === 'one_to_many')
    expect(commentsRel?.targetEntityName).toBe('Comment')
  })

  it('ignores TypeORM files that use @Column', async () => {
    const extractor = makeExtractor({
      'src/entities/TypeOrmUser.ts': `
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
export class TypeOrmUser {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string
}
`,
    })

    const result = await extractor.extract()
    // Should be excluded because it has @Column but no @Property
    expect(result.entities).toHaveLength(0)
  })
})
