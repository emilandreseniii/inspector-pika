# Entity Analysis — UI Plan

This document describes the React UI additions to display entity analysis results on the `RepositoryPage`. All components follow the inline-styles pattern established in the existing `RepositoryPage.tsx`.

---

## 1. New Section on RepositoryPage

A new "Data Entities" section is added after the existing Languages section and before the Detected Packages section, giving the page layout:

1. Repo info card _(existing)_
2. Languages section _(existing)_
3. **Data Entities section** _(new)_
4. Detected Packages section _(existing)_

This ordering is intentional: language analysis is a soft prerequisite for entity analysis (it drives which extractors run), so entities appear directly below languages. Packages appear last as the most verbose section.

---

## 2. Component Hierarchy

```
RepositoryPage
└── Data Entities section (inline JSX, not a separate file initially)
    ├── EntityAnalysisSection        — outer wrapper, section heading, job trigger state
    │   ├── EntityApproachBadges     — compact approach tags with confidence dots
    │   ├── Filter toolbar           — search input + type filter + approach filter
    │   ├── EntityTable              — list of entities with sortable/expandable rows
    │   │   └── EntityFieldsPanel    — expanded row showing fields (inline in table)
    │   └── EntityRelationshipGraph  — optional; deferred to phase 2
```

Following the existing pattern in `RepositoryPage.tsx`, all components are implemented as inline JSX within the page file initially (matching how the Languages and Packages sections are handled). If complexity grows, they can be extracted to separate files under `client/src/components/`.

---

## 3. State Shape

Additional state added to `RepositoryPage` alongside the existing `depStatus`, `langStatus`, etc.:

```ts
type JobStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed'

// Detected approaches (from GET /api/v1/repositories/:id/entity-approaches)
const [entityApproaches, setEntityApproaches] = useState<EntityApproach[]>([])

// Entity list (from GET /api/v1/repositories/:id/entities)
const [entities, setEntities] = useState<RepoEntity[]>([])

// Job status for analyze_entities
const [entityStatus, setEntityStatus] = useState<JobStatus>('idle')
const [entityError, setEntityError] = useState<string | null>(null)

// Which entity row is currently expanded to show fields
const [expandedEntityId, setExpandedEntityId] = useState<number | null>(null)

// Filter/search state
const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all')
const [entityApproachFilter, setEntityApproachFilter] = useState<string>('all')
const [entitySearch, setEntitySearch] = useState<string>('')

// Poll interval ref (same pattern as depPollRef, langPollRef)
const entityPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
```

The `isAnyBusy` flag is extended to include entity job status:

```ts
const isEntityBusy = entityStatus === 'pending' || entityStatus === 'running'
const isAnyBusy = isDepBusy || isLangBusy || isEntityBusy
```

### Types (extend `@inspector-pika/shared`)

```ts
// In shared/src/types.ts

export interface EntityApproach {
  id: number
  language: string
  approach: string
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
  detectedAt: string
  entityCount: number
}

export interface EntityField {
  id: number
  name: string
  normalizedName: string
  dataType: string
  nativeType: string | null
  isNullable: string | null   // "true" | "false" | null (unknown)
  isPrimaryKey: string        // "true" | "false"
  isForeignKey: string        // "true" | "false"
  isUnique: string            // "true" | "false"
  defaultValue: string | null
  ordinalPosition: number | null
}

export interface RepoEntity {
  id: number
  name: string
  normalizedName: string
  entityType: string
  confidence: 'high' | 'medium' | 'low'
  fieldCount: number
  sourceApproach: Pick<EntityApproach, 'id' | 'language' | 'approach' | 'confidence'> | null
  primarySources: Array<{
    file: string
    startLine: number | null
    endLine: number | null
    format: string
    extractorId: string
  }>
  fields: EntityField[]
}
```

---

## 4. Data Fetching

On mount (in the existing `useEffect` alongside the repo, packages, and languages fetches):

```ts
// Load entity approaches (lightweight — no fields)
fetch(`/api/v1/repositories/${id}/entity-approaches`)
  .then((r) => r.json())
  .then((json) => {
    if (json.error) return
    if (json.data.length > 0) setEntityApproaches(json.data)
  })
  .catch(() => {})

// Load entities with fields if approaches exist
fetch(`/api/v1/repositories/${id}/entities`)
  .then((r) => r.json())
  .then((json) => {
    if (json.error) return
    if (json.data.length > 0) {
      setEntities(json.data)
      setEntityStatus('completed')
    }
  })
  .catch(() => {})
```

After the `analyze_entities` job completes (via the existing `startPolling` mechanism), refresh both endpoints:

