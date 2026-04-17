const fs = require('node:fs/promises');
const path = require('node:path');
const fg = require('fast-glob');
const { renderVitePressThemeEntry, renderThemeStyles, loadBundledMermaidBrowserScript } = require('./generator');
const { neutralizeTopLevelMarkdownEsm } = require('./markdownSafe');

/**
 * Overwrites VitePress theme, bundled Mermaid script, and `public/docs-wiki.css` in an existing
 * generated site, then sanitizes generated markdown against top-level ESM lines (`import` / `export`).
 * Use after upgrading docs-wiki to pick up client-side fixes and markdown rendering guards without a full
 * analysis run.
 *
 * @param {string} siteRoot Absolute path to the output folder (contains `.vitepress/` and `public/`)
 * @param {object} [opts]
 * @param {{ themePreset?: string }} [opts.output] Resolved `output` from config (used for CSS variables). Defaults to `{ themePreset: 'clean' }`.
 * @returns {Promise<{ siteRoot: string, themePath: string, mermaidPath: string, stylesPath: string, markdownFilesScanned: number, markdownFilesPatched: number }>}
 */
async function applySiteHotfix(siteRoot, opts = {}) {
  const root = path.resolve(siteRoot);
  const themePath = path.join(root, '.vitepress', 'theme', 'index.mjs');
  const mermaidPath = path.join(root, 'public', 'mermaid.min.js');
  const stylesPath = path.join(root, 'public', 'docs-wiki.css');
  const output = opts.output && typeof opts.output === 'object' ? opts.output : { themePreset: 'clean' };

  await fs.mkdir(path.dirname(themePath), { recursive: true });
  await fs.mkdir(path.dirname(mermaidPath), { recursive: true });

  await fs.writeFile(themePath, renderVitePressThemeEntry(), 'utf8');
  await fs.writeFile(mermaidPath, await loadBundledMermaidBrowserScript(), 'utf8');
  await fs.writeFile(stylesPath, renderThemeStyles(output), 'utf8');

  const markdownPaths = await fg('**/*.md', {
    cwd: root,
    absolute: true,
    dot: true,
    ignore: ['**/.vitepress/**', '**/node_modules/**'],
  });
  let markdownFilesPatched = 0;

  for (const markdownPath of markdownPaths) {
    const original = await fs.readFile(markdownPath, 'utf8');
    const sanitized = neutralizeTopLevelMarkdownEsm(original);
    if (sanitized !== original) {
      await fs.writeFile(markdownPath, sanitized, 'utf8');
      markdownFilesPatched += 1;
    }
  }

  return {
    siteRoot: root,
    themePath,
    mermaidPath,
    stylesPath,
    markdownFilesScanned: markdownPaths.length,
    markdownFilesPatched,
  };
}

module.exports = {
  applySiteHotfix,
};
