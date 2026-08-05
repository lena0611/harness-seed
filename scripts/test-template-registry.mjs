import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const listTemplates = path.join(repoRoot, '.harness/bin/list-templates.mjs')
// 기대 ref는 하드코딩하지 않고 진실 출처(registry.json)에서 읽는다(test-standards-registry와 동일 원칙).
const templatesRegistry = JSON.parse(readFileSync(path.join(repoRoot, '.harness/templates/registry.json'), 'utf8'))
const adminTemplateRef = templatesRegistry.templates.find((template) => template.id === 'cloud-front-admin-template').ref

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

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
assert.match(consumerOutput, new RegExp(`--ref ${escapeRegExp(adminTemplateRef)}`))
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
