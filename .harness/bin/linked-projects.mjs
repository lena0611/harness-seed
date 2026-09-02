#!/usr/bin/env node
// 연결 프로젝트 해석기 (0.2.140)
//
// 무엇: profile.linkedProjects(팀 공유)에 선언된 "다른 저장소"를 이 PC의 실제 폴더로 해석해
//   세션 시작 블록·프롬프트 한 줄·상태 표를 만든다.
// 왜 이렇게: 0.2.139는 항목에 path를 적게 했는데 그 파일은 형상관리 대상이라 사람마다 다른 clone
//   위치를 팀 파일에 박는 셈이었다(2026-09-02 지적). 팀 파일에는 저장소의 정체(repo URL)·label·focus만
//   두고, PC마다 다른 경로는 개발자가 어차피 열어 둬야 하는 파일 접근 권한 목록
//   (.claude/settings.local.json 의 permissions.additionalDirectories)에서 git remote가 일치하는
//   폴더를 찾아 채운다. path는 힌트(선택, 있고 실존하면 우선)로 남겨 0.2.139 선언과 호환한다.
// 사용:
//   node linked-projects.mjs session [root]   세션 시작 블록(한국어, 여러 줄)
//   node linked-projects.mjs prompt  [root]   매 프롬프트 한 줄(영문, 해석된 항목만)
//   node linked-projects.mjs json    [root]   해석 결과 JSON
//   node linked-projects.mjs status  [root]   사람용 상태 표 (런처: harness linked)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mode = process.argv[2] || 'status'
const root = path.resolve(process.argv[3] || process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || path.resolve(__dirname, '..', '..'))

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

// git@host:group/repo.git · https://host/group/repo.git · ssh://git@host/group/repo → host/group/repo
export function normalizeRepo(url) {
  if (typeof url !== 'string') return null
  let s = url.trim()
  if (!s) return null
  const scp = s.match(/^[^@/]+@([^:]+):(.+)$/)
  if (scp) s = `${scp[1]}/${scp[2]}`
  s = s.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '')
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '')
  const slash = s.indexOf('/')
  return slash === -1 ? s.toLowerCase() : s.slice(0, slash).toLowerCase() + s.slice(slash)
}

function remoteUrls(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'config', '--get-regexp', String.raw`^remote\..*\.url$`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/).slice(1).join(' '))
  } catch {
    return []
  }
}

// 개발자가 이미 열어 둔 접근 폴더 = 연결 저장소 후보. 개인(local) 설정을 먼저, 공유 설정도 본다.
function candidateDirs() {
  const dirs = []
  for (const rel of ['.claude/settings.local.json', '.claude/settings.json']) {
    const settings = readJson(path.join(root, rel))
    const list = settings?.permissions?.additionalDirectories
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (typeof entry !== 'string' || !entry.trim()) continue
      const abs = path.resolve(root, expandHome(entry.trim()))
      if (!dirs.includes(abs)) dirs.push(abs)
    }
  }
  return dirs
}

