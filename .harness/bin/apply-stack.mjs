import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRootRel = fs.existsSync(path.join(repoRoot, '.harness')) ? '.harness' : '.github'
const harnessRoot = path.join(repoRoot, harnessRootRel)
const profilePath = path.join(harnessRoot, harnessRootRel === '.harness' ? 'policy' : 'policy-harness', 'profile.json')
const stacksRoot = path.join(harnessRoot, 'stacks')
const appliedStacksRoot = path.join(stacksRoot, '.applied')
const templatesRoot = path.join(harnessRoot, 'templates')
const appliedTemplatesRoot = path.join(templatesRoot, '.applied')
const markerPath = path.join(harnessRoot, '.stack-applied.json')
const templateMarkerPath = path.join(harnessRoot, '.template-applied.json')
const lockPath = path.join(harnessRoot, 'harness-lock.json')
const stackPresetRulesRel = `${harnessRootRel}/project/stack-preset-rules.md`
const stackPresetRulesPath = path.join(repoRoot, stackPresetRulesRel)
const templateContractRel = `${harnessRootRel}/project/template-contract.md`
const templateContractPath = path.join(repoRoot, templateContractRel)
const stackRulesStart = '<!-- harness-stack-rules:start -->'
const stackRulesEnd = '<!-- harness-stack-rules:end -->'
const templateContractStart = '<!-- harness-template-contract:start -->'
const templateContractEnd = '<!-- harness-template-contract:end -->'

const args = process.argv.slice(2)
const isReset = args.includes('--reset')
const isStatus = args.includes('--status')
const isTemplateMode = args.includes('--template')
const isTemplateReset = args.includes('--template-reset')
const isTemplateStatus = args.includes('--template-status')
const isEmbedded = args.includes('--embedded')
const tempRoots = []
const PROJECT_RUNTIME_CONTRACT_FILES = new Set([
  '.nvmrc',
  '.node-version',
])

function getArgValue(flag) {
  const index = args.indexOf(flag)

  if (index === -1 || index === args.length - 1) {
    return undefined
  }

  return args[index + 1]
}

function nonEmpty(value) {
  return value === undefined || value === null || value === '' ? null : value
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function readJson(absPath, fallback = null) {
  if (!fs.existsSync(absPath)) {
    return fallback
  }

  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(absPath, value) {
  fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`)
}

function copyDirectoryExcluding(srcDir, destDir, shouldExclude) {
  if (!fs.existsSync(srcDir)) {
    return
  }

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    const rel = toPosix(path.relative(srcDir, src))

    if (shouldExclude(rel, entry)) {
      continue
    }

    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      copyDirectoryExcluding(src, dest, (childRel, childEntry) => shouldExclude(`${rel}/${childRel}`, childEntry))
      continue
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function readProfile() {
  return readJson(profilePath, { activeStack: 'none' })
}

function fetchPresetGit(repoUrl, ref = 'main') {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-preset-git-'))
  tempRoots.push(tmpRoot)

  const cloneArgs = ['clone', '--depth=1', '--branch', ref, repoUrl, tmpRoot]
  execFileSync('git', cloneArgs, { stdio: 'inherit' })
  return tmpRoot
}

function resolvePresetManifestPath(stackId, profile) {
  const cliPresetPath = getArgValue('--preset-path')
  const cliPresetGit = getArgValue('--preset-git')
  const cliRef = getArgValue('--ref') ?? 'main'
  const configuredManifest = profile.stackManifest

  if (cliPresetGit) {
    return path.join(fetchPresetGit(cliPresetGit, cliRef), 'manifest.json')
  }

  if (cliPresetPath) {
    const abs = path.resolve(repoRoot, cliPresetPath)
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory()
      ? path.join(abs, 'manifest.json')
      : abs
  }

  if (configuredManifest) {
    return path.resolve(repoRoot, configuredManifest)
  }

  return path.join(stacksRoot, stackId, 'manifest.json')
}

function resolveManifestRelative(manifestRoot, relPath) {
  if (!relPath) {
    return null
  }

  if (path.isAbsolute(relPath)) {
    return relPath
  }

  if (relPath.startsWith('.harness/') || relPath.startsWith('.github/') || relPath.startsWith('scripts/')) {
    return path.join(repoRoot, relPath)
  }

  return path.join(manifestRoot, relPath)
}

function readManifest(stackId, profile) {
  const manifestPath = resolvePresetManifestPath(stackId, profile)
  const manifest = readJson(manifestPath)

  if (!manifest) {
    throw new Error(`Stack manifest를 찾을 수 없습니다: ${manifestPath}`)
  }

  return {
    manifest,
    manifestPath,
    manifestRoot: path.dirname(manifestPath),
  }
}

function cleanupTempRoots() {
  for (const tempRoot of tempRoots) {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function readMarker() {
  return readJson(markerPath)
}

function writeMarker(value) {
  writeJson(markerPath, value)
}

function readTemplateMarker() {
  return readJson(templateMarkerPath)
}

function writeTemplateMarker(value) {
  writeJson(templateMarkerPath, value)
}

function readLock() {
  return readJson(lockPath, { version: 1 })
}

function writeLock(value) {
  writeJson(lockPath, value)
}

function deleteMarker() {
  if (fs.existsSync(markerPath)) {
    fs.unlinkSync(markerPath)
  }
}

function deleteTemplateMarker() {
  if (fs.existsSync(templateMarkerPath)) {
    fs.unlinkSync(templateMarkerPath)
  }
}

function isTemplateManifest(manifest) {
  const kind = String(manifest.kind ?? manifest.assetType ?? '').toLowerCase()
  return isTemplateMode
    || kind === 'scaffold-template'
    || kind === 'template'
    || Boolean(manifest.template?.guideRoot)
    || Boolean(manifest.template?.docs)
}

function snapshotStackStandard(stackId, manifest, context) {
  const snapshotRoot = path.join(appliedStacksRoot, stackId)
  fs.rmSync(snapshotRoot, { recursive: true, force: true })
  fs.mkdirSync(snapshotRoot, { recursive: true })

  const excludedSnapshotPaths = new Set([
    '.git',
    '.idea',
    '.vscode',
    'node_modules',
    '.DS_Store',
  ])
  const sourcePath = manifest.source?.path
  const sourceRel = sourcePath ? toPosix(sourcePath) : null
  const packageMergeRel = manifest.source?.packageMerge ? toPosix(manifest.source.packageMerge) : null

  copyDirectoryExcluding(context.manifestRoot, snapshotRoot, (rel) => {
    if ([...excludedSnapshotPaths].some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`))) {
      return true
    }

    if (sourceRel && (rel === sourceRel || rel.startsWith(`${sourceRel}/`))) {
      return true
    }

    if (packageMergeRel && rel === packageMergeRel) {
      return true
    }

    return false
  })

  const snapshotManifestPath = path.join(snapshotRoot, 'manifest.json')
  const snapshotManifest = readJson(snapshotManifestPath, manifest)
  snapshotManifest.source = { type: 'none' }
  writeJson(snapshotManifestPath, snapshotManifest)

  return {
    root: toPosix(path.relative(repoRoot, snapshotRoot)),
    manifestPath: toPosix(path.relative(repoRoot, snapshotManifestPath)),
  }
}