```ts
startPolling(json.data.id, setEntityStatus, setEntityError, entityPollRef, async () => {
  const [approachRes, entityRes] = await Promise.all([
    fetch(`/api/v1/repositories/${id}/entity-approaches`).then(r => r.json()),
    fetch(`/api/v1/repositories/${id}/entities`).then(r => r.json()),
  ])
  if (!approachRes.error) setEntityApproaches(approachRes.data)
  if (!entityRes.error)   setEntities(entityRes.data)
})
```

Polling interval: 3000ms (same as existing dep/lang polling).

Cleanup on unmount:

```ts
useEffect(() => () => {
  if (depPollRef.current)    clearInterval(depPollRef.current)
  if (langPollRef.current)   clearInterval(langPollRef.current)
  if (entityPollRef.current) clearInterval(entityPollRef.current)  // new
}, [])
```

---

## 5. EntityAnalysisSection — States and Rendering

The section renders differently depending on `entityStatus`:

### `idle` — Not yet analyzed

```
Data Entities
No entity data yet. Use ▼ Start A Job → Detect Data Entities to analyze.
```

Same `<p style={styles.muted}>` pattern as the Languages section empty state.

### `pending` / `running` — Job in progress

```
Data Entities
Analysis in progress — detecting entity storage patterns…
```

A muted text line with no spinner (matching the Languages and Packages in-progress states).
When `entityStatus === 'running'` the button label reads `'Scanning entities…'`;
when `entityStatus === 'pending'` it reads `'Queuing…'`.

### `completed` — Has results

Shows `EntityApproachBadges` followed by the filter toolbar followed by `EntityTable`.

### `completed` but `entities.length === 0`

```
Data Entities
Analysis completed but no entities were found.
This may indicate the repository does not use a recognized data storage framework.
```

Still renders the `EntityApproachBadges` if approaches were detected (approaches with `low` confidence may be detected but no extractor ran).

### `failed` — Job failed

```
Data Entities
Entity analysis failed: <error message>
```

Displayed using `<p style={styles.jobError}>` (crimson, fontSize 13), below the section heading.

---

## 6. EntityApproachBadges

Renders a horizontal wrapping row of compact badges, one per detected approach. Appears at the top of the Data Entities section, above the filter toolbar and entity table.

**Visual design:**
- Each badge is a rounded pill: `background: #f6f8fa`, `border: 1px solid #d0d7de`, `border-radius: 12px`, `padding: 3px 10px`, `font-size: 12px`
- A small 7×7px colored dot to the left of the text indicates confidence:
  - `high` → `#1a7f37` (green)
  - `medium` → `#9a6700` (amber)
  - `low` → `#57606a` (grey)
- The badge text: `{language}: {approachLabel}`, e.g. "Python: Django ORM", "TypeScript: Prisma", "SQL DDL" (cross-language approaches show the label only, no language prefix)
- On hover, a browser `title` tooltip shows the signals array joined by `\n`

**Approach name formatting:**
```ts
const APPROACH_LABELS: Record<string, string> = {
  django_orm:      'Django ORM',
  sqlalchemy:      'SQLAlchemy',
  tortoise_orm:    'Tortoise ORM',
  peewee:          'Peewee',
  prisma:          'Prisma',
  typeorm:         'TypeORM',
  drizzle_orm:     'Drizzle ORM',
  mikro_orm:       'MikroORM',
  sequelize:       'Sequelize',
  mongoose:        'Mongoose',
  jpa_hibernate:   'JPA / Hibernate',
  mybatis:         'MyBatis',
  jooq:            'jOOQ',
  exposed:         'Exposed',
  room:            'Room',
  gorm:            'GORM',
  ent:             'ent',
  sqlc:            'sqlc',
  activerecord:    'ActiveRecord',
  sequel:          'Sequel',
  eloquent:        'Eloquent',
  doctrine:        'Doctrine',
  ef_core:         'Entity Framework Core',
  dapper:          'Dapper',
  diesel:          'Diesel',
  sea_orm:         'SeaORM',
  core_data:       'Core Data',
  grdb:            'GRDB',
  realm:           'Realm',
  slick:           'Slick',
  doobie:          'Doobie',
  ecto:            'Ecto',
  persistent:      'Persistent',
  dbix_class:      'DBIx::Class',
  drift:           'Drift',
  dbi_dbplyr:      'DBI / dbplyr',
  luasql:          'LuaSQL',
  sql_ddl:         'SQL DDL',
  migration_files: 'Migration Files',
  protobuf:        'Protobuf',
  graphql_schema:  'GraphQL Schema',
  openapi:         'OpenAPI',
}
```

---

## 7. EntityTable — Entity List

A table listing all (filtered) entities. Uses `styles.pkgTable`, `styles.th`, `styles.td`.

**Columns:**

