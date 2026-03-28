/**
 * Parses dependency files and extracts structured dependency info.
 */

export interface ParsedDependency {
  name: string
  version: string | null
  isDevDependency: boolean
  githubRepo: string | null
}

export function parseNpmDependencies(content: string): ParsedDependency[] {
  try {
    const pkg = JSON.parse(content)
    const deps: ParsedDependency[] = []

    const parseDeps = (obj: Record<string, string> | undefined, isDev: boolean) => {
      if (!obj) return
      for (const [name, version] of Object.entries(obj)) {
        // Detect if the version string points to a GitHub repo
        const githubRepo = extractGithubRepo(version)
        deps.push({ name, version: version ?? null, isDevDependency: isDev, githubRepo })
      }
    }

    parseDeps(pkg.dependencies, false)
    parseDeps(pkg.devDependencies, true)
    parseDeps(pkg.peerDependencies, false)
    return deps
  } catch {
    return []
  }
}

export function parsePipDependencies(content: string): ParsedDependency[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = line.match(/^([A-Za-z0-9_.-]+)([>=<!].+)?$/)
      if (!match) return null
      return {
        name: match[1],
        version: match[2]?.trim() ?? null,
        isDevDependency: false,
        githubRepo: null,
      }
    })
    .filter((d): d is ParsedDependency => d !== null)
}

export function parseGoDependencies(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = []
  const lines = content.split('\n')
  for (const line of lines) {
    const match = line.trim().match(/^require\s+(\S+)\s+(\S+)$/) ||
      line.trim().match(/^\s+(\S+)\s+(\S+)$/)
    if (match) {
      const name = match[1]
      deps.push({
        name,
        version: match[2],
        isDevDependency: false,
        githubRepo: name.startsWith('github.com/') ? name.replace('github.com/', '') : null,
      })
    }
  }
  return deps
}

function extractGithubRepo(version: string): string | null {
  // Matches: github:owner/repo, owner/repo, https://github.com/owner/repo
  const patterns = [
    /^github:([^#]+)/,
    /^https?:\/\/github\.com\/([^/#]+\/[^/#]+)/,
  ]
  for (const pattern of patterns) {
    const match = version.match(pattern)
    if (match) return match[1].replace(/\.git$/, '')
  }
  return null
}
