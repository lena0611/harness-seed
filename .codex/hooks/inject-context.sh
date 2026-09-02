#!/usr/bin/env bash
set -euo pipefail

root="${CODEX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
profile="$root/.harness/policy/profile.json"
active_stack="unknown"

if [ -f "$profile" ]; then
  active_stack="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(p.activeStack || 'none')" "$profile" 2>/dev/null || printf 'unknown')"
fi

printf 'Harness context: read CLAUDE.md first; source of truth is .harness/; activeStack=%s; before user finalization, report checks as candidates. If user asks final check, run .harness/bin/harness check. If user asks commit/push and hooks are installed, trust pre-commit/pre-push checks and do not run duplicate manual harness:check first.\n' "$active_stack"
printf 'Harness reporting: when reporting actual work progress, summarize as [harness] request/context/impact/action/decision/verify. Do not force this format for simple Q&A, casual, or meta-only turns.\n'

# 연결 프로젝트(0.2.139): 매 프롬프트에 한 줄 — 그쪽 파일 작업 전 기준 문서 읽기·런처 경로·커밋 위치 상기.
if [ -f "$profile" ]; then
  node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
let linked = [];
try { linked = JSON.parse(fs.readFileSync(path.join(root, ".harness/policy/profile.json"), "utf8")).linkedProjects || []; } catch {}
for (const it of Array.isArray(linked) ? linked : []) {
  if (!it || typeof it.path !== "string") continue;
  const abs = path.resolve(root, it.path);
  if (!fs.existsSync(abs)) continue;
  const label = it.label || it.path;
  const focus = typeof it.focus === "string" && it.focus ? it.focus : "";
  console.log(`Linked project ${label}: ${abs}${focus ? ` (focus ${focus})` : ""} — before touching files there, read its CLAUDE.md${focus ? ` and ${focus}/CLAUDE.md` : ""}; run its harness via ${abs}/.harness/bin/harness; commit inside that repo (its own git hooks check).`);
}
' "$root" 2>/dev/null || true
fi

# 훅 미설치 감지(결정 94): 훅 설정은 clone으로 공유되지 않으므로 새로 받은 clone은 관문이 꺼져 있다. fail-open.
if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hooks_path="$(git -C "$root" config core.hooksPath 2>/dev/null || printf '')"
  auto_enable="$(git -C "$root" config harness.hooksAutoEnable 2>/dev/null || printf '')"
  if [ "$hooks_path" != ".githooks" ] && [ "$auto_enable" != "false" ]; then
    printf 'Harness hooks are OFF in this clone (hook config does not travel with git clone; the team already opted in by adding the harness). Turn them on NOW by running .harness/bin/harness hooks:install (idempotent, preserves existing hooks by chaining), then tell the user in one line that you enabled them.\n'
  fi
fi

# 기획 문서 연동 프로젝트에서는 코드 변경 전에 관련 기획을 먼저 확인한다(절차 정본은 .harness/project/spec-authority-workflow.md).
if [ -f "$root/.harness/spec-lock.json" ]; then
  printf 'Planning spec link is active: before changing code, follow .harness/project/spec-authority-workflow.md and check related planning docs first (regardless of task size).\n'
fi
