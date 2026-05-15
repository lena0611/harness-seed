#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRoot = path.join(repoRoot, '.harness')
const generatedRoot = path.join(harnessRoot, 'generated')

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.harness-backup',
  'outputs',
])

const sourceExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.svelte',
  '.java',
  '.kt',
  '.go',
  '.py',
  '.rb',
  '.php',
  '.cs',
])

const configNames = new Set([
  'package.json',
  'vite.config.js',
  'vite.config.ts',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  'jsconfig.json',
  '.editorconfig',
  '.nvmrc',
  'Dockerfile',
  'docker-compose.yml',
])

const generatedFiles = new Set([
  '.harness/session/project-scan-report.md',
  '.harness/session/handoff.md',
  '.harness/session/task-context.md',
  '.harness/install-manifest.json',
  '.harness/harness-lock.json',
])

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function readJson(rel) {
  const filePath = path.join(repoRoot, rel)
  if (!fs.existsSync(filePath)) return null

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue

    const full = path.join(dir, entry.name)
    const rel = toPosix(path.relative(repoRoot, full))

    if (entry.isDirectory()) {
      if (rel.startsWith('.harness/generated')) continue
      walk(full, out)
      continue
    }

    if (generatedFiles.has(rel)) continue

    out.push(full)
  }

  return out
}

function listFiles() {
  return walk(repoRoot)
    .map((filePath) => toPosix(path.relative(repoRoot, filePath)))
    .filter((rel) => rel && !rel.startsWith('.harness/generated/'))
    .sort()
}

function isSourceFile(rel) {
  return sourceExtensions.has(path.extname(rel))
}

function isConfigFile(rel) {
  return configNames.has(path.basename(rel)) || rel.startsWith('.github/workflows/')
}

