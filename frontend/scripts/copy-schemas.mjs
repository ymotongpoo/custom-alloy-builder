import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const source = resolve(repoRoot, 'schemas')
const target = resolve(repoRoot, 'frontend', 'public', 'schemas')

rmSync(target, { force: true, recursive: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
