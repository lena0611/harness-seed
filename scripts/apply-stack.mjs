import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const profilePath = path.join(repoRoot, '.github', 'policy-harness', 'profile.json')
const markerPath = path.join(repoRoot, '.github', '.stack-applied.json')

const args = process.argv.slice(2)
const isReset = args.includes('--reset')
const isStatus = args.includes('--status')

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

function readProfile() {
  return readJson(profilePath, { activeStack: 'none' })
}

function readManifest(stackId) {
  const manifestPath = path.join(repoRoot, '.github', 'stacks', stackId, 'manifest.json')
  const manifest = readJson(manifestPath)

  if (!manifest) {
    throw new Error(`Stack manifest를 찾을 수 없습니다: ${manifestPath}`)
  }

  return manifest
}

function readMarker() {
  return readJson(markerPath)
}

function writeMarker(value) {
  writeJson(markerPath, value)
}

function deleteMarker() {
  if (fs.existsSync(markerPath)) {
    fs.unlinkSync(markerPath)
  }
}

function listScaffoldFiles(scaffoldRoot) {
  const out = []

  function walk(absDir, relDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name === 'package.merge.json' && relDir === '') {
        continue
      }

      const absChild = path.join(absDir, entry.name)
      const relChild = relDir ? `${relDir}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        walk(absChild, relChild)
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

// ---------- Source adapters ----------

function adapterLocal(manifest) {
  const scaffoldRel = manifest.source.path
  const scaffoldRoot = path.join(repoRoot, scaffoldRel)

  if (!fs.existsSync(scaffoldRoot)) {
    throw new Error(`local source 경로가 존재하지 않습니다: ${scaffoldRel}`)
  }

  const files = listScaffoldFiles(scaffoldRoot)
  const copied = []

  for (const rel of files) {
    const src = path.join(scaffoldRoot, rel)
    const dest = path.join(repoRoot, rel)
    copyFileEnsuringDir(src, dest)
    copied.push(toPosix(rel))
  }

  // packageMerge는 repoRoot 기준 경로로 manifest에 적혀 있음
  const packageMergeRel = manifest.source?.packageMerge
  let packageMergeData = null

  if (packageMergeRel) {
    const absMerge = path.join(repoRoot, packageMergeRel)
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

    const files = listScaffoldFiles(sourceRoot).filter((rel) => rel !== packageMergeRel)
    const copied = []

    for (const rel of files) {
      const src = path.join(sourceRoot, rel)
      const dest = path.join(repoRoot, rel)
      copyFileEnsuringDir(src, dest)
      copied.push(toPosix(rel))
    }

    return { copied, packageMergeData }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

const SOURCE_ADAPTERS = {
  local: adapterLocal,
  tiged: adapterTiged,
}

// ---------- Commands ----------

function commandStatus() {
  const profile = readProfile()
  const marker = readMarker()

  console.log('Stack status')
  console.log(`  activeStack: ${profile.activeStack ?? 'none'}`)

  if (!marker) {
    console.log('  applied: no')
    return
  }

  console.log('  applied: yes')
  console.log(`  appliedStack: ${marker.stackId}`)
  console.log(`  appliedAt: ${marker.appliedAt}`)
  console.log(`  source.type: ${marker.source?.type ?? 'unknown'}`)
  console.log(`  files: ${marker.copiedFiles?.length ?? 0}`)

  if (profile.activeStack !== marker.stackId) {
    console.log('')
    console.log(`  WARNING: activeStack(${profile.activeStack})과 적용된 스택(${marker.stackId})이 다릅니다.`)
  }
}

function commandApply() {
  const profile = readProfile()
  const stackId = profile.activeStack

  if (!stackId || stackId === 'none') {
    console.error('activeStack이 설정되지 않았습니다. .github/policy-harness/profile.json의 activeStack을 먼저 지정하세요.')
    process.exit(1)
  }

  const existing = readMarker()

  if (existing) {
    console.error(`이미 스택이 적용되어 있습니다 (stackId=${existing.stackId}). 먼저 npm run stack:reset 실행 후 다시 시도하세요.`)
    process.exit(1)
  }

  const manifest = readManifest(stackId)
  const sourceType = manifest.source?.type ?? 'local'
  const adapter = SOURCE_ADAPTERS[sourceType]

  if (!adapter) {
    console.error(`알 수 없는 source.type: ${sourceType}. 지원: ${Object.keys(SOURCE_ADAPTERS).join(', ')}`)
    process.exit(1)
  }

  console.log(`Applying stack '${stackId}' (source.type=${sourceType})...`)
  const result = adapter(manifest)
  const copiedFiles = result.copied
  const packageBackup = mergePackageJson(result.packageMergeData)

  writeMarker({
    stackId,
    appliedAt: new Date().toISOString(),
    source: manifest.source,
    copiedFiles,
    packageJsonBackup: packageBackup,
  })

  console.log(`Applied. ${copiedFiles.length} file(s) copied.`)
  console.log('다음 단계:')
  console.log('  1. npm install')
  console.log('  2. npm run guard')
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
  deleteMarker()

  console.log(`Reset complete. ${removed} file(s) removed. package.json도 적용 전 상태로 복원했습니다.`)
  console.log('node_modules는 자동으로 정리하지 않습니다. 필요 시 수동으로 npm install 또는 rm -rf node_modules를 수행하세요.')
}

if (isStatus) {
  commandStatus()
} else if (isReset) {
  commandReset()
} else {
  commandApply()
}
