const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { resolveAiProvider, pickOllamaModel, enrichWithAi } = require('../src/ai');
const { enrichWithDesign } = require('../src/design');
const { renderGitHubPagesWorkflow, renderVercelConfig } = require('../src/deploy');
const { clusterFeatures } = require('../src/featureClusterer');
const { scanProject } = require('../src/scanner');
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

async function createAuthFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-wiki-auth-'));

  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'auth-app',
      version: '1.0.0',
      description: 'Fixture project with auth flow.',
    }, null, 2),
  );

  await fs.mkdir(path.join(tempDir, 'src', 'auth'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'src', 'shared'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'src', 'auth', 'login-route.ts'),
    [
      "import { authenticateUser } from './auth-service';",
      '',
      'export async function loginHandler(email: string, password: string) {',
      '  return authenticateUser(email, password);',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'auth', 'auth-service.ts'),
    [
      "import { findUserByEmail } from './auth-repository';",
      "import { storeSessionToken } from '../shared/session-store';",
      '',
      'export async function authenticateUser(email: string, password: string) {',
      '  const user = await findUserByEmail(email);',
      '  if (!user || password.length < 8) throw new Error("invalid");',
      '  return storeSessionToken(user.id);',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'auth', 'auth-repository.ts'),
    [
      'export async function findUserByEmail(email: string) {',
      '  return { id: email };',
      '}',
      '',
      'export async function storeSessionToken(userId: string) {',
      '  return { userId, token: "session-token" };',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'shared', 'session-store.ts'),
    [
      'export async function storeSessionToken(userId: string) {',
      '  return { userId, token: "session-token" };',
      '}',
    ].join('\n'),
    'utf8',
  );

  return tempDir;
}

async function createApiFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-wiki-api-'));

  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'api-app',
      version: '1.0.0',
      description: 'Fixture project with inferred API contracts.',
    }, null, 2),
  );

  await fs.mkdir(path.join(tempDir, 'src', 'auth'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'src', 'orders'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'src', 'auth', 'login-route.ts'),
    [
      "import { Router } from 'express';",
      "import { authenticateUser } from './auth-service';",
      '',
      'export const router = Router();',
      '',
      'router.post("/login", loginHandler);',
      '',
      'export async function loginHandler(req: any, res: any) {',
      '  const { email, password } = req.body;',
      '  const traceId = req.headers["x-trace-id"];',
      '  if (!email || !password) {',
      '    return res.status(400).json({ error: "missing_credentials", traceId });',
      '  }',
      '  const session = await authenticateUser(email, password);',
      '  return res.status(200).json({ token: session.token, userId: session.userId, traceId });',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'auth', 'auth-service.ts'),
    [
      'export async function authenticateUser(email: string, password: string) {',
      '  return { token: `${email}.${password}`, userId: email };',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'orders', 'order-route.ts'),
    [
      "import { Router } from 'express';",
      '',
      'export const router = Router();',
      '',
      'router.get("/orders/:orderId", getOrderHandler);',
      '',
      'export async function getOrderHandler(req: any, res: any) {',
      '  const { orderId } = req.params;',
      '  const expand = req.query.expand;',
      '  return res.json({ orderId, status: "paid", expand });',
      '}',
    ].join('\n'),
    'utf8',
  );

  return tempDir;
}