export function resolveLinkedProjects(projectRoot = root) {
  const profile = readJson(path.join(projectRoot, '.harness/policy/profile.json'))
  const declared = Array.isArray(profile?.linkedProjects) ? profile.linkedProjects : []
  const candidates = candidateDirs()
  return declared.filter((item) => item && typeof item === 'object').map((item) => {
    const label = item.label || item.repo || item.path || '(이름 없음)'
    const focus = typeof item.focus === 'string' && item.focus ? item.focus.replace(/\/+$/, '') : null
    const wanted = normalizeRepo(item.repo)
    let abs = null
    let via = null
    if (typeof item.path === 'string' && item.path.trim()) {
      const hinted = path.resolve(projectRoot, expandHome(item.path.trim()))
      if (fs.existsSync(hinted)) { abs = hinted; via = 'path' }
    }
    if (!abs && wanted) {
      for (const dir of candidates) {
        if (!fs.existsSync(dir)) continue
        if (remoteUrls(dir).some((u) => normalizeRepo(u) === wanted)) { abs = dir; via = 'additionalDirectories'; break }
      }
    }
    const hasHarness = abs ? fs.existsSync(path.join(abs, '.harness/bin/harness')) : false
    const docs = abs ? [path.join(abs, 'CLAUDE.md'), ...(focus ? [path.join(abs, focus, 'CLAUDE.md')] : [])].filter((d) => fs.existsSync(d)) : []
    let reminderHeads = []
    if (abs && hasHarness) {
      try {
        reminderHeads = fs.readFileSync(path.join(abs, '.harness/session/next-session-reminder.md'), 'utf8')
          .split(/\r?\n/).filter((l) => /^## /.test(l)).slice(0, 3).map((h) => h.replace(/^## /, ''))
      } catch {}
    }
    return { label, repo: item.repo ?? null, focus, hint: item.path ?? null, abs, via, hasHarness, docs, reminderHeads }
  })
}

function unresolvedHint(item) {
  const key = item.repo ? `repo ${item.repo}` : (item.hint ? `힌트 경로 ${item.hint}` : '식별 정보 없음(repo 또는 path 필요)')
  return `이 PC에서 위치를 못 찾았습니다(${key}). ${root}/.claude/settings.local.json 의 permissions.additionalDirectories 에 그 저장소 폴더를 추가하세요 — 파일 접근 권한도 거기서 열립니다.`
}

const items = resolveLinkedProjects(root)

if (mode === 'json') {
  console.log(JSON.stringify(items, null, 2))
} else if (mode === 'prompt') {
  for (const it of items) {
    if (!it.abs) continue
    const focus = it.focus ? ` (focus ${it.focus})` : ''
    console.log(`Linked project ${it.label}: ${it.abs}${focus} — before touching files there, read its CLAUDE.md${it.focus ? ` and ${it.focus}/CLAUDE.md` : ''}; its write-time hooks do not run in this session; run its harness via ${it.abs}/.harness/bin/harness; commit inside that repo (its own git hooks check).`)
  }
} else if (mode === 'session') {
  if (items.length > 0) {
    console.log('')
    console.log('[harness] 연결 프로젝트 (이 세션에서 함께 다루는 다른 저장소)')
    for (const it of items) {
      if (!it.abs) { console.log(`- ${it.label}: ${unresolvedHint(it)}`); continue }
      console.log(`- ${it.label}: ${it.abs}${it.focus ? ` (관심 영역 ${it.focus})` : ''}${it.hasHarness ? '' : ' — 하네스 미설치(기준 문서 없음, 파일 작업만)'}`)
      if (it.docs.length) console.log(`  그쪽 파일을 읽거나 고치기 전에 반드시 먼저 읽기: ${it.docs.join(', ')}`)
      if (it.hasHarness) {
        console.log(`  그쪽 하네스 명령은 ${path.join(it.abs, '.harness/bin/harness')} <명령> 으로 실행합니다(이 저장소 런처가 아님). 커밋·푸시는 그 저장소 안에서 — 그쪽 git 훅이 검사합니다.`)
        console.log('  ⚠ 그쪽 훅(쓰기 시점 차단·검사)은 이 세션에서 자동 실행되지 않습니다 — 그쪽 파일을 고쳤으면 그 저장소에서 커밋해 훅 검사를 받고, 필요하면 위 런처로 check를 돌리세요.')
        if (it.reminderHeads.length) console.log(`  그쪽 리마인더 최근 항목: ${it.reminderHeads.join(' / ')} (전문: ${path.join(it.abs, '.harness/session/next-session-reminder.md')})`)
      }
    }
    console.log('  같은 이름의 슬래시 명령(/하네스업데이트 등)은 이 저장소 것만 뜹니다 — 연결 저장소 작업은 위 런처 경로로.')
  }
} else {
  if (items.length === 0) {
    console.log('연결 프로젝트 없음 — .harness/policy/profile.json 의 linkedProjects 에 { "label", "repo", "focus" } 를 선언하면 세션 시작 때 그 저장소의 기준 문서·런처가 함께 안내됩니다.')
  } else {
    console.log('연결 프로젝트 해석 상태 (이 PC 기준)')
    for (const it of items) {
      console.log(`- ${it.label}${it.focus ? ` (focus ${it.focus})` : ''}`)
      console.log(`    저장소: ${it.repo ?? '(repo 미선언)'}${it.hint ? `  힌트 경로: ${it.hint}` : ''}`)
      console.log(it.abs ? `    위치: ${it.abs}  (${it.via === 'path' ? '힌트 경로' : 'additionalDirectories 의 git remote 일치'})` : `    위치: ${unresolvedHint(it)}`)
      if (it.abs) console.log(`    하네스: ${it.hasHarness ? '있음' : '없음'}  기준 문서: ${it.docs.length ? it.docs.join(', ') : '없음'}`)
    }
  }
}
