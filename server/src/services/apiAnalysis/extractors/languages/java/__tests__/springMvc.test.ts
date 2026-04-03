import { describe, it, expect, vi } from 'vitest'
import { SpringMvcExtractor } from '../springMvc'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SpringMvcExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'spring_mvc', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SpringMvcExtractor(ctx)
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

describe('SpringMvcExtractor', () => {
  describe('basic controller detection', () => {
    it('extracts a simple @RestController with @GetMapping', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
package com.example.controller;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    @GetMapping
    public List<UserResponse> list() {
        return userService.findAll();
    }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('UserController')
      expect(surface.basePath).toBe('/api/v1/users')
      expect(surface.packageOrModule).toBe('com.example.controller')
      expect(surface.apiStyle).toBe('http')
      expect(surface.endpoints).toHaveLength(1)

      const ep = surface.endpoints[0]
      expect(ep.httpMethod).toBe('GET')
      expect(ep.path).toBe('/api/v1/users')
    })

    it('extracts multiple HTTP methods with paths', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
@RestController
@RequestMapping("/users")
public class UserController {

    @GetMapping
    public List<User> list() { return null; }

    @PostMapping
    public User create(@RequestBody UserRequest req) { return null; }

    @GetMapping("/{id}")
    public User get(@PathVariable Long id) { return null; }

    @PutMapping("/{id}")
    public User update(@PathVariable Long id, @RequestBody UserRequest req) { return null; }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {}
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

    it('skips files without @Controller or @RestController', async () => {
      const extractor = makeExtractor({
        'Service.java': `
public class UserService {
    public List<User> findAll() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(0)
    })
  })

  describe('path resolution', () => {
    it('concatenates class-level @RequestMapping with method-level path', async () => {
      const extractor = makeExtractor({
        'OrderController.java': `
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {
    @GetMapping("/{orderId}/items")
    public List<Item> getItems(@PathVariable Long orderId) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.path).toBe('/api/v1/orders/{orderId}/items')
    })

    it('handles @RequestMapping with value= keyword', async () => {
      const extractor = makeExtractor({
        'ProductController.java': `
@RestController
@RequestMapping(value = "/products")
public class ProductController {
    @GetMapping
    public List<Product> list() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].basePath).toBe('/products')
    })

    it('handles @GetMapping with value= keyword', async () => {
      const extractor = makeExtractor({
        'ItemController.java': `
@RestController
@RequestMapping("/items")
public class ItemController {
    @GetMapping(value = "/{id}")
    public Item get(@PathVariable Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.path).toBe('/items/{id}')
    })

    it('produces root path when no class or method path given', async () => {
      const extractor = makeExtractor({
        'HealthController.java': `
@RestController
public class HealthController {
    @GetMapping("/health")
    public String health() { return "ok"; }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.path).toBe('/health')
    })
  })

  describe('parameter extraction', () => {
    it('extracts @PathVariable parameters', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
@RestController
@RequestMapping("/users")
public class UserController {
    @GetMapping("/{id}")
    public User get(@PathVariable Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(1)
      expect(params[0].name).toBe('id')
      expect(params[0].location).toBe('path')
      expect(params[0].required).toBe(true)
    })

    it('extracts @PathVariable with explicit name', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
@RestController
@RequestMapping("/users")
public class UserController {
    @DeleteMapping("/{userId}")
    public void delete(@PathVariable("userId") Long id) {}
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params[0].name).toBe('userId')
      expect(params[0].location).toBe('path')
    })

    it('extracts @RequestParam parameters', async () => {
      const extractor = makeExtractor({
        'SearchController.java': `
@RestController
public class SearchController {
    @GetMapping("/search")
    public List<Result> search(
        @RequestParam String query,
        @RequestParam(required = false) Integer limit
    ) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(2)

      const query = params.find((p) => p.name === 'query')!
      expect(query.location).toBe('query')
      expect(query.required).toBe(true)

      const limit = params.find((p) => p.name === 'limit')!
      expect(limit.location).toBe('query')
      expect(limit.required).toBe(false)
    })

    it('extracts @RequestBody parameter', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
@RestController
@RequestMapping("/users")
public class UserController {
    @PostMapping
    public User create(@RequestBody UserCreateRequest request) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      const body = params.find((p) => p.location === 'body')!
      expect(body).toBeDefined()
      expect(body.type).toBe('UserCreateRequest')
      expect(body.required).toBe(true)
    })

    it('extracts multiple parameter types together', async () => {
      const extractor = makeExtractor({
        'OrderController.java': `
@RestController
@RequestMapping("/orders")
public class OrderController {
    @PutMapping("/{orderId}")
    public Order update(
        @PathVariable Long orderId,
        @RequestParam(required = false) String note,
        @RequestBody OrderUpdateRequest body
    ) { return null; }
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters

      const pathParam = params.find((p) => p.location === 'path')!
      expect(pathParam.name).toBe('orderId')

      const queryParam = params.find((p) => p.location === 'query')!
      expect(queryParam.name).toBe('note')
      expect(queryParam.required).toBe(false)

      const bodyParam = params.find((p) => p.location === 'body')!
      expect(bodyParam.type).toBe('OrderUpdateRequest')
    })
  })

  describe('return type extraction', () => {
    it('extracts simple return type', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
@RestController
@RequestMapping("/users")
public class UserController {
    @GetMapping("/{id}")
    public UserResponse getUser(@PathVariable Long id) { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].returnType).toBe('UserResponse')
    })
  })

  describe('multi-line annotations', () => {
    it('handles @RequestMapping spread across multiple lines', async () => {
      const extractor = makeExtractor({
        'ProductController.java': `
@RestController
@RequestMapping(
    value = "/products",
    produces = "application/json"
)
public class ProductController {
    @GetMapping
    public List<Product> list() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].basePath).toBe('/products')
    })
  })

  describe('tags', () => {
    it('tags endpoints with the controller class name', async () => {
      const extractor = makeExtractor({
        'InvoiceController.java': `
@RestController
@RequestMapping("/invoices")
public class InvoiceController {
    @GetMapping
    public List<Invoice> list() { return null; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].tags).toContain('InvoiceController')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'UserController.java': `
@RestController
@RequestMapping("/users")
public class UserController {
    @GetMapping
    public List<User> list() { return null; }
    @PostMapping
    public User create(@RequestBody UserRequest r) { return null; }
}
`,
        'UserService.java': `public class UserService {}`,
      })

      const result = await extractor.extract()
      // UserService.java has no @RestController but grep mock will still include it;
      // the parser filters it out. surfacesFound = 1, endpointsFound = 2.
      expect(result.stats.surfacesFound).toBe(1)
      expect(result.stats.endpointsFound).toBe(2)
    })
  })
})
