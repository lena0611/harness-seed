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
// 목록에서 복사한 설치 명령이 **macOS 기본 zsh에서 실제로 실행되는지** 확인한다.
// glob 문자(`*`)가 들어가면 zsh가 파일 패턴으로 먼저 해석해 no matches found로 죽는다.
for (const line of consumerOutput.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('설치: ') && !trimmed.startsWith('적용(고급): ')) continue
  const command = trimmed.slice(trimmed.indexOf(': ') + 2)
  const probe = spawnSync('zsh', ['-fc', `print -r -- ${command.replace(/^npx -y /, '')}`], { encoding: 'utf8' })
  assert.equal(probe.status, 0, `목록의 명령이 zsh에서 실행되지 않습니다: ${command}\n${probe.stderr}`)
}
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
