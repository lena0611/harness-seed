import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const listTemplates = path.join(repoRoot, '.harness/bin/list-templates.mjs')
// 카탈로그의 `ref`는 **검증된 태그**다. 자리표시자 `<태그>`를 잠시 썼다가 되돌렸다
// (외부 리뷰 2026-09-07 P2): 적용은 git ref를 요구하는데 ref를 빼면 사용자가 최신 태그를
// 알 방법이 없어 실행 가능한 경로가 사라진다. 기대값은 registry.json에서 읽는다.
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
for (const template of templatesRegistry.templates) {
  assert.match(template.ref ?? '', /^v\d+\.\d+\.\d+$/, `카탈로그 ref는 검증된 구체 태그여야 합니다: ${template.id}`)
}
// 목록에서 복사한 적용 명령이 zsh에서 실제로 실행되는지 확인한다(glob 문자 금지).
for (const line of consumerOutput.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('적용: ')) continue
  const command = trimmed.slice(trimmed.indexOf(': ') + 2)
  const probe = spawnSync('zsh', ['-fc', `print -r -- ${command}`], { encoding: 'utf8' })
  assert.equal(probe.status, 0, `목록의 명령이 zsh에서 실행되지 않습니다: ${command}\n${probe.stderr}`)
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
