import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, '..')
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-template-contract-compat-'))
const harnessRoot = path.join(fixtureRoot, '.harness')

function writeJson(rel, value) {
  const target = path.join(fixtureRoot, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
}

try {
  fs.mkdirSync(path.join(harnessRoot, 'bin'), { recursive: true })
  fs.copyFileSync(
    path.join(repoRoot, '.harness/bin/check-template-contract.mjs'),
    path.join(harnessRoot, 'bin/check-template-contract.mjs'),
  )
  fs.mkdirSync(path.join(harnessRoot, 'templates/.applied/legacy-template/developmentGuide'), { recursive: true })
  fs.writeFileSync(path.join(harnessRoot, 'templates/.applied/legacy-template/developmentGuide/README.md'), '# Legacy template\n')
  writeJson('package.json', { name: 'legacy-template-project', version: '1.0.0' })
  writeJson('.harness/harness-lock.json', {
    scaffoldTemplate: {
      id: 'legacy-template',
      manifestPath: '.harness/templates/.applied/legacy-template/manifest.json',
      applicationMode: 'scaffold',
    },
  })
  writeJson('.harness/templates/.applied/legacy-template/manifest.json', {
    id: 'legacy-template',
    template: {
      guideRoot: 'developmentGuide/README.md',
      docs: ['developmentGuide/README.md'],
    },
  })

  const result = spawnSync(process.execPath, [path.join(harnessRoot, 'bin/check-template-contract.mjs'), '--write', '--brief'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.equal(result.status, 0, output)
  assert.match(output, /contract checks: not declared/)
  assert.match(output, /result: skipped/)

  const summary = JSON.parse(fs.readFileSync(path.join(harnessRoot, 'generated/template-gap-summary.json'), 'utf8'))
  const report = fs.readFileSync(path.join(harnessRoot, 'session/template-gap-report.md'), 'utf8')
  assert.equal(summary.contractChecks, 0)
  assert.equal(summary.invalid, 0)
  assert.match(report, /구조화된 계약 미선언/)
  console.log('Template contract compatibility tests passed')
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
