import { describe, it, expect, vi } from 'vitest'
import { JaxRsExtractor } from '../jaxRs'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): JaxRsExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'jax_rs', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new JaxRsExtractor(ctx)
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

describe('JaxRsExtractor', () => {
  describe('basic resource detection', () => {
    it('extracts a simple JAX-RS resource with @GET', async () => {
      const extractor = makeExtractor({
        'UserResource.java': `
package com.example.resource;

import jakarta.ws.rs.*;

@Path("/users")
public class UserResource {

    @GET
    public List<User> list() {
        return userService.findAll();
    }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('UserResource')
      expect(surface.basePath).toBe('/users')
      expect(surface.packageOrModule).toBe('com.example.resource')
      expect(surface.apiStyle).toBe('http')
      expect(surface.endpoints).toHaveLength(1)
      expect(surface.endpoints[0].httpMethod).toBe('GET')
      expect(surface.endpoints[0].path).toBe('/users')
    })

    it('extracts multiple HTTP methods', async () => {
      const extractor = makeExtractor({
        'OrderResource.java': `
@Path("/orders")
public class OrderResource {
    @GET
    public List<Order> list() { return null; }

    @POST
    public Order create(OrderRequest req) { return null; }

    @GET @Path("/{id}")
    public Order get(@PathParam("id") Long id) { return null; }

    @PUT @Path("/{id}")
    public Order update(@PathParam("id") Long id, OrderRequest req) { return null; }

    @DELETE @Path("/{id}")
    public void delete(@PathParam("id") Long id) {}
}
`,
      })

      const result = await extractor.extract()
      const surface = result.surfaces[0]
      expect(surface.endpoints).toHaveLength(5)
      const methods = surface.endpoints.map((e) => e.httpMethod)
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('PUT')
      expect(methods).toContain('DELETE')
    })

    it('returns empty when no @Path annotation present', async () => {
      const extractor = makeExtractor({
        'ServiceBean.java': `
public class UserServiceBean {
    public User findById(Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(0)
    })
  })

  describe('path resolution', () => {
    it('concatenates class-level and method-level @Path', async () => {
      const extractor = makeExtractor({
        'UserResource.java': `
@Path("/api/users")
public class UserResource {
    @GET
    @Path("/{userId}/profile")
    public Profile getProfile(@PathParam("userId") Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].path).toBe('/api/users/{userId}/profile')
    })

    it('handles method with no sub-path (inherits class path only)', async () => {
      const extractor = makeExtractor({
        'ItemResource.java': `
@Path("/items")
public class ItemResource {
    @GET
    public List<Item> list() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].path).toBe('/items')
    })
  })

  describe('parameter extraction', () => {
    it('extracts @PathParam parameters', async () => {
      const extractor = makeExtractor({
        'UserResource.java': `
@Path("/users")
public class UserResource {
    @GET
    @Path("/{id}")
    public User get(@PathParam("id") Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      const pathParam = params.find((p) => p.location === 'path')!
      expect(pathParam.name).toBe('id')
      expect(pathParam.required).toBe(true)
    })

    it('extracts @QueryParam parameters', async () => {
      const extractor = makeExtractor({
        'SearchResource.java': `
@Path("/search")
public class SearchResource {
    @GET
    public List<Result> search(
        @QueryParam("q") String query,
        @QueryParam("page") Integer page
    ) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      const qParam = params.find((p) => p.name === 'q')!
      expect(qParam.location).toBe('query')
      expect(qParam.required).toBe(false)

      const pageParam = params.find((p) => p.name === 'page')!
      expect(pageParam.location).toBe('query')
    })

    it('extracts @FormParam parameters', async () => {
      const extractor = makeExtractor({
        'LoginResource.java': `
@Path("/auth")
public class LoginResource {
    @POST
    @Path("/login")
    public Token login(
        @FormParam("username") String username,
        @FormParam("password") String password
    ) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(2)
      expect(params.every((p) => p.location === 'body')).toBe(true)
    })

    it('detects path template params not declared with @PathParam', async () => {
      const extractor = makeExtractor({
        'Resource.java': `
@Path("/items")
public class Resource {
    @GET
    @Path("/{categoryId}/products/{productId}")
    public Product get() { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      const names = params.map((p) => p.name)
      expect(names).toContain('categoryId')
      expect(names).toContain('productId')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'UserResource.java': `
@Path("/users")
public class UserResource {
    @GET
    public List<User> list() { return null; }
    @POST
    public User create(UserRequest req) { return null; }
    @GET @Path("/{id}")
    public User get(@PathParam("id") Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.surfacesFound).toBe(1)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
