import { describe, it, expect, vi } from 'vitest'
import { SpringGraphqlExtractor } from '../springGraphql'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SpringGraphqlExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'spring_graphql', apiStyle: 'graphql', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SpringGraphqlExtractor(ctx)
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

describe('SpringGraphqlExtractor', () => {
  describe('basic operation detection', () => {
    it('extracts @QueryMapping methods as Query operations', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
package com.example;
import org.springframework.graphql.data.method.annotation.*;

@Controller
public class UserController {

  @QueryMapping
  public User user(@Argument Long id) { return null; }

  @QueryMapping
  public List<User> users() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)
      const surface = result.surfaces[0]
      expect(surface.name).toBe('UserController')
      expect(surface.apiStyle).toBe('graphql')
      expect(surface.endpoints).toHaveLength(2)

      const ops = surface.endpoints.map((e) => e.operationType)
      expect(ops).toEqual(['Query', 'Query'])
    })

    it('extracts @MutationMapping methods as Mutation operations', async () => {
      const extractor = makeExtractor({
        'UserMutations.java': `
@Controller
public class UserMutations {

  @MutationMapping
  public User createUser(@Argument UserInput input) { return null; }

  @MutationMapping
  public Boolean deleteUser(@Argument Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ops = result.surfaces[0].endpoints
      expect(ops).toHaveLength(2)
      expect(ops.every((e) => e.operationType === 'Mutation')).toBe(true)
    })

    it('extracts @SubscriptionMapping as Subscription operations', async () => {
      const extractor = makeExtractor({
        'EventSub.java': `
@Controller
public class EventSub {
  @SubscriptionMapping
  public Publisher<Event> onEvent() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationType).toBe('Subscription')
    })

    it('returns no surfaces when no mapping annotations present', async () => {
      const extractor = makeExtractor({
        'Plain.java': `
@Service
public class Plain {
  public String hello() { return "hi"; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(0)
    })
  })

  describe('operation name extraction', () => {
    it('uses method name when no explicit name given', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @QueryMapping
  public Book bookById(@Argument Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationName).toBe('bookById')
    })

    it('uses explicit name from @QueryMapping("name")', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @QueryMapping("book")
  public Book getBookById(@Argument Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationName).toBe('book')
    })

    it('uses value= attribute for operation name', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @MutationMapping(value = "addBook")
  public Book createBook(@Argument BookInput input) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationName).toBe('addBook')
    })
  })

  describe('@SchemaMapping', () => {
    it('detects root-type @SchemaMapping as Query operation', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @SchemaMapping(typeName = "Query", field = "allBooks")
  public List<Book> allBooks() { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.operationType).toBe('Query')
      expect(ep.operationName).toBe('allBooks')
    })

    it('captures field resolver with non-root typeName as null operationType', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @SchemaMapping(typeName = "Book")
  public Author author(Book book) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.operationType).toBeUndefined()
      expect(ep.operationName).toBe('author')
      expect(ep.summary).toContain('Book')
    })
  })

  describe('parameter extraction', () => {
    it('extracts @Argument parameters', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @QueryMapping
  public Product product(@Argument Long id, @Argument String slug) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(2)
      expect(params[0].name).toBe('id')
      expect(params[0].location).toBe('field')
      expect(params[0].required).toBe(true)
      expect(params[1].name).toBe('slug')
    })

    it('extracts @Argument with explicit name', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @QueryMapping
  public User user(@Argument("userId") Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].parameters[0].name).toBe('userId')
    })

    it('skips DataFetchingEnvironment injection parameter', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @QueryMapping
  public Book book(@Argument Long id, DataFetchingEnvironment env) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(1)
      expect(params[0].name).toBe('id')
    })

    it('skips @ContextValue injection parameter', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @QueryMapping
  public List<Order> orders(@Argument Long userId, @ContextValue String token) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].parameters).toHaveLength(1)
    })
  })

  describe('return type extraction', () => {
    it('extracts simple return type', async () => {
      const extractor = makeExtractor({
        'C.java': `
@Controller
public class C {
  @QueryMapping
  public UserResponse getUser(@Argument Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].returnType).toBe('UserResponse')
    })
  })

  describe('package and class metadata', () => {
    it('extracts package name', async () => {
      const extractor = makeExtractor({
        'C.java': `
package com.example.graphql;
@Controller
public class C {
  @QueryMapping
  public String hello() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].packageOrModule).toBe('com.example.graphql')
    })

    it('tags endpoints with controller class name', async () => {
      const extractor = makeExtractor({
        'BookController.java': `
@Controller
public class BookController {
  @QueryMapping
  public Book book(@Argument Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].tags).toContain('BookController')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'A.java': `
@Controller
public class A {
  @QueryMapping public String a() { return null; }
  @QueryMapping public String b() { return null; }
  @MutationMapping public String c() { return null; }
}
`,
        'B.java': `
@Controller
public class B {
  @QueryMapping public String d() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(4)
    })
  })
})
