const fs = require('node:fs/promises');
const path = require('node:path');
const { renderVitePressThemeEntry, loadBundledMermaidBrowserScript } = require('./generator');

/**
 * Overwrites VitePress theme + bundled Mermaid script in an existing generated site
 * (no re-scan, no AI, no markdown regeneration). Use after upgrading docs-wiki to pick up
 * client-side fixes (e.g. Mermaid rendering) without running a full analysis.
 *
 * @param {string} siteRoot Absolute path to the output folder (contains `.vitepress/` and `public/`)
 * @returns {Promise<{ siteRoot: string, themePath: string, mermaidPath: string }>}
 */
async function applySiteHotfix(siteRoot) {
  const root = path.resolve(siteRoot);
  const themePath = path.join(root, '.vitepress', 'theme', 'index.mjs');
  const mermaidPath = path.join(root, 'public', 'mermaid.min.js');

  await fs.mkdir(path.dirname(themePath), { recursive: true });
  await fs.mkdir(path.dirname(mermaidPath), { recursive: true });

  await fs.writeFile(themePath, renderVitePressThemeEntry(), 'utf8');
  await fs.writeFile(mermaidPath, await loadBundledMermaidBrowserScript(), 'utf8');

  return {
    siteRoot: root,
    themePath,
    mermaidPath,
  };
}

module.exports = {
  applySiteHotfix,
};