async function createTypedApiFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-wiki-typed-api-'));

  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'typed-api-app',
      version: '1.0.0',
      description: 'Fixture project with zod and DTO-based API contracts.',
    }, null, 2),
  );

  await fs.mkdir(path.join(tempDir, 'src', 'auth'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'app', 'api', 'auth', 'login'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'src', 'auth', 'schemas.ts'),
    [
      "import { z } from 'zod';",
      '',
      'export const loginSchema = z.object({',
      '  email: z.string(),',
      '  password: z.string(),',
      '});',
      '',
      'export interface LoginResponse {',
      '  token: string;',
      '  userId: string;',
      '  traceId: string;',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'src', 'auth', 'auth-service.ts'),
    [
      'export async function authenticateUser(email: string, password: string) {',
      '  return { token: `${email}.${password}`, userId: email };',
      '}',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(tempDir, 'app', 'api', 'auth', 'login', 'route.ts'),
    [
      "import { NextResponse } from 'next/server';",
      "import { loginSchema, type LoginResponse } from '../../../../src/auth/schemas';",
      "import { authenticateUser } from '../../../../src/auth/auth-service';",
      '',
      'export async function POST(request: Request) {',
      '  const body = await request.json();',
      '  const payload = loginSchema.parse(body);',
      '  const session = await authenticateUser(payload.email, payload.password);',
      '  return NextResponse.json<LoginResponse>({',
      '    token: session.token,',
      '    userId: session.userId,',
      '    traceId: "trace-1",',
      '  }, { status: 200 });',
      '}',
    ].join('\n'),
    'utf8',
  );

  return tempDir;
}

async function readManifest(tempDir) {
  return JSON.parse(await fs.readFile(path.join(tempDir, 'docs-wiki', 'manifest.json'), 'utf8'));
}

async function readFeaturePage(tempDir, matcher) {
  const manifest = await readManifest(tempDir);
  const feature = manifest.features.find((entry) => matcher(entry));
  assert.ok(feature, 'expected a matching feature in manifest');
  const featureMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'features', `${feature.slug || feature.id}.md`), 'utf8');
  return { manifest, feature, featureMarkdown };
}

