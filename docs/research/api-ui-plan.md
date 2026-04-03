# API UI Plan

This document describes the React component hierarchy and UI state management for displaying API analysis results on the Repository page.

---

## Overview

API results appear in a new **"API Surfaces"** section on `RepositoryPage.tsx`, between the Data Entities section and the bottom of the page. The section adapts its display based on the API style — HTTP endpoints render as a Swagger-style list, GraphQL operations as a schema viewer, and RPC methods grouped by service.

The section follows the same inline-styles React pattern as existing sections (Languages, Packages, Data Entities).

---

## State Variables (additions to RepositoryPage)

```ts
const [apiApproaches, setApiApproaches] = useState<RepoApiApproach[]>([])
const [apis, setApis] = useState<RepoApi[]>([])
const [apiEndpoints, setApiEndpoints] = useState<RepoApiEndpoint[]>([])
const [apiStatus, setApiStatus] = useState<JobStatus>('idle')
const [apiError, setApiError] = useState<string | null>(null)
const [apiUpdatedAt, setApiUpdatedAt] = useState<string | null>(null)

// UI state
const [apiStyleTab, setApiStyleTab] = useState<'http' | 'graphql' | 'rpc' | 'all'>('all')
const [expandedApi, setExpandedApi] = useState<number | null>(null)
const [expandedEndpoint, setExpandedEndpoint] = useState<number | null>(null)
```

---

## Data Loading

On mount, load existing API data (mirrors the entity data loading pattern):

```ts
fetch(`/api/v1/repositories/${id}/api-approaches`)
  .then(r => r.json())
  .then(json => {
    if (!json.error && json.data.length > 0) {
      setApiApproaches(json.data)
      setApiStatus('completed')
      if (json.data[0]?.detectedAt) setApiUpdatedAt(fmtDate(json.data[0].detectedAt))
    }
  })

fetch(`/api/v1/repositories/${id}/api-endpoints`)
  .then(r => r.json())
  .then(json => { if (!json.error) setApiEndpoints(json.data) })

fetch(`/api/v1/repositories/${id}/apis`)
  .then(r => r.json())
  .then(json => { if (!json.error) setApis(json.data) })
```

---

## Section Structure (JSX)

```jsx
{/* ── API Surfaces section ── */}
<div style={{ ...styles.section, marginTop: 24 }}>
  <div style={styles.sectionHeaderRow}>
    <h3 style={styles.sectionHeading}>
      API Surfaces
      {apiEndpoints.length > 0 && <span style={styles.badge}>{apiEndpoints.length}</span>}
    </h3>
    <div style={styles.sectionActions}>
      <span style={styles.updatedAt}>{apiUpdatedAt ? `Updated: ${apiUpdatedAt}` : 'Not yet run'}</span>
      <button
        style={{ ...styles.analyzeBtn, ...(isApiBusy ? styles.analyzeBtnBusy : {}) }}
        disabled={isApiBusy}
        onClick={() => startApiJob()}
      >
        {isApiBusy ? 'Analyzing…' : 'Analyze'}
      </button>
    </div>
  </div>

  {/* Approach badges */}
  {apiApproaches.length > 0 && (
    <div style={styles.approachBadges}>
      {apiApproaches.map(a => (
        <span
          key={a.id}
          style={{ ...styles.approachBadge, ...confidenceStyle(a.confidence) }}
          title={a.signals?.join('\n')}
        >
          {API_APPROACH_LABELS[a.approach] ?? a.approach}
          {a.endpointCount != null ? ` (${a.endpointCount})` : ''}
          <span style={styles.apiStylePip}>{API_STYLE_ICONS[a.apiStyle]}</span>
        </span>
      ))}
    </div>
  )}

  {/* Style tabs — only shown when multiple styles are present */}
  {hasMultipleStyles && (
    <div style={styles.tabRow}>
      {['all', 'http', 'graphql', 'rpc'].map(tab => (
        activeTabs.includes(tab) && (
          <button
            key={tab}
            style={{ ...styles.tab, ...(apiStyleTab === tab ? styles.tabActive : {}) }}
            onClick={() => setApiStyleTab(tab as typeof apiStyleTab)}
          >
            {tab === 'all' ? 'All' : tab === 'http' ? '⟵→ HTTP' : tab === 'graphql' ? '◈ GraphQL' : '⚡ RPC'}
          </button>
        )
      ))}
    </div>
  )}

  {/* Empty states */}
  {isApiBusy && <p style={styles.muted}>Detection in progress…</p>}
  {!isApiBusy && apiEndpoints.length === 0 && apiStatus === 'idle' && (
    <p style={styles.muted}>No API data yet. Use <strong>Start A Job → Detect APIs</strong> to analyze.</p>
  )}
  {!isApiBusy && apiEndpoints.length === 0 && apiStatus !== 'idle' && (
    <p style={styles.muted}>No API endpoints detected in this repository.</p>
  )}

  {/* Content by style */}
  {apiEndpoints.length > 0 && (
    <>
      {(apiStyleTab === 'all' || apiStyleTab === 'http') && (
        <HttpEndpointList
          apis={apis.filter(a => a.apiStyle === 'http')}
          endpoints={apiEndpoints.filter(e => e.httpMethod != null)}
          expandedApi={expandedApi}
          expandedEndpoint={expandedEndpoint}
          onToggleApi={setExpandedApi}
          onToggleEndpoint={setExpandedEndpoint}
        />
      )}
      {(apiStyleTab === 'all' || apiStyleTab === 'graphql') && (
        <GraphQLView
          apis={apis.filter(a => a.apiStyle === 'graphql')}
          endpoints={apiEndpoints.filter(e => e.operationType != null)}
          expandedApi={expandedApi}
          onToggleApi={setExpandedApi}
        />
      )}
      {(apiStyleTab === 'all' || apiStyleTab === 'rpc') && (
        <RpcView
          apis={apis.filter(a => a.apiStyle === 'rpc')}
          endpoints={apiEndpoints.filter(e => e.rpcMethodName != null)}
          expandedApi={expandedApi}
          onToggleApi={setExpandedApi}
        />
      )}
    </>
  )}
</div>
```

