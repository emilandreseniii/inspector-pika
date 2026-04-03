import { describe, it, expect, vi } from 'vitest'
import { EfCoreExtractor } from '../efCore'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): EfCoreExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'C#', approach: 'ef_core', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new EfCoreExtractor(ctx)
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

describe('EfCoreExtractor', () => {
  it('extracts entity from DbContext DbSet types', async () => {
    const extractor = makeExtractor({
      'Data/AppDbContext.cs': `
using Microsoft.EntityFrameworkCore;
namespace MyApp.Data;

public class AppDbContext : DbContext
{
    public DbSet<User> Users { get; set; }
    public DbSet<Post> Posts { get; set; }
}
`,
      'Models/User.cs': `
namespace MyApp.Models;

public class User
{
    public int Id { get; set; }
    public string Email { get; set; }
    public string? Name { get; set; }
    public bool IsAdmin { get; set; }
    public ICollection<Post> Posts { get; set; }
}
`,
      'Models/Post.cs': `
namespace MyApp.Models;

public class Post
{
    public int Id { get; set; }
    public string Title { get; set; }
    public int UserId { get; set; }
    public User User { get; set; }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities.length).toBeGreaterThanOrEqual(2)

    const user = result.entities.find((e) => e.name === 'user')
    expect(user).toBeDefined()

    const idField = user!.fields.find((f) => f.name === 'id')
    expect(idField!.isPrimaryKey).toBe(true)

    const emailField = user!.fields.find((f) => f.name === 'email')
    expect(emailField!.type).toBe('string')

    const nameField = user!.fields.find((f) => f.name === 'name')
    expect(nameField!.nullable).toBe(true)

    // ICollection<Post> → one_to_many
    const postsRel = user!.relationships.find((r) => r.type === 'one_to_many' && r.targetEntity === 'Post')
    expect(postsRel).toBeDefined()
  })

  it('respects [Table] attribute for table name', async () => {
    const extractor = makeExtractor({
      'Models/Product.cs': `
using System.ComponentModel.DataAnnotations.Schema;
namespace MyApp.Models;

[Table("products")]
public class Product
{
    [Key]
    public int Id { get; set; }
    public string Name { get; set; }
}
`,
    })

    const result = await extractor.extract()
    const product = result.entities.find((e) => e.name === 'products')
    expect(product).toBeDefined()
  })

  it('extracts [Key] and [Required] attributes', async () => {
    const extractor = makeExtractor({
      'Models/Order.cs': `
using System.ComponentModel.DataAnnotations;
namespace MyApp.Models;

[Table("orders")]
public class Order
{
    [Key]
    public Guid OrderId { get; set; }
    [Required]
    public string CustomerName { get; set; }
    public decimal Total { get; set; }
}
`,
    })

    const result = await extractor.extract()
    const order = result.entities.find((e) => e.name === 'orders')
    expect(order).toBeDefined()

    const pk = order!.fields.find((f) => f.isPrimaryKey)
    expect(pk?.type).toBe('uuid')

    const customerName = order!.fields.find((f) => f.name === 'customer_name')
    expect(customerName!.nullable).toBe(false)
  })
})
