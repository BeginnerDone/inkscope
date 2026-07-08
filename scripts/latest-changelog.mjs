#!/usr/bin/env node
import { existsSync, writeFileSync, readFileSync } from 'node:fs'

const output = process.argv[2] || 'release-notes.md'
const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : ''
const tag = process.env.GITHUB_REF_NAME || ''
const version = tag.replace(/^v/, '')

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pattern = version
  ? new RegExp(`^##\\s+v?${escapeRegExp(version)}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, 'm')
  : /^##\s+[^\n]+\n([\s\S]*?)(?=^##\s+|$(?![\s\S]))/m

const match = changelog.match(pattern)
const notes = match?.[1]?.trim() || changelog.trim() || `Release ${tag || 'InkScope'}`
writeFileSync(output, `${notes}\n`)
