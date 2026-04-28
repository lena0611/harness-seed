import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const forwardedArgs = process.argv.slice(2)
const harnessRoot = fs.existsSync(path.join(repoRoot, '.harness'))
  ? path.join(repoRoot, '.harness')
  : path.join(repoRoot, '.github')
const markerPath = path.join(harnessRoot, '.stack-applied.json')
const stackApplied = fs.existsSync(markerPath)

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

run('node', ['scripts/policy-harness.mjs', 'guard', ...forwardedArgs])
run('node', ['scripts/doc-link-check.mjs', ...forwardedArgs])

if (!stackApplied) {
  console.log('')
  console.log(`Stack not applied (${path.relative(repoRoot, markerPath)} 없음). lint/test/build 단계는 건너뜁니다.`)
  console.log('스택을 적용하려면: npm run stack:apply')
  process.exit(0)
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const scripts = pkg.scripts || {}

if (scripts.lint) {
  run('npm', ['run', 'lint'])
}

if (scripts.test) {
  run('npm', ['run', 'test'])
}

if (scripts.build) {
  run('npm', ['run', 'build'])
}