function templateDocs(manifest) {
  const guideRoot = manifest.template?.guideRoot ?? manifest.guideRoot ?? null
  const docs = manifest.template?.docs ?? manifest.docs ?? []
  return unique([guideRoot, ...docs].filter(Boolean))
}

function snapshotTemplateAsset(templateId, manifest, context) {
  const snapshotRoot = path.join(appliedTemplatesRoot, templateId)
  fs.rmSync(snapshotRoot, { recursive: true, force: true })
  fs.mkdirSync(snapshotRoot, { recursive: true })

  const snapshotManifestPath = path.join(snapshotRoot, 'manifest.json')
  writeJson(snapshotManifestPath, manifest)

  for (const docRel of templateDocs(manifest)) {
    const src = resolveManifestRelative(context.manifestRoot, docRel)

    if (!src || !fs.existsSync(src) || fs.statSync(src).isDirectory()) {
      continue
    }

    const dest = path.join(snapshotRoot, docRel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }

  return {
    root: toPosix(path.relative(repoRoot, snapshotRoot)),
    manifestPath: toPosix(path.relative(repoRoot, snapshotManifestPath)),
  }
}

function updateProfileForAppliedStack(stackId, stackSnapshot) {
  const previous = readProfile()
  const next = {
    ...previous,
    activeStack: stackId,
    available: unique([...(previous.available ?? ['none']), stackId]),
    stackManifest: stackSnapshot.manifestPath,
  }

  writeJson(profilePath, next)
  return previous
}

function readPackageVersion(manifestRoot) {
  const pkg = readJson(path.join(manifestRoot, 'package.json'), {})
  return pkg.version ?? null
}

function buildStackHarnessMetadata(stackId, manifest, context, stackSnapshot) {
  const cliPresetGit = nonEmpty(getArgValue('--preset-git'))
  const cliRef = nonEmpty(getArgValue('--ref'))
  const repo = nonEmpty(getArgValue('--stack-repo')) ?? cliPresetGit ?? manifest.stackHarness?.repo ?? null
  const ref = nonEmpty(getArgValue('--stack-ref')) ?? (cliPresetGit ? cliRef : manifest.stackHarness?.ref) ?? null
  const range = nonEmpty(getArgValue('--stack-range')) ?? manifest.stackHarness?.range ?? null
  const version = nonEmpty(getArgValue('--stack-version')) ?? readPackageVersion(context.manifestRoot) ?? manifest.stackHarness?.version ?? null
  const commit = nonEmpty(getArgValue('--stack-commit'))

  return {
    id: stackId,
    title: manifest.title ?? stackId,
    version,
    repo,
    ref,
    range,
    commit,
    manifestVersion: manifest.version ?? null,
    manifestPath: stackSnapshot.manifestPath,
    requiredBaseHarness: manifest.baseHarness ?? null,
  }
}

function buildTemplateMetadata(templateId, manifest, context, templateSnapshot) {
  const cliPresetGit = nonEmpty(getArgValue('--preset-git'))
  const cliRef = nonEmpty(getArgValue('--ref'))
  const repo = nonEmpty(getArgValue('--template-repo')) ?? cliPresetGit ?? manifest.template?.repo ?? null
  const ref = nonEmpty(getArgValue('--template-ref')) ?? (cliPresetGit ? cliRef : manifest.template?.ref) ?? null
  const range = nonEmpty(getArgValue('--template-range')) ?? manifest.template?.range ?? null
  const version = nonEmpty(getArgValue('--template-version')) ?? readPackageVersion(context.manifestRoot) ?? manifest.version ?? manifest.template?.version ?? null
  const commit = nonEmpty(getArgValue('--template-commit'))

  return {
    id: templateId,
    title: manifest.title ?? templateId,
    version,
    repo,
    ref,
    range,
    commit,
    manifestVersion: manifest.version ?? null,
    manifestPath: templateSnapshot.manifestPath,
    guideRoot: manifest.template?.guideRoot ?? manifest.guideRoot ?? null,
    docs: templateDocs(manifest),
    requiredStackHarness: manifest.requiredStackHarness ?? null,
    requiredBaseHarness: manifest.baseHarness ?? null,
  }
}

function updateHarnessLockForStack(stackHarness) {
  const previous = readLock()
  const next = {
    ...previous,
    version: 1,
    updatedAt: new Date().toISOString(),
    baseHarness: previous.baseHarness ?? null,
    stackHarness,
  }

  writeLock(next)
  return next
}

function updateHarnessLockForTemplate(scaffoldTemplate) {
  const previous = readLock()
  const next = {
    ...previous,
    version: 1,
    updatedAt: new Date().toISOString(),
    scaffoldTemplate,
  }

  writeLock(next)
  return next
}

function clearStackHarnessLock() {
  const previous = readLock()
  if (!previous.stackHarness) {
    return previous
  }

  const next = {
    ...previous,
    updatedAt: new Date().toISOString(),
    stackHarness: null,
  }

  writeLock(next)
  return next
}

function clearTemplateLock() {
  const previous = readLock()
  if (!previous.scaffoldTemplate) {
    return previous
  }

  const next = {
    ...previous,
    updatedAt: new Date().toISOString(),
    scaffoldTemplate: null,
  }

  writeLock(next)
  return next
}

function restoreStackProfileFields(snapshot) {
  if (!snapshot) {
    return
  }

  const current = readProfile()
  const restored = {
    ...snapshot,
    ...current,
    // stack:reset reverts only stack-owned profile fields.
    activeStack: snapshot.activeStack ?? 'none',
    available: snapshot.available ?? ['none'],
    stackManifest: snapshot.stackManifest ?? null,
  }

  writeJson(profilePath, restored)
}

function unique(values) {
  return [...new Set(values)]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesPattern(rel, pattern) {
  const normalized = toPosix(pattern)

  if (normalized.endsWith('/**')) {
    const prefix = normalized.slice(0, -3)
    return rel === prefix || rel.startsWith(`${prefix}/`)
  }

  if (normalized.includes('*')) {
    const regex = new RegExp(`^${escapeRegExp(normalized)
      .replace(/\\\*\\\*/g, '.*')
      .replace(/\\\*/g, '[^/]*')}$`)
    return regex.test(rel)
  }

  return rel === normalized
}

function matchesAnyPattern(rel, patterns) {
  return patterns.some((pattern) => matchesPattern(rel, pattern))
}

function listScaffoldFiles(scaffoldRoot, manifest = {}) {
  const out = []
  const includePatterns = manifest.source?.include ?? []
  const excludePatterns = [
    '.git/**',
    'node_modules/**',
    '.harness-backup/**',
    'dist/**',
    '.DS_Store',
    ...(manifest.source?.exclude ?? []),
  ]

  function walk(absDir, relDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name === 'package.merge.json' && relDir === '') {
        continue
      }

      const absChild = path.join(absDir, entry.name)
      const relChild = relDir ? `${relDir}/${entry.name}` : entry.name

      if (matchesAnyPattern(relChild, excludePatterns)) {
        continue
      }

      if (entry.isDirectory()) {
        walk(absChild, relChild)
        continue
      }

      if (includePatterns.length > 0 && !matchesAnyPattern(relChild, includePatterns)) {
        continue
      }

      out.push(relChild)
    }
  }

  walk(scaffoldRoot, '')
  return out
}

function copyFileEnsuringDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function shouldPreserveProjectRuntimeContract(rel) {
  const normalized = toPosix(rel)
  return PROJECT_RUNTIME_CONTRACT_FILES.has(normalized) && fs.existsSync(path.join(repoRoot, normalized))
}

function mergePackageJson(packageMergeData) {
  if (!packageMergeData) {
    return null
  }

  const rootPkgPath = path.join(repoRoot, 'package.json')
  const rootPkg = readJson(rootPkgPath, {})
  const snapshot = JSON.parse(JSON.stringify(rootPkg))

  for (const section of ['scripts', 'dependencies', 'devDependencies']) {
    if (!packageMergeData[section]) {
      continue
    }

    rootPkg[section] = rootPkg[section] ?? {}

    for (const [key, value] of Object.entries(packageMergeData[section])) {
      if (section === 'scripts' && key in rootPkg[section] && !isNpmInitPlaceholderScript(key, rootPkg[section][key])) {
        // harness script wins on conflict
        continue
      }

      rootPkg[section][key] = value
    }
  }

  writeJson(rootPkgPath, rootPkg)
  return snapshot
}

function isNpmInitPlaceholderScript(key, value) {
  return key === 'test' && value === 'echo "Error: no test specified" && exit 1'
}

function restorePackageJson(snapshot) {
  if (!snapshot) {
    return
  }

  writeJson(path.join(repoRoot, 'package.json'), snapshot)
}

