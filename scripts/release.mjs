#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flags = new Set(args.filter(arg => arg.startsWith('--')))
const positional = args.filter(arg => !arg.startsWith('--'))
const push = flags.has('--push')
const dryRun = flags.has('--dry-run')
const noCommit = flags.has('--no-commit')
const noTag = flags.has('--no-tag')

const run = (cmd, cmdArgs = [], options = {}) => {
  const printable = [cmd, ...cmdArgs].join(' ')
  if (dryRun && options.write !== false) {
    console.log(`[dry-run] ${printable}`)
    return ''
  }
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: options.stdio || 'pipe' }).trim()
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

const assertClean = () => {
  const status = run('git', ['status', '--porcelain'], { write: false })
  if (status) {
    console.error('工作区不干净。请先提交或暂存当前改动，再执行 release。')
    console.error(status)
    process.exit(1)
  }
}

const bumpVersion = (version, bump) => {
  if (/^v?\d+\.\d+\.\d+(-[\w.-]+)?$/.test(bump)) return bump.replace(/^v/, '')
  const parts = version.split('.').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) throw new Error(`无法解析当前版本：${version}`)
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('用法：npm run release -- patch|minor|major|x.y.z [--dry-run]')
  if (bump === 'major') return `${parts[0] + 1}.0.0`
  if (bump === 'minor') return `${parts[0]}.${parts[1] + 1}.0`
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
}

const latestTag = () => {
  try { return run('git', ['describe', '--tags', '--abbrev=0'], { write: false }) }
  catch { return '' }
}

const collectChanges = fromTag => {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD'
  const raw = run('git', ['log', range, '--pretty=format:%h%x09%s'], { write: false })
  if (!raw) return ['- 初始化发布。']
  return raw.split('\n').map(line => {
    const [hash, subject] = line.split('\t')
    return `- ${subject} (${hash})`
  })
}

const updateCargoToml = version => {
  const path = 'src-tauri/Cargo.toml'
  const source = readFileSync(path, 'utf8')
  writeFileSync(path, source.replace(/(^version\s*=\s*")([^"]+)(")/m, `$1${version}$3`))
}

const updateTauriConfig = version => {
  const path = 'src-tauri/tauri.conf.json'
  const config = readJson(path)
  config.version = version
  writeJson(path, config)
}

const updatePackageFiles = version => {
  const pkg = readJson('package.json')
  pkg.version = version
  writeJson('package.json', pkg)

  const lock = readJson('package-lock.json')
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  writeJson('package-lock.json', lock)
}

const updateChangelog = (version, fromTag) => {
  const path = 'CHANGELOG.md'
  const date = new Date().toISOString().slice(0, 10)
  const changes = collectChanges(fromTag)
  const entry = [`## v${version} - ${date}`, '', ...changes, ''].join('\n')
  const existing = existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : '# Changelog\n'
  const next = existing.startsWith('# Changelog')
    ? existing.replace('# Changelog', `# Changelog\n\n${entry}`)
    : `# Changelog\n\n${entry}\n\n${existing}`
  writeFileSync(path, `${next.trimEnd()}\n`)
}

const main = () => {
  assertClean()
  const pkg = readJson('package.json')
  const bump = positional[0] || 'patch'
  const version = bumpVersion(pkg.version, bump)
  const tag = `v${version}`
  const fromTag = latestTag()

  if (run('git', ['tag', '--list', tag], { write: false })) {
    console.error(`标签 ${tag} 已存在。`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`当前版本：${pkg.version}`)
    console.log(`目标版本：${version}`)
    console.log(`将创建标签：${tag}`)
    console.log(`上一标签：${fromTag || '无'}`)
    console.log('将写入 CHANGELOG 条目：')
    console.log(collectChanges(fromTag).join('\n'))
    return
  }

  updatePackageFiles(version)
  updateCargoToml(version)
  updateTauriConfig(version)
  updateChangelog(version, fromTag)

  if (!noCommit) {
    run('git', ['add', 'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'CHANGELOG.md'])
    run('git', ['commit', '-m', `chore(release): ${tag}`], { stdio: 'inherit' })
  }

  if (!noTag) run('git', ['tag', '-a', tag, '-m', `Release ${tag}`], { stdio: 'inherit' })

  if (push) {
    run('git', ['push', 'origin', 'main'], { stdio: 'inherit' })
    run('git', ['push', 'origin', tag], { stdio: 'inherit' })
  }

  console.log(`Release ${tag} 已生成。${push ? '已推送。' : '如需推送：git push origin main && git push origin ' + tag}`)
}

main()
