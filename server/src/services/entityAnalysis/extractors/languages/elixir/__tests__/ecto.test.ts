import { describe, it, expect, vi } from 'vitest'
import { EctoExtractor } from '../ecto'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): EctoExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Elixir', approach: 'ecto', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new EctoExtractor(ctx)
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

describe('EctoExtractor', () => {
  it('extracts fields and relationships from Ecto schema', async () => {
    const extractor = makeExtractor({
      'lib/myapp/user.ex': `
defmodule MyApp.User do
  use Ecto.Schema
  import Ecto.Changeset

  schema "users" do
    field :name, :string
    field :email, :string
    field :age, :integer

    belongs_to :role, MyApp.Role
    has_many :posts, MyApp.Post

    timestamps()
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :age])
    |> validate_required([:name, :email])
  end
end
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('users')

    // Has implicit id + 3 fields + timestamps = 6 fields
    expect(entity.fields.length).toBeGreaterThanOrEqual(5)

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)

    const name = entity.fields.find((f) => f.name === 'name')
    expect(name?.type).toBe('string')

    const insertedAt = entity.fields.find((f) => f.name === 'inserted_at')
    expect(insertedAt).toBeDefined()

    expect(entity.relationships).toHaveLength(2)
    const belongsTo = entity.relationships.find((r) => r.type === 'many_to_one')
    expect(belongsTo?.targetEntity).toBe('Role')
  })

  it('returns empty for non-Ecto files', async () => {
    const extractor = makeExtractor({
      'lib/foo.ex': `defmodule Foo do\nend\n`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
