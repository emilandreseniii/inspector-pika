import { describe, it, expect, vi } from 'vitest'
import { DapperExtractor } from '../dapper'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): DapperExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'C#', approach: 'dapper', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new DapperExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      content.split('\n').forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text })
      })
    }
    return hits
  })
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('DapperExtractor', () => {
  it('extracts DTO types used in Query<T> calls', async () => {
    const extractor = makeExtractor({
      'Repositories/UserRepository.cs': `
using Dapper;

public class UserRepository
{
    public async Task<IEnumerable<UserDto>> GetAllAsync()
    {
        return await connection.QueryAsync<UserDto>(
            "SELECT id, email, name FROM users");
    }
}
`,
      'Models/UserDto.cs': `
namespace MyApp.Models;

public class UserDto
{
    public int Id { get; set; }
    public string Email { get; set; }
    public string? Name { get; set; }
    public bool IsActive { get; set; }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)
    const user = result.entities[0]
    expect(user.name).toBe('user')

    const id = user.fields.find((f) => f.name === 'id')
    expect(id!.isPrimaryKey).toBe(true)

    const email = user.fields.find((f) => f.name === 'email')
    expect(email!.type).toBe('string')

    const name = user.fields.find((f) => f.name === 'name')
    expect(name!.nullable).toBe(true)
  })
})
