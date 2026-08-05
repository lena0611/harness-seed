import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const listStacks = path.join(repoRoot, '.harness/bin/list-stack-standards.mjs')
// 기대 ref는 하드코딩하지 않고 진실 출처(registry.json)에서 읽는다.
// 하드코딩 픽스처는 레지스트리 범프 때마다 깨진다(2026-08-05 v0.2.1→v0.2.3 범프에서 실증).
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
