const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { resolveAiProvider, pickOllamaModel } = require('../src/ai');
const { renderGitHubPagesWorkflow, renderVercelConfig } = require('../src/deploy');
const { createVitePressArgs } = require('../src/vitepress');

const execFileAsync = promisify(execFile);

async function createFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-wiki-'));
  const sourceDir = path.join(tempDir, 'src', 'utils');

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      version: '1.2.3',
      description: 'Fixture project for docs-wiki smoke tests.',
    }, null, 2),
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'index.ts'),
    [
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
      '',
      'export class Calculator {',
      '  multiply(a: number, b: number) {',
      '    return a * b;',
      '  }',
      '}',
      '',
      'export const subtract = (a: number, b: number) => a - b;',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'utils', 'format.ts'),
    [
      'export function formatCurrency(value: number) {',
      '  return `$${value.toFixed(2)}`;',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'skip.ts'),
    [
      'export function shouldBeIgnored() {',
      '  return false;',
      '}',
    ].join('\n'),
    'utf8',
  );

  return tempDir;
}

test('docs-wiki scans the cwd and writes summary, module, and file docs', async () => {
  const tempDir = await createFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const summaryPath = path.join(tempDir, 'docs-wiki', 'SUMMARY.md');
  const indexPath = path.join(tempDir, 'docs-wiki', 'index.md');
  const vitePressConfigPath = path.join(tempDir, 'docs-wiki', '.vitepress', 'config.mjs');
  const schemaPath = path.join(tempDir, 'docs-wiki', 'vitepress.schema.json');
  const searchIndexPath = path.join(tempDir, 'docs-wiki', 'search-index.json');
  const themeCssPath = path.join(tempDir, 'docs-wiki', 'public', 'docs-wiki.css');
  const moduleIndexPath = path.join(tempDir, 'docs-wiki', 'modules', 'index.md');
  const workspaceIndexPath = path.join(tempDir, 'docs-wiki', 'workspaces', 'index.md');
  const workspaceRootPath = path.join(tempDir, 'docs-wiki', 'workspaces', 'root.md');
  const rootModulePath = path.join(tempDir, 'docs-wiki', 'modules', 'root.md');
  const srcModulePath = path.join(tempDir, 'docs-wiki', 'modules', 'src.md');
  const nestedModulePath = path.join(tempDir, 'docs-wiki', 'modules', 'src', 'utils.md');
  const filePagePath = path.join(tempDir, 'docs-wiki', 'files', 'src', 'index.ts.md');
  const nestedFilePagePath = path.join(tempDir, 'docs-wiki', 'files', 'src', 'utils', 'format.ts.md');

  const [summaryMarkdown, indexMarkdown, vitePressConfigText, schemaText, searchIndexText, themeCssText, moduleIndexMarkdown, workspaceIndexMarkdown, workspaceRootMarkdown, rootModuleMarkdown, srcModuleMarkdown, nestedModuleMarkdown, fileMarkdown, nestedFileMarkdown] = await Promise.all([
    fs.readFile(summaryPath, 'utf8'),
    fs.readFile(indexPath, 'utf8'),
    fs.readFile(vitePressConfigPath, 'utf8'),
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(searchIndexPath, 'utf8'),
    fs.readFile(themeCssPath, 'utf8'),
    fs.readFile(moduleIndexPath, 'utf8'),
    fs.readFile(workspaceIndexPath, 'utf8'),
    fs.readFile(workspaceRootPath, 'utf8'),
    fs.readFile(rootModulePath, 'utf8'),
    fs.readFile(srcModulePath, 'utf8'),
    fs.readFile(nestedModulePath, 'utf8'),
    fs.readFile(filePagePath, 'utf8'),
    fs.readFile(nestedFilePagePath, 'utf8'),
  ]);
  const schema = JSON.parse(schemaText);
  const searchIndex = JSON.parse(searchIndexText);

  assert.match(summaryMarkdown, /^---\n/);
  assert.match(summaryMarkdown, /Project Overview/);
  assert.match(summaryMarkdown, /Module: src/);
  assert.match(summaryMarkdown, /Workspace Index/);
  assert.match(indexMarkdown, /^---\n/);
  assert.match(indexMarkdown, /layout: "home"/);
  assert.match(indexMarkdown, /sidebar: false/);
  assert.match(indexMarkdown, /aside: false/);
  assert.match(indexMarkdown, /themePreset: "clean"/);
  assert.match(indexMarkdown, /hero:/);
  assert.match(indexMarkdown, /features:/);
  assert.match(indexMarkdown, /title: "fixture-app Docs Wiki"/);
  assert.match(indexMarkdown, /docsWiki:/);
  assert.match(vitePressConfigText, /transformPageData/);
  assert.match(vitePressConfigText, /docs-wiki\.css/);
  assert.match(vitePressConfigText, /provider": "local"/);
  assert.match(vitePressConfigText, /"\/modules\/"/);
  assert.match(vitePressConfigText, /"\/files\/"/);
  assert.match(indexMarkdown, /## Snapshot/);
  assert.match(indexMarkdown, /## Key Modules/);
  assert.match(indexMarkdown, /## Workspaces/);
  assert.equal(schema.title, 'docs-wiki VitePress Frontmatter');
  assert.ok(schema.properties.docsWiki);
  assert.equal(searchIndex.project, 'fixture-app');
  assert.ok(searchIndex.entryCount >= 6);
  assert.ok(searchIndex.entries.some((entry) => entry.kind === 'file' && entry.title === 'src/index.ts'));
  assert.match(themeCssText, /--vp-c-brand-1/);
  assert.match(themeCssText, /--vp-home-hero-name-background/);
  assert.match(themeCssText, /\.docs-wiki--overview \.VPFeature/);
  assert.match(themeCssText, /\.docs-wiki--file \.vp-doc h3::before/);
  assert.match(moduleIndexMarkdown, /# Module Index/);
  assert.match(workspaceIndexMarkdown, /# Workspace Index/);
  assert.match(workspaceRootMarkdown, /# Workspace fixture-app/);
  assert.match(rootModuleMarkdown, /# Module \(root\)/);
  assert.match(srcModuleMarkdown, /# Module src/);
  assert.match(srcModuleMarkdown, /src\/index.ts/);
  assert.match(nestedModuleMarkdown, /src\/utils\/format.ts/);
  assert.match(fileMarkdown, /Module: \[src\]/);
  assert.match(fileMarkdown, /Workspace: \[fixture-app\]/);
  assert.match(fileMarkdown, /outline: "deep"/);
  assert.match(fileMarkdown, /pageClass: "docs-wiki docs-wiki--file"/);
  assert.match(fileMarkdown, /relativePath: "src\/index\.ts"/);
  assert.match(fileMarkdown, /## Public API/);
  assert.match(fileMarkdown, /function `add`/);
  assert.match(fileMarkdown, /class `Calculator`/);
  assert.match(fileMarkdown, /function `subtract`/);
  assert.match(nestedFileMarkdown, /function `formatCurrency`/);
});

test('docs-wiki errors when AI is enabled without an API key', async () => {
  const tempDir = await createFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await assert.rejects(
    execFileAsync(process.execPath, [binPath, '--ai'], {
      cwd: tempDir,
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
        OLLAMA_BASE_URL: 'http://127.0.0.1:9/v1',
      },
    }),
    /Ollama|OPENAI_API_KEY|reachable local Ollama server/,
  );
});

test('AI provider auto mode falls back to Ollama when no OpenAI key is configured', async () => {
  const resolved = await resolveAiProvider({
    provider: 'auto',
    apiKey: '',
    baseURL: '',
    model: 'gpt-5.4-mini',
    ollamaBaseURL: 'http://127.0.0.1:11434/v1',
    ollamaModel: 'llama3.2',
    ollamaApiKey: 'ollama',
  }, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.2:1b' }] }),
    }),
  });

  assert.equal(resolved.provider, 'ollama');
  assert.equal(resolved.model, 'llama3.2:1b');
});

test('Ollama model selection falls back to an available family variant', () => {
  assert.equal(
    pickOllamaModel('llama3.2', ['llama3.2:1b', 'qwen2.5:3b']),
    'llama3.2:1b',
  );
  assert.equal(
    pickOllamaModel('missing-model', ['llama3.2:1b', 'qwen2.5:3b']),
    'llama3.2:1b',
  );
});

test('VitePress CLI args are forwarded only for supported commands', () => {
  const devArgs = createVitePressArgs('dev', '/tmp/docs-wiki', {
    open: true,
    port: 4173,
    base: '/docs/',
    strictPort: true,
    force: true,
  });
  const buildArgs = createVitePressArgs('build', '/tmp/docs-wiki', {
    base: '/docs/',
    port: 4173,
    open: true,
  });
  const previewArgs = createVitePressArgs('preview', '/tmp/docs-wiki', {
    base: '/docs/',
    port: 4174,
    open: true,
  });

  assert.deepEqual(devArgs.slice(1), ['dev', '/tmp/docs-wiki', '--open', '--port', '4173', '--base', '/docs/', '--strictPort', '--force']);
  assert.deepEqual(buildArgs.slice(1), ['build', '/tmp/docs-wiki', '--base', '/docs/']);
  assert.deepEqual(previewArgs.slice(1), ['preview', '/tmp/docs-wiki', '--base', '/docs/', '--port', '4174']);
});

test('deploy scaffold renderers generate GitHub Pages and Vercel configs', () => {
  const workflow = renderGitHubPagesWorkflow({ outDir: 'docs-wiki', branch: 'main' });
  const vercelConfig = JSON.parse(renderVercelConfig({ outDir: 'docs-wiki' }));

  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /npx --yes docs-wiki build-site --base/);
  assert.match(workflow, /path: docs-wiki\/\.vitepress\/dist/);
  assert.equal(vercelConfig.buildCommand, 'npx --yes docs-wiki build-site');
  assert.equal(vercelConfig.outputDirectory, 'docs-wiki/.vitepress/dist');
});

test('docs-wiki respects docs-wiki.config.json for ignore patterns and output style', async () => {
  const tempDir = await createFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await fs.writeFile(
    path.join(tempDir, 'docs-wiki.config.json'),
    JSON.stringify({
      ignore: ['**/skip.ts'],
      template: 'api-first',
      themePreset: 'warm',
      output: {
        includeCodeBlocks: false,
      },
    }, null, 2),
  );

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const indexMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'index.md'), 'utf8');
  const fileMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'files', 'src', 'index.ts.md'), 'utf8');
  const themeCssText = await fs.readFile(path.join(tempDir, 'docs-wiki', 'public', 'docs-wiki.css'), 'utf8');

  assert.match(indexMarkdown, /Config:/);
  assert.match(indexMarkdown, /themePreset: "warm"/);
  assert.doesNotMatch(indexMarkdown, /skip.ts/);
  assert.doesNotMatch(fileMarkdown, /```ts/);
  assert.match(fileMarkdown, /## Public API/);
  assert.match(fileMarkdown, /Signature:/);
  assert.match(themeCssText, /--vp-c-brand-1: #c2410c/);
});

test('docs-wiki indexes .dart files as Dart (Flutter) plain-text pages', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-wiki-dart-'));
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await fs.writeFile(path.join(tempDir, 'pubspec.yaml'), 'name: sample_app\nversion: 0.0.1\n', 'utf8');
  await fs.mkdir(path.join(tempDir, 'lib'), { recursive: true });
  await fs.writeFile(path.join(tempDir, 'lib', 'main.dart'), 'void main() {\n  // fixture\n}\n', 'utf8');

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const manifest = JSON.parse(await fs.readFile(path.join(tempDir, 'docs-wiki', 'manifest.json'), 'utf8'));
  const dart = manifest.files.find((f) => f.relativePath === 'lib/main.dart');
  assert.ok(dart, 'expected lib/main.dart in manifest');
  assert.equal(dart.language, 'Dart (Flutter)');
  assert.ok(Array.isArray(dart.symbols) && dart.symbols.length >= 1);
});

test('docs-wiki discovers source files under hidden directories (dot segments)', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-wiki-dot-'));
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ name: 'dot-app', version: '1.0.0' }, null, 2),
    'utf8',
  );
  await fs.mkdir(path.join(tempDir, '.config'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, '.config', 'routes.ts'),
    'export const routes: string[] = [];\n',
    'utf8',
  );

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const manifest = JSON.parse(await fs.readFile(path.join(tempDir, 'docs-wiki', 'manifest.json'), 'utf8'));
  assert.ok(manifest.files.some((f) => f.relativePath === '.config/routes.ts'));
});

test('docs-wiki incremental mode rewrites only changed file pages when content changes', async () => {
  const tempDir = await createFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');
  const unchangedPagePath = path.join(tempDir, 'docs-wiki', 'files', 'src', 'index.ts.md');
  const changedPagePath = path.join(tempDir, 'docs-wiki', 'files', 'src', 'utils', 'format.ts.md');
  const manifestPath = path.join(tempDir, 'docs-wiki', 'manifest.json');

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });
  const beforeUnchanged = await fs.stat(unchangedPagePath);
  const beforeChanged = await fs.stat(changedPagePath);

  await new Promise((resolve) => setTimeout(resolve, 50));
  await fs.writeFile(
    path.join(tempDir, 'src', 'utils', 'format.ts'),
    [
      'export function formatCurrency(value: number) {',
      '  return `USD ${value.toFixed(2)}`;',
      '}',
    ].join('\n'),
    'utf8',
  );

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const afterUnchanged = await fs.stat(unchangedPagePath);
  const afterChanged = await fs.stat(changedPagePath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  assert.equal(afterUnchanged.mtimeMs, beforeUnchanged.mtimeMs);
  assert.ok(afterChanged.mtimeMs > beforeChanged.mtimeMs);
  assert.equal(manifest.incremental.mode, 'incremental');
  assert.deepEqual(manifest.incremental.changedFiles, ['src/utils/format.ts']);
  assert.ok(manifest.incremental.reusedFiles.includes('src/index.ts'));
});
