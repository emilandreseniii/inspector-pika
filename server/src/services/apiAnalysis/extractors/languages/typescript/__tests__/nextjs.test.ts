import { describe, it, expect, vi } from 'vitest'
import { NextJsApiExtractor } from '../nextjs'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): NextJsApiExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'nextjs_api', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new NextJsApiExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      if (!matchGlob(_glob, file)) continue
      const lines = content.split('\n')
      lines.forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text })
      })
    }
    return hits
  })
  vi.spyOn(extractor as any, 'glob').mockImplementation(async (pattern: string) => {
    return Object.keys(files).filter((f) => matchGlob(pattern, f))
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

function matchGlob(pattern: string, file: string): boolean {
  // Simplified glob matcher for tests
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '(?:.+/)?')
    .replace(/\*\.(\{[^}]+\}|\w+)/g, '[^/]+\\.$1')
    .replace(/\{([^}]+)\}/g, (_, group) => `(?:${group.split(',').join('|')})`)
    .replace(/\*/g, '[^/]+')
  try {
    return new RegExp(`^${regexStr}$`).test(file)
  } catch {
    return file.includes(pattern.replace(/\*/g, ''))
  }
}

describe('NextJsApiExtractor', () => {
  it('extracts routes from Pages Router api files', async () => {
    const extractor = makeExtractor({
      'pages/api/users.ts': `
import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    res.json([])
  } else if (req.method === 'POST') {
    res.status(201).json({})
  }
}
`,
      'pages/api/users/[id].ts': `
import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    res.json({ id: req.query.id })
  } else if (req.method === 'DELETE') {
    res.status(204).end()
  }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(2)

    const usersSurface = result.surfaces.find((s) => s.file === 'pages/api/users.ts')
    expect(usersSurface?.endpoints.map((e) => e.httpMethod).sort()).toEqual(['GET', 'POST'])
    expect(usersSurface?.endpoints[0].path).toBe('/api/users')

    const userByIdSurface = result.surfaces.find((s) => s.file === 'pages/api/users/[id].ts')
    expect(userByIdSurface?.endpoints.map((e) => e.httpMethod).sort()).toEqual(['DELETE', 'GET'])
    expect(userByIdSurface?.endpoints[0].path).toBe('/api/users/[id]')
    const idParam = userByIdSurface?.endpoints[0].parameters.find((p) => p.name === 'id')
    expect(idParam?.in).toBe('path')
  })

  it('extracts routes from App Router route files', async () => {
    const extractor = makeExtractor({
      'app/api/products/route.ts': `
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  return Response.json([])
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  return Response.json(body, { status: 201 })
}
`,
      'app/api/products/[id]/route.ts': `
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id })
}

export const DELETE = async (request: NextRequest) => {
  return new Response(null, { status: 204 })
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(2)

    const productsSurface = result.surfaces.find((s) => s.file === 'app/api/products/route.ts')
    expect(productsSurface?.endpoints.map((e) => e.httpMethod).sort()).toEqual(['GET', 'POST'])
    expect(productsSurface?.endpoints[0].path).toBe('/api/products')

    const productByIdSurface = result.surfaces.find((s) => s.file === 'app/api/products/[id]/route.ts')
    expect(productByIdSurface?.endpoints.map((e) => e.httpMethod).sort()).toEqual(['DELETE', 'GET'])
    expect(productByIdSurface?.endpoints[0].path).toBe('/api/products/[id]')
  })
})
