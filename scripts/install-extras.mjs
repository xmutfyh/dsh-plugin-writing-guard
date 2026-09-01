#!/usr/bin/env node
/**
 * Post-install script for dsh-plugin-writing-guard.
 * Copies skill files and Python word_guard module to DSH directories.
 */
import { existsSync, mkdirSync, cpSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(__dirname, '..')

// DSH home directory
const DSH_HOME = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE, '.dsh')

function copyDir(src, dest) {
  if (!existsSync(src)) return
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
}

try {
  // 1. Copy skill files to ~/.dsh/skills/writing-guard/
  const skillSrc = join(PLUGIN_ROOT, 'skills', 'writing-guard')
  const skillDest = join(DSH_HOME, 'skills', 'writing-guard')
  if (existsSync(skillSrc)) {
    copyDir(skillSrc, skillDest)
    console.log(`[dsh-plugin-writing-guard] Skill installed to ${skillDest}`)
  }

  // 2. Copy Python word_guard module to ~/.dsh/plugins/dsh-plugin-writing-guard/word_guard/
  const pySrc = join(PLUGIN_ROOT, 'src', 'word_guard')
  const pyDest = join(DSH_HOME, 'plugins', 'dsh-plugin-writing-guard', 'word_guard')
  if (existsSync(pySrc)) {
    copyDir(pySrc, pyDest)
    console.log(`[dsh-plugin-writing-guard] Python module installed to ${pyDest}`)
  }

  // 3. Ensure Python scripts are executable (Unix)
  if (process.platform !== 'win32') {
    try {
      chmodSync(join(pyDest, 'cli.py'), 0o755)
    } catch {}
  }

  // 4. Check python-docx availability
  const { execSync } = await import('node:child_process')
  const pythonCmd = process.env.DSH_PYTHON || 'python3'
  try {
    execSync(`${pythonCmd} -c "import docx; print(docx.__version__)"`, { stdio: 'pipe' })
    console.log('[dsh-plugin-writing-guard] python-docx detected ✓')
  } catch {
    console.warn('[dsh-plugin-writing-guard] Warning: python-docx not found. Install it with:')
    console.warn(`  ${pythonCmd} -m pip install python-docx`)
  }

  console.log('[dsh-plugin-writing-guard] Installation complete!')
} catch (e) {
  console.warn(`[dsh-plugin-writing-guard] Post-install warning: ${e.message}`)
  console.warn('[dsh-plugin-writing-guard] Word editing tools may not work until Python module is installed manually.')
}
