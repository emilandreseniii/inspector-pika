import { describe, it, expect, vi } from 'vitest'
import { SpringDataJdbcExtractor } from '../springDataJdbc'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SpringDataJdbcExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'spring_data_jdbc', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SpringDataJdbcExtractor(ctx)
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

describe('SpringDataJdbcExtractor', () => {
  describe('basic entity extraction', () => {
    it('extracts a simple @Table entity', async () => {
      const extractor = makeExtractor({
        'Customer.java': `
package com.example.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;

@Table("customers")
public class Customer {
  @Id
  private Long id;
  private String firstName;
  private String lastName;
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const entity = result.entities[0]
      expect(entity.name).toBe('customers')
      expect(entity.entityType).toBe('table')
      expect(entity.extractorId).toBe('java.spring_data_jdbc')
      expect(entity.confidence).toBe('high')
      expect(entity.metadata.javaClass).toBe('Customer')
      expect(entity.metadata.packageName).toBe('com.example.domain')

      const fieldNames = entity.fields.map((f) => f.name)
      expect(fieldNames).toContain('id')
      expect(fieldNames).toContain('first_name')
      expect(fieldNames).toContain('last_name')
    })

    it('derives table name from class name when @Table has no explicit name', async () => {
      const extractor = makeExtractor({
        'OrderItem.java': `
@Table
public class OrderItem {
  @Id
  private Long id;
  private Integer quantity;
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].name).toBe('order_item')
    })

    it('skips JPA @Entity files', async () => {
      const extractor = makeExtractor({
        'JpaEntity.java': `
@Entity
@Table(name = "jpa_things")
public class JpaThing {
  @Id
  private Long id;
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(0)
    })
  })

  describe('field extraction', () => {
    it('marks @Id field as primary key', async () => {
      const extractor = makeExtractor({
        'Product.java': `
@Table("products")
public class Product {
  @Id
  private Long id;
  private String name;
}
`,
      })

      const result = await extractor.extract()
      const idField = result.entities[0].fields.find((f) => f.name === 'id')
      expect(idField?.isPrimaryKey).toBe(true)
      expect(idField?.nullable).toBe(false)
      expect(idField?.isUnique).toBe(true)
    })

    it('uses @Column value for column name', async () => {
      const extractor = makeExtractor({
        'User.java': `
@Table("users")
public class User {
  @Id
  private Long id;

  @Column("full_name")
  private String name;

  @Column(value = "email_address")
  private String email;
}
`,
      })

      const result = await extractor.extract()
      const fieldNames = result.entities[0].fields.map((f) => f.name)
      expect(fieldNames).toContain('full_name')
      expect(fieldNames).toContain('email_address')
    })

    it('skips @Transient fields', async () => {
      const extractor = makeExtractor({
        'Account.java': `
@Table("accounts")
public class Account {
  @Id
  private Long id;

  @Transient
  private String computedValue;

  private String status;
}
`,
      })

      const result = await extractor.extract()
      const fieldNames = result.entities[0].fields.map((f) => f.name)
      expect(fieldNames).not.toContain('computed_value')
      expect(fieldNames).toContain('status')
    })

    it('marks @Version field in metadata', async () => {
      const extractor = makeExtractor({
        'Doc.java': `
@Table("documents")
public class Document {
  @Id
  private Long id;

  @Version
  private Long version;
}
`,
      })

      const result = await extractor.extract()
      const vField = result.entities[0].fields.find((f) => f.name === 'version')
      expect(vField?.metadata.version).toBe(true)
    })
  })

  describe('relationship extraction', () => {
    it('extracts @MappedCollection as one_to_many', async () => {
      const extractor = makeExtractor({
        'Order.java': `
@Table("orders")
public class Order {
  @Id
  private Long id;

  @MappedCollection(idColumn = "order_id")
  private List<LineItem> lineItems;
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].relationships).toHaveLength(1)
      const rel = result.entities[0].relationships[0]
      expect(rel.type).toBe('one_to_many')
      expect(rel.targetEntity).toBe('line_item')
      expect(rel.sourceField).toBe('order_id')
    })

    it('defaults idColumn to snake_case fieldName + _id when not specified', async () => {
      const extractor = makeExtractor({
        'Invoice.java': `
@Table("invoices")
public class Invoice {
  @Id
  private Long id;

  @MappedCollection
  private Set<InvoiceLine> invoiceLines;
}
`,
      })

      const result = await extractor.extract()
      const rel = result.entities[0].relationships[0]
      expect(rel.sourceField).toBe('invoice_lines_id')
    })
  })

  describe('multiple entities in one file', () => {
    it('extracts multiple @Table classes from the same file', async () => {
      const extractor = makeExtractor({
        'Domain.java': `
@Table("authors")
public class Author {
  @Id
  private Long id;
  private String name;
}

@Table("books")
public class Book {
  @Id
  private Long id;
  private String title;
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)
      expect(result.entities.map((e) => e.name)).toEqual(expect.arrayContaining(['authors', 'books']))
    })
  })

  describe('Kotlin support', () => {
    it('extracts fields from Kotlin data class', async () => {
      const extractor = makeExtractor({
        'Customer.kt': `
package com.example

@Table("customers")
data class Customer(
  @Id val id: Long,
  val firstName: String,
  val lastName: String,
)
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)
      const fieldNames = result.entities[0].fields.map((f) => f.name)
      expect(fieldNames).toContain('id')
      // Spring Data JDBC maps camelCase → snake_case by default
      expect(fieldNames).toContain('first_name')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'A.java': `
@Table("a_table")
public class A {
  @Id private Long id;
}
`,
        'B.java': `
@Table("b_table")
public class B {
  @Id private Long id;
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
