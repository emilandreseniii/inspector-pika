import { describe, it, expect, vi } from 'vitest'
import { NetflixDgsExtractor } from '../netflixDgs'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): NetflixDgsExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'netflix_dgs', apiStyle: 'graphql', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new NetflixDgsExtractor(ctx)
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

describe('NetflixDgsExtractor', () => {
  describe('basic operation detection', () => {
    it('extracts @DgsQuery methods as Query operations', async () => {
      const extractor = makeExtractor({
        'ShowFetcher.java': `
package com.example.fetcher;
import com.netflix.graphql.dgs.*;

@DgsComponent
public class ShowFetcher {

  @DgsQuery
  public List<Show> shows() { return null; }

  @DgsQuery
  public Show show(@InputArgument Integer id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('ShowFetcher')
      expect(surface.apiStyle).toBe('graphql')
      expect(surface.endpoints).toHaveLength(2)
      expect(surface.endpoints.every((e) => e.operationType === 'Query')).toBe(true)
    })

    it('extracts @DgsMutation methods as Mutation operations', async () => {
      const extractor = makeExtractor({
        'MutationFetcher.java': `
@DgsComponent
public class MutationFetcher {

  @DgsMutation
  public Show addShow(@InputArgument ShowInput show) { return null; }

  @DgsMutation
  public Boolean removeShow(@InputArgument Integer id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ops = result.surfaces[0].endpoints
      expect(ops).toHaveLength(2)
      expect(ops.every((e) => e.operationType === 'Mutation')).toBe(true)
    })

    it('extracts @DgsSubscription as Subscription operations', async () => {
      const extractor = makeExtractor({
        'SubFetcher.java': `
@DgsComponent
public class SubFetcher {
  @DgsSubscription
  public Publisher<Stock> stocks(@InputArgument String ticker) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationType).toBe('Subscription')
    })

    it('returns no surfaces when only @DgsComponent with no query methods', async () => {
      const extractor = makeExtractor({
        'Plain.java': `
@DgsComponent
public class Plain {
  public String helper() { return "hi"; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(0)
    })
  })

  describe('operation name extraction', () => {
    it('uses method name when no explicit field name given', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsQuery
  public Book bookById(@InputArgument Integer id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationName).toBe('bookById')
    })

    it('uses explicit field name from @DgsQuery("name")', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsQuery("book")
  public Book getBookById(@InputArgument Integer id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationName).toBe('book')
    })

    it('uses field= attribute for operation name', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsMutation(field = "addBook")
  public Book createBook(@InputArgument BookInput input) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationName).toBe('addBook')
    })
  })

  describe('@DgsData', () => {
    it('treats @DgsData with parentType=Query as Query operation', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsData(parentType = "Query", field = "shows")
  public List<Show> shows(DataFetchingEnvironment env) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.operationType).toBe('Query')
      expect(ep.operationName).toBe('shows')
    })

    it('captures @DgsData field resolver on non-root type with null operationType', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsData(parentType = "Show", field = "director")
  public Director director(DataFetchingEnvironment env) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.operationType).toBeUndefined()
      expect(ep.operationName).toBe('director')
      expect(ep.summary).toContain('Show')
    })
  })

  describe('parameter extraction', () => {
    it('extracts @InputArgument parameters', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsQuery
  public List<Show> shows(@InputArgument Integer page, @InputArgument Integer size) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(2)
      expect(params[0].name).toBe('page')
      expect(params[0].location).toBe('field')
      expect(params[0].required).toBe(true)
      expect(params[1].name).toBe('size')
    })

    it('extracts @InputArgument with explicit name', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsQuery
  public Show show(@InputArgument("showId") Integer id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].parameters[0].name).toBe('showId')
    })

    it('skips DataFetchingEnvironment injection parameter', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsQuery
  public Show show(@InputArgument Integer id, DataFetchingEnvironment env) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].parameters).toHaveLength(1)
      expect(result.surfaces[0].endpoints[0].parameters[0].name).toBe('id')
    })
  })

  describe('same-line annotation and method', () => {
    it('handles annotation and method signature on same line', async () => {
      const extractor = makeExtractor({
        'C.java': `
@DgsComponent
public class C {
  @DgsQuery public List<Show> shows() { return null; }
  @DgsMutation public Show addShow(@InputArgument ShowInput s) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints).toHaveLength(2)
      expect(result.surfaces[0].endpoints[0].operationType).toBe('Query')
      expect(result.surfaces[0].endpoints[1].operationType).toBe('Mutation')
    })
  })

  describe('metadata', () => {
    it('extracts package name', async () => {
      const extractor = makeExtractor({
        'C.java': `
package com.netflix.example.fetcher;
@DgsComponent
public class C {
  @DgsQuery
  public String ping() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].packageOrModule).toBe('com.netflix.example.fetcher')
    })

    it('tags endpoints with fetcher class name', async () => {
      const extractor = makeExtractor({
        'ShowDataFetcher.java': `
@DgsComponent
public class ShowDataFetcher {
  @DgsQuery
  public Show show(@InputArgument Integer id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].tags).toContain('ShowDataFetcher')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'A.java': `
@DgsComponent
public class A {
  @DgsQuery public String a() { return null; }
  @DgsQuery public String b() { return null; }
  @DgsMutation public String c() { return null; }
}
`,
        'B.java': `
@DgsComponent
public class B {
  @DgsQuery public String d() { return null; }
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
