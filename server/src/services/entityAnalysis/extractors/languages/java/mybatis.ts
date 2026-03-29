import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'
import { toSnakeCase } from '../../../normalizer'

export class MybatisExtractor extends BaseExtractor {
  readonly extractorId = 'java.mybatis'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    // Find MyBatis mapper XML files
    const xmlFiles = await this.glob('**/*.xml')
    const mapperFiles = xmlFiles.filter((f) => isMapperXml(f))

    for (const file of mapperFiles) {
      filesScanned++
      try {
        const content = await this.readFile(file)
        if (!/<mapper\b/.test(content)) continue
        const parsed = parseMapperXml(content, file, this.extractorId)
        entities.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    return {
      entities,
      warnings,
      stats: { filesScanned, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

function isMapperXml(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return lower.endsWith('mapper.xml') || lower.includes('/mapper/') || lower.includes('/mappers/')
}

function parseMapperXml(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // Extract resultMap blocks
  const resultMapPattern = /<resultMap\s+[^>]*id\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/resultMap>/g
  let m: RegExpExecArray | null

  while ((m = resultMapPattern.exec(content)) !== null) {
    const _mapId = m[1]
    const javaType = m[2]
    const body = m[3]

    // Derive entity/table name from java type (last segment of fully-qualified name)
    const typeName = javaType.split('.').pop() ?? javaType
    const tableName = toSnakeCase(typeName)

    const fields: RawField[] = []
    let pos = 1

    // Parse <id property="..." column="..." javaType="..." jdbcType="..."/>
    const idPattern = /<id\s+([^/]*)\/?>/g
    let idMatch: RegExpExecArray | null
    while ((idMatch = idPattern.exec(body)) !== null) {
      const attrs = idMatch[1]
      const col = extractAttr(attrs, 'column') ?? extractAttr(attrs, 'property') ?? 'id'
      const nativeType = extractAttr(attrs, 'jdbcType') ?? extractAttr(attrs, 'javaType') ?? 'unknown'
      fields.push({
        name: col,
        type: nativeType,
        nullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
        isUnique: true,
        defaultValue: null,
        ordinalPosition: pos++,
        metadata: {},
      })
    }

    // Parse <result property="..." column="..." javaType="..." jdbcType="..."/>
    const resultPattern = /<result\s+([^/]*)\/?>/g
    let resultMatch: RegExpExecArray | null
    while ((resultMatch = resultPattern.exec(body)) !== null) {
      const attrs = resultMatch[1]
      const col = extractAttr(attrs, 'column') ?? toSnakeCase(extractAttr(attrs, 'property') ?? '')
      if (!col) continue
      const nativeType = extractAttr(attrs, 'jdbcType') ?? extractAttr(attrs, 'javaType') ?? 'unknown'
      fields.push({
        name: col,
        type: nativeType,
        nullable: null,
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        defaultValue: null,
        ordinalPosition: pos++,
        metadata: {},
      })
    }

    if (fields.length > 0) {
      entities.push({
        name: tableName,
        entityType: 'table',
        fields,
        relationships: [],
        source: { file, startLine: null, endLine: null, format: 'mybatis_xml', extractorId },
        extractorId,
        confidence: 'medium',
        metadata: { javaType, resultMapId: _mapId },
      })
    }
  }

  return entities
}

function extractAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`))
  return m ? m[1] : null
}