---

## HTTP / REST Display (Swagger-style)

Endpoints are grouped by their parent `RepoApi` (controller/router/blueprint). Within each group, endpoints are sorted by path then method.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ▸ UserController  /api/v1/users  (6 endpoints)    com.example.ctrl  │
└─────────────────────────────────────────────────────────────────────┘

  ▾ UserController  /api/v1/users  (6 endpoints)    com.example.ctrl
  ┌─────┬──────────────────────────────────────────────────────────┐
  │ GET │ /api/v1/users                                            │
  │ POST│ /api/v1/users                                            │
  │ GET │ /api/v1/users/{id}                           ▸ expand    │
  │ PUT │ /api/v1/users/{id}                                       │
  │PATCH│ /api/v1/users/{id}                                       │
  │ DEL │ /api/v1/users/{id}                                       │
  └─────┴──────────────────────────────────────────────────────────┘

  ▾ GET /api/v1/users/{id}                     UserResponse
    Parameters:
      • id  (path)  Long  required
    Returns: UserResponse
    Source: UserController.java:38
```

### HTTP Method Badge Colors

| Method | Background | Text |
|--------|-----------|------|
| GET | `#dafbe1` | `#116329` |
| POST | `#ddf4ff` | `#0969da` |
| PUT | `#fff8c5` | `#7d4e00` |
| DELETE | `#ffebe9` | `#cf222e` |
| PATCH | `#fbefff` | `#6e40c9` |
| HEAD | `#f6f8fa` | `#57606a` |
| OPTIONS | `#f6f8fa` | `#57606a` |

### `HttpEndpointList` Component Sketch

