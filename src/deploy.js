const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_OUT_DIR } = require('./config');

function renderGitHubPagesWorkflow({ outDir = DEFAULT_OUT_DIR, branch = 'main' }) {
  const distPath = `${outDir}/.vitepress/dist`;

  return [
    'name: Deploy docs-wiki to GitHub Pages',
    '',
    'on:',
    '  push:',
    '    branches:',
    `      - ${branch}`,
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: read',
    '  pages: write',
    '  id-token: write',
    '',
    'concurrency:',
    '  group: github-pages',
    '  cancel-in-progress: true',
    '',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      # Change to "/" for a user/organization site or a custom domain.',
    '      DOCS_BASE: /${{ github.event.repository.name }}/',
    '    steps:',
    '      - name: Checkout',
    '        uses: actions/checkout@v5',
    '      - name: Setup Node',
    '        uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 20',
    '      - name: Configure Pages',
    '        uses: actions/configure-pages@v5',
    '      - name: Build docs-wiki site',
    `        run: npx --yes github:truongnat/docs-wiki build-site --base "$DOCS_BASE"`,
    '      - name: Upload artifact',
    '        uses: actions/upload-pages-artifact@v4',
    '        with:',
    `          path: ${distPath}`,
    '',
    '  deploy:',
    '    environment:',
    '      name: github-pages',
    '      url: ${{ steps.deployment.outputs.page_url }}',
    '    needs: build',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Deploy to GitHub Pages',
    '        id: deployment',
    '        uses: actions/deploy-pages@v4',
    '',
  ].join('\n');
}

function renderVercelConfig({ outDir = DEFAULT_OUT_DIR }) {
  return JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    buildCommand: 'npx --yes github:truongnat/docs-wiki build-site',
    outputDirectory: `${outDir}/.vitepress/dist`,
    cleanUrls: true,
  }, null, 2);
}

async function writeScaffoldFile(targetPath, content, overwrite) {
  try {
    await fs.access(targetPath);
    if (!overwrite) {
      throw new Error(`Refusing to overwrite existing file: ${targetPath}`);
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf8');
}

async function scaffoldDeploy(rootDir, options = {}) {
  const target = options.target;
  const outDir = options.outDir || DEFAULT_OUT_DIR;
  const overwrite = Boolean(options.overwrite);
  const branch = options.branch || 'main';
  const written = [];

  if (target === 'github-pages') {
    const workflowPath = path.join(rootDir, '.github', 'workflows', 'docs-wiki-pages.yml');
    await writeScaffoldFile(workflowPath, renderGitHubPagesWorkflow({ outDir, branch }), overwrite);
    written.push(workflowPath);
  } else if (target === 'vercel') {
    const vercelPath = path.join(rootDir, 'vercel.json');
    await writeScaffoldFile(vercelPath, renderVercelConfig({ outDir }), overwrite);
    written.push(vercelPath);
  } else {
    throw new Error(`Unsupported deploy target: ${target}`);
  }

  return written;
}

module.exports = {
  renderGitHubPagesWorkflow,
  renderVercelConfig,
  scaffoldDeploy,
};
