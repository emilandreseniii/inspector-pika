import { describe, it, expect, vi } from 'vitest'
import { KtorExtractor } from '../ktor'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): KtorExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Kotlin', approach: 'ktor', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new KtorExtractor(ctx)
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

describe('KtorExtractor', () => {
  it('extracts flat routing block routes', async () => {
    const extractor = makeExtractor({
      'src/plugins/Routing.kt': `
package com.example.plugins

import io.ktor.server.application.*
import io.ktor.server.routing.*

fun Application.configureRouting() {
    routing {
        get("/users") {
            call.respond(userService.findAll())
        }
        get("/users/{id}") {
            val id = call.parameters["id"]!!.toLong()
            call.respond(userService.findById(id))
        }
        post("/users") {
            val dto = call.receive<UserDto>()
            call.respond(userService.create(dto))
        }
        delete("/users/{id}") {
            userService.delete(call.parameters["id"]!!.toLong())
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(4)

    expect(eps[0]).toMatchObject({ httpMethod: 'GET', path: '/users' })
    expect(eps[1]).toMatchObject({ httpMethod: 'GET', path: '/users/{id}' })
    expect(eps[1].parameters).toEqual([{ name: 'id', location: 'path', required: true }])
    expect(eps[2]).toMatchObject({ httpMethod: 'POST', path: '/users' })
    expect(eps[3]).toMatchObject({ httpMethod: 'DELETE', path: '/users/{id}' })
  })

  it('handles nested route blocks with path prefixes', async () => {
    const extractor = makeExtractor({
      'src/routes.kt': `
import io.ktor.server.routing.*

fun Application.apiRoutes() {
    routing {
        route("/api/v1") {
            get("/products") {
                call.respond(productService.list())
            }
            post("/products") {
                call.respond(productService.create(call.receive()))
            }
            route("/products/{id}") {
                get {
                    call.respond(productService.get(call.parameters["id"]!!.toInt()))
                }
                put {
                    call.respond(productService.update(call.parameters["id"]!!.toInt(), call.receive()))
                }
            }
        }
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(4)
    expect(eps[0]).toMatchObject({ path: '/api/v1/products', httpMethod: 'GET' })
    expect(eps[1]).toMatchObject({ path: '/api/v1/products', httpMethod: 'POST' })
    expect(eps[2]).toMatchObject({ path: '/api/v1/products/{id}', httpMethod: 'GET' })
    expect(eps[3]).toMatchObject({ path: '/api/v1/products/{id}', httpMethod: 'PUT' })
  })

  it('returns empty surfaces when no routing block found', async () => {
    const extractor = makeExtractor({
      'src/Service.kt': `
class UserService {
    fun findAll() = userRepo.findAll()
}
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
