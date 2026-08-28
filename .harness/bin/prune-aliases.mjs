#!/usr/bin/env node
// 은퇴한 하네스 npm 별칭을 package.json에서 안전하게 지운다(0.2.131).
//
// 왜 필요한가: 0.2.131부터 하네스는 npm 별칭을 주입하지 않지만, 기존 소비자의
// package.json에 이미 들어간 별칭은 add-only 계약에 따라 업데이트가 지우지 않는다.
// 그대로 둬도 계속 동작하므로 정리는 선택이며, 이 도구는 그 선택을 도울 뿐이다.
//
// 안전 원칙:
//  - 기본은 미리보기다. 실제 수정은 --write를 줄 때만 한다.
//  - 하네스가 주입했다고 인식되는 값일 때만 지운다. 프로젝트가 값을 고쳤으면 보존하고 알린다.
//  - 지우기 전에 package.json.harness-bak을 남긴다.
//  - scripts 외의 어떤 필드도 건드리지 않고, 키 순서와 들여쓰기를 유지한다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..', '..')
const pkgPath = path.join(repoRoot, 'package.json')

// 0.2.131에서 주입을 중단한 별칭. scripts/init.mjs의 RETIRED_CONSUMER_SCRIPTS와 같은 목록이며,
// 드리프트는 회귀(prune 도구 테스트)가 검사한다.
const RETIRED = [
  'harness:check',
  'harness:impact',
  'harness:context',
  'hooks:install',
  'harness:guide',
  'harness:scan',
  'harness:handoff',
  'harness:check:strict',
  'harness:sync',
  'harness:spec:fetch',
  'harness:spec:status',
  'harness:spec:settle',
  'harness:outdated',
  'harness:update',
  'harness:changelog',
  'harness:uninstall',
  'standards:list',
  'templates:list',
  'stack:apply',
  'stack:reset',
  'stack:status',
  'template:apply',
  'template:reset',
  'template:status',
  'template:gap',
]

// 하네스가 주입한 값으로 인정하는 형태. 버전에 따라 세 갈래가 있었다:
//  1) 현행    : node .harness/bin/check-node-version.mjs && node .harness/bin/<script>.mjs ...
//  2) 구형    : npm run node:check --silent && node .harness/bin/<script>.mjs ...
//  3) 레거시  : npm run node:check --silent && node scripts/<script>.mjs ...   (bin 이관 전)
// 이 형태를 벗어나면 프로젝트가 손댄 것으로 보고 지우지 않는다.
const RECOGNIZED_VALUE = [
  /^node \.harness\/bin\/check-node-version\.mjs && node \.harness\/bin\/[\w-]+\.mjs(?: [^&|;]*)?$/,
  /^npm run node:check --silent && node \.harness\/bin\/[\w-]+\.mjs(?: [^&|;]*)?$/,
  /^npm run node:check --silent && node scripts\/[\w-]+\.mjs(?: [^&|;]*)?$/,
]

function looksInjected(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return RECOGNIZED_VALUE.some((pattern) => pattern.test(normalized))
}

function detectIndent(raw) {
  const match = raw.match(/\n(\s+)"/)
  return match ? match[1] : '  '
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`Usage: harness prune:aliases [--write]

은퇴한 하네스 npm 별칭을 package.json에서 지웁니다.

  (옵션 없음)   무엇을 지울지 미리 보여주기만 합니다. 파일을 바꾸지 않습니다.
  --write       실제로 지웁니다. 지우기 전 package.json.harness-bak을 남깁니다.

하네스가 주입한 그대로인 별칭만 지웁니다. 값을 고쳐 쓴 별칭은 보존하고 알려줍니다.
별칭을 지워도 모든 명령은 .harness/bin/harness <명령> 으로 그대로 실행됩니다.`)
    process.exit(0)
  }

  const write = args.includes('--write')
  const unknown = args.filter((arg) => !['--write', '-h', '--help'].includes(arg))
  if (unknown.length > 0) {
    console.error(`알 수 없는 옵션: ${unknown.join(', ')}`)
    process.exit(1)
  }

  // 본체(하네스시드) 저장소 보호: 본체의 package.json에 있는 같은 이름의 스크립트는
  // "주입된 별칭"이 아니라 그 스크립트들의 원본이다. 값 형태가 소비자 주입값과 같아서
  // 그대로 두면 본체의 개발 명령이 통째로 지워진다(2026-08-28 실측).
  if (fs.existsSync(path.join(repoRoot, '.harness-seed-mode'))) {
    console.error('여기는 하네스 본체 저장소입니다 — 이 도구는 소비자 프로젝트 전용입니다.')
    console.error('본체의 scripts는 주입된 별칭이 아니라 원본이므로 지우면 안 됩니다.')
    process.exit(1)
  }

  if (!fs.existsSync(pkgPath)) {
    console.log('package.json이 없습니다 — 지울 별칭도 없습니다. (비-Node 프로젝트)')
    process.exit(0)
  }

  const raw = fs.readFileSync(pkgPath, 'utf8')
  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch (error) {
    console.error(`package.json을 JSON으로 읽지 못했습니다: ${String(error.message ?? error).split('\n')[0]}`)
    console.error('파일을 고친 뒤 다시 실행하세요. 손상된 파일은 건드리지 않습니다.')
    process.exit(1)
  }

  const scripts = pkg.scripts ?? {}
  const present = RETIRED.filter((name) => scripts[name] !== undefined)

  if (present.length === 0) {
    console.log('지울 은퇴 별칭이 없습니다. package.json은 이미 깨끗합니다.')
    process.exit(0)
  }

  const removable = present.filter((name) => looksInjected(scripts[name]))
  const preserved = present.filter((name) => !looksInjected(scripts[name]))

  console.log(`은퇴 별칭 ${present.length}개를 찾았습니다.`)
  console.log('')

  if (removable.length > 0) {
    console.log(`지울 수 있는 것 ${removable.length}개 (하네스가 주입한 값 그대로):`)
    for (const name of removable) {
      console.log(`  - ${name}`)
    }
    console.log('')
  }

  if (preserved.length > 0) {
    console.log(`보존할 것 ${preserved.length}개 (값이 하네스 주입값과 달라 프로젝트가 고친 것으로 봅니다):`)
    for (const name of preserved) {
      console.log(`  - ${name}: ${scripts[name]}`)
    }
    console.log('  이 별칭들은 지우지 않습니다. 필요 없으면 직접 확인하고 지우세요.')
    console.log('')
  }

  if (removable.length === 0) {
    console.log('자동으로 지울 수 있는 별칭이 없습니다.')
    process.exit(0)
  }

  if (!write) {
    console.log('미리보기입니다 — 파일을 바꾸지 않았습니다.')
    console.log('실제로 지우려면: .harness/bin/harness prune:aliases --write')
    process.exit(0)
  }

  const backupPath = `${pkgPath}.harness-bak`
  fs.writeFileSync(backupPath, raw)

  const indent = detectIndent(raw)
  for (const name of removable) {
    delete pkg.scripts[name]
  }
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}${trailingNewline}`)

  console.log(`${removable.length}개를 지웠습니다.`)
  console.log(`백업: ${path.relative(repoRoot, backupPath)} (되돌리려면 이 파일을 package.json으로 복사하세요)`)
  console.log('모든 하네스 명령은 .harness/bin/harness <명령> 으로 그대로 실행됩니다.')
}

main()
