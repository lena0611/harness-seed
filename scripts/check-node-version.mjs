#!/usr/bin/env node

const required = [
  { major: 20, minor: 19, label: '20.19.0' },
  { major: 22, minor: 13, label: '22.13.0' },
]

function parse(version) {
  const parts = version.split('.').map((part) => Number(part))
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  }
}

function isSupported(version) {
  return required.some((range) => {
    if (version.major > range.major) {
      return true
    }

    return version.major === range.major && version.minor >= range.minor
  })
}

const current = parse(process.versions.node)

if (!isSupported(current)) {
  console.error('')
  console.error(`harness-seed requires Node.js >=20.19.0 or >=22.13.0. Current: ${process.version}`)
  console.error('')
  console.error('Recommended:')
  console.error('  nvm install')
  console.error('  nvm use')
  console.error('')
  console.error('This matches Vite 7 and the vue3-fsd stack runtime.')
  process.exit(1)
}