function readTextIfExists(absPath) {
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null
}

function upsertGeneratedSection(current, generated, startMarker = stackRulesStart, endMarker = stackRulesEnd) {
  const block = `${startMarker}\n${generated.trim()}\n${endMarker}`

  if (current.includes(startMarker) && current.includes(endMarker)) {
    const before = current.slice(0, current.indexOf(startMarker))
    const after = current.slice(current.indexOf(endMarker) + endMarker.length)
    return `${before}${block}${after}`
  }

  const prefix = current.trim() ? `${current.replace(/\s*$/, '')}\n\n` : ''
  return `${prefix}${block}\n`
}

function renderStackLocalRules(stackId, manifest, manifestRoot) {
  const lines = [
    `## 적용된 스택: ${manifest.title ?? stackId}`,
    '',
    `- stackId: \`${stackId}\``,
    `- framework: ${manifest.framework ? Object.values(manifest.framework).join(' / ') : 'TBD'}`,
    `- designPattern: ${(manifest.designPattern ?? []).join(' + ') || 'TBD'}`,
    '',
    '이 섹션은 `npm run stack:apply`가 생성한 로컬 규칙입니다. 공통 하네스의 전역 강제가 아니라, 이 프로젝트가 선택한 스택 기준으로 해석합니다.',
  ]

  for (const instructionRel of manifest.instructions ?? []) {
    const abs = resolveManifestRelative(manifestRoot, instructionRel)
    if (!fs.existsSync(abs)) {
      continue
    }

    lines.push('')
    lines.push(`---`)
    lines.push('')
    lines.push(`### ${instructionRel}`)
    lines.push('')
    lines.push(fs.readFileSync(abs, 'utf8').trim())
  }

  return `${lines.join('\n')}\n`
}

