import { describe, it, expect, vi } from 'vitest'
import { MinimalApiExtractor } from '../minimalApi'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): MinimalApiExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'C#', approach: 'minimal_api', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new MinimalApiExtractor(ctx)
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

describe('MinimalApiExtractor', () => {
  it('extracts routes from basic Minimal API Program.cs', async () => {
    const extractor = makeExtractor({
      'Program.cs': `
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/users", () => Results.Ok(new[] { "Alice", "Bob" }));
app.MapGet("/users/{id}", (int id) => Results.Ok(id));
app.MapPost("/users", ([FromBody] UserDto dto) => Results.Created("/users/1", dto));
app.MapPut("/users/{id}", (int id, [FromBody] UserDto dto) => Results.NoContent());
app.MapDelete("/users/{id}", (int id) => Results.NoContent());

app.Run();
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(5)

    expect(eps[0]).toMatchObject({ httpMethod: 'GET', path: '/users' })
    expect(eps[1]).toMatchObject({ httpMethod: 'GET', path: '/users/{id}' })
    expect(eps[1].parameters).toContainEqual({ name: 'id', location: 'path', required: true })
    expect(eps[2]).toMatchObject({ httpMethod: 'POST', path: '/users' })
    expect(eps[2].parameters).toContainEqual({ name: 'dto', location: 'body', required: true })
    expect(eps[3]).toMatchObject({ httpMethod: 'PUT', path: '/users/{id}' })
    expect(eps[4]).toMatchObject({ httpMethod: 'DELETE', path: '/users/{id}' })
  })

  it('handles MapGroup route groups', async () => {
    const extractor = makeExtractor({
      'Program.cs': `
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var api = app.MapGroup("/api/v1");
api.MapGet("/products", GetProducts);
api.MapGet("/products/{id:int}", GetProduct);
api.MapPost("/products", CreateProduct);

app.Run();
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(3)
    expect(eps[0]).toMatchObject({ path: '/api/v1/products', httpMethod: 'GET' })
    expect(eps[1]).toMatchObject({ path: '/api/v1/products/{id:int}', httpMethod: 'GET' })
    expect(eps[2]).toMatchObject({ path: '/api/v1/products', httpMethod: 'POST' })
  })

  it('returns empty surfaces when no Map* routes found', async () => {
    const extractor = makeExtractor({
      'Helper.cs': `
public static class Helper {
    public static string Format(string s) => s.ToLower();
}
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