| Column | Width | Notes |
|--------|-------|-------|
| Name | auto | Chevron `▶`/`▼` + entity name; click row to expand/collapse field panel |
| Type | 90px | Entity type badge (colored pill) |
| Fields | 60px | Right-aligned count of fields |
| Source | 120px | Short approach label from `APPROACH_LABELS` |
| Confidence | 80px | Colored dot + label text |
| Source File | auto | First entry from `primarySources[0].file`, truncated with ellipsis |

**Table header:** uses `styles.th` (grey background `#f6f8fa`, 12px, bold, left-aligned, border-bottom).

**Table row:** uses `styles.td`, `cursor: 'pointer'` styling. Clicking anywhere on a row toggles `expandedEntityId`. The `▶` / `▼` chevron in the Name cell changes based on expansion state.

**Type badges** (small inline colored pills):

```ts
const ENTITY_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  table:      { bg: '#ddf4ff', color: '#0550ae' },   // blue
  collection: { bg: '#fff8c5', color: '#7d4e00' },   // amber
  document:   { bg: '#fff8c5', color: '#7d4e00' },   // amber
  view:       { bg: '#f6f8fa', color: '#57606a' },    // grey
  procedure:  { bg: '#ffebe9', color: '#82071e' },    // red
  index:      { bg: '#f6f8fa', color: '#57606a' },    // grey
  schema:     { bg: '#f6f8fa', color: '#57606a' },    // grey
}
```

**Initial sort:** by `normalizedName` ascending, with `entityType === 'table'` sorted before other types (tables first, then views, then the rest).

---

## 8. EntityFieldsPanel — Field Detail

Rendered as an additional `<tr>` immediately after the parent entity row when expanded. The panel cell spans all 6 columns using `colSpan={6}`.

The panel renders a nested table of fields:

| Column | Width | Notes |
|--------|-------|-------|
| Field Name | auto | Monospace font (`font-family: 'SFMono-Regular', Consolas, monospace`) |
| Type | 110px | `nativeType` in a `<code>` tag, truncated at 30 chars with title tooltip |
| Category | 80px | Normalized `dataType` |
| Nullable | 55px | Checkmark `✓` / dash `—` / `?` (when `isNullable === null`) |
| PK | 40px | Blue `PK` pill or dash |
| FK | 40px | Grey `FK` pill or dash |
| Default | 100px | `defaultValue` or dash |

Visual treatment of the nested table: `background: #f6f8fa`, `border: 1px solid #e8eaed`, `border-radius: 4px`, `margin: 8px 0`, `font-size: 12px`.

PK indicator: a small blue pill `PK` (`background: #0969da`, `color: white`, `font-size: 10px`, `padding: 1px 5px`, `border-radius: 3px`).

FK indicator: small grey pill `FK` with the same treatment (`background: #57606a`).

If `entity.fields.length === 0`, show:
```
<p style={styles.muted}>No field details available.</p>
```

---

## 9. EntityRelationshipGraph (Optional — Phase 2)

This component is deferred to a later iteration. When implemented, it appears as a collapsible panel below the entity table, toggled by a "Show Relationships" button.

For the initial implementation, a simple text-based list of relationships grouped by entity is acceptable:

```
UserAccount
  → one_to_many → Order (via id → user_id)
  → one_to_one  → UserProfile (via id → user_id)

Order
  → many_to_one → UserAccount
  → one_to_many → OrderItem (via id → order_id)
```

Data is fetched from `GET /api/v1/repositories/:id/entity-relationships` on demand when the panel is expanded.

---

## 10. Filtering and Search

Three filter controls above the entity table, in a single toolbar row using `styles.filterToolbar`:

**Search box** (text input):
- Placeholder: "Search entities…"
- `styles.filterInput`
- Filters `entities` client-side: `entity.name.toLowerCase().includes(entitySearch.toLowerCase())`

**Type filter** (native `<select>`):
- `styles.filterInput`
- Options: "All types" (value `"all"`), then one option per unique `entityType` in the entity list
- Displayed labels: "Table", "Collection", "View", "Document", "Procedure", "Index"
- Filters by `entity.entityType`

**Approach filter** (native `<select>`):
- `styles.filterInput`
- Options: "All approaches" (value `"all"`), then one option per unique `entity.sourceApproach.approach`
- Labels use `APPROACH_LABELS` mapping
- Filters by `entity.sourceApproach?.approach`

**Result count line:**
```
Showing {filteredCount} of {entities.length} entities
```
Rendered as `<p style={styles.muted}>` below the toolbar. Hidden when no filter is active.

All three filters are applied client-side on the already-fetched `entities` state — no new API calls on filter change.

---

## 11. Integration with "Start A Job" Menu

The existing dropdown menu in the repo info card is extended with a third item:

