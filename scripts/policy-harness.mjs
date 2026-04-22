import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const registryPath = path.join(repoRoot, '.github', 'policy-harness', 'policy-registry.json')

const args = process.argv.slice(2)
const mode = args[0] ?? 'guard'

function getArgValue(flag) {
  const index = args.indexOf(flag)

  if (index === -1 || index === args.length - 1) {
    return undefined
  }

  return args[index + 1]
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(glob) {
  const escaped = glob
    .split('**')
    .map((segment) => segment.split('*').map(escapeRegExp).join('[^/]*'))
    .join('::DOUBLE_STAR::')

  return new RegExp(
    `^${escaped.replaceAll('::DOUBLE_STAR::', '.*')}$`,
  )
}

function matchesGlob(filePath, glob) {
  return globToRegExp(glob).test(filePath)
}

function matchesAnyGlob(filePath, globs) {
  return globs.some((glob) => matchesGlob(filePath, glob))
}

function walkDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return []
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...walkDirectory(entryPath))
      continue
    }

    files.push(toPosixPath(path.relative(repoRoot, entryPath)))
  }

  return files
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function readRegistry() {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'))
}

function runGit(argsToRun) {
  return execFileSync('git', argsToRun, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function getAllTrackedFiles() {
  return walkDirectory(path.join(repoRoot, 'src')).concat(
    walkDirectory(path.join(repoRoot, '.github')),
    walkDirectory(path.join(repoRoot, 'scripts')),
    ['package.json', 'README.md'].filter((filePath) => fs.existsSync(path.join(repoRoot, filePath))),
  )
}

function getChangedFiles() {
  const base = getArgValue('--base')
  const head = getArgValue('--head')

  if (base && head && !/^0+$/.test(base)) {
    try {
      const output = runGit(['diff', '--name-only', base, head])
      return output ? output.split('\n').filter(Boolean) : []
    } catch {
      return getChangedFilesFromHead()
    }
  }

  return getChangedFilesFromHead()
}

function unique(values) {
  return [...new Set(values)]
}

function getWorkingTreeChangedFiles() {
  const changed = []

  try {
    const trackedChanges = runGit(['diff', '--name-only', 'HEAD'])
    changed.push(...(trackedChanges ? trackedChanges.split('\n').filter(Boolean) : []))
  } catch {
    // noop
  }

  try {
    const untrackedChanges = runGit(['ls-files', '--others', '--exclude-standard'])
    changed.push(...(untrackedChanges ? untrackedChanges.split('\n').filter(Boolean) : []))
  } catch {
    // noop
  }

  return unique(changed)
}

function getChangedFilesFromHead() {
  const workingTreeChangedFiles = getWorkingTreeChangedFiles()

  if (workingTreeChangedFiles.length > 0) {
    return workingTreeChangedFiles
  }

  try {
    const output = runGit(['diff', '--name-only', 'HEAD~1', 'HEAD'])
    return output ? output.split('\n').filter(Boolean) : []
  } catch {
    try {
      const output = runGit(['status', '--short'])
      return output
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3))
    } catch {
      return []
    }
  }
}

function resolveImport(importerPath, specifier) {
  if (specifier.startsWith('@/')) {
    return toPosixPath(path.posix.normalize(`src/${specifier.slice(2)}`))
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const importerDir = path.posix.dirname(importerPath)
    return toPosixPath(path.posix.normalize(path.posix.join(importerDir, specifier)))
  }

  return specifier
}

function getImports(relativePath) {
  const content = readText(relativePath)
  const imports = []
  const importPattern =
    /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|\bexport\s+[^'";]+?\s+from\s+['"]([^'"]+)['"]/g

  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2]

    if (specifier) {
      imports.push({
        specifier,
        resolved: resolveImport(relativePath, specifier),
      })
    }
  }

  return imports
}

