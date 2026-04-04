import { describe, it, expect, vi } from 'vitest'
import { SqlModelExtractor } from '../sqlModel'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SqlModelExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'sql_model', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SqlModelExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockResolvedValue(Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('SqlModelExtractor', () => {
  it('extracts SQLModel table classes', async () => {
    const extractor = makeExtractor({
      'models.py': `
from typing import Optional
from sqlmodel import SQLModel, Field

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str = Field(unique=True)
    age: Optional[int] = None

class UserCreate(SQLModel):
    name: str
    email: str
`,
    })

    const result = await extractor.extract()
    // Only the table=True class should be extracted
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('User')
    expect(entity.tableName).toBe('user')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.isNullable).toBe(true)

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email?.isUnique).toBe(true)

    const age = entity.fields.find((f) => f.name === 'age')
    expect(age?.isNullable).toBe(true)
  })

  it('extracts foreign key fields and relationship references', async () => {
    const extractor = makeExtractor({
      'models.py': `
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship

class Team(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    heroes: List["Hero"] = Relationship(back_populates="team")

class Hero(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    team_id: Optional[int] = Field(default=None, foreign_key="team.id")
    team: Optional["Team"] = Relationship(back_populates="heroes")
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(2)

    const hero = result.entities.find((e) => e.name === 'Hero')!
    expect(hero).toBeDefined()

    const teamId = hero.fields.find((f) => f.name === 'team_id')
    expect(teamId?.isForeignKey).toBe(true)

    expect(hero.relationships).toHaveLength(1)
    expect(hero.relationships[0]).toMatchObject({ targetEntityName: 'Team' })
  })

  it('ignores non-table SQLModel classes', async () => {
    const extractor = makeExtractor({
      'schemas.py': `
from sqlmodel import SQLModel

class UserCreate(SQLModel):
    name: str
    email: str

class UserUpdate(SQLModel):
    name: Optional[str]
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
