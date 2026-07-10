import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const sourceScript = path.join(repoRoot, '.harness/bin/update-harness.mjs')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-update-targets-'))

function writeJson(relativePath, value) {
  const absolutePath = path.join(tempRoot, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
}

function run(args) {
  const result = spawnSync(process.execPath, ['.harness/bin/update-harness.mjs', ...args], {
    cwd: tempRoot,
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.equal(result.status, 0, output)
  return output
}

try {
  fs.mkdirSync(path.join(tempRoot, '.harness/bin'), { recursive: true })
  fs.copyFileSync(sourceScript, path.join(tempRoot, '.harness/bin/update-harness.mjs'))
  writeJson('.harness/harness-lock.json', {
    baseHarness: {
      id: 'harness-seed',
      version: '0.2.85',
      repo: 'https://example.invalid/harness-seed.git',
      ref: 'v0.2.85',
    },
    stackHarness: {
      id: 'vue3-vite-pinia-router',
      version: '0.1.47',
      repo: 'https://example.invalid/vue3-vite-pinia-router.git',
      ref: 'v0.1.47',
    },
  })
  writeJson('.harness/install-manifest.json', {
    source: {
      type: 'git',
      repo: 'https://example.invalid/harness-seed.git',
      ref: 'v0.2.85',
    },
  })

  const defaultOutput = run(['--dry-run'])
  assert.match(defaultOutput, /target: 스택 하네스/)
  assert.match(defaultOutput, /target: 공통 하네스/)
  assert.equal((defaultOutput.match(/command: npx -y/g) ?? []).length, 2)

  const stackOnlyOutput = run(['--dry-run', '--stack-only'])
  assert.match(stackOnlyOutput, /target: 스택 하네스/)
  assert.doesNotMatch(stackOnlyOutput, /target: 공통 하네스/)

  const baseOnlyOutput = run(['--dry-run', '--base-only'])
  assert.match(baseOnlyOutput, /target: 공통 하네스/)
  assert.doesNotMatch(baseOnlyOutput, /target: 스택 하네스/)

  const refOutput = run(['--dry-run', '--ref', 'v0.1.47'])
  assert.match(refOutput, /target: 스택 하네스/)
  assert.doesNotMatch(refOutput, /target: 공통 하네스/)

  console.log('Harness update target tests passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
