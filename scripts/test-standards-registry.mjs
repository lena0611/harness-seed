import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const listStacks = path.join(repoRoot, '.harness/bin/list-stack-standards.mjs')
// 카탈로그는 남의 저장소 버전을 고정하지 않는다(결정 108, 2026-09-07). 예전에는 항목마다
// `ref`가 있어 스택이 태그를 내면 배포된 목록이 낡았고, 그것을 맞추는 일이 본체 릴리스
// 절차에 들어와 있었다. 이제 설치 명령이 `#semver:*`로 최신 태그를 해석한다.
const stacksRegistry = JSON.parse(readFileSync(path.join(repoRoot, '.harness/stacks/registry.json'), 'utf8'))

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
assert.match(consumerOutput, /#semver:\* init/)
for (const stack of stacksRegistry.stacks) {
  assert.equal(stack.ref, undefined, `카탈로그는 남의 버전을 고정하지 않습니다: ${stack.id}`)
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
