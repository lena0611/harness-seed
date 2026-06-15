#!/usr/bin/env node

const required = { major: 20, minor: 19, label: '20.19.0' }

function parse(version) {
  const parts = version.split('.').map((part) => Number(part))
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  }
}

function isSupported(version) {
  if (version.major > required.major) return true
  return version.major === required.major && version.minor >= required.minor
}

const current = parse(process.versions.node)

if (!isSupported(current)) {
  console.error('')
  console.error(`harness-seed requires Node.js >=${required.label}. Current: ${process.version}`)
  console.error('')
  console.error('Recommended:')
  console.error('  nvm install ' + required.major)
  console.error('')
  console.error('프로젝트가 저버전 Node(.nvmrc)를 쓰는 경우에도 프로젝트 Node를 올릴 필요는 없습니다.')
  console.error('nvm에 ' + required.label + ' 이상이 설치되어 있으면 git hook(Git Bash 포함)과 POSIX 셸의')
  console.error('.harness/bin/harness <command>가 하네스 스크립트만 그 버전으로 자동 전환합니다(dual-runtime).')
  console.error('프로젝트 검증은 .nvmrc Node로 실행됩니다.')
  console.error('Windows(nvm-windows)는 dual-runtime 자동 전환을 지원하지 않으므로, ' + required.label + ' 이상으로 직접 `nvm use` 후 실행하세요.')
  process.exit(1)
}
