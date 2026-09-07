import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const listTemplates = path.join(repoRoot, '.harness/bin/list-templates.mjs')
// 카탈로그는 남의 저장소 버전을 고정하지 않는다(결정 108, 2026-09-07). 예전에는 항목마다
// `ref`가 있어 그 저장소가 태그를 내면 배포된 목록이 낡았고, 그것을 맞추는 일이 본체
// 릴리스 절차에 들어와 있었다.
const templatesRegistry = JSON.parse(readFileSync(path.join(repoRoot, '.harness/templates/registry.json'), 'utf8'))

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [listTemplates, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  assert.equal(result.status, 0, output)
  return output
}

const consumerOutput = run([])
assert.match(consumerOutput, /승인된 템플릿 목록/)
assert.match(consumerOutput, /Cloud Front 관리자형 업무 앱 템플릿/)
assert.match(consumerOutput, /--ref <태그>/)
for (const template of templatesRegistry.templates) {
  assert.equal(template.ref, undefined, `카탈로그는 남의 버전을 고정하지 않습니다: ${template.id}`)
}
assert.doesNotMatch(consumerOutput, /GITLAB_TOKEN/)
assert.doesNotMatch(consumerOutput, /GitLab API/)

const remoteFallback = run(['--remote'], {
  HARNESS_GITLAB_URL: 'http://127.0.0.1:1',
  GITLAB_TOKEN: '',
  HARNESS_GITLAB_TOKEN: '',
})
assert.match(remoteFallback, /원격 템플릿 조회를 완료하지 못해 배포된 승인 목록을 표시합니다/)
assert.match(remoteFallback, /관리자용 원격 조회 설정/)

console.log('Template registry tests passed')