```tsx
function HttpEndpointList({ apis, endpoints, expandedApi, expandedEndpoint, onToggleApi, onToggleEndpoint }) {
  const endpointsByApi = groupBy(endpoints, e => e.apiId)

  return (
    <div style={{ marginTop: 16 }}>
      {apis.map(api => {
        const apiEndpoints = endpointsByApi[api.id] ?? []
        const isExpanded = expandedApi === api.id
        return (
          <div key={api.id} style={styles.apiGroup}>
            <div style={styles.apiGroupHeader} onClick={() => onToggleApi(isExpanded ? null : api.id)}>
              <span>{isExpanded ? '▾' : '▸'}</span>
              <span style={styles.apiGroupName}>{api.name}</span>
              {api.basePath && <code style={styles.basePath}>{api.basePath}</code>}
              <span style={styles.endpointCount}>{apiEndpoints.length} endpoint{apiEndpoints.length !== 1 ? 's' : ''}</span>
              {api.packageOrModule && <span style={styles.packageName}>{api.packageOrModule}</span>}
            </div>

            {isExpanded && (
              <div style={styles.endpointList}>
                {apiEndpoints.map(ep => (
                  <div key={ep.id}>
                    <div style={styles.endpointRow} onClick={() => onToggleEndpoint(expandedEndpoint === ep.id ? null : ep.id)}>
                      <span style={{ ...styles.methodBadge, ...methodStyle(ep.httpMethod) }}>
                        {ep.httpMethod}
                      </span>
                      <code style={styles.pathCode}>{ep.path}</code>
                      {ep.returnType && <span style={styles.returnType}>{ep.returnType}</span>}
                    </div>
                    {expandedEndpoint === ep.id && (
                      <div style={styles.endpointDetail}>
                        {ep.summary && <p style={styles.summary}>{ep.summary}</p>}
                        {ep.parameters && ep.parameters.length > 0 && (
                          <div>
                            <div style={styles.detailLabel}>Parameters</div>
                            {ep.parameters.map(p => (
                              <div key={p.id} style={styles.paramRow}>
                                <span style={styles.paramName}>{p.name}</span>
                                <span style={styles.paramLocation}>({p.location})</span>
                                {p.type && <code style={styles.paramType}>{p.type}</code>}
                                {p.required && <span style={styles.requiredBadge}>required</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {ep.sourceFile && (
                          <div style={styles.sourceRef}>
                            {ep.sourceFile}{ep.sourceLine ? `:${ep.sourceLine}` : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

---

## GraphQL Display

GraphQL results are organized into three tabs: **Query**, **Mutation**, **Subscription**. Schema types (Object, Input, Enum) from `.graphql` files are shown in a separate "Types" tab.

```
Queries (12)  |  Mutations (8)  |  Subscriptions (2)  |  Types (24)

  getUser(id: ID!): User
  listUsers(filter: UserFilter, limit: Int): [User]
  getPost(id: ID!): Post
  ...

  ▾ getUser(id: ID!): User
    Arguments:
      • id  ID  required
    Returns: User
    Source: schema.graphql:14
