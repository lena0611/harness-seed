import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const listStacks = path.join(repoRoot, '.harness/bin/list-stack-standards.mjs')
// 카탈로그의 `ref`는 **검증된 태그**다. `#semver:*`(최신 자동 해석)를 잠시 썼다가 되돌렸다
// (외부 리뷰 2026-09-07 P1): zsh가 `*`를 파일 패턴으로 해석해 복사한 명령이 죽는다.
// 기대 ref는 하드코딩하지 않고 진실 출처(registry.json)에서 읽는다.
const stacksRegistry = JSON.parse(readFileSync(path.join(repoRoot, '.harness/stacks/registry.json'), 'utf8'))
const vueStackRef = stacksRegistry.stacks.find((stack) => stack.id === 'vue3-vite-pinia-router').ref

// 목록 명령은 개발자가 **복사해 붙이는** 것이므로 셸에서 그대로 실행돼야 한다.
// 두 단계로 본다(외부 리뷰 2026-09-07 2차 P1): 정적 검사는 모든 환경에서 돌고,
// 실제 파싱 검사는 zsh가 있는 환경에서만 돈다. 처음 판은 zsh를 무조건 실행해
// zsh가 없는 ubuntu-latest CI를 깨뜨렸다 — 하네스는 Linux·Windows도 다룬다.
function assertShellSafeCommands(output, prefixes) {
  const commands = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    const prefix = prefixes.find((item) => trimmed.startsWith(item))
    if (!prefix) continue
    commands.push(trimmed.slice(trimmed.indexOf(': ') + 2))
  }

  assert.ok(commands.length > 0, '목록에서 검사할 명령을 찾지 못했습니다')

  // ① 정적: 따옴표 밖 glob 문자는 셸마다 다르게 해석된다(zsh는 매칭 실패 시 죽는다).
  for (const command of commands) {
    const glob = command.match(/[*?[\]]/)
    assert.equal(glob, null, `목록의 명령에 셸 glob 문자가 있습니다: ${command}`)
  }

  // ② 실제 파싱: zsh가 있는 환경에서만.
  const hasZsh = spawnSync('zsh', ['-fc', 'exit 0'], { encoding: 'utf8' }).status === 0
  if (!hasZsh) {
    console.log('  (zsh 없음 — 정적 검사만 수행)')
    return
  }

  for (const command of commands) {
    const probe = spawnSync('zsh', ['-fc', `print -r -- ${command.replace(/^npx -y /, '')}`], { encoding: 'utf8' })
    assert.equal(probe.status, 0, `목록의 명령이 zsh에서 실행되지 않습니다: ${command}\n${probe.stderr}`)
  }
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [listStacks, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  assert.equal(result.status, 0, output)
  return output
}

const consumerOutput = run([])
assert.match(consumerOutput, /승인된 스택 하네스 목록/)
assert.match(consumerOutput, /Vue 3 \+ Vite \+ Pinia \+ Vue Router/)
assert.match(consumerOutput, new RegExp(`#${escapeRegExp(vueStackRef)} init`))
for (const stack of stacksRegistry.stacks) {
  assert.match(stack.ref ?? '', /^v\d+\.\d+\.\d+$/, `카탈로그 ref는 검증된 구체 태그여야 합니다: ${stack.id}`)
}
assertShellSafeCommands(consumerOutput, ['설치: ', '적용(고급): '])
assert.doesNotMatch(consumerOutput, /GITLAB_TOKEN/)
assert.doesNotMatch(consumerOutput, /GitLab API/)

const remoteFallback = run(['--remote'], {
  HARNESS_GITLAB_URL: 'http://127.0.0.1:1',
  GITLAB_TOKEN: '',
  HARNESS_GITLAB_TOKEN: '',
})
assert.match(remoteFallback, /원격 스택 조회를 완료하지 못해 배포된 승인 목록을 표시합니다/)
assert.match(remoteFallback, /관리자용 원격 조회 설정/)

console.log('Standards registry tests passed')
