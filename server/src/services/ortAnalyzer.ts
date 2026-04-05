import { spawn, execSync } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '../../../')
const DATA_DIR = path.join(PROJECT_ROOT, 'data')
const ORT_BIN = path.join(
  PROJECT_ROOT,
  'tools', 'ort', 'ort-83.0.0', 'bin',
  process.platform === 'win32' ? 'ort.bat' : 'ort'
)

// Resolve the Python Scripts directory at startup so ORT can find python-inspector
function resolvePythonScriptsDir(): string | null {
  try {
    const script = process.platform === 'win32'
      ? "import sys, pathlib; print(pathlib.Path(sys.executable).parent / 'Scripts')"
      : "import sys, pathlib; print(pathlib.Path(sys.executable).parent)"
    return execSync(`python -c "${script}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

const PYTHON_SCRIPTS_DIR = resolvePythonScriptsDir()

type LogFn = (chunk: string) => void

function runProcess(cmd: string, args: string[], cwd: string, onLog?: LogFn, extraEnv?: Record<string, string>): Promise<{ stderr: string }> {
  const env = extraEnv ? { ...process.env, ...extraEnv } : undefined
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32'
    const proc = isWindows
      ? spawn('cmd', ['/c', cmd, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env })
      : spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env })

    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => { process.stdout.write(d); onLog?.(d.toString()) })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); process.stderr.write(d); onLog?.(d.toString()) })

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

// Base ORT config written on first run if no config exists
const ORT_BASE_CONFIG = `ort:
  analyzer:
    allowDynamicVersions: true
`

async function withNpmDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const backupPath = ORT_GLOBAL_CONFIG_PATH + '.bak'
  // ORT v83 config requires 'ort:' root key; use enabledPackageManagers to whitelist non-npm managers
  const disableYaml = `ort:
  analyzer:
    allowDynamicVersions: true
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

// Per-repo lock: prevents concurrent clone/pull for the same repo
const repoLocks = new Map<string, Promise<void>>()

export async function cloneOrUpdate(repo: string, sourceDir: string, onLog?: LogFn): Promise<void> {
  // Wait for any in-progress clone/pull of the same repo to finish before starting
  const pending = repoLocks.get(repo)
  if (pending) await pending.catch(() => { /* ignore errors from previous attempt */ })

  const operation = _doCloneOrUpdate(repo, sourceDir, onLog)
  repoLocks.set(repo, operation.then(() => { repoLocks.delete(repo) }, () => { repoLocks.delete(repo) }))
  await operation
}

async function _doCloneOrUpdate(repo: string, sourceDir: string, onLog?: LogFn): Promise<void> {
  const cloneUrl = `https://github.com/${repo}.git`

  try {
    await fs.access(path.join(sourceDir, '.git'))
    // Already cloned — pull latest
    const msg = `[git] Updating ${repo}…\n`
    console.log(msg.trimEnd())
    onLog?.(msg)
    await runProcess('git', ['-C', sourceDir, 'pull', '--ff-only'], DATA_DIR, onLog)
  } catch {
    // Not cloned yet
    const msg = `[git] Cloning ${repo}…\n`
    console.log(msg.trimEnd())
    onLog?.(msg)
    await fs.mkdir(sourceDir, { recursive: true })
    await runProcess('git', ['clone', '--depth', '1', cloneUrl, sourceDir], DATA_DIR, onLog)
  }
}

export async function runOrtAnalyze(sourceDir: string, ortOutputDir: string, onLog?: LogFn): Promise<void> {
  await fs.mkdir(ortOutputDir, { recursive: true })
  const resultPath = path.join(ortOutputDir, 'analyzer-result.json')

  // Remove any result from a previous run so ORT doesn't refuse to write a new one
  await fs.unlink(resultPath).catch(() => {})

  // Bootstrap a base ORT config if none exists (sets allowDynamicVersions so npm projects
  // without a lockfile can still be analyzed)
  const configExists = await fs.access(ORT_GLOBAL_CONFIG_PATH).then(() => true).catch(() => false)
  if (!configExists) {
    await fs.mkdir(ORT_GLOBAL_CONFIG_DIR, { recursive: true })
    await fs.writeFile(ORT_GLOBAL_CONFIG_PATH, ORT_BASE_CONFIG, 'utf-8')
  }

  // Build an extended PATH so ORT can find python-inspector
  const ortEnv: Record<string, string> | undefined = PYTHON_SCRIPTS_DIR
    ? { PATH: `${PYTHON_SCRIPTS_DIR}${path.delimiter}${process.env.PATH ?? ''}` }
    : undefined

  const baseArgs = ['analyze', '--input-dir', sourceDir, '--output-dir', ortOutputDir, '--output-formats', 'JSON']

  const tryRun = async (extraArgs: string[] = []) => {
    const msg = `[ORT] Running analyze on ${sourceDir}…\n`
    console.log(msg.trimEnd())
    onLog?.(msg)
    try {
      await runProcess(ORT_BIN, [...baseArgs, ...extraArgs], PROJECT_ROOT, onLog, ortEnv)
    } catch (err) {
      // ORT exits with code 1 for non-fatal issues but still writes a valid result.
      const resultExists = await fs.access(resultPath).then(() => true).catch(() => false)
      if (resultExists) {
        const note = `[ORT] Exited with issues but result file was written — continuing.\n`
        console.log(note.trimEnd())
        onLog?.(note)
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
    const warn = `[ORT] npm analyzer crash detected. Retrying with npm package managers disabled…\n`
    console.warn(warn.trimEnd())
    onLog?.(warn)
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