function renderTemplateContract(templateId, manifest, templateSnapshot) {
  const requiredStack = manifest.requiredStackHarness ?? null
  const guideRoot = manifest.template?.guideRoot ?? manifest.guideRoot ?? null
  const docs = templateDocs(manifest)
  const lines = [
    `## 적용된 템플릿: ${manifest.title ?? templateId}`,
    '',
    `- templateId: \`${templateId}\``,
    `- version: ${manifest.version ?? manifest.template?.version ?? 'TBD'}`,
    `- manifest: \`${templateSnapshot.manifestPath}\``,
    `- guideRoot: ${guideRoot ? `\`${guideRoot}\`` : 'TBD'}`,
    '',
    '이 섹션은 scaffold 템플릿이 생성한 코드와 템플릿 개발 가이드를 프로젝트 하네스에 연결하는 브리지입니다.',
    '템플릿 가이드 전체는 템플릿 저장소가 소유하며, 현재 프로젝트에서 추가하거나 바꾼 판단만 이 파일의 관리 섹션 밖 또는 다른 `.harness/project/*` 문서에 기록합니다.',
  ]

  if (requiredStack?.id || requiredStack?.repo) {
    lines.push('')
    lines.push('### 요구 스택 하네스')
    lines.push(`- id: ${requiredStack.id ? `\`${requiredStack.id}\`` : 'TBD'}`)
    lines.push(`- repo: ${requiredStack.repo ?? 'TBD'}`)
    lines.push(`- range: ${requiredStack.range ?? requiredStack.ref ?? requiredStack.minVersion ?? 'TBD'}`)
  }

  if (docs.length > 0) {
    lines.push('')
    lines.push('### 템플릿 개발 가이드')
    for (const doc of docs) {
      lines.push(`- \`${doc}\``)
    }
  }

  lines.push('')
  lines.push('### 해석 원칙')
  lines.push('- 스택 일반 기준은 `stack-preset-rules.md`에서 확인합니다.')
  lines.push('- 템플릿 코드가 전제하는 계약은 위 템플릿 개발 가이드를 따릅니다.')
  lines.push('- 현재 프로젝트의 도메인, 예외, 운영 선택은 `domain-rules.md`, `architecture-rules.md`, `workflow-rules.md` 또는 이 파일의 관리 섹션 밖에 기록합니다.')
  lines.push('- 템플릿 계약과 프로젝트 로컬룰이 충돌하면 `decision-log.md`에 선택 이유를 남깁니다.')

  return `${lines.join('\n')}\n`
}

function applyStackLocalRules(stackId, manifest, manifestRoot) {
  const before = readTextIfExists(stackPresetRulesPath)
  const current = before ?? '# 스택 프리셋 로컬 규칙\n\n'
  const generated = renderStackLocalRules(stackId, manifest, manifestRoot)
  const next = upsertGeneratedSection(current, generated)

  fs.mkdirSync(path.dirname(stackPresetRulesPath), { recursive: true })
  fs.writeFileSync(stackPresetRulesPath, next)

  return {
    path: toPosix(stackPresetRulesRel),
    existed: before !== null,
    content: before,
  }
}

function applyTemplateContract(templateId, manifest, templateSnapshot) {
  const before = readTextIfExists(templateContractPath)
  const current = before ?? '# 템플릿 사용 계약\n\n'
  const generated = renderTemplateContract(templateId, manifest, templateSnapshot)
  const next = upsertGeneratedSection(current, generated, templateContractStart, templateContractEnd)

  fs.mkdirSync(path.dirname(templateContractPath), { recursive: true })
  fs.writeFileSync(templateContractPath, next)

  return {
    path: toPosix(templateContractRel),
    existed: before !== null,
    content: before,
  }
}

function restoreStackLocalRules(snapshot) {
  if (!snapshot?.path) {
    return
  }

  const abs = path.join(repoRoot, snapshot.path)
  if (snapshot.existed) {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, snapshot.content ?? '')
    return
  }

  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs)
    removeEmptyParents(abs)
  }
}

function restoreTemplateContract(snapshot) {
  if (!snapshot?.path) {
    return
  }

  const abs = path.join(repoRoot, snapshot.path)
  if (snapshot.existed) {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, snapshot.content ?? '')
    return
  }

  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs)
    removeEmptyParents(abs)
  }
}

// ---------- Source adapters ----------

function adapterLocal(manifest, context) {
  const scaffoldRel = manifest.source.path
  const scaffoldRoot = resolveManifestRelative(context.manifestRoot, scaffoldRel)

  if (!fs.existsSync(scaffoldRoot)) {
    throw new Error(`local source 경로가 존재하지 않습니다: ${scaffoldRel}`)
  }

  const files = listScaffoldFiles(scaffoldRoot, manifest)
  const copied = []

  for (const rel of files) {
    const src = path.join(scaffoldRoot, rel)
    const dest = path.join(repoRoot, rel)
    if (shouldPreserveProjectRuntimeContract(rel)) {
      console.log(`Preserved project runtime contract: ${rel}`)
      continue
    }
    copyFileEnsuringDir(src, dest)
    copied.push(toPosix(rel))
  }

  // packageMerge는 manifest 위치 기준 상대 경로로 해석한다.
  const packageMergeRel = manifest.source?.packageMerge
  let packageMergeData = null

  if (packageMergeRel) {
    const absMerge = resolveManifestRelative(context.manifestRoot, packageMergeRel)
    if (fs.existsSync(absMerge)) {
      packageMergeData = readJson(absMerge, null)
    }
  }

  return { copied, packageMergeData }
}

function adapterTiged(manifest) {
  const ref = manifest.source?.ref

  if (!ref) {
    throw new Error('source.type=tiged 사용 시 manifest.source.ref(예: "owner/repo" 또는 "owner/repo#branch")가 필요합니다.')
  }

  const subdir = manifest.source?.subdir ?? ''
  const packageMergeRel = manifest.source?.packageMerge ?? ''
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-stack-'))

  try {
    console.log(`  Fetching '${ref}' via tiged into temp...`)

    execFileSync('npx', ['-y', 'tiged', '--force', ref, tmpRoot], {
      stdio: 'inherit',
    })

    const sourceRoot = subdir ? path.join(tmpRoot, subdir) : tmpRoot

    if (!fs.existsSync(sourceRoot)) {
      throw new Error(`tiged 결과물에서 subdir 경로를 찾을 수 없습니다: ${subdir || '(root)'}`)
    }

    let packageMergeData = null
    if (packageMergeRel) {
      // packageMerge는 sourceRoot 기준 상대 경로로 본다
      const absMerge = path.join(sourceRoot, packageMergeRel)
      if (fs.existsSync(absMerge)) {
        packageMergeData = readJson(absMerge, null)
      }
    }

    const files = listScaffoldFiles(sourceRoot, manifest).filter((rel) => rel !== packageMergeRel)
    const copied = []

    for (const rel of files) {
      const src = path.join(sourceRoot, rel)
      const dest = path.join(repoRoot, rel)
      if (shouldPreserveProjectRuntimeContract(rel)) {
        console.log(`Preserved project runtime contract: ${rel}`)
        continue
      }
      copyFileEnsuringDir(src, dest)
      copied.push(toPosix(rel))
    }

    return { copied, packageMergeData }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

function adapterNone() {
  return { copied: [], packageMergeData: null }
}

const SOURCE_ADAPTERS = {
  local: adapterLocal,
  tiged: adapterTiged,
  none: adapterNone,
}

// ---------- Commands ----------

function commandStatus() {
  const profile = readProfile()
  const marker = readMarker()
  const templateMarker = readTemplateMarker()
  const lock = readLock()

  console.log('Stack status')
  console.log(`  activeStack: ${profile.activeStack ?? 'none'}`)
  if (profile.stackManifest) {
    console.log(`  stackManifest: ${profile.stackManifest}`)
  }

  if (lock.baseHarness || lock.stackHarness) {
    console.log('')
    console.log('Harness versions')
    if (lock.baseHarness) {
      console.log(`  base: ${lock.baseHarness.id ?? 'harness-seed'} ${lock.baseHarness.version ?? 'unknown'}${lock.baseHarness.ref ? ` (${lock.baseHarness.ref})` : ''}`)
    }
    if (lock.stackHarness) {
      console.log(`  stack: ${lock.stackHarness.id ?? profile.activeStack ?? 'unknown'} ${lock.stackHarness.version ?? 'unknown'}${lock.stackHarness.ref ? ` (${lock.stackHarness.ref})` : ''}`)
      if (lock.stackHarness.requiredBaseHarness?.ref) {
        console.log(`  requiredBase: ${lock.stackHarness.requiredBaseHarness.ref}`)
      }
    }
  }

  if (!marker) {
    console.log('  applied: no')
  } else {
    console.log('  applied: yes')
    console.log(`  appliedStack: ${marker.stackId}`)
    console.log(`  appliedAt: ${marker.appliedAt}`)
    if (marker.manifestPath) {
      console.log(`  manifestPath: ${marker.manifestPath}`)
    }
    const sourceType = marker.source?.type ?? 'unknown'
    const copiedCount = marker.copiedFiles?.length ?? 0
    console.log(`  source.type: ${sourceType}`)
    console.log(`  stackType: ${sourceType === 'none' ? 'rules-only' : 'rules-and-scaffold'}`)
    console.log(`  copiedFiles: ${copiedCount}`)
    if (sourceType === 'none') {
      console.log('  reason: 이 스택은 프로젝트 기준 문서만 적용하고 scaffold 파일은 복사하지 않습니다.')
      console.log('  templateHint: scaffold가 필요하면 npm run templates:list')
    }

    if (profile.activeStack !== marker.stackId) {
      console.log('')
      console.log(`  WARNING: activeStack(${profile.activeStack})과 적용된 스택(${marker.stackId})이 다릅니다.`)
    }
  }

  if (templateMarker || lock.scaffoldTemplate) {
    console.log('')
    console.log('Scaffold template')
    if (lock.scaffoldTemplate) {
      console.log(`  template: ${lock.scaffoldTemplate.id ?? 'unknown'} ${lock.scaffoldTemplate.version ?? 'unknown'}${lock.scaffoldTemplate.ref ? ` (${lock.scaffoldTemplate.ref})` : ''}`)
      if (lock.scaffoldTemplate.requiredStackHarness?.id) {
        console.log(`  requiredStack: ${lock.scaffoldTemplate.requiredStackHarness.id}`)
      }
      if (lock.scaffoldTemplate.guideRoot) {
        console.log(`  guideRoot: ${lock.scaffoldTemplate.guideRoot}`)
      }
    }

    if (templateMarker) {
      console.log(`  appliedAt: ${templateMarker.appliedAt}`)
      console.log(`  copiedFiles: ${templateMarker.copiedFiles?.length ?? 0}`)
      console.log(`  contract: ${templateMarker.templateContractBackup?.path ?? templateContractRel}`)
    }
  }
}

function validateTemplateRequirements(manifest, profile, lock) {
  const required = manifest.requiredStackHarness
  if (!required?.id) {
    return
  }

  const activeStackId = lock.stackHarness?.id ?? profile.activeStack ?? 'none'
  if (activeStackId === required.id) {
    return
  }

  console.error('템플릿 요구 스택과 현재 프로젝트 스택이 맞지 않습니다.')
  console.error(`  required: ${required.id}`)
  console.error(`  current: ${activeStackId}`)
  if (required.repo) {
    console.error('')
    console.error('먼저 맞는 스택 하네스를 설치하세요.')
    console.error(`  npx -y git+${required.repo}${required.ref ? `#${required.ref}` : ''} init`)
  }
  process.exit(1)
}

function commandApplyTemplate(templateId, manifest, context, profile) {
  const existing = readTemplateMarker()

  if (existing) {
    console.error(`이미 scaffold 템플릿이 적용되어 있습니다 (templateId=${existing.templateId}). 먼저 npm run template:reset 실행 후 다시 시도하세요.`)
    process.exit(1)
  }

  const lockBefore = readLock()
  validateTemplateRequirements(manifest, profile, lockBefore)

  const sourceType = manifest.source?.type ?? 'local'
  const adapter = SOURCE_ADAPTERS[sourceType]

  if (!adapter) {
    console.error(`알 수 없는 source.type: ${sourceType}. 지원: ${Object.keys(SOURCE_ADAPTERS).join(', ')}`)
    process.exit(1)
  }

  console.log(`Applying scaffold template '${templateId}' (source.type=${sourceType})...`)
  const result = adapter(manifest, context)
  const copiedFiles = result.copied
  const packageBackup = mergePackageJson(result.packageMergeData)
  const templateSnapshot = snapshotTemplateAsset(templateId, manifest, context)
  const templateContractBackup = applyTemplateContract(templateId, manifest, templateSnapshot)
  const scaffoldTemplate = buildTemplateMetadata(templateId, manifest, context, templateSnapshot)
  const lock = updateHarnessLockForTemplate(scaffoldTemplate)

  writeTemplateMarker({
    templateId,
    appliedAt: new Date().toISOString(),
    manifestPath: templateSnapshot.manifestPath,
    sourceManifestPath: toPosix(path.relative(repoRoot, context.manifestPath)),
    source: manifest.source,
    copiedFiles,
    packageJsonBackup: packageBackup,
    templateContractBackup,
    templateSnapshot,
    scaffoldTemplate,
  })

  console.log(`Applied scaffold template. ${copiedFiles.length} file(s) copied.`)
  console.log('')
  console.log('Template contract bridge')
  console.log(`  - ${templateContractRel}`)
  console.log(`  - ${templateSnapshot.manifestPath}`)
  if (scaffoldTemplate.guideRoot) {
    console.log(`  - guideRoot: ${scaffoldTemplate.guideRoot}`)
  }
  if (lock.scaffoldTemplate?.version) {
    console.log(`harness lock: template=${lock.scaffoldTemplate.version}`)
  }
  console.log('다음 단계:')
  console.log('  1. 템플릿 개발 가이드 확인')
  console.log(`     ${scaffoldTemplate.guideRoot ?? '템플릿 README'}`)
  console.log(`  2. ${templateContractRel} 확인`)
  console.log('  3. npm install')
  console.log('  4. npm run harness:check')
}

function commandApply() {
  const profile = readProfile()
  const hasExternalPresetInput = Boolean(getArgValue('--preset-path') || getArgValue('--preset-git'))
  let stackId = profile.activeStack

  if ((!stackId || stackId === 'none') && !hasExternalPresetInput) {
    console.error(`activeStack이 설정되지 않았습니다. ${toPosix(path.relative(repoRoot, profilePath))}의 activeStack을 먼저 지정하세요.`)
    console.error('외부 스택 기준을 바로 적용하려면 npm run stack:apply -- --preset-path <dir> 또는 --preset-git <repo-url> --ref <tag>를 사용하세요.')
    process.exit(1)
  }

  const context = readManifest(stackId, profile)
  const manifest = context.manifest
  const isTemplate = isTemplateManifest(manifest)
  stackId = isTemplate
    ? manifest.id
    : stackId && stackId !== 'none'
      ? stackId
      : manifest.id

  if (!stackId) {
    console.error('프리셋 manifest에 id가 없습니다.')
    process.exit(1)
  }

  if (isTemplate) {
    commandApplyTemplate(stackId, manifest, context, profile)
    return
  }

  const existing = readMarker()

  if (existing) {
    console.error(`이미 스택이 적용되어 있습니다 (stackId=${existing.stackId}). 먼저 npm run stack:reset 실행 후 다시 시도하세요.`)
    process.exit(1)
  }

  const sourceType = manifest.source?.type ?? 'local'
  const adapter = SOURCE_ADAPTERS[sourceType]

  if (!adapter) {
    console.error(`알 수 없는 source.type: ${sourceType}. 지원: ${Object.keys(SOURCE_ADAPTERS).join(', ')}`)
    process.exit(1)
  }

  console.log(`Applying stack '${stackId}' (source.type=${sourceType})...`)
  const result = adapter(manifest, context)
  const copiedFiles = result.copied
  const packageBackup = mergePackageJson(result.packageMergeData)
  const stackLocalRulesBackup = applyStackLocalRules(stackId, manifest, context.manifestRoot)
  const stackSnapshot = snapshotStackStandard(stackId, manifest, context)
  const profileBackup = updateProfileForAppliedStack(stackId, stackSnapshot)
  const stackHarness = buildStackHarnessMetadata(stackId, manifest, context, stackSnapshot)
  const lock = updateHarnessLockForStack(stackHarness)

  writeMarker({
    stackId,
    appliedAt: new Date().toISOString(),
    manifestPath: stackSnapshot.manifestPath,
    sourceManifestPath: toPosix(path.relative(repoRoot, context.manifestPath)),
    source: manifest.source,
    copiedFiles,
    packageJsonBackup: packageBackup,
    stackLocalRulesBackup,
    stackSnapshot,
    stackHarness,
    profileBackup,
  })

  console.log(`Applied. ${copiedFiles.length} file(s) copied.`)
  if (sourceType === 'none') {
    console.log('')
    console.log('Rules-only stack applied')
    console.log('  적용된 것:')
    console.log(`  - ${manifest.title ?? stackId} 개발 기준`)
    console.log(`  - ${stackPresetRulesRel}`)
    console.log(`  - ${stackSnapshot.manifestPath}`)
    console.log('  복사하지 않는 것:')
    console.log('  - 업무 코드 scaffold 파일')
    console.log('  - UI, API, 상태, batch 등 스택별 예제 파일')
    console.log('  scaffold 템플릿이 필요하면: npm run templates:list')
    console.log('')
  }
  console.log(`stackManifest: ${stackSnapshot.manifestPath}`)
  if (lock.baseHarness?.version || stackHarness.version) {
    console.log(`harness lock: base=${lock.baseHarness?.version ?? 'unknown'}, stack=${stackHarness.version ?? stackId}`)
  }
  if (!isEmbedded) {
    console.log('다음 단계:')
    if (sourceType !== 'none') {
      console.log('  1. npm install')
      console.log('  2. npm run harness:check')
    } else {
      console.log('  1. .harness/project/stack-preset-rules.md 확인')
      console.log('  2. npm run harness:check')
    }
  }
}

function commandTemplateStatus() {
  const marker = readTemplateMarker()
  const lock = readLock()

  console.log('Scaffold template status')
  if (!marker && !lock.scaffoldTemplate) {
    console.log('  applied: no')
    return
  }

  if (lock.scaffoldTemplate) {
    console.log(`  template: ${lock.scaffoldTemplate.id ?? 'unknown'} ${lock.scaffoldTemplate.version ?? 'unknown'}${lock.scaffoldTemplate.ref ? ` (${lock.scaffoldTemplate.ref})` : ''}`)
    if (lock.scaffoldTemplate.guideRoot) {
      console.log(`  guideRoot: ${lock.scaffoldTemplate.guideRoot}`)
    }
    if (lock.scaffoldTemplate.manifestPath) {
      console.log(`  manifestPath: ${lock.scaffoldTemplate.manifestPath}`)
    }
    if (lock.scaffoldTemplate.requiredStackHarness?.id) {
      console.log(`  requiredStack: ${lock.scaffoldTemplate.requiredStackHarness.id}`)
    }
  }

  if (marker) {
    console.log('  applied: yes')
    console.log(`  appliedAt: ${marker.appliedAt}`)
    console.log(`  copiedFiles: ${marker.copiedFiles?.length ?? 0}`)
    console.log(`  contract: ${marker.templateContractBackup?.path ?? templateContractRel}`)
  }
}

function removeEmptyParents(absPath) {
  let dir = path.dirname(absPath)

  while (dir.startsWith(repoRoot) && dir !== repoRoot) {
    try {
      fs.rmdirSync(dir)
      dir = path.dirname(dir)
    } catch {
      break
    }
  }
}

function commandReset() {
  const marker = readMarker()

  if (!marker) {
    console.log('적용된 스택이 없습니다.')
    return
  }

  let removed = 0

  for (const rel of marker.copiedFiles ?? []) {
    const abs = path.join(repoRoot, rel)

    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs)
      removed += 1
      removeEmptyParents(abs)
    }
  }

  restorePackageJson(marker.packageJsonBackup)
  restoreStackLocalRules(marker.stackLocalRulesBackup)
  restoreStackProfileFields(marker.profileBackup)
  if (marker.stackSnapshot?.root) {
    fs.rmSync(path.join(repoRoot, marker.stackSnapshot.root), { recursive: true, force: true })
    removeEmptyParents(path.join(repoRoot, marker.stackSnapshot.root))
  }
  clearStackHarnessLock()
  deleteMarker()

  console.log(`Reset complete. ${removed} file(s) removed. package.json도 적용 전 상태로 복원했습니다.`)
  console.log('node_modules는 자동으로 정리하지 않습니다. 필요 시 수동으로 npm install 또는 rm -rf node_modules를 수행하세요.')
}

function commandTemplateReset() {
  const marker = readTemplateMarker()

  if (!marker) {
    console.log('적용된 scaffold 템플릿이 없습니다.')
    return
  }

  let removed = 0

  for (const rel of marker.copiedFiles ?? []) {
    const abs = path.join(repoRoot, rel)

    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs)
      removed += 1
      removeEmptyParents(abs)
    }
  }

  restorePackageJson(marker.packageJsonBackup)
  restoreTemplateContract(marker.templateContractBackup)
  if (marker.templateSnapshot?.root) {
    fs.rmSync(path.join(repoRoot, marker.templateSnapshot.root), { recursive: true, force: true })
    removeEmptyParents(path.join(repoRoot, marker.templateSnapshot.root))
  }
  clearTemplateLock()
  deleteTemplateMarker()

  console.log(`Template reset complete. ${removed} file(s) removed. package.json도 적용 전 상태로 복원했습니다.`)
  console.log('node_modules는 자동으로 정리하지 않습니다. 필요 시 수동으로 npm install 또는 rm -rf node_modules를 수행하세요.')
}

try {
  if (isTemplateStatus) {
    commandTemplateStatus()
  } else if (isTemplateReset) {
    commandTemplateReset()
  } else if (isStatus) {
    commandStatus()
  } else if (isReset) {
    commandReset()
  } else {
    commandApply()
  }
} finally {
  cleanupTempRoots()
}
