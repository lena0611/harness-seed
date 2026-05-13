#!/usr/bin/env node

const gitlabUrl = process.env.HARNESS_GITLAB_URL ?? 'https://git.smartscore.kr'
const groupPath = process.env.HARNESS_TEMPLATE_GROUP ?? 'ai-standard/stacks'
const token = process.env.GITLAB_TOKEN ?? process.env.HARNESS_GITLAB_TOKEN

function encodeGroupPath(value) {
  return value.split('/').map(encodeURIComponent).join('%2F')
}

function printManualFallback() {
  console.log('템플릿 목록을 자동 조회하지 못했습니다.')
  console.log('')
  console.log('사내 GitLab 스택 템플릿 조회 설정을 확인하세요.')
  console.log('  HARNESS_GITLAB_URL=https://git.smartscore.kr')
  console.log('  HARNESS_TEMPLATE_GROUP=ai-standard/stacks')
  console.log('  GITLAB_TOKEN=<private-token>   # 비공개 그룹이거나 API 권한이 필요하면 설정')
  console.log('')
  console.log('현재 등록된 템플릿 후보 예시입니다. 적용 전 템플릿 저장소 README와 manifest 계약을 확인하세요.')
  console.log('  https://git.smartscore.kr/ai-standard/stacks/cloud-front-admin-template')
  console.log('')
  console.log('다른 템플릿을 알고 있다면 직접 지정할 수 있습니다.')
  console.log('  npm run template:apply -- --preset-git <repo-url> --ref <tag-or-branch>')
  console.log('  npm run template:apply -- --preset-path <local-preset-dir>')
}

async function main() {
  const url = new URL(`/api/v4/groups/${encodeGroupPath(groupPath)}/projects`, gitlabUrl)
  url.searchParams.set('include_subgroups', 'true')
  url.searchParams.set('simple', 'true')
  url.searchParams.set('per_page', '100')

  const headers = token ? { 'PRIVATE-TOKEN': token } : {}
  let response

  try {
    response = await fetch(url, { headers })
  } catch {
    printManualFallback()
    process.exit(0)
  }

  if (!response.ok) {
    printManualFallback()
    process.exit(0)
  }

  const projects = await response.json()
  if (!Array.isArray(projects) || projects.length === 0) {
    console.log(`템플릿 그룹에 프로젝트가 없습니다: ${groupPath}`)
    return
  }

  console.log(`Scaffold templates from ${groupPath}`)
  console.log('')

  for (const project of projects) {
    const name = project.path_with_namespace ?? project.name
    const repo = project.http_url_to_repo ?? project.web_url
    const ref = project.tag_list?.[0] ?? project.default_branch ?? '<tag-or-branch>'
    console.log(`- ${name}`)
    console.log(`  repo: ${repo}`)
    console.log(`  apply: npm run template:apply -- --preset-git ${repo} --ref ${ref}`)
  }
}

main()
