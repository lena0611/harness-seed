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
  console.error('  nvm install')
  console.error('  nvm use')
  console.error('')
  console.error('This matches the default harness runtime. Individual presets may require additional tools.')
  process.exit(1)
}
