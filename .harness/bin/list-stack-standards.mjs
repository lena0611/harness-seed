#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const gitlabUrl = process.env.HARNESS_GITLAB_URL ?? 'https://git.smartscore.kr'
const groupPath = process.env.HARNESS_STACK_STANDARD_GROUP ?? 'ai-standard/harnesses'
const token = process.env.GITLAB_TOKEN ?? process.env.HARNESS_GITLAB_TOKEN
const remoteMode = process.argv.slice(2).includes('--remote')
const registryPath = path.join(__dirname, '..', 'stacks', 'registry.json')
const excludedProjects = new Set(
  (process.env.HARNESS_STACK_STANDARD_EXCLUDE ?? 'harness-seed')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

function encodeGroupPath(value) {
  return value.split('/').map(encodeURIComponent).join('%2F')
}

function readRegistry() {
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    return Array.isArray(registry.stacks) ? registry.stacks : []
  } catch {
    return []
  }
}

function printStackList(stacks, heading) {
  console.log(heading)
  console.log('')

  for (const stack of stacks) {
    console.log(`- ${stack.title ?? stack.id}`)
    if (stack.description) console.log(`  ${stack.description}`)
    console.log(`  repo: ${stack.repo}`)
    console.log(`  기준: ${stack.ref ?? '저장소 기본 브랜치'}`)
    console.log(`  설치: npx -y git+${stack.repo}${stack.ref ? `#${stack.ref}` : ''} init`)
    console.log(`  적용: npm run stack:apply -- --preset-git ${stack.repo}${stack.ref ? ` --ref ${stack.ref}` : ''}`)
  }

  console.log('')
  console.log('목록 조회에는 GitLab 토큰이 필요 없습니다. private 스택을 설치할 때만 해당 저장소의 Git 읽기 권한이 필요합니다.')
}

function printRemoteFallback(stacks, status = null) {
  console.log('원격 스택 조회를 완료하지 못해 배포된 승인 목록을 표시합니다.')
  if (status) console.log(`  GitLab API 응답: ${status}`)
  console.log('')
  printStackList(stacks, '승인된 스택 하네스 목록')
  console.log('')
  console.log('관리자용 원격 조회 설정:')
  console.log('  HARNESS_GITLAB_URL=https://git.smartscore.kr')
  console.log('  HARNESS_STACK_STANDARD_GROUP=ai-standard/harnesses')
  console.log('  GITLAB_TOKEN=<read_api token> npm run standards:list -- --remote')
}

async function main() {
  const stacks = readRegistry()

  if (!remoteMode) {
    if (stacks.length === 0) {
      console.error(`배포된 스택 레지스트리를 읽을 수 없습니다: ${registryPath}`)
      process.exit(1)
    }

    printStackList(stacks, '승인된 스택 하네스 목록')
    return
  }

  const url = new URL(`/api/v4/groups/${encodeGroupPath(groupPath)}/projects`, gitlabUrl)
  url.searchParams.set('include_subgroups', 'true')
  url.searchParams.set('per_page', '100')

  const headers = token ? { 'PRIVATE-TOKEN': token } : {}
  let response

  try {
    response = await fetch(url, { headers })
  } catch {
    printRemoteFallback(stacks)
    process.exit(0)
  }

  if (!response.ok) {
    printRemoteFallback(stacks, response.status)
    process.exit(0)
  }

  const projects = await response.json()
  const remoteStacks = Array.isArray(projects)
    ? projects.filter((project) => !excludedProjects.has(project.path))
    : []

  if (remoteStacks.length === 0) {
    printRemoteFallback(stacks)
    return
  }

  printStackList(remoteStacks.map((project) => ({
    id: project.path,
    title: project.path_with_namespace ?? project.name,
    repo: project.http_url_to_repo ?? project.web_url,
    ref: project.tag_list?.[0] ?? project.default_branch ?? null,
  })), `원격 스택 하네스 목록 (${groupPath})`)
}

main()
