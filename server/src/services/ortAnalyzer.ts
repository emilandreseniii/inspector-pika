import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '../../../')
const DATA_DIR = path.join(PROJECT_ROOT, 'data')
const ORT_BIN = path.join(
  PROJECT_ROOT,
  'tools', 'ort', 'ort-83.0.0', 'bin',
  process.platform === 'win32' ? 'ort.bat' : 'ort'
)

function runProcess(cmd: string, args: string[], cwd: string): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32'
    const proc = isWindows
      ? spawn('cmd', ['/c', cmd, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(d))
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); process.stderr.write(d) })

    proc.on('close', (code) => {
      if (code === 0) resolve({ stderr })
      else reject(Object.assign(new Error(`Process "${cmd}" exited with code ${code}`), { stderr }))
    })
    proc.on('error', reject)
  })
}

// ORT v83 npm analyzer crashes with IllegalArgumentException when a devDependency
// is referenced in the graph but its package data wasn't fetched (known ORT bug).
// When this happens, temporarily write an ORT global config that disables npm/yarn/pnpm,
// retry (Maven/Gradle still run), then clean up the temp config.
const ORT_NPM_CRASH_PATTERN = /references do not actually refer to packages|IllegalArgumentException.*NPM/i

const ORT_GLOBAL_CONFIG_DIR = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  '.ort', 'config'
)
const ORT_GLOBAL_CONFIG_PATH = path.join(ORT_GLOBAL_CONFIG_DIR, 'config.yml')

async function withNpmDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const backupPath = ORT_GLOBAL_CONFIG_PATH + '.bak'
  // ORT v83 config requires 'ort:' root key; use enabledPackageManagers to whitelist non-npm managers
  const disableYaml = `ort:
  analyzer:
    enabledPackageManagers:
      - Bazel
      - Bundler
      - Cargo
      - Carthage
      - CocoaPods
      - Composer
      - Conan
      - Gleam
      - GoMod
      - GradleInspector
      - Maven
      - Mix
      - NuGet
      - OrtProjectFile
      - PIP
      - Pipenv
      - PNPM
      - Poetry
      - Pub
      - Rebar3
      - SBT
      - SpdxDocumentFile
      - Stack
      - SwiftPM
      - Tycho
      - Unmanaged
      - Yarn2
`
  // Back up existing config if any
  const existing = await fs.readFile(ORT_GLOBAL_CONFIG_PATH, 'utf-8').catch(() => null)
  await fs.mkdir(ORT_GLOBAL_CONFIG_DIR, { recursive: true })
  if (existing !== null) await fs.writeFile(backupPath, existing, 'utf-8')
  await fs.writeFile(ORT_GLOBAL_CONFIG_PATH, disableYaml, 'utf-8')
  try {
    return await fn()
  } finally {
    if (existing !== null) {
      await fs.writeFile(ORT_GLOBAL_CONFIG_PATH, existing, 'utf-8')
      await fs.unlink(backupPath).catch(() => {})
    } else {
      await fs.unlink(ORT_GLOBAL_CONFIG_PATH).catch(() => {})
    }
  }
}

export function repoDirs(repo: string) {
  const [owner, name] = repo.split('/')
  const base = path.join(DATA_DIR, owner, name)
  return {
    source: path.join(base, 'source'),
    ortOutput: path.join(base, 'ort-results'),
  }
}

export async function cloneOrUpdate(repo: string, sourceDir: string): Promise<void> {
  const cloneUrl = `https://github.com/${repo}.git`

  try {
    await fs.access(path.join(sourceDir, '.git'))
    // Already cloned — pull latest
    console.log(`[ORT] Updating ${repo}…`)
    await runProcess('git', ['-C', sourceDir, 'pull', '--ff-only'], DATA_DIR)
  } catch {
    // Not cloned yet
    console.log(`[ORT] Cloning ${repo}…`)
    await fs.mkdir(sourceDir, { recursive: true })
    await runProcess('git', ['clone', '--depth', '1', cloneUrl, sourceDir], DATA_DIR)
  }
}

export async function runOrtAnalyze(sourceDir: string, ortOutputDir: string): Promise<void> {
  await fs.mkdir(ortOutputDir, { recursive: true })
  const resultPath = path.join(ortOutputDir, 'analyzer-result.json')
  const baseArgs = ['analyze', '--input-dir', sourceDir, '--output-dir', ortOutputDir, '--output-formats', 'JSON']

  const tryRun = async (extraArgs: string[] = []) => {
    console.log(`[ORT] Running analyze on ${sourceDir}…`)
    try {
      await runProcess(ORT_BIN, [...baseArgs, ...extraArgs], PROJECT_ROOT)
    } catch (err) {
      // ORT exits with code 1 for non-fatal issues but still writes a valid result.
      const resultExists = await fs.access(resultPath).then(() => true).catch(() => false)
      if (resultExists) {
        console.log(`[ORT] Exited with issues but result file was written — continuing.`)
        return
      }
      throw err
    }
  }

  try {
    await tryRun()
  } catch (firstErr) {
    const stderr = (firstErr as { stderr?: string }).stderr ?? ''
    if (!ORT_NPM_CRASH_PATTERN.test(stderr)) throw firstErr

    // Known ORT npm analyzer crash — retry with npm/yarn/pnpm disabled globally
    console.warn(`[ORT] npm analyzer crash detected. Retrying with npm package managers disabled…`)
    await withNpmDisabled(() => tryRun())
  }
}

export interface OrtPackage {
  packageId: string
  purl: string | null
  type: string | null
  namespace: string | null
  name: string
  version: string | null
  declaredLicenses: string[]
  description: string | null
  homepageUrl: string | null
  metadata: Record<string, unknown>
}

function parsePackageId(id: string): { type: string | null; namespace: string | null; name: string; version: string | null } {
  // Format: "Type:Namespace:Name:Version"  e.g. "NPM::lodash:4.17.21" or "Maven:org.apache:commons:3.0"
  const parts = id.split(':')
  if (parts.length >= 4) {
    return { type: parts[0] || null, namespace: parts[1] || null, name: parts[2], version: parts[3] || null }
  }
  return { type: null, namespace: null, name: id, version: null }
}

export async function parseOrtResult(ortOutputDir: string): Promise<OrtPackage[]> {
  const resultPath = path.join(ortOutputDir, 'analyzer-result.json')
  const raw = await fs.readFile(resultPath, 'utf-8')
  const json = JSON.parse(raw)

  // ORT result structure: json.analyzer.result.packages[]
  const pkgList: unknown[] =
    json?.analyzer?.result?.packages ??
    json?.analyzer?.result?.packages ??
    []

  if (!Array.isArray(pkgList)) return []

  return pkgList.map((p: unknown) => {
    const pkg = p as Record<string, unknown>
    const id = (pkg.id ?? pkg.packageId ?? '') as string
    const parsed = parsePackageId(id)

    const licenses: string[] = Array.isArray(pkg.declaredLicenses)
      ? (pkg.declaredLicenses as string[])
      : []

    return {
      packageId: id,
      purl: (pkg.purl as string) ?? null,
      type: parsed.type,
      namespace: parsed.namespace,
      name: parsed.name,
      version: parsed.version,
      declaredLicenses: licenses,
      description: (pkg.description as string) ?? null,
      homepageUrl: (pkg.homepageUrl as string) ?? null,
      metadata: pkg,
    }
  })
}