test('docs-wiki scans the cwd and writes summary, feature, reference, and file docs', async () => {
  const tempDir = await createFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const manifest = await readManifest(tempDir);
  const summaryPath = path.join(tempDir, 'docs-wiki', 'SUMMARY.md');
  const indexPath = path.join(tempDir, 'docs-wiki', 'index.md');
  const featureIndexPath = path.join(tempDir, 'docs-wiki', 'features', 'index.md');
  const referenceIndexPath = path.join(tempDir, 'docs-wiki', 'reference', 'index.md');
  const designIndexPath = path.join(tempDir, 'docs-wiki', 'design', 'index.md');
  const basicDesignPath = path.join(tempDir, 'docs-wiki', 'design', 'basic-design.md');
  const detailDesignPath = path.join(tempDir, 'docs-wiki', 'design', 'detail-design.md');
  const flowCatalogPath = path.join(tempDir, 'docs-wiki', 'design', 'flows.md');
  const vitePressConfigPath = path.join(tempDir, 'docs-wiki', '.vitepress', 'config.mjs');
  const vitePressThemePath = path.join(tempDir, 'docs-wiki', '.vitepress', 'theme', 'index.mjs');
  const schemaPath = path.join(tempDir, 'docs-wiki', 'vitepress.schema.json');
  const searchIndexPath = path.join(tempDir, 'docs-wiki', 'search-index.json');
  const themeCssPath = path.join(tempDir, 'docs-wiki', 'public', 'docs-wiki.css');
  const moduleIndexPath = path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'index.md');
  const workspaceIndexPath = path.join(tempDir, 'docs-wiki', 'workspaces', 'index.md');
  const workspaceRootPath = path.join(tempDir, 'docs-wiki', 'workspaces', 'root.md');
  const rootModulePath = path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'root.md');
  const srcModulePath = path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'src.md');
  const nestedModulePath = path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'src', 'utils.md');
  const legacyModulePath = path.join(tempDir, 'docs-wiki', 'modules', 'src.md');
  const filePagePath = path.join(tempDir, 'docs-wiki', 'reference', 'files', 'src', 'index.ts.md');
  const nestedFilePagePath = path.join(tempDir, 'docs-wiki', 'reference', 'files', 'src', 'utils', 'format.ts.md');
  const legacyFilePagePath = path.join(tempDir, 'docs-wiki', 'files', 'src', 'index.ts.md');

  const [summaryMarkdown, indexMarkdown, featureIndexMarkdown, referenceIndexMarkdown, designIndexMarkdown, basicDesignMarkdown, detailDesignMarkdown, flowCatalogMarkdown, vitePressConfigText, vitePressThemeText, schemaText, searchIndexText, themeCssText, moduleIndexMarkdown, workspaceIndexMarkdown, workspaceRootMarkdown, rootModuleMarkdown, srcModuleMarkdown, nestedModuleMarkdown, legacyModuleMarkdown, fileMarkdown, nestedFileMarkdown, legacyFileMarkdown] = await Promise.all([
    fs.readFile(summaryPath, 'utf8'),
    fs.readFile(indexPath, 'utf8'),
    fs.readFile(featureIndexPath, 'utf8'),
    fs.readFile(referenceIndexPath, 'utf8'),
    fs.readFile(designIndexPath, 'utf8'),
    fs.readFile(basicDesignPath, 'utf8'),
    fs.readFile(detailDesignPath, 'utf8'),
    fs.readFile(flowCatalogPath, 'utf8'),
    fs.readFile(vitePressConfigPath, 'utf8'),
    fs.readFile(vitePressThemePath, 'utf8'),
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(searchIndexPath, 'utf8'),
    fs.readFile(themeCssPath, 'utf8'),
    fs.readFile(moduleIndexPath, 'utf8'),
    fs.readFile(workspaceIndexPath, 'utf8'),
    fs.readFile(workspaceRootPath, 'utf8'),
    fs.readFile(rootModulePath, 'utf8'),
    fs.readFile(srcModulePath, 'utf8'),
    fs.readFile(nestedModulePath, 'utf8'),
    fs.readFile(legacyModulePath, 'utf8'),
    fs.readFile(filePagePath, 'utf8'),
    fs.readFile(nestedFilePagePath, 'utf8'),
    fs.readFile(legacyFilePagePath, 'utf8'),
  ]);
  const schema = JSON.parse(schemaText);
  const searchIndex = JSON.parse(searchIndexText);

  assert.match(summaryMarkdown, /^---\n/);
  assert.match(summaryMarkdown, /Project Overview/);
  assert.match(summaryMarkdown, /Basic Design/);
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
  assert.match(featureIndexMarkdown, /# Feature Catalog/);
  assert.match(featureIndexMarkdown, /## Features/);
  assert.match(referenceIndexMarkdown, /# Reference Index/);
  assert.match(vitePressConfigText, /transformPageData/);
  assert.match(vitePressConfigText, /docs-wiki\.css/);
  assert.match(vitePressConfigText, /provider": "local"/);
  assert.match(vitePressConfigText, /"\/features\/"/);
  assert.match(vitePressConfigText, /"\/reference\/modules\/"/);
  assert.match(vitePressConfigText, /"\/reference\/files\/"/);
  assert.match(indexMarkdown, /## Snapshot/);
  assert.match(indexMarkdown, /## Feature Highlights/);
  assert.match(indexMarkdown, /Basic Design/);
  assert.match(indexMarkdown, /## Key Modules/);
  assert.match(indexMarkdown, /## Workspaces/);
  assert.match(designIndexMarkdown, /# Design Overview/);
  assert.match(basicDesignMarkdown, /# Basic Design/);
  assert.match(basicDesignMarkdown, /```mermaid/);
  assert.match(detailDesignMarkdown, /# Detail Design/);
  assert.match(flowCatalogMarkdown, /# Flow Catalog/);
  assert.match(flowCatalogMarkdown, /```mermaid/);
  assert.doesNotMatch(flowCatalogMarkdown, /sequenceDiagram/);
  assert.equal(schema.title, 'docs-wiki VitePress Frontmatter');
  assert.ok(schema.properties.docsWiki);
  assert.equal(searchIndex.project, 'fixture-app');
  assert.ok(searchIndex.entryCount >= 7);
  assert.ok(searchIndex.entries.some((entry) => entry.kind === 'feature-index' && entry.title === 'Feature Catalog'));
  assert.ok(searchIndex.entries.some((entry) => entry.kind === 'reference-index' && entry.title === 'Reference Index'));
  assert.ok(searchIndex.entries.some((entry) => entry.kind === 'design' && entry.title === 'Basic Design'));
  assert.ok(searchIndex.entries.some((entry) => entry.kind === 'file' && entry.title === 'src/index.ts'));
  assert.match(themeCssText, /--vp-c-brand-1/);
  assert.match(vitePressThemeText, /renderMermaidDiagrams/);
  assert.match(vitePressThemeText, /import\("mermaid"\)/);
  assert.match(themeCssText, /--vp-home-hero-name-background/);
  assert.match(themeCssText, /\.docs-wiki--overview \.VPFeature/);
  assert.match(themeCssText, /\.docs-wiki-mermaid/);
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
  assert.match(legacyModuleMarkdown, /kind: "reference-redirect"/);
  assert.match(legacyModuleMarkdown, /This page moved to \[Module src\]\(\.\.\/reference\/modules\/src\.md\)/);
  assert.match(legacyFileMarkdown, /kind: "reference-redirect"/);
  assert.match(legacyFileMarkdown, /This page moved to \[src\/index\.ts\]\(\.\.\/\.\.\/reference\/files\/src\/index\.ts\.md\)/);
  assert.ok(Array.isArray(manifest.features));
  assert.ok(manifest.features.length >= 1);
});

test('docs-wiki infers auth business flow and Mermaid diagrams from a focused module', async () => {
  const tempDir = await createAuthFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const { manifest, feature, featureMarkdown } = await readFeaturePage(tempDir, (entry) => entry.domain === 'auth');
  const moduleMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'src', 'auth.md'), 'utf8');
  const legacyModuleMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'modules', 'src', 'auth.md'), 'utf8');
  const flowCatalog = await fs.readFile(path.join(tempDir, 'docs-wiki', 'design', 'flows.md'), 'utf8');

  assert.match(featureMarkdown, new RegExp(`# ${feature.title}`));
  assert.match(featureMarkdown, /## Actors & User Stories/);
  assert.match(featureMarkdown, /## Business Flows/);
  assert.match(featureMarkdown, /## Related Files/);
  assert.match(featureMarkdown, /login-route\.ts/);
  assert.match(featureMarkdown, /auth-service\.ts/);
  assert.match(featureMarkdown, /auth-repository\.ts/);
  assert.doesNotMatch(featureMarkdown, /#### Sequence Diagram/);
  assert.match(moduleMarkdown, /## Business Capability/);
  assert.match(moduleMarkdown, /Authentication and access control|auth/i);
  assert.match(moduleMarkdown, /## Inferred Business Flows/);
  assert.match(moduleMarkdown, /Auth login|login/i);
  assert.match(moduleMarkdown, /```mermaid/);
  assert.doesNotMatch(moduleMarkdown, /#### Sequence Diagram/);
  assert.doesNotMatch(moduleMarkdown, /sequenceDiagram/);
  assert.match(moduleMarkdown, /login-route\.ts/);
  assert.match(moduleMarkdown, /auth-service\.ts/);
  assert.match(moduleMarkdown, /## Module Interactions/);
  assert.match(moduleMarkdown, /`src\/auth` -> `src\/shared`/);
  assert.match(legacyModuleMarkdown, /kind: "reference-redirect"/);
  assert.ok(manifest.features.some((entry) => entry.domain === 'auth'));
  assert.match(flowCatalog, /Auth login|login/i);
  assert.match(flowCatalog, /```mermaid/);
});

test('docs-wiki lets users choose flow, sequence, both, or no diagrams', async () => {
  const tempDir = await createAuthFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await fs.writeFile(
    path.join(tempDir, 'docs-wiki.config.json'),
    JSON.stringify({
      output: {
        flowDiagram: 'both',
      },
    }, null, 2),
    'utf8',
  );

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  let moduleMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'src', 'auth.md'), 'utf8');
  assert.match(moduleMarkdown, /#### Flow Diagram/);
  assert.match(moduleMarkdown, /#### Sequence Diagram/);

  await execFileAsync(process.execPath, [binPath, '--flow-diagram', 'sequence'], { cwd: tempDir });
  moduleMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'src', 'auth.md'), 'utf8');
  assert.doesNotMatch(moduleMarkdown, /#### Flow Diagram/);
  assert.match(moduleMarkdown, /#### Sequence Diagram/);

  await execFileAsync(process.execPath, [binPath, '--flow-diagram', 'none'], { cwd: tempDir });
  moduleMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'src', 'auth.md'), 'utf8');
  assert.doesNotMatch(moduleMarkdown, /#### Flow Diagram/);
  assert.doesNotMatch(moduleMarkdown, /#### Sequence Diagram/);
});

test('docs-wiki extracts API contracts into design, module, workspace, and file pages', async () => {
  const tempDir = await createApiFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const { featureMarkdown } = await readFeaturePage(tempDir, (entry) => entry.domain === 'auth');
  const apiContractsMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'design', 'api-contracts.md'), 'utf8');
  const moduleMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'modules', 'src', 'auth.md'), 'utf8');
  const workspaceMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'workspaces', 'root.md'), 'utf8');
  const fileMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'files', 'src', 'auth', 'login-route.ts.md'), 'utf8');
  const manifest = await readManifest(tempDir);

  assert.match(apiContractsMarkdown, /# API Contracts/);
  assert.match(apiContractsMarkdown, /- Auth: 1 endpoint/);
  assert.match(apiContractsMarkdown, /- Orders: 1 endpoint/);
  assert.match(apiContractsMarkdown, /## Auth/);
  assert.match(apiContractsMarkdown, /## Orders/);
  assert.match(apiContractsMarkdown, /POST \/login/);
  assert.match(apiContractsMarkdown, /GET \/orders\/:orderId/);
  assert.match(apiContractsMarkdown, /Body fields: `email`, `password`/);
  assert.match(apiContractsMarkdown, /Headers: `x-trace-id`/);
  assert.match(apiContractsMarkdown, /Path params: `orderId`/);
  assert.match(apiContractsMarkdown, /Query fields: `expand`/);
  assert.match(apiContractsMarkdown, /`400` json: `error`, `traceId`/);
  assert.match(apiContractsMarkdown, /`200` json: `token`, `traceId`, `userId`|`200` json: `token`, `userId`, `traceId`/);
  assert.match(featureMarkdown, /## API Contracts/);
  assert.match(moduleMarkdown, /## API Contracts/);
  assert.match(workspaceMarkdown, /## API Surface/);
  assert.match(fileMarkdown, /## API Contracts/);
  assert.ok(Array.isArray(manifest.api.endpoints));
  assert.ok(manifest.api.endpoints.some((endpoint) => endpoint.method === 'POST' && endpoint.path === '/login'));
});

test('docs-wiki infers zod and DTO schemas plus endpoint-level sequence flow', async () => {
  const tempDir = await createTypedApiFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await execFileAsync(process.execPath, [binPath, '--flow-diagram', 'both'], { cwd: tempDir });

  const apiContractsMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'design', 'api-contracts.md'), 'utf8');
  const fileMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'files', 'app', 'api', 'auth', 'login', 'route.ts.md'), 'utf8');
  const manifest = await readManifest(tempDir);

  assert.match(apiContractsMarkdown, /POST \/api\/auth\/login/);
  assert.match(apiContractsMarkdown, /Request schemas: `loginSchema` \(zod\) -> `email`, `password`/);
  assert.match(apiContractsMarkdown, /Response schemas: `LoginResponse` \(type\) -> `token`, `traceId`, `userId`|Response schemas: `LoginResponse` \(type\) -> `token`, `userId`, `traceId`|Response schemas: `LoginResponse` \(interface\) -> `token`, `traceId`, `userId`|Response schemas: `LoginResponse` \(interface\) -> `token`, `userId`, `traceId`/);
  assert.match(apiContractsMarkdown, /#### Endpoint Sequence Diagram/);
  assert.match(apiContractsMarkdown, /sequenceDiagram/);
  assert.match(apiContractsMarkdown, /auth-service\.ts/);
  assert.match(fileMarkdown, /## API Contracts/);
  assert.match(fileMarkdown, /#### Endpoint Sequence Diagram/);
  const endpoint = manifest.api.endpoints.find((entry) => entry.path === '/api/auth/login');
  assert.ok(endpoint);
  assert.ok(Array.isArray(endpoint.request.bodySchemas));
  assert.ok(endpoint.request.bodySchemas.some((schema) => schema.name === 'loginSchema'));
  assert.ok(Array.isArray(endpoint.responseSchemas));
  assert.ok(endpoint.responseSchemas.some((schema) => schema.name === 'LoginResponse'));
});

test('feature clustering groups auth files into one cross-file business feature', async () => {
  const tempDir = await createAuthFixture();
  const { scanResult } = await scanProject(tempDir, {
    outDir: 'docs-wiki',
    maxFiles: Infinity,
    include: [],
    ignore: [],
    incremental: false,
    cache: {
      scanKey: 'scan',
      aiKey: 'ai',
      renderKey: 'render',
    },
    settings: {},
  });

  const designed = enrichWithDesign(scanResult);
  const clustered = clusterFeatures(designed, {
    enabled: true,
    maxFilesPerFeature: 40,
    splitByAction: true,
    customDomains: {},
  });

  const authFeature = clustered.features.find((entry) => entry.domain === 'auth');
  assert.ok(authFeature, 'expected an auth feature cluster');
  assert.equal(authFeature.action, 'login');
  assert.ok(authFeature.files.some((file) => file.path === 'src/auth/login-route.ts'));
  assert.ok(authFeature.files.some((file) => file.path === 'src/auth/auth-service.ts'));
  assert.ok(authFeature.files.some((file) => file.path === 'src/auth/auth-repository.ts'));
  assert.ok(authFeature.files.some((file) => file.path === 'src/shared/session-store.ts'));
  assert.ok(authFeature.contextDiagram.includes('flowchart LR'));
  assert.ok(authFeature.componentDiagram.includes('flowchart LR'));
});

test('docs-wiki check exits clean when docs are fresh and fails after drift', async () => {
  const tempDir = await createFixture();
  const binPath = path.resolve(__dirname, '..', 'bin', 'docs-wiki.js');

  await execFileAsync(process.execPath, [binPath], { cwd: tempDir });

  const fresh = await execFileAsync(process.execPath, [binPath, '--root', tempDir, 'check']);
  assert.match(fresh.stdout, /Docs are up to date\./);

  await fs.writeFile(
    path.join(tempDir, 'src', 'index.ts'),
    [
      'export function add(a: number, b: number) {',
      '  return a + b + 1;',
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

  const stale = spawnSync(process.execPath, [binPath, '--root', tempDir, 'check'], {
    encoding: 'utf8',
  });
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /Docs are stale\./);
  assert.match(stale.stdout, /Changed files: src\/index\.ts/);
});

test('AI module summaries refine module business capability and flow naming', async () => {
  const tempDir = await createAuthFixture();
  const { scanResult } = await scanProject(tempDir, {
    outDir: 'docs-wiki',
    maxFiles: Infinity,
    include: [],
    ignore: [],
    incremental: false,
    cache: {
      scanKey: 'scan',
      aiKey: 'ai',
      renderKey: 'render',
    },
    settings: {},
  });

  const fileByPath = new Map(scanResult.files.map((file) => [file.relativePath, file]));
  const mockClient = {
    responses: {
      parse: async ({ input }) => {
        const prompt = input[1].content;

        if (prompt.startsWith('File: ')) {
          const match = prompt.match(/^File: (.+)$/m);
          const relativePath = match ? match[1] : '';
          const file = fileByPath.get(relativePath);
          return {
            output_parsed: {
              summary: `Summary for ${relativePath}`,
              responsibilities: [`Handle ${path.basename(relativePath)} responsibilities.`],
              usageNotes: [],
              symbols: (file ? file.symbols : []).map((symbol) => ({
                key: `${symbol.kind}:${symbol.name}:${symbol.startLine}`,
                summary: `${symbol.name} contributes to ${path.basename(relativePath)}.`,
              })),
            },
          };
        }

        if (prompt.startsWith('Module directory: src/auth')) {
          return {
            output_parsed: {
              capability: 'Handles user login and session issuance for the authentication domain.',
              basicDesign: 'The auth module exposes login entry points, validates credentials, and persists session state.',
              detailDesign: 'Requests enter through login-route, delegate to auth-service, then read user records and issue a session token.',
              actors: ['Anonymous end user'],
              entryPoints: ['src/auth/login-route.ts'],
              dataStores: ['User credential store', 'Session token store'],
              integrations: [],
              components: [
                { name: 'login-route.ts', responsibility: 'Accepts login requests and forwards them to the use-case layer.' },
                { name: 'auth-service.ts', responsibility: 'Validates credentials and coordinates session creation.' },
              ],
              keyFlows: [
                { name: 'User login', goal: 'Validate credentials and create a usable authenticated session.' },
              ],
            },
          };
        }

        if (prompt.startsWith('Module directory: ')) {
          const match = prompt.match(/^Module directory: (.+)$/m);
          const directory = match ? match[1] : '(root)';
          return {
            output_parsed: {
              capability: `${directory} support capability`,
              basicDesign: `${directory} support design`,
              detailDesign: `${directory} support detail`,
              actors: [],
              entryPoints: [],
              dataStores: [],
              integrations: [],
              components: [],
              keyFlows: [],
            },
          };
        }

        return {
          output_parsed: {
            overview: 'Project overview',
            architecture: ['Auth module coordinates login and session creation.'],
            keyModules: [
              { directory: 'src/auth', reason: 'Contains the login and session issuance flow.' },
            ],
          },
        };
      },
    },
  };

  const aiResult = await enrichWithAi(scanResult, {
    enabled: true,
    provider: 'openai',
    apiKey: 'test-key',
    dependencies: {
      resolvedProvider: {
        provider: 'openai',
        model: 'mock-model',
        client: mockClient,
      },
    },
  });

  const authModuleAi = aiResult.ai.modules.find((entry) => entry.directory === 'src/auth');
  assert.equal(authModuleAi.capability, 'Handles user login and session issuance for the authentication domain.');
  assert.equal(authModuleAi.keyFlows[0].name, 'User login');

  const designResult = enrichWithDesign(aiResult);
  const authModuleDesign = designResult.design.modules.find((entry) => entry.directory === 'src/auth');
  assert.equal(authModuleDesign.capability, 'Handles user login and session issuance for the authentication domain.');
  assert.equal(authModuleDesign.basicDesign, 'The auth module exposes login entry points, validates credentials, and persists session state.');
  assert.equal(authModuleDesign.flows[0].name, 'User login');
  assert.equal(authModuleDesign.flows[0].goal, 'Validate credentials and create a usable authenticated session.');
  assert.ok(authModuleDesign.components.some((entry) => entry.includes('login-route.ts')));
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
  const fileMarkdown = await fs.readFile(path.join(tempDir, 'docs-wiki', 'reference', 'files', 'src', 'index.ts.md'), 'utf8');
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
  const unchangedPagePath = path.join(tempDir, 'docs-wiki', 'reference', 'files', 'src', 'index.ts.md');
  const changedPagePath = path.join(tempDir, 'docs-wiki', 'reference', 'files', 'src', 'utils', 'format.ts.md');
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
