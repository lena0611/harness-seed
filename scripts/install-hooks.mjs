import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

function runGit(args) {
  execFileSync('git', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

runGit(['config', 'core.hooksPath', '.githooks'])
runGit(['config', 'commit.template', '.github/commit-template.txt'])
