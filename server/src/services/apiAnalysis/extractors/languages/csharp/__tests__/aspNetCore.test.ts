import { describe, it, expect, vi } from 'vitest'
import { AspNetCoreExtractor } from '../aspNetCore'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): AspNetCoreExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'C#', approach: 'aspnet_core', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new AspNetCoreExtractor(ctx)
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

describe('AspNetCoreExtractor', () => {
  it('extracts endpoints from a controller with [Route] and HTTP verb attributes', async () => {
    const extractor = makeExtractor({
      'Controllers/UsersController.cs': `
using Microsoft.AspNetCore.Mvc;

namespace MyApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();

    [HttpGet("{id}")]
    public IActionResult GetById(int id) => Ok();

    [HttpPost]
    public IActionResult Create([FromBody] UserDto dto) => Created();

    [HttpPut("{id}")]
    public IActionResult Update(int id, [FromBody] UserDto dto) => Ok();

    [HttpDelete("{id}")]
    public IActionResult Delete(int id) => Ok();
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const endpoints = result.surfaces[0].endpoints

    expect(endpoints.find((e) => e.httpMethod === 'GET' && !e.path.includes('{id}'))).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path.includes('{id}'))).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'POST')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'PUT')).toBeDefined()
    expect(endpoints.find((e) => e.httpMethod === 'DELETE')).toBeDefined()
  })

  it('expands [controller] token in route', async () => {
    const extractor = makeExtractor({
      'Controllers/ProductsController.cs': `
[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet("{id}")]
    public IActionResult Get(int id) => Ok();
}
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.path).toContain('products')
    expect(ep.path).toContain('{id}')
  })

  it('extracts path parameters', async () => {
    const extractor = makeExtractor({
      'Controllers/OrdersController.cs': `
[ApiController]
[Route("api/users/{userId}/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet("{orderId}")]
    public IActionResult Get(int userId, int orderId) => Ok();
}
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters.find((p) => p.name === 'userId')).toBeDefined()
    expect(ep.parameters.find((p) => p.name === 'orderId')).toBeDefined()
  })

  it('handles all HTTP methods', async () => {
    const extractor = makeExtractor({
      'Controllers/TestController.cs': `
[ApiController]
public class TestController : ControllerBase
{
    [HttpGet("/a")]
    public IActionResult A() => Ok();

    [HttpPost("/b")]
    public IActionResult B() => Ok();

    [HttpPut("/c")]
    public IActionResult C() => Ok();

    [HttpPatch("/d")]
    public IActionResult D() => Ok();

    [HttpDelete("/e")]
    public IActionResult E() => Ok();
}
`,
    })

    const result = await extractor.extract()
    const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('PUT')
    expect(methods).toContain('PATCH')
    expect(methods).toContain('DELETE')
  })
})
