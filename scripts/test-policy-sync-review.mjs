import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const sourceHarness = path.join(repoRoot, '.harness/bin/policy-harness.mjs')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sync-review-'))

function run(command, args, cwd, expectedStatus = 0) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  assert.equal(result.status, expectedStatus, `${command} ${args.join(' ')}\n${output}`)
  return output
}

function writeJson(target, relativePath, value) {
  const absolutePath = path.join(target, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
}

function policy(syncEnforcement) {
  return {
    id: 'test.api-contract',
    title: 'API contract review',
    layer: 'project',
    category: 'sync',
    status: 'active',
    severity: 'blocker',
    enforcement: 'block',
    waiverAllowed: false,
    owner: 'test',
    source: { type: 'local', path: 'docs/api.md' },
    documents: ['docs/api.md'],
    ownedAreas: ['src/apis/**'],
    triggerPaths: ['src/apis/**'],
    checks: [],
    ...(syncEnforcement ? { syncEnforcement } : {}),
  }
}

function makeFixture() {
  const target = fs.mkdtempSync(path.join(tempRoot, 'case-'))
  fs.mkdirSync(path.join(target, '.harness/bin'), { recursive: true })
  fs.mkdirSync(path.join(target, '.harness/policy'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src/apis'), { recursive: true })
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true })
  fs.copyFileSync(sourceHarness, path.join(target, '.harness/bin/policy-harness.mjs'))
  fs.writeFileSync(path.join(target, 'src/apis/users.js'), 'export const users = []\n')
  fs.writeFileSync(path.join(target, 'docs/api.md'), '# API contract\n')
  writeJson(target, '.harness/policy/profile.json', {
    version: 2,
    activeStack: 'none',
    harnessMode: 'active',
  })
  writeJson(target, '.harness/policy/policy-registry.json', {
    version: 3,
    policies: [policy()],
  })

  run('git', ['init', '--quiet'], target)
  run('git', ['add', '.'], target)
  run('git', ['-c', 'user.name=Harness Test', '-c', 'user.email=harness-test@example.invalid', 'commit', '--quiet', '-m', 'baseline'], target)
  fs.appendFileSync(path.join(target, 'src/apis/users.js'), '// implementation-only change\n')
  return target
}

try {
  const defaultTarget = makeFixture()
  const defaultOutput = run(process.execPath, ['.harness/bin/policy-harness.mjs', 'impact', '--strict', '--verbose'], defaultTarget)
  assert.match(defaultOutput, /기준 동기화 검토 후보 \(의미 불일치 판정 아님\)/)
  assert.match(defaultOutput, /\[가볍게 확인\]/)
  assert.match(defaultOutput, /일반 구현 변경이면 문서 수정이 필요 없습니다/)
  assert.doesNotMatch(defaultOutput, /SYNC GAP/)

  const defaultSummary = JSON.parse(fs.readFileSync(path.join(defaultTarget, '.harness/generated/policy-impact-summary.json'), 'utf8'))
  assert.equal(defaultSummary.syncReviewCandidates, 1)
  assert.equal(defaultSummary.syncReviewLevels['review suggested'], 1)

  const enforcedTarget = makeFixture()
  writeJson(enforcedTarget, '.harness/policy/policy-registry.json', {
    version: 3,
    policies: [policy('block')],
  })
  const enforcedOutput = run(process.execPath, ['.harness/bin/policy-harness.mjs', 'impact', '--strict', '--verbose'], enforcedTarget, 1)
  assert.match(enforcedOutput, /\[차단\]/)
  assert.match(enforcedOutput, /동기화 강제 설정: block/)

  writeJson(enforcedTarget, '.harness/policy/policy-registry.json', {
    version: 3,
    policies: [policy('invalid')],
  })
  const invalidOutput = run(process.execPath, ['.harness/bin/policy-harness.mjs', 'check'], enforcedTarget, 1)
  assert.match(invalidOutput, /invalid syncEnforcement 'invalid'/)

  console.log('Policy sync review tests passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
