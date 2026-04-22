import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const forwardedArgs = process.argv.slice(2)

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

run('node', ['scripts/policy-harness.mjs', 'guard', ...forwardedArgs])
run('npm', ['run', 'lint'])
run('npm', ['run', 'test'])
run('npm', ['run', 'build'])