```

```tsx
function GraphQLView({ apis, endpoints, expandedApi, onToggleApi }) {
  const [gqlTab, setGqlTab] = useState<'Query' | 'Mutation' | 'Subscription' | 'Types'>('Query')
  const byType = groupBy(endpoints, e => e.operationType)

  return (
    <div style={{ marginTop: 16 }}>
      <div style={styles.tabRow}>
        {(['Query', 'Mutation', 'Subscription'] as const).map(t => (
          byType[t]?.length > 0 && (
            <button key={t} style={{ ...styles.tab, ...(gqlTab === t ? styles.tabActive : {}) }}
              onClick={() => setGqlTab(t)}>
              {t} ({byType[t].length})
            </button>
          )
        ))}
      </div>
      <div style={styles.gqlList}>
        {(byType[gqlTab] ?? []).map(ep => (
          <div key={ep.id} style={styles.gqlRow}>
            <code style={styles.gqlSignature}>
              {ep.operationName}
              {ep.parameters?.length
                ? `(${ep.parameters.map(p => `${p.name}: ${p.type ?? '?'}`).join(', ')})`
                : ''}
              {ep.returnType ? `: ${ep.returnType}` : ''}
            </code>
            {ep.sourceFile && <span style={styles.sourceRef}>{ep.sourceFile}{ep.sourceLine ? `:${ep.sourceLine}` : ''}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## RPC Display

RPC results are grouped by service. Each service shows its package, protocol badge, and the list of methods with request/response types.

```
⚡ UserService   grpc  user.v1   user.proto
   GetUser        GetUserRequest   →  GetUserResponse
   ListUsers      ListUsersRequest →  (stream) ListUsersResponse
   CreateUser     CreateUserRequest → CreateUserResponse
   DeleteUser     DeleteUserRequest → DeleteUserResponse

⚡ AuthService   grpc  auth.v1   auth.proto
   Login          LoginRequest     →  LoginResponse
   Logout         LogoutRequest    →  Empty
   RefreshToken   RefreshRequest   →  TokenResponse
```

```tsx
function RpcView({ apis, endpoints, expandedApi, onToggleApi }) {
  const endpointsByApi = groupBy(endpoints, e => e.apiId)
  return (
    <div style={{ marginTop: 16 }}>
      {apis.map(api => {
        const methods = endpointsByApi[api.id] ?? []
        const isExpanded = expandedApi === api.id
        return (
          <div key={api.id} style={styles.apiGroup}>
            <div style={styles.apiGroupHeader} onClick={() => onToggleApi(isExpanded ? null : api.id)}>
              <span>{isExpanded ? '▾' : '▸'}</span>
              <span style={styles.apiGroupName}>{api.name}</span>
              {api.protocol && <span style={styles.protocolBadge}>{api.protocol}</span>}
              {api.packageOrModule && <code style={styles.packageCode}>{api.packageOrModule}</code>}
              {api.primarySource?.file && <span style={styles.sourceRef}>{api.primarySource.file.split('/').pop()}</span>}
            </div>
            {isExpanded && (
              <table style={styles.rpcTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Method</th>
                    <th style={styles.th}>Request</th>
                    <th style={styles.th}>Response</th>
                    <th style={styles.th}>Streaming</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map(ep => (
                    <tr key={ep.id}>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 500 }}>{ep.rpcMethodName}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', color: '#57606a' }}>{ep.requestType ?? '—'}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', color: '#57606a' }}>{ep.responseType ?? '—'}</td>
                      <td style={styles.td}>{ep.rpcStreaming && ep.rpcStreaming !== 'none' ? ep.rpcStreaming : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

---

## "Start A Job" Menu Addition

Add a new menu item to the existing dropdown in `RepositoryPage.tsx`:

```jsx
<button style={styles.menuItem} onClick={() => startApiJob()}>
  🔌 Detect APIs
</button>
```

---

## Label Tables

```ts
const API_APPROACH_LABELS: Record<string, string> = {
  spring_mvc:               'Spring MVC',
  jax_rs:                   'JAX-RS',
  micronaut_http:           'Micronaut',
  spring_graphql:           'Spring GraphQL',
  netflix_dgs:              'Netflix DGS',
  grpc_java:                'gRPC (Java)',
  ktor:                     'Ktor',
  flask:                    'Flask',
  fastapi:                  'FastAPI',
  django_views:             'Django Views',
  django_rest_framework:    'Django REST Framework',
  graphene:                 'Graphene',
  strawberry:               'Strawberry',
  grpc_python:              'gRPC (Python)',
  tornado:                  'Tornado',
  express:                  'Express',
  fastify:                  'Fastify',
  nestjs:                   'NestJS',
  apollo_server:            'Apollo Server',
  type_graphql:             'TypeGraphQL',
  grpc_node:                'gRPC (Node)',
  gin:                      'Gin',
  echo:                     'Echo',
  net_http:                 'net/http',
  grpc_go:                  'gRPC (Go)',
  gqlgen:                   'gqlgen',
  rails_routes:             'Rails Routes',
  grape:                    'Grape',
  graphql_ruby:             'GraphQL Ruby',
  aspnet_controller:        'ASP.NET Controllers',
  aspnet_minimal:           'ASP.NET Minimal API',
  hot_chocolate:            'Hot Chocolate',
  grpc_csharp:              'gRPC (C#)',
  actix_web:                'Actix Web',
  axum:                     'Axum',
  async_graphql:            'async-graphql',
  tonic_grpc:               'Tonic (gRPC)',
  laravel_routes:           'Laravel Routes',
  symfony_routing:          'Symfony Routing',
  lighthouse_graphql:       'Lighthouse',
  openapi_spec:             'OpenAPI Spec',
  grpc_proto:               'gRPC Proto',
  graphql_schema:           'GraphQL Schema',
  thrift_idl:               'Thrift IDL',
}

const API_STYLE_ICONS: Record<string, string> = {
  http:     '⟵→',
  graphql:  '◈',
  rpc:      '⚡',
}
```

---

## New Styles (additions to `styles` object)

```ts
apiGroup: {
  border: '1px solid #d0d7de',
  borderRadius: 6,
  marginBottom: 8,
  overflow: 'hidden',
} as React.CSSProperties,
apiGroupHeader: {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  background: '#f6f8fa',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
} as React.CSSProperties,
apiGroupName: {
  fontWeight: 600,
  fontFamily: 'monospace',
  fontSize: 13,
} as React.CSSProperties,
basePath: {
  background: '#ddf4ff',
  color: '#0969da',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 12,
} as React.CSSProperties,
endpointCount: {
  fontSize: 12,
  color: '#57606a',
  marginLeft: 'auto',
  flexShrink: 0,
} as React.CSSProperties,
packageName: {
  fontSize: 11,
  color: '#8c959f',
  fontFamily: 'monospace',
} as React.CSSProperties,
endpointList: {
  borderTop: '1px solid #d0d7de',
} as React.CSSProperties,
endpointRow: {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 14px',
  borderBottom: '1px solid #f6f8fa',
  cursor: 'pointer',
  fontSize: 13,
} as React.CSSProperties,
methodBadge: {
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 4,
  fontFamily: 'monospace',
  fontWeight: 700,
  fontSize: 11,
  minWidth: 52,
  textAlign: 'center' as const,
  flexShrink: 0,
} as React.CSSProperties,
pathCode: {
  fontFamily: 'monospace',
  fontSize: 13,
  flex: 1,
} as React.CSSProperties,
returnType: {
  fontSize: 11,
  color: '#57606a',
  fontFamily: 'monospace',
  marginLeft: 'auto',
  flexShrink: 0,
} as React.CSSProperties,
endpointDetail: {
  padding: '10px 14px 10px 24px',
  background: '#fafbfc',
  fontSize: 13,
  borderBottom: '1px solid #f6f8fa',
} as React.CSSProperties,
detailLabel: {
  fontSize: 11,
  fontWeight: 700,
  color: '#57606a',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 4,
  marginTop: 8,
} as React.CSSProperties,
paramRow: {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 0',
} as React.CSSProperties,
paramName: {
  fontFamily: 'monospace',
  fontWeight: 500,
  fontSize: 13,
} as React.CSSProperties,
paramLocation: {
  fontSize: 11,
  color: '#8c959f',
} as React.CSSProperties,
paramType: {
  fontSize: 12,
  color: '#57606a',
  background: '#f6f8fa',
  padding: '0 4px',
  borderRadius: 3,
} as React.CSSProperties,
requiredBadge: {
  fontSize: 10,
  color: '#cf222e',
  background: '#ffebe9',
  padding: '1px 5px',
  borderRadius: 4,
  fontWeight: 600,
} as React.CSSProperties,
sourceRef: {
  fontSize: 11,
  color: '#8c959f',
  fontFamily: 'monospace',
  marginLeft: 'auto',
  flexShrink: 0,
} as React.CSSProperties,
gqlList: {
  marginTop: 8,
} as React.CSSProperties,
gqlRow: {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '1px solid #f6f8fa',
  gap: 12,
} as React.CSSProperties,
gqlSignature: {
  fontFamily: 'monospace',
  fontSize: 13,
  color: '#0969da',
} as React.CSSProperties,
gqlSummary: {
  fontSize: 12,
  color: '#57606a',
} as React.CSSProperties,
tabRow: {
  display: 'flex',
  gap: 4,
  marginBottom: 16,
  borderBottom: '1px solid #d0d7de',
  paddingBottom: 0,
} as React.CSSProperties,
tab: {
  padding: '6px 14px',
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  color: '#57606a',
  marginBottom: -1,
} as React.CSSProperties,
tabActive: {
  color: '#0969da',
  borderBottomColor: '#0969da',
} as React.CSSProperties,
apiStylePip: {
  marginLeft: 4,
  fontSize: 10,
} as React.CSSProperties,
protocolBadge: {
  padding: '2px 7px',
  background: '#f6f8fa',
  border: '1px solid #d0d7de',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  color: '#57606a',
} as React.CSSProperties,
packageCode: {
  fontSize: 11,
  color: '#8c959f',
} as React.CSSProperties,
rpcTable: {
  width: '100%',
  borderCollapse: 'collapse' as const,
  fontSize: 13,
} as React.CSSProperties,
summary: {
  color: '#57606a',
  fontSize: 13,
  margin: '0 0 8px 0',
  fontStyle: 'italic',
} as React.CSSProperties,
```