function collectViolations() {
  const trackedFiles = getAllTrackedFiles()
  const violations = []
  const sourceFiles = trackedFiles.filter((filePath) => filePath.startsWith('src/'))

  const coreFiles = sourceFiles.filter((filePath) => filePath.startsWith('src/core/'))

  for (const filePath of coreFiles) {
    if (filePath.endsWith('.vue')) {
      violations.push({
        rule: 'core-purity',
        file: filePath,
        message: 'core 내부에 Vue SFC를 둘 수 없습니다.',
      })
      continue
    }

    const content = readText(filePath)

    if (/from\s+['"]vue['"]|import\s+['"]vue['"]/.test(content)) {
      violations.push({
        rule: 'core-purity',
        file: filePath,
        message: 'core 내부에서 Vue를 import하면 안 됩니다.',
      })
    }

    if (/from\s+['"]pinia['"]|import\s+['"]pinia['"]/.test(content)) {
      violations.push({
        rule: 'core-purity',
        file: filePath,
        message: 'core 내부에서 Pinia를 import하면 안 됩니다.',
      })
    }

    if (/\b(window|document|localStorage|sessionStorage|navigator|location|history|HTMLElement|MutationObserver)\b/.test(content)) {
      violations.push({
        rule: 'core-purity',
        file: filePath,
        message: 'core 내부에서 browser API를 직접 사용하면 안 됩니다.',
      })
    }
  }

  for (const filePath of sourceFiles) {
    const segments = filePath.split('/')

    if (
      filePath.startsWith('src/') &&
      segments.some((segment, index) => index > 0 && (segment === 'common' || segment === 'utils'))
    ) {
      violations.push({
        rule: 'no-dumping-folders',
        file: filePath,
        message: '`common` 또는 `utils` dumping folder를 만들면 안 됩니다.',
      })
    }
  }

  const featureFiles = sourceFiles.filter((filePath) => filePath.startsWith('src/features/'))

  for (const filePath of featureFiles) {
    const segments = filePath.split('/')
    const layer = segments[3]

    if (segments.length > 3 && !['model', 'ui', 'api'].includes(layer)) {
      violations.push({
        rule: 'feature-structure',
        file: filePath,
        message: 'feature 내부의 1차 하위 디렉터리는 model/ui/api만 허용합니다.',
      })
    }
  }

  const sharedFiles = sourceFiles.filter((filePath) => filePath.startsWith('src/shared/'))

  for (const filePath of sharedFiles) {
    for (const imported of getImports(filePath)) {
      if (
        /^src\/(features|pages|widgets|app)\//.test(imported.resolved)
      ) {
        violations.push({
          rule: 'shared-boundary',
          file: filePath,
          message: `shared는 feature/UI 계층(${imported.specifier})에 의존하면 안 됩니다.`,
        })
      }
    }
  }

  const storeFiles = sourceFiles.filter((filePath) => filePath.endsWith('.store.ts'))

  for (const filePath of storeFiles) {
    if (!filePath.startsWith('src/adapters/vue/stores/')) {
      violations.push({
        rule: 'store-placement',
        file: filePath,
        message: 'Pinia store 파일은 src/adapters/vue/stores 아래에 있어야 합니다.',
      })
    }
  }

  for (const filePath of sourceFiles) {
    const content = readText(filePath)

    if (/\bdefineStore\s*\(/.test(content) && !filePath.startsWith('src/adapters/vue/stores/')) {
      violations.push({
        rule: 'store-placement',
        file: filePath,
        message: 'defineStore 사용 위치는 src/adapters/vue/stores로 제한합니다.',
      })
    }
  }

  const composableFiles = sourceFiles.filter((filePath) => /\/use[A-Z].+\.ts$/.test(filePath))

  for (const filePath of composableFiles) {
    if (!filePath.startsWith('src/adapters/vue/composables/')) {
      violations.push({
        rule: 'composable-placement',
        file: filePath,
        message: 'Vue composable은 src/adapters/vue/composables 아래에 있어야 합니다.',
      })
    }
  }

  const adapterFiles = sourceFiles.filter(
    (filePath) =>
      filePath.startsWith('src/adapters/vue/stores/') ||
      filePath.startsWith('src/adapters/vue/composables/'),
  )

  for (const filePath of adapterFiles) {
    for (const imported of getImports(filePath)) {
      if (
        /^src\/(app|pages|widgets)\//.test(imported.resolved) ||
        /^src\/features\/[^/]+\/ui\//.test(imported.resolved)
      ) {
        violations.push({
          rule: 'adapter-ui-boundary',
          file: filePath,
          message: `adapter 계층은 UI 계층(${imported.specifier})에 의존하면 안 됩니다.`,
        })
      }
    }
  }

  return violations
}

function formatFileList(files) {
  if (files.length === 0) {
    return '  - 없음'
  }

  return files.map((filePath) => `  - ${filePath}`).join('\n')
}

function runImpact() {
  const registry = readRegistry()
  const trackedFiles = getAllTrackedFiles()
  const changedFiles = getChangedFiles()

  console.log('Policy impact analysis')
  console.log('')

  if (changedFiles.length === 0) {
    console.log('변경 파일을 찾지 못했습니다. 정책 영향도는 현재 작업 트리 기준으로 수동 확인이 필요합니다.')
    return
  }

  console.log('Changed files:')
  console.log(formatFileList(changedFiles))
  console.log('')

  const policyTriggered = []
  const codeTriggered = []

  for (const policy of registry.policies) {
    const documentChanged = changedFiles.some((filePath) => matchesAnyGlob(filePath, policy.documents))
    const sourceChanged = changedFiles.some((filePath) => matchesAnyGlob(filePath, policy.ownedAreas))

    if (documentChanged) {
      const impactedFiles = trackedFiles.filter((filePath) => matchesAnyGlob(filePath, policy.ownedAreas))
      policyTriggered.push({
        title: policy.title,
        files: impactedFiles,
      })
    }

    if (sourceChanged) {
      codeTriggered.push({
        title: policy.title,
        documents: policy.documents,
      })
    }
  }

  if (policyTriggered.length > 0) {
    console.log('Policy document changes require source review:')

    for (const item of policyTriggered) {
      console.log(`- ${item.title}`)
      console.log(formatFileList(item.files))
    }

    console.log('')
  }

  if (codeTriggered.length > 0) {
    console.log('Source changes require policy review:')

    for (const item of codeTriggered) {
      console.log(`- ${item.title}`)
      console.log(formatFileList(item.documents))
    }

    console.log('')
  }

  if (policyTriggered.length === 0 && codeTriggered.length === 0) {
    console.log('등록된 정책-코드 매핑에 걸리는 변경은 없습니다.')
  }
}

function runCheck() {
  const violations = collectViolations()

  if (violations.length === 0) {
    console.log('Policy check passed')
    return
  }

  console.error('Policy check failed')
  console.error('')

  for (const violation of violations) {
    console.error(`[${violation.rule}] ${violation.file}: ${violation.message}`)
  }

  process.exitCode = 1
}

if (mode === 'impact') {
  runImpact()
} else if (mode === 'check') {
  runCheck()
} else if (mode === 'guard') {
  runImpact()
  console.log('')
  runCheck()
} else {
  console.error(`Unknown mode: ${mode}`)
  process.exit(1)
}
