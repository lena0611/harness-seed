#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const write = process.argv.includes('--write')

function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'))
}

function writeJson(absPath, value) {
  writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`)
}

function readPackageVersion(dir) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  return readJson(pkgPath).version ?? null
}

function topChangelogVersion() {
  const text = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  const match = text.match(/^##\s+(\d+\.\d+\.\d+)/m)
  return match?.[1] ?? null
}

function setPath(target, path, value) {
  let cursor = target
  for (const key of path.slice(0, -1)) {
    cursor[key] = cursor[key] && typeof cursor[key] === 'object' ? cursor[key] : {}
    cursor = cursor[key]
  }
  const last = path.at(-1)
  const before = cursor[last]
  cursor[last] = value
  return before !== value
}

function checkOrWriteJson(label, absPath, changes) {
  if (!existsSync(absPath)) {
    console.log(`skip: ${label} 없음 (${absPath})`)
    return true
  }

  const json = readJson(absPath)
  const mismatches = []
  for (const change of changes) {
    const cursor = change.path.slice(0, -1).reduce((acc, key) => acc?.[key], json)
    const actual = cursor?.[change.path.at(-1)]
    if (actual !== change.value) {
      mismatches.push({ ...change, actual })
      if (write) setPath(json, change.path, change.value)
    }
  }

  if (write && mismatches.length > 0) {
    writeJson(absPath, json)
  }

  if (mismatches.length === 0) {
    console.log(`ok: ${label}`)
    return true
  }

  console.log(`${write ? 'updated' : 'mismatch'}: ${label}`)
  for (const item of mismatches) {
    console.log(`  - ${item.path.join('.')}: ${item.actual ?? '(missing)'} -> ${item.value}`)
  }
  return write
}

const baseVersion = readPackageVersion(repoRoot)
const stackDir = resolve(repoRoot, '../vue3-vite-pinia-router')
const templateDir = resolve(repoRoot, '../cloud-front-admin-template')
const stackVersion = readPackageVersion(stackDir)
const templateVersion = readPackageVersion(templateDir)

let ok = true
const changelogVersion = topChangelogVersion()
if (changelogVersion !== baseVersion) {
  console.log(`mismatch: CHANGELOG top version ${changelogVersion ?? '(missing)'} -> ${baseVersion}`)
  ok = false
} else {
  console.log('ok: CHANGELOG top version')
}

if (stackVersion) {
  ok = checkOrWriteJson('vue3 stack manifest', join(stackDir, 'manifest.json'), [
    { path: ['stackHarness', 'ref'], value: `v${stackVersion}` },
    { path: ['baseHarness', 'ref'], value: `v${baseVersion}` },
    { path: ['baseHarness', 'minVersion'], value: baseVersion },
  ]) && ok
}

if (templateVersion) {
  const templateChanges = [
    { path: ['template', 'ref'], value: `v${templateVersion}` },
    { path: ['template', 'range'], value: `^${templateVersion}` },
    { path: ['baseHarness', 'ref'], value: `v${baseVersion}` },
    { path: ['baseHarness', 'minVersion'], value: baseVersion },
  ]
  if (stackVersion) {
    templateChanges.push(
      { path: ['requiredStackHarness', 'ref'], value: `v${stackVersion}` },
      { path: ['requiredStackHarness', 'range'], value: `^${stackVersion}` },
      { path: ['requiredStackHarness', 'minVersion'], value: stackVersion },
    )
  }
  ok = checkOrWriteJson('cloud-front template manifest', join(templateDir, 'manifest.json'), templateChanges) && ok
}

if (!ok) {
  console.error('')
  console.error(write
    ? 'version net sync failed.'
    : 'version net mismatch. Run: npm run release:version-net -- --write')
  process.exit(1)
}
