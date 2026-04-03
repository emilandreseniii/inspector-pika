import { describe, it, expect, vi } from 'vitest'
import { DoctrineExtractor } from '../doctrine'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): DoctrineExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'doctrine', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new DoctrineExtractor(ctx)
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

describe('DoctrineExtractor', () => {
  it('extracts entity from PHP 8 #[ORM] attributes', async () => {
    const extractor = makeExtractor({
      'src/Entity/User.php': `<?php

namespace App\\Entity;

use Doctrine\\ORM\\Mapping as ORM;

#[ORM\\Entity]
#[ORM\\Table(name: "users")]
class User
{
    #[ORM\\Id]
    #[ORM\\Column(type: 'integer')]
    private int $id;

    #[ORM\\Column(type: 'string', unique: true)]
    private string $email;

    #[ORM\\Column(type: 'string', nullable: true)]
    private ?string $name = null;

    #[ORM\\ManyToOne(targetEntity: Post::class)]
    private Post $post;
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)
    const user = result.entities[0]
    expect(user.name).toBe('users')

    const id = user.fields.find((f) => f.name === 'id')
    expect(id!.isPrimaryKey).toBe(true)
    expect(id!.type).toBe('integer')

    const email = user.fields.find((f) => f.name === 'email')
    expect(email!.type).toBe('string')
    expect(email!.isUnique).toBe(true)

    const name = user.fields.find((f) => f.name === 'name')
    expect(name!.nullable).toBe(true)

    const rel = user.relationships.find((r) => r.type === 'many_to_one')
    expect(rel?.targetEntity).toBe('Post')
  })

  it('falls back to snake_case class name for table name', async () => {
    const extractor = makeExtractor({
      'src/Entity/BlogPost.php': `<?php
#[ORM\\Entity]
class BlogPost
{
    #[ORM\\Id]
    #[ORM\\Column(type: 'integer')]
    private int $id;
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities[0].name).toBe('blog_post')
  })
})
