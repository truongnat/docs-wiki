const fs = require('node:fs/promises');
const path = require('node:path');

const MARKER = '# docs-wiki generated output';

/**
 * Appends the wiki output directory to `<root>/.gitignore` if missing (relative outDir only).
 *
 * @param {string} rootDir Project root (scanned repo)
 * @param {string} outDir Relative output directory, e.g. `.docs-wiki`
 */
async function ensureGitignoreOutDir(rootDir, outDir) {
  if (!shouldManageGitignore(outDir)) {
    return;
  }

  const entry = gitignoreEntryLine(outDir);
  if (!entry) {
    return;
  }

  const gitignorePath = path.join(rootDir, '.gitignore');
  let content = '';
  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const lines = content.split(/\r?\n/);
  const base = entry.replace(/\/$/, '');
  const hasAlready = lines.some((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      return false;
    }
    return t === entry || t === base || t === `${base}/` || t === `/${base}` || t === `/${base}/`;
  });

  if (hasAlready) {
    return;
  }

  const block = content.length ? `\n${MARKER}\n${entry}\n` : `${MARKER}\n${entry}\n`;
  const sep = content.length && !content.endsWith('\n') ? '\n' : '';
  await fs.writeFile(gitignorePath, `${content}${sep}${block}`, 'utf8');
}

function shouldManageGitignore(outDir) {
  if (!outDir || typeof outDir !== 'string') {
    return false;
  }
  const trimmed = outDir.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    return false;
  }
  const normalized = path.normalize(trimmed);
  if (normalized.startsWith('..')) {
    return false;
  }
  return true;
}

function gitignoreEntryLine(outDir) {
  let s = String(outDir).replace(/\\/g, '/').trim();
  if (s.startsWith('./')) {
    s = s.slice(2);
  }
  s = s.replace(/\/$/, '');
  if (!s || s.includes('..')) {
    return null;
  }
  return s.endsWith('/') ? s : `${s}/`;
}

module.exports = {
  ensureGitignoreOutDir,
};