function groupByTopLevel(files) {
  const map = new Map()

  for (const file of files) {
    const top = file.includes('/') ? file.split('/')[0] : '(root)'
    const item = map.get(top) ?? { count: 0, examples: [] }
    item.count += 1
    if (item.examples.length < 8) item.examples.push(file)
    map.set(top, item)
  }

  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function readPackageSummary() {
  const pkg = readJson('package.json')
  if (!pkg) return ['- `package.json` 없음']

  const lines = []
  lines.push(`- name: ${pkg.name ?? '(unknown)'}`)
  lines.push(`- version: ${pkg.version ?? '(unknown)'}`)

  const scripts = Object.keys(pkg.scripts ?? {}).sort()
  lines.push(`- scripts: ${scripts.length > 0 ? scripts.map((name) => `\`${name}\``).join(', ') : '없음'}`)

  const dependencies = Object.keys(pkg.dependencies ?? {}).sort()
  const devDependencies = Object.keys(pkg.devDependencies ?? {}).sort()
  lines.push(`- dependencies: ${dependencies.length > 0 ? dependencies.join(', ') : '없음'}`)
  lines.push(`- devDependencies: ${devDependencies.length > 0 ? devDependencies.join(', ') : '없음'}`)

  return lines
}

function buildProjectMap(files) {
  const sourceFiles = files.filter(isSourceFile)
  const configFiles = files.filter(isConfigFile)
  const markdownFiles = files.filter((file) => file.endsWith('.md'))

  const lines = []
  lines.push('# Generated Project Map')
  lines.push('')
  lines.push('> 이 파일은 `npm run harness:sync`가 생성한 보조 컨텍스트입니다. 진실 출처는 실제 코드와 `.harness/**/*.md`입니다.')
  lines.push('')
  lines.push(`- generatedAt: ${new Date().toISOString()}`)
  lines.push(`- files: ${files.length}`)
  lines.push(`- source files: ${sourceFiles.length}`)
  lines.push(`- config files: ${configFiles.length}`)
  lines.push(`- markdown files: ${markdownFiles.length}`)
  lines.push('')
  lines.push('## Package Summary')
  lines.push('')
  lines.push(...readPackageSummary())
  lines.push('')
  lines.push('## Top-Level Layout')
  lines.push('')

  for (const [dir, item] of groupByTopLevel(files)) {
    lines.push(`- ${dir}: ${item.count} files`)
    for (const example of item.examples) {
      lines.push(`  - ${example}`)
    }
  }

  lines.push('')
  lines.push('## Config Files')
  lines.push('')
  if (configFiles.length === 0) {
    lines.push('- 없음')
  } else {
    for (const file of configFiles) lines.push(`- ${file}`)
  }

  return `${lines.join('\n')}\n`
}

function extractImports(rel) {
  const abs = path.join(repoRoot, rel)
  const content = fs.readFileSync(abs, 'utf8')
  const imports = new Set()
  const patterns = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\(['"]([^'"]+)['"]\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      imports.add(match[1])
    }
  }

  return [...imports].sort()
}

function buildImportMap(files) {
  const sourceFiles = files.filter(isSourceFile)
  const rows = []

  for (const file of sourceFiles) {
    let imports = []

    try {
      imports = extractImports(file)
    } catch {
      imports = []
    }

    if (imports.length > 0) {
      rows.push({ file, imports })
    }
  }

  const lines = []
  lines.push('# Generated Import Map')
  lines.push('')
  lines.push('> 이 파일은 정규 파서가 아니라 하네스 컨텍스트 합성을 위한 보조 색인입니다. 정확한 의존성 판단은 실제 소스와 빌드 도구를 우선합니다.')
  lines.push('')
  lines.push(`- generatedAt: ${new Date().toISOString()}`)
  lines.push('')

  if (rows.length === 0) {
    lines.push('- import/export/require 문을 찾지 못했습니다.')
    return `${lines.join('\n')}\n`
  }

  for (const row of rows) {
    lines.push(`## ${row.file}`)
    lines.push('')
    for (const item of row.imports.slice(0, 30)) {
      lines.push(`- ${item}`)
    }
    if (row.imports.length > 30) {
      lines.push(`- ... 외 ${row.imports.length - 30}건`)
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function detectPatterns(files) {
  const pkg = readJson('package.json') ?? {}
  const scripts = pkg.scripts ?? {}
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }
  const sourceRoots = ['src', 'app', 'lib', 'packages', 'apps', 'internal']
    .filter((dir) => fs.existsSync(path.join(repoRoot, dir)))

  const lines = []
  lines.push('# Generated Detected Patterns')
  lines.push('')
  lines.push('> 이 파일은 반복 패턴 후보를 찾기 위한 보조 리포트입니다. 로컬룰 승격은 개발자 확인 후 `.harness/project/*`에 기록합니다.')
  lines.push('')
  lines.push(`- generatedAt: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Runtime And Tooling Hints')
  lines.push('')
  lines.push(`- node contract: ${fs.existsSync(path.join(repoRoot, '.nvmrc')) ? fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim() : '없음'}`)
  lines.push(`- lint script: ${scripts.lint ? `\`${scripts.lint}\`` : '없음'}`)
  lines.push(`- test script: ${scripts.test ? `\`${scripts.test}\`` : '없음'}`)
  lines.push(`- build script: ${scripts.build ? `\`${scripts.build}\`` : '없음'}`)
  lines.push('')
  lines.push('## Stack Hints')
  lines.push('')

  const stackHints = []
  if (deps.vue) stackHints.push(`Vue (${deps.vue})`)
  if (deps.react) stackHints.push(`React (${deps.react})`)
  if (deps.express) stackHints.push(`Express (${deps.express})`)
  if (deps.fastify) stackHints.push(`Fastify (${deps.fastify})`)
  if (deps['@nestjs/core']) stackHints.push(`NestJS (${deps['@nestjs/core']})`)
  if (deps.vite) stackHints.push(`Vite (${deps.vite})`)

  if (stackHints.length === 0) {
    lines.push('- package dependency 기준의 대표 스택 후보 없음')
  } else {
    for (const hint of stackHints) lines.push(`- ${hint}`)
  }

  lines.push('')
  lines.push('## Source Roots')
  lines.push('')
  if (sourceRoots.length === 0) {
    lines.push('- 일반적인 source root를 찾지 못했습니다.')
  } else {
    for (const root of sourceRoots) {
      const count = files.filter((file) => file.startsWith(`${root}/`) && isSourceFile(file)).length
      lines.push(`- ${root}/: ${count} source files`)
    }
  }

  return `${lines.join('\n')}\n`
}

function writeGenerated(name, content) {
  fs.mkdirSync(generatedRoot, { recursive: true })
  const filePath = path.join(generatedRoot, name)
  fs.writeFileSync(filePath, content)
  return toPosix(path.relative(repoRoot, filePath))
}

function main() {
  if (!fs.existsSync(harnessRoot)) {
    console.error('.harness directory not found. Run harness init first.')
    process.exit(1)
  }

  const files = listFiles()
  const written = [
    writeGenerated('project-map.md', buildProjectMap(files)),
    writeGenerated('import-map.md', buildImportMap(files)),
    writeGenerated('detected-patterns.md', detectPatterns(files)),
  ]

  console.log('Harness sync complete')
  for (const file of written) {
    console.log(`- ${file}`)
  }
}

main()