```tsx
{showJobMenu && (
  <div style={styles.menu}>
    <button style={styles.menuItem} onClick={() => startJob('analyze_dependencies')}>
      ⚙ Analyze Dependencies
    </button>
    <button style={styles.menuItem} onClick={() => startJob('analyze_languages')}>
      🔍 Analyze Languages
    </button>
    {/* New entry: */}
    <button style={styles.menuItem} onClick={() => startJob('analyze_entities')}>
      🗃 Detect Data Entities
    </button>
  </div>
)}
```

The `startJob` function signature is extended:

```ts
async function startJob(
  type: 'analyze_dependencies' | 'analyze_languages' | 'analyze_entities'
) {
```

The `analyze_entities` case follows exactly the same structure as the existing two cases:

```ts
if (type === 'analyze_entities') {
  setEntityStatus('pending')
  setEntityError(null)
  try {
    const res = await fetch('/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, repoId: repo.id, repo: repo.fullName }),
    })
    const json = await res.json()
    if (!res.ok) { setEntityStatus('failed'); setEntityError(json.error); return }
    startPolling(json.data.id, setEntityStatus, setEntityError, entityPollRef, async () => {
      const [approachRes, entityRes] = await Promise.all([
        fetch(`/api/v1/repositories/${id}/entity-approaches`).then(r => r.json()),
        fetch(`/api/v1/repositories/${id}/entities`).then(r => r.json()),
      ])
      if (!approachRes.error) setEntityApproaches(approachRes.data)
      if (!entityRes.error)   setEntities(entityRes.data)
    })
  } catch {
    setEntityStatus('failed')
    setEntityError('Failed to start job.')
  }
}
```

The busy button label for entity analysis:
- `entityStatus === 'pending'` → button shows `'Queuing…'`
- `entityStatus === 'running'` → button shows `'Scanning entities…'`

---

## 12. Style Additions

New entries for the `styles` object in `RepositoryPage.tsx`:

```ts
approachBadgeRow: {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 6,
  marginBottom: 16,
} as React.CSSProperties,

approachBadge: {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 10px',
  background: '#f6f8fa',
  border: '1px solid #d0d7de',
  borderRadius: 12,
  fontSize: 12,
  color: '#24292f',
  cursor: 'default',
} as React.CSSProperties,

confidenceDot: {
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
} as React.CSSProperties,

fieldTable: {
  width: '100%',
  borderCollapse: 'collapse' as const,
  fontSize: 12,
  background: '#f6f8fa',
  border: '1px solid #e8eaed',
  borderRadius: 4,
  overflow: 'hidden',
  margin: '6px 0',
} as React.CSSProperties,

fieldPanelRow: {
  background: '#fafbfc',
} as React.CSSProperties,

filterToolbar: {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 12,
  flexWrap: 'wrap' as const,
} as React.CSSProperties,

filterInput: {
  border: '1px solid #d0d7de',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 13,
  color: '#24292f',
  background: '#fff',
} as React.CSSProperties,

pkBadge: {
  display: 'inline-block',
  padding: '1px 5px',
  background: '#0969da',
  color: '#fff',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
} as React.CSSProperties,

fkBadge: {
  display: 'inline-block',
  padding: '1px 5px',
  background: '#57606a',
  color: '#fff',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
} as React.CSSProperties,

typeBadge: {
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 500,
} as React.CSSProperties,

chevron: {
  display: 'inline-block',
  width: 16,
  fontSize: 10,
  color: '#57606a',
  userSelect: 'none' as const,
} as React.CSSProperties,

monoFont: {
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: 12,
} as React.CSSProperties,
```

---

## 13. Existing Patterns to Follow

The implementation must match these patterns already established in `RepositoryPage.tsx`:

| Pattern | Where in existing code |
|---------|------------------------|
| Section wrapper: white card with border, `borderRadius: 8`, `padding: 24` | `styles.section` used for Languages and Packages sections |
| Section heading: `<h3>` with `styles.sectionHeading`, optional `<span style={styles.badge}>` count pill | Languages and Packages headings |
| In-progress text: `<p style={styles.muted}>` | "Detection in progress…" in Languages section |
| Empty state text: `<p style={styles.muted}>` with `<strong>` for menu action name | All empty states |
| Table styling: `styles.pkgTable`, `styles.th`, `styles.td` | Packages and Languages tables |
| External link: `<a href target="_blank" rel="noopener noreferrer" style={styles.link}>` | Package name links |
| Error display: `<p style={styles.jobError}>` in crimson | `depError` and `langError` display |
| Poll mechanism: `startPolling(jobId, setStatus, setError, pollRef, onComplete)` | Both existing job types |
| Job creation: `fetch('/api/v1/jobs', { method: 'POST', ... })` | Both existing job types |
| Cleanup: `clearInterval` in `useEffect` return | Existing dep/lang poll refs |
| State pattern: separate `{type}Status` and `{type}Error` state vars per job | `depStatus`/`depError`, `langStatus`/`langError` |
| Badge count pill on section heading: blue rounded tag | Languages and Packages headings |
