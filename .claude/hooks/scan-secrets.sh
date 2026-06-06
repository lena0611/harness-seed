#!/usr/bin/env bash
set -euo pipefail

input="$(cat 2>/dev/null || true)"

HARNESS_HOOK_INPUT="$input" node <<'NODE'
const raw = process.env.HARNESS_HOOK_INPUT || "{}";
let prompt = "";
try {
  const data = JSON.parse(raw);
  prompt = String(data.prompt || "");
} catch (_) {
  process.exit(0);
}

if (!prompt) process.exit(0);

const patterns = [
  { label: "OpenAI / Anthropic API key", pattern: /(^|[^A-Za-z0-9_-])sk-(ant-|proj-)?[A-Za-z0-9_-]{32,}/ },
  { label: "GitHub personal access token", pattern: /ghp_[A-Za-z0-9]{36,}/ },
  { label: "GitHub fine-grained PAT", pattern: /github_pat_[A-Za-z0-9_]{82}/ },
  { label: "GitHub Actions token", pattern: /ghs_[A-Za-z0-9]{36,}/ },
  { label: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "AWS secret key", pattern: /aws.{0,20}secret.{0,20}[=:]["\s]*[A-Za-z0-9/+=]{40}/i },
  { label: "Slack token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}={0,2}/ },
  { label: "PEM private key", pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { label: "password-like value", pattern: /(password|passwd|pwd)\s*[=:]\s*\S{8,}/i },
  { label: "database url with credentials", pattern: /(database_url|db_url)\s*[=:]\s*\S+:\S+@/i },
  { label: "Google API key", pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { label: "private key value", pattern: /private[_-]?key\s*[=:]\s*["']?[A-Za-z0-9+/=_-]{20,}/i }
];

const found = patterns.filter((entry) => entry.pattern.test(prompt)).map((entry) => entry.label);
if (found.length === 0) process.exit(0);

console.log(`## 하네스 보안 경고: 시크릿 패턴 감지
사용자 메시지에서 다음 시크릿 패턴이 감지되었습니다: **${Array.from(new Set(found)).join(", ")}**

값을 코드, 로그, 커밋 메시지, 세션 메모리, 하네스 문서에 기록하지 마세요. 필요한 경우 사용자에게 해당 자격증명 폐기/재발급과 secret manager 또는 환경 변수 사용을 안내하세요.`);
NODE

exit 0
