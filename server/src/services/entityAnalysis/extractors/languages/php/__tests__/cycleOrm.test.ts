import { describe, it, expect, vi } from 'vitest'
import { CycleOrmExtractor } from '../cycleOrm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): CycleOrmExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'cycle_orm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new CycleOrmExtractor(ctx)
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

describe('CycleOrmExtractor', () => {
  it('extracts entity fields and relationships', async () => {
    const extractor = makeExtractor({
      'src/Entity/User.php': `<?php
namespace App\\Entity;

use Cycle\\Annotated\\Annotation\\Entity;
use Cycle\\Annotated\\Annotation\\Column;
use Cycle\\Annotated\\Annotation\\Relation\\HasMany;

#[Entity(table: 'users')]
class User
{
    #[Column(type: 'primary')]
    private int $id;

    #[Column(type: 'string')]
    private string $name;

    #[Column(type: 'string', nullable: true)]
    private ?string $email;

    #[HasMany(target: Post::class)]
    private Collection $posts;
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
    expect(id?.type).toBe('integer')

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email?.nullable).toBe(true)

    expect(entity.relationships).toHaveLength(1)
    expect(entity.relationships[0].type).toBe('one_to_many')
    expect(entity.relationships[0].targetEntity).toBe('Post')
  })

  it('returns empty when no Cycle ORM import', async () => {
    const extractor = makeExtractor({
      'src/Entity/User.php': `<?php\nclass User {}\n`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
