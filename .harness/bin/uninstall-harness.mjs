#!/usr/bin/env node
import { createHash } from 'crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const repoRoot = process.cwd()
const manifestPath = join(repoRoot, '.harness/install-manifest.json')
const packagePath = join(repoRoot, 'package.json')
const confirm = process.argv.includes('--confirm')
const dryRun = !confirm || process.argv.includes('--dry-run')

const harnessScriptNames = [
  'harness:guide',
  'harness:scan',
  'harness:handoff',
  'harness:impact',
  'harness:check',
  'harness:check:strict',
  'harness:sync',
  'harness:context',
  'harness:outdated',
  'harness:update',
  'harness:changelog',
  'harness:uninstall',
  'hooks:install',
  'standards:list',
  'templates:list',
  'stack:status',
  'stack:apply',
  'stack:reset',
  'template:status',
  'template:apply',
  'template:reset',
]

function readJson(absPath, fallback = null) {
  if (!existsSync(absPath)) return fallback
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'))
  } catch (error) {
    throw new Error(`${absPath} JSON을 읽을 수 없습니다: ${error.message}`)
  }
}

function toPosix(filePath) {
  return filePath.split('\\').join('/')
}

function sha256(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

async function fileMatchesManifest(rel, entry) {
  const abs = join(repoRoot, rel)
  if (!existsSync(abs) || !statSync(abs).isFile()) return false
  if (!entry?.sha256) return false
  return sha256(abs) === entry.sha256
}

function removeEmptyParents(rel) {
  let dir = dirname(join(repoRoot, rel))
  while (dir.startsWith(join(repoRoot, '.harness')) || dir.startsWith(join(repoRoot, '.claude')) || dir.startsWith(join(repoRoot, '.codex')) || dir.startsWith(join(repoRoot, '.githooks')) || dir.startsWith(join(repoRoot, '.github'))) {
    try {
      rmSync(dir, { recursive: false })
    } catch {
      break
    }
    dir = dirname(dir)
  }
}

function scriptLooksManaged(value) {
  return typeof value === 'string' && value.includes('.harness/bin/')
}

async function main() {
  const manifest = readJson(manifestPath)
  if (!manifest?.managedFiles) {
    console.error('하네스 설치 manifest가 없습니다: .harness/install-manifest.json')
    console.error('자동 제거 대상을 확정할 수 없어 중단합니다. 수동 정리가 필요하면 먼저 파일 목록을 확인하세요.')
    process.exit(1)
  }

  const removable = []
  const preserved = []

  for (const [rel, entry] of Object.entries(manifest.managedFiles)) {
    const normalized = toPosix(rel)
    const abs = join(repoRoot, normalized)
    if (!existsSync(abs)) continue
    if (await fileMatchesManifest(normalized, entry)) {
      removable.push(normalized)
    } else {
      preserved.push(normalized)
    }
  }

  const pkg = readJson(packagePath, null)
  const scriptRemovals = []
  if (pkg?.scripts) {
    for (const name of harnessScriptNames) {
      if (scriptLooksManaged(pkg.scripts[name])) {
        scriptRemovals.push(name)
      }
    }
  }

  console.log('::: 공통 하네스 제거 계획 :::')
  console.log(`프로젝트: ${repoRoot}`)
  console.log(`모드: ${dryRun ? 'dry-run' : 'confirm'}`)
  console.log('')
  console.log(`삭제할 managed 파일: ${removable.length}개`)
  for (const rel of removable.slice(0, 30)) console.log(`  - ${rel}`)
  if (removable.length > 30) console.log(`  ... 외 ${removable.length - 30}개`)
  console.log('')
  console.log(`보존할 로컬 수정/출처 불명 파일: ${preserved.length}개`)
  for (const rel of preserved.slice(0, 30)) console.log(`  - ${rel}`)
  if (preserved.length > 30) console.log(`  ... 외 ${preserved.length - 30}개`)
  console.log('')
  console.log(`package.json에서 제거할 하네스 명령: ${scriptRemovals.length}개`)
  for (const name of scriptRemovals) console.log(`  - ${name}`)

  if (dryRun) {
    console.log('')
    console.log('실제 제거하려면 다음 명령을 실행하세요:')
    console.log('  npm run harness:uninstall -- --confirm')
    return
  }

  for (const rel of removable) {
    rmSync(join(repoRoot, rel), { force: true })
    removeEmptyParents(rel)
  }

  if (pkg?.scripts && scriptRemovals.length > 0) {
    for (const name of scriptRemovals) delete pkg.scripts[name]
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  console.log('')
  console.log('공통 하네스 managed 파일과 하네스 npm 명령을 제거했습니다.')
  if (preserved.length > 0) {
    console.log('로컬 수정/출처 불명 파일은 보존했습니다. 필요하면 내용을 확인한 뒤 직접 삭제하세요.')
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
