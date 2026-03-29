import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'

const token = process.env.GITHUB_TOKEN

export const octokit = new Octokit({ auth: token })

export const githubGraphql = graphql.defaults({
  headers: { authorization: token ? `token ${token}` : undefined },
})

export interface RepoSummary {
  owner: string
  name: string
  fullName: string
  description: string | null
  defaultBranch: string
  stars: number
  forks: number
  isPrivate: boolean
  url: string
  metadata: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRepoSummary(data: any): RepoSummary {
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? null,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count,
    forks: data.forks_count,
    isPrivate: data.private,
    url: data.html_url,
    metadata: data as unknown as Record<string, unknown>,
  }
}

export async function fetchRepoSummary(owner: string, name: string): Promise<RepoSummary> {
  const { data } = await octokit.repos.get({ owner, repo: name })
  return toRepoSummary(data)
}

export async function fetchOrgRepos(org: string): Promise<RepoSummary[]> {
  const data = await octokit.paginate(octokit.repos.listForOrg, {
    org,
    per_page: 100,
    type: 'all',
  })
  return data.map(toRepoSummary)
}

export async function fetchLanguages(owner: string, name: string): Promise<Record<string, number>> {
  const { data } = await octokit.repos.listLanguages({ owner, repo: name })
  return data as Record<string, number>
}

export async function fetchFileContent(owner: string, name: string, path: string): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo: name, path })
    if ('content' in data && typeof data.content === 'string') {
      return Buffer.from(data.content, 'base64').toString('utf-8')
    }
    return null
  } catch {
    return null
  }
}

const DEPENDENCY_FILES: Record<string, string> = {
  'package.json': 'npm',
  'requirements.txt': 'pip',
  'Pipfile': 'pip',
  'go.mod': 'go',
  'Cargo.toml': 'cargo',
  'pom.xml': 'maven',
  'build.gradle': 'gradle',
  'composer.json': 'composer',
  'Gemfile': 'gem',
}

export async function fetchDependencyFiles(
  owner: string,
  name: string
): Promise<Array<{ file: string; ecosystem: string; content: string }>> {
  const results: Array<{ file: string; ecosystem: string; content: string }> = []
  for (const [file, ecosystem] of Object.entries(DEPENDENCY_FILES)) {
    const content = await fetchFileContent(owner, name, file)
    if (content) results.push({ file, ecosystem, content })
  }
  return results
}
