import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const GRAPE_METHODS: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class GrapeExtractor extends BaseApiExtractor {
  readonly extractorId = 'ruby.grape'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.rb',
      /Grape::API|< Grape::API/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseGrapeFile(content, file)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned: uniqueFiles.length, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

function parseGrapeFile(content: string, file: string): RawApiSurface | null {
  // Find class name
  const classMatch = content.match(/class\s+(\w+)\s*<\s*Grape::API/)
  const className = classMatch?.[1] ?? file.split('/').pop()?.replace(/\.rb$/, '') ?? 'GrapeAPI'

  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Track prefix from `prefix :api` or `namespace '/v1'`
  let prefix = ''
  // Stack entries: string = namespace segment added, null = non-namespace `do` block (verb/class/etc.)
  const blockStack: Array<string | null> = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    // end → pop block
    if (trimmed === 'end') {
      blockStack.pop()
      continue
    }

    // prefix :api or prefix '/api'
    const prefixMatch = trimmed.match(/^prefix\s+(?::(\w+)|['"]([^'"]+)['"])/)
    if (prefixMatch) {
      prefix = prefixMatch[1] ? '/' + prefixMatch[1] : prefixMatch[2]
      if (!prefix.startsWith('/')) prefix = '/' + prefix
      continue
    }

    // class Foo < Grape::API → push null (tracks class-level end)
    if (trimmed.match(/^class\s+\w+.*do\s*$/) || trimmed.match(/^class\s+\w+\s*</)) {
      blockStack.push(null)
      continue
    }

    // namespace '/v1' do or resource :users do
    const nsMatch = trimmed.match(/^(?:namespace|resource|group|segment)\s+(?::(\w+)|['"]([^'"]+)['"]).+?do/)
    if (nsMatch) {
      const seg = nsMatch[1] ? `/${nsMatch[1]}` : nsMatch[2]
      blockStack.push(seg.startsWith('/') ? seg : '/' + seg)
      continue
    }

    const currentNs = prefix + blockStack.filter((s): s is string => s !== null).join('')

    // HTTP verb: get do | get '/path' do | get ':id' do
    for (const [verb, method] of Object.entries(GRAPE_METHODS)) {
      const verbRe = new RegExp('^' + verb + '(?:\\s+(?::?(\\w+)|\'([^\']+)\'|"([^"]+)"))?(?:\\s+do|\\s*$|\\s*;)')
      const verbMatch = trimmed.match(verbRe)
      if (!verbMatch) continue

      let path: string
      if (verbMatch[1]) {
        const raw = ':' + verbMatch[1]
        path = currentNs + (raw.startsWith('/') ? raw : '/' + raw)
      } else if (verbMatch[2] || verbMatch[3]) {
        const raw = verbMatch[2] ?? verbMatch[3]
        path = currentNs + (raw.startsWith('/') ? raw : '/' + raw)
      } else {
        path = currentNs || '/'
      }
      const parameters = extractPathParams(path)
      endpoints.push({ httpMethod: method, path, parameters, tags: [className], sourceFile: file, sourceLine: i + 1 })
      // If this verb line opens a block (ends with `do`), push null so `end` is consumed
      if (/\bdo\s*$/.test(trimmed)) blockStack.push(null)
      break
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: className,
    apiStyle: 'http',
    basePath: prefix || undefined,
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/:(\w+)/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/#.*$/gm, '')
}
