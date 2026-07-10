#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const gitlabUrl = process.env.HARNESS_GITLAB_URL ?? 'https://git.smartscore.kr'
const groupPath = process.env.HARNESS_TEMPLATE_GROUP ?? 'ai-standard/stacks'
const token = process.env.GITLAB_TOKEN ?? process.env.HARNESS_GITLAB_TOKEN
const remoteMode = process.argv.slice(2).includes('--remote')
const registryPath = path.join(__dirname, '..', 'templates', 'registry.json')

function encodeGroupPath(value) {
  return value.split('/').map(encodeURIComponent).join('%2F')
}

function readRegistry() {
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    return Array.isArray(registry.templates) ? registry.templates : []
  } catch {
    return []
  }
}

function printTemplateList(templates, heading) {
  console.log(heading)
  console.log('')

  for (const template of templates) {
    console.log(`- ${template.title ?? template.id}`)
    if (template.description) console.log(`  ${template.description}`)
    if (template.requiredStackHarness?.id) console.log(`  대상 스택: ${template.requiredStackHarness.id}`)
    console.log(`  repo: ${template.repo}`)
    console.log(`  기준: ${template.ref ?? '저장소 기본 브랜치'}`)
    console.log(`  적용: npm run template:apply -- --preset-git ${template.repo}${template.ref ? ` --ref ${template.ref}` : ''}`)
  }

  console.log('')
  console.log('목록 조회에는 GitLab 토큰이 필요 없습니다. private 템플릿을 적용할 때만 해당 저장소의 Git 읽기 권한이 필요합니다.')
}

function printRemoteFallback(templates, status = null) {
  console.log('원격 템플릿 조회를 완료하지 못해 배포된 승인 목록을 표시합니다.')
  if (status) console.log(`  GitLab API 응답: ${status}`)
  console.log('')
  printTemplateList(templates, '승인된 템플릿 목록')
  console.log('')
  console.log('관리자용 원격 조회 설정:')
  console.log('  HARNESS_GITLAB_URL=https://git.smartscore.kr')
  console.log('  HARNESS_TEMPLATE_GROUP=ai-standard/stacks')
  console.log('  GITLAB_TOKEN=<read_api token> npm run templates:list -- --remote')
}

async function main() {
  const templates = readRegistry()

  if (!remoteMode) {
    if (templates.length === 0) {
      console.error(`배포된 템플릿 레지스트리를 읽을 수 없습니다: ${registryPath}`)
      process.exit(1)
    }

    printTemplateList(templates, '승인된 템플릿 목록')
    return
  }

  const url = new URL(`/api/v4/groups/${encodeGroupPath(groupPath)}/projects`, gitlabUrl)
  url.searchParams.set('include_subgroups', 'true')
  url.searchParams.set('simple', 'true')
  url.searchParams.set('per_page', '100')

  const headers = token ? { 'PRIVATE-TOKEN': token } : {}
  let response

  try {
    response = await fetch(url, { headers })
  } catch {
    printRemoteFallback(templates)
    process.exit(0)
  }

  if (!response.ok) {
    printRemoteFallback(templates, response.status)
    process.exit(0)
  }

  const projects = await response.json()
  if (!Array.isArray(projects) || projects.length === 0) {
    printRemoteFallback(templates)
    return
  }

  printTemplateList(projects.map((project) => ({
    id: project.path,
    title: project.path_with_namespace ?? project.name,
    repo: project.http_url_to_repo ?? project.web_url,
    ref: project.tag_list?.[0] ?? project.default_branch ?? null,
  })), `원격 템플릿 목록 (${groupPath})`)
}

main()
