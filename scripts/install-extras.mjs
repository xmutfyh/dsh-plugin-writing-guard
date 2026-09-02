#!/usr/bin/env node
/**
 * Post-install script for dsh-plugin-writing-guard.
 * Copies skill files and Python word_guard module to DSH directories.
 *
 * This script NEVER throws — failures are logged as warnings so npm install
 * does not fail. The plugin works without the skill/Python files; they just
 * enable natural-language triggering and Word editing.
 */
import { existsSync, mkdirSync, cpSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(__dirname, '..')

// DSH home directory — handle Windows, macOS, Linux
function getDshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  // Windows: USERPROFILE, Unix: HOME
  const home = process.env.USERPROFILE || process.env.HOME
  if (!home) return null
  return join(home, '.dsh')
}

function copyDir(src, dest) {
  if (!existsSync(src)) return false
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
  return true
}

// Main — wrapped in a top-level catch that never exits with code 1
try {
  const DSH_HOME = getDshHome()
  if (!DSH_HOME) {
    console.warn('[dsh-plugin-writing-guard] Could not determine DSH_HOME — skipping postinstall setup')
    console.warn('[dsh-plugin-writing-guard] You can manually copy skills/ and src/word_guard/ later')
    // Exit successfully — this is not a fatal error
    process.exit(0)
  }

  // 1. Copy skill files to ~/.dsh/skills/writing-guard/
  try {
    const skillSrc = join(PLUGIN_ROOT, 'skills', 'writing-guard')
    const skillDest = join(DSH_HOME, 'skills', 'writing-guard')
    if (existsSync(skillSrc)) {
      copyDir(skillSrc, skillDest)
      console.log(`[dsh-plugin-writing-guard] Skill installed to ${skillDest}`)
    }
  } catch (e) {
    console.warn(`[dsh-plugin-writing-guard] Could not install skill: ${e.message}`)
  }

  // 2. Copy Python word_guard module to ~/.dsh/plugins/dsh-plugin-writing-guard/word_guard/
  try {
    const pySrc = join(PLUGIN_ROOT, 'src', 'word_guard')
    const pyDest = join(DSH_HOME, 'plugins', 'dsh-plugin-writing-guard', 'word_guard')
    if (existsSync(pySrc)) {
      copyDir(pySrc, pyDest)
      console.log(`[dsh-plugin-writing-guard] Python module installed to ${pyDest}`)
    }
  } catch (e) {
    console.warn(`[dsh-plugin-writing-guard] Could not install Python module: ${e.message}`)
  }

  // 3. Check python-docx availability (informational only)
  try {
    const { execSync } = await import('node:child_process')
    const pythonCmd = process.env.DSH_PYTHON || 'python3'
    execSync(`${pythonCmd} -c "import docx; print(docx.__version__)"`, { stdio: 'pipe' })
    console.log('[dsh-plugin-writing-guard] python-docx detected ✓')
  } catch {
    console.warn('[dsh-plugin-writing-guard] python-docx not found — Word tools will not work until installed:')
    console.warn('  pip install python-docx')
  }

  console.log('[dsh-plugin-writing-guard] Postinstall complete')
} catch (e) {
  // Last resort — never let postinstall fail the npm install
  console.warn(`[dsh-plugin-writing-guard] Postinstall warning: ${e.message}`)
}
