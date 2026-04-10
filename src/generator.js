const fs = require('node:fs/promises');
const path = require('node:path');
const { ensureGitignoreOutDir } = require('./gitignore');
const { DEFAULT_OUTPUT } = require('./config');
const { hashText } = require('./hash');
const {
  escapeAngleBracketsForVueMarkdown,
  markdownFencedInlineCode,
  createFence,
} = require('./markdownSafe');

const VITEPRESS_SCHEMA_VERSION = '1.0.0';
const VITEPRESS_SCHEMA_FILE = 'vitepress.schema.json';
const VITEPRESS_CONFIG_FILE = path.join('.vitepress', 'config.mjs');
const VITEPRESS_THEME_FILE = path.join('.vitepress', 'theme', 'index.mjs');
const SEARCH_INDEX_FILE = 'search-index.json';
const THEME_STYLES_FILE = path.join('public', 'docs-wiki.css');
const MERMAID_BROWSER_SCRIPT_FILE = path.join('public', 'mermaid.min.js');
const FEATURES_INDEX_FILE = path.join('features', 'index.md');
const DESIGN_INDEX_FILE = path.join('design', 'index.md');
const BASIC_DESIGN_FILE = path.join('design', 'basic-design.md');
const DETAIL_DESIGN_FILE = path.join('design', 'detail-design.md');
const FLOW_CATALOG_FILE = path.join('design', 'flows.md');
const API_CONTRACTS_FILE = path.join('design', 'api-contracts.md');
const REFERENCE_INDEX_FILE = path.join('reference', 'index.md');
const REFERENCE_MODULE_INDEX_FILE = path.join('reference', 'modules', 'index.md');
const REFERENCE_FILE_ROOT = path.join('reference', 'files');
const REFERENCE_MODULE_ROOT = path.join('reference', 'modules');
const DEFAULT_PAGE_CLASS_PREFIX = 'docs-wiki';
const THEME_STYLE_PRESETS = {
  clean: {
    brand1: '#0f766e',
    brand2: '#0a6a63',
    brand3: '#0b4f4a',
    brandSoft: 'rgba(15, 118, 110, 0.14)',
    panel: 'rgba(15, 118, 110, 0.08)',
    panelStrong: 'rgba(15, 118, 110, 0.14)',
    accent: '#c2410c',
    heroNameColor: 'transparent',
    heroNameBackground: 'linear-gradient(120deg, #0f766e 20%, #14b8a6 55%, #f97316 100%)',
    darkBrand1: '#38b2ac',
    darkBrand2: '#2c9892',
    darkBrand3: '#217a75',
    darkBrandSoft: 'rgba(56, 178, 172, 0.18)',
    darkPanel: 'rgba(56, 178, 172, 0.14)',
    darkPanelStrong: 'rgba(56, 178, 172, 0.2)',
    darkAccent: '#fb923c',
    darkHeroNameColor: 'transparent',
    darkHeroNameBackground: 'linear-gradient(120deg, #5eead4 15%, #38bdf8 60%, #fb923c 100%)',
  },
  warm: {
    brand1: '#c2410c',
    brand2: '#9a3412',
    brand3: '#7c2d12',
    brandSoft: 'rgba(194, 65, 12, 0.14)',
    panel: 'rgba(251, 146, 60, 0.12)',
    panelStrong: 'rgba(194, 65, 12, 0.18)',
    accent: '#7c3aed',
    heroNameColor: 'transparent',
    heroNameBackground: 'linear-gradient(120deg, #ea580c 10%, #fb923c 45%, #facc15 100%)',
    darkBrand1: '#fb923c',
    darkBrand2: '#f97316',
    darkBrand3: '#ea580c',
    darkBrandSoft: 'rgba(251, 146, 60, 0.18)',
    darkPanel: 'rgba(251, 146, 60, 0.14)',
    darkPanelStrong: 'rgba(251, 146, 60, 0.22)',
    darkAccent: '#c084fc',
    darkHeroNameColor: 'transparent',
    darkHeroNameBackground: 'linear-gradient(120deg, #fdba74 10%, #f59e0b 55%, #f472b6 100%)',
  },
  enterprise: {
    brand1: '#2563eb',
    brand2: '#1d4ed8',
    brand3: '#1e40af',
    brandSoft: 'rgba(37, 99, 235, 0.14)',
    panel: 'rgba(59, 130, 246, 0.09)',
    panelStrong: 'rgba(37, 99, 235, 0.16)',
    accent: '#0f766e',
    heroNameColor: 'transparent',
    heroNameBackground: 'linear-gradient(120deg, #1d4ed8 10%, #38bdf8 55%, #0f766e 100%)',
    darkBrand1: '#60a5fa',
    darkBrand2: '#3b82f6',
    darkBrand3: '#2563eb',
    darkBrandSoft: 'rgba(96, 165, 250, 0.2)',
    darkPanel: 'rgba(96, 165, 250, 0.14)',
    darkPanelStrong: 'rgba(96, 165, 250, 0.24)',
    darkAccent: '#2dd4bf',
    darkHeroNameColor: 'transparent',
    darkHeroNameBackground: 'linear-gradient(120deg, #bfdbfe 10%, #38bdf8 55%, #2dd4bf 100%)',
  },
};

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function encodeRouteSegment(segment) {
  const value = String(segment || '');
  const extension = path.posix.extname(value);
  const base = extension ? value.slice(0, -extension.length) : value;
  let safeBase = base
    .replace(/\[\.\.\.(.+?)\]/g, 'splat-$1')
    .replace(/\[(.+?)\]/g, 'param-$1')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!safeBase) {
    safeBase = 'page';
  }

  if (safeBase !== base) {
    safeBase = `${safeBase}--${hashText(value).slice(0, 8)}`;
  }

  return `${safeBase}${extension}`;
}

function encodeRoutePath(value) {
  return toPosixPath(String(value || ''))
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeRouteSegment(segment));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value, limit = 180) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1)}…`;
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function formatYamlScalar(value) {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  throw new Error(`Unsupported YAML scalar: ${typeof value}`);
}

function formatYamlValue(value, indent = 0) {
  const prefix = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}[]`;
    }

    return value.map((item) => {
      if (isScalar(item)) {
        return `${prefix}- ${formatYamlScalar(item)}`;
      }

      return `${prefix}-\n${formatYamlValue(item, indent + 2)}`;
    }).join('\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, nestedValue]) => nestedValue !== undefined);
    if (entries.length === 0) {
      return `${prefix}{}`;
    }

    return entries.map(([key, nestedValue]) => {
      if (isScalar(nestedValue)) {
        return `${prefix}${key}: ${formatYamlScalar(nestedValue)}`;
      }

      return `${prefix}${key}:\n${formatYamlValue(nestedValue, indent + 2)}`;
    }).join('\n');
  }

  return `${prefix}${formatYamlScalar(value)}`;
}

function serializeFrontmatter(frontmatter) {
  return `---\n${formatYamlValue(frontmatter)}\n---\n\n`;
}

function buildVitePressFrontmatter({
  title,
  description,
  kind,
  layout = 'doc',
  outline,
  scanResult,
  meta = {},
  extra = {},
}) {
  return {
    title,
    description: clipText(description),
    layout,
    outline,
    editLink: false,
    lastUpdated: false,
    pageClass: `${DEFAULT_PAGE_CLASS_PREFIX} ${DEFAULT_PAGE_CLASS_PREFIX}--${kind}`,
    ...extra,
    docsWiki: {
      schemaVersion: VITEPRESS_SCHEMA_VERSION,
      kind,
      project: scanResult.projectName,
      template: scanResult.settings && scanResult.settings.output ? scanResult.settings.output.template : 'detailed',
      themePreset: scanResult.settings && scanResult.settings.output ? scanResult.settings.output.themePreset : 'clean',
      generatedAt: scanResult.generatedAt,
      ...meta,
    },
  };
}

function withFrontmatter(frontmatter, markdown) {
  return `${serializeFrontmatter(frontmatter)}${markdown}`;
}

function toVitePressLink(markdownPath) {
  const normalized = toPosixPath(markdownPath);
  if (normalized === 'index.md') {
    return '/';
  }
  if (normalized.endsWith('/index.md')) {
    return `/${normalized.slice(0, -'index.md'.length)}`;
  }
  if (normalized.endsWith('.md')) {
    return `/${normalized.slice(0, -3)}`;
  }
  return `/${normalized}`;
}

function createSidebarGroup(text, items) {
  if (items.length === 0) {
    return null;
  }

  return {
    text,
    collapsed: items.length > 12,
    items,
  };
}

function buildFileSidebarGroups(scanResult) {
  const grouped = new Map();

  for (const file of scanResult.files) {
    const key = file.workspace && file.workspace.directory ? file.workspace.directory : file.directory || '(root)';
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push({
      text: file.relativePath,
      link: toVitePressLink(filePagePath(file.relativePath)),
    });
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([group, items]) => createSidebarGroup(group, items.sort((left, right) => left.text.localeCompare(right.text))))
    .filter(Boolean);
}

function buildFeatureSidebarItems(scanResult) {
  return (Array.isArray(scanResult.features) ? scanResult.features : [])
    .map((feature) => ({
      text: feature.title,
      link: toVitePressLink(featurePagePath(feature.slug)),
    }))
    .sort((left, right) => left.text.localeCompare(right.text));
}

function renderVitePressConfig(scanResult) {
  const config = {
    title: `${scanResult.projectName} Docs Wiki`,
    description: scanResult.package && scanResult.package.description
      ? scanResult.package.description
      : `Generated docs for ${scanResult.projectName}`,
    cleanUrls: true,
    ignoreDeadLinks: true,
    vite: {
      optimizeDeps: {
        include: [],
      },
    },
    themeConfig: {
      search: {
        provider: 'local',
      },
      nav: [
        { text: 'Overview', link: '/' },
        { text: 'Features', link: '/features/' },
        { text: 'Design', link: '/design/' },
        { text: 'Workspaces', link: '/workspaces/' },
        { text: 'Reference', link: '/reference/' },
      ],
      sidebar: {
        '/': [
          createSidebarGroup('Features', [
            { text: 'Feature Catalog', link: toVitePressLink(FEATURES_INDEX_FILE) },
            ...buildFeatureSidebarItems(scanResult),
          ]),
          createSidebarGroup('Overview', [
            { text: 'Project Overview', link: '/' },
            { text: 'Summary', link: toVitePressLink('SUMMARY.md') },
            { text: 'Reference Index', link: toVitePressLink(REFERENCE_INDEX_FILE) },
            { text: 'Design Overview', link: toVitePressLink(DESIGN_INDEX_FILE) },
            { text: 'Basic Design', link: toVitePressLink(BASIC_DESIGN_FILE) },
            { text: 'Detail Design', link: toVitePressLink(DETAIL_DESIGN_FILE) },
            { text: 'API Contracts', link: toVitePressLink(API_CONTRACTS_FILE) },
            { text: 'Flow Catalog', link: toVitePressLink(FLOW_CATALOG_FILE) },
            { text: 'Module Index', link: toVitePressLink(REFERENCE_MODULE_INDEX_FILE) },
            { text: 'Workspace Index', link: toVitePressLink(path.join('workspaces', 'index.md')) },
          ]),
        ].filter(Boolean),
        '/features/': [
          createSidebarGroup('Features', [
            { text: 'Feature Catalog', link: toVitePressLink(FEATURES_INDEX_FILE) },
            ...buildFeatureSidebarItems(scanResult),
          ]),
        ].filter(Boolean),
        '/design/': [
          createSidebarGroup('Design Docs', [
            { text: 'Design Overview', link: toVitePressLink(DESIGN_INDEX_FILE) },
            { text: 'Basic Design', link: toVitePressLink(BASIC_DESIGN_FILE) },
            { text: 'Detail Design', link: toVitePressLink(DETAIL_DESIGN_FILE) },
            { text: 'API Contracts', link: toVitePressLink(API_CONTRACTS_FILE) },
            { text: 'Flow Catalog', link: toVitePressLink(FLOW_CATALOG_FILE) },
          ]),
        ].filter(Boolean),
        '/reference/': [
          createSidebarGroup('Reference', [
            { text: 'Reference Index', link: toVitePressLink(REFERENCE_INDEX_FILE) },
            { text: 'Module Index', link: toVitePressLink(REFERENCE_MODULE_INDEX_FILE) },
          ]),
        ].filter(Boolean),
        '/reference/modules/': [
          createSidebarGroup('Modules', [
            { text: 'Module Index', link: toVitePressLink(REFERENCE_MODULE_INDEX_FILE) },
            ...getSortedModules(scanResult).map((module) => ({
              text: module.directory || '(root)',
              link: toVitePressLink(modulePagePath(module.directory)),
            })),
          ]),
        ].filter(Boolean),
        '/workspaces/': [
          createSidebarGroup('Workspaces', [
            { text: 'Workspace Index', link: toVitePressLink(path.join('workspaces', 'index.md')) },
            ...scanResult.workspaces.map((workspace) => ({
              text: workspace.name,
              link: toVitePressLink(workspacePagePath(workspace.directory)),
            })),
          ]),
        ].filter(Boolean),
        '/reference/files/': buildFileSidebarGroups(scanResult),
      },
      outline: {
        level: [2, 3],
      },
      docFooter: {
        prev: false,
        next: false,
      },
    },
  };

  const themeConfigBlock = JSON.stringify(config.themeConfig, null, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return [
    'export default {',
    `  title: ${JSON.stringify(config.title)},`,
    `  description: ${JSON.stringify(config.description)},`,
    `  cleanUrls: ${config.cleanUrls},`,
    `  ignoreDeadLinks: ${config.ignoreDeadLinks},`,
    '  vite: {',
    '    optimizeDeps: {',
    '      include: [],',
    '    },',
    '  },',
    '  transformPageData(pageData, { siteConfig }) {',
    '    pageData.frontmatter.head ??= [];',
    '    const href = `${siteConfig.site.base}docs-wiki.css`;',
    '    if (!pageData.frontmatter.head.some((entry) => Array.isArray(entry) && entry[0] === \'link\' && entry[1] && entry[1].href === href)) {',
    '      pageData.frontmatter.head.push([\'link\', { rel: \'stylesheet\', href }]);',
    '    }',
    '  },',
    '  themeConfig:',
    themeConfigBlock,
    '};',
    '',
  ].join('\n');
}

function renderThemeStyles(output) {
  const preset = THEME_STYLE_PRESETS[output.themePreset] || THEME_STYLE_PRESETS.clean;
  return [
    ':root {',
    `  --vp-c-brand-1: ${preset.brand1};`,
    `  --vp-c-brand-2: ${preset.brand2};`,
    `  --vp-c-brand-3: ${preset.brand3};`,
    `  --vp-c-brand-soft: ${preset.brandSoft};`,
    `  --docs-wiki-panel: ${preset.panel};`,
    `  --docs-wiki-panel-strong: ${preset.panelStrong};`,
    `  --docs-wiki-accent: ${preset.accent};`,
    `  --vp-home-hero-name-color: ${preset.heroNameColor};`,
    `  --vp-home-hero-name-background: ${preset.heroNameBackground};`,
    '}',
    '',
    '.dark {',
    `  --vp-c-brand-1: ${preset.darkBrand1};`,
    `  --vp-c-brand-2: ${preset.darkBrand2};`,
    `  --vp-c-brand-3: ${preset.darkBrand3};`,
    `  --vp-c-brand-soft: ${preset.darkBrandSoft};`,
    `  --docs-wiki-panel: ${preset.darkPanel};`,
    `  --docs-wiki-panel-strong: ${preset.darkPanelStrong};`,
    `  --docs-wiki-accent: ${preset.darkAccent};`,
    `  --vp-home-hero-name-color: ${preset.darkHeroNameColor};`,
    `  --vp-home-hero-name-background: ${preset.darkHeroNameBackground};`,
    '}',
    '',
    '.docs-wiki--overview .VPHome {',
    '  padding-bottom: 2rem;',
    '}',
    '',
    '.docs-wiki--overview .VPHero {',
    '  padding-top: 2rem;',
    '}',
    '',
    '.docs-wiki--overview .VPFeature {',
    '  border: 1px solid var(--docs-wiki-panel-strong);',
    '  background: linear-gradient(180deg, var(--docs-wiki-panel), transparent);',
    '  box-shadow: 0 18px 40px -28px var(--vp-c-brand-soft);',
    '}',
    '',
    '.docs-wiki--overview .VPFeature:hover {',
    '  border-color: var(--vp-c-brand-1);',
    '}',
    '',
    '.docs-wiki .vp-doc {',
    '  line-height: 1.72;',
    '}',
    '',
    '.docs-wiki .vp-doc h2 {',
    '  margin-top: 2rem;',
    '  padding-top: 1rem;',
    '  border-top: 1px solid var(--vp-c-divider);',
    '}',
    '',
    '.docs-wiki .vp-doc h2:first-of-type {',
    '  margin-top: 1.25rem;',
    '  padding-top: 0;',
    '  border-top: 0;',
    '}',
    '',
    '.docs-wiki .vp-doc h3 {',
    '  color: var(--vp-c-text-1);',
    '  letter-spacing: -0.01em;',
    '}',
    '',
    '.docs-wiki .vp-doc ul > li::marker {',
    '  color: var(--vp-c-brand-1);',
    '}',
    '',
    '.docs-wiki .vp-doc blockquote {',
    '  margin: 20px 0;',
    '  border-left: 4px solid var(--vp-c-brand-1);',
    '  background: var(--docs-wiki-panel);',
    '  border-radius: 12px;',
    '  padding: 14px 16px;',
    '}',
    '',
    '.docs-wiki .vp-doc table tr:hover {',
    '  background: var(--docs-wiki-panel);',
    '}',
    '',
    '.docs-wiki .vp-doc a {',
    '  text-decoration-thickness: 1.5px;',
    '}',
    '',
    '.docs-wiki .vp-doc a:hover {',
    '  color: var(--vp-c-brand-2);',
    '}',
    '',
    '.docs-wiki--overview .vp-doc h2,',
    '.docs-wiki--feature .vp-doc h2,',
    '.docs-wiki--module .vp-doc h2,',
    '.docs-wiki--workspace .vp-doc h2 {',
    '  display: inline-block;',
    '  padding: 0.4rem 0.8rem;',
    '  border: 1px solid var(--docs-wiki-panel-strong);',
    '  border-radius: 999px;',
    '  background: linear-gradient(180deg, var(--docs-wiki-panel), transparent);',
    '}',
    '',
    '.docs-wiki--file .vp-doc h3 {',
    '  position: relative;',
    '  padding-left: 1rem;',
    '}',
    '',
    '.docs-wiki--file .vp-doc h3::before {',
    '  content: "";',
    '  position: absolute;',
    '  left: 0;',
    '  top: 0.3em;',
    '  width: 0.3rem;',
    '  height: 1.1em;',
    '  border-radius: 999px;',
    '  background: linear-gradient(180deg, var(--vp-c-brand-1), var(--docs-wiki-accent));',
    '}',
    '',
    '.docs-wiki--summary .vp-doc ul,',
    '.docs-wiki--module-index .vp-doc ul,',
    '.docs-wiki--workspace-index .vp-doc ul {',
    '  display: grid;',
    '  gap: 0.5rem;',
    '  padding-left: 1.1rem;',
    '}',
    '',
    '.docs-wiki--summary .vp-doc li,',
    '.docs-wiki--module-index .vp-doc li,',
    '.docs-wiki--workspace-index .vp-doc li {',
    '  padding: 0.35rem 0;',
    '}',
    '',
    '.docs-wiki-mermaid {',
    '  margin: 1.25rem 0;',
    '  padding: 1rem;',
    '  border: 1px solid var(--docs-wiki-panel-strong);',
    '  border-radius: 18px;',
    '  background: linear-gradient(180deg, var(--docs-wiki-panel), transparent);',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 0.5rem;',
    '}',
    '',
    '.docs-wiki-mermaid:fullscreen {',
    '  margin: 0;',
    '  border-radius: 0;',
    '  max-height: 100vh;',
    '  box-sizing: border-box;',
    '}',
    '',
    '.docs-wiki-mermaid__toolbar {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 0.35rem;',
    '  justify-content: flex-end;',
    '  align-items: center;',
    '}',
    '',
    '.docs-wiki-mermaid__btn {',
    '  font: inherit;',
    '  font-size: 0.8rem;',
    '  line-height: 1.2;',
    '  padding: 0.3rem 0.55rem;',
    '  border-radius: 10px;',
    '  border: 1px solid var(--docs-wiki-panel-strong);',
    '  background: var(--vp-c-bg-soft);',
    '  color: var(--vp-c-text-1);',
    '  cursor: pointer;',
    '}',
    '',
    '.docs-wiki-mermaid__btn:hover {',
    '  border-color: var(--vp-c-brand-1);',
    '}',
    '',
    '.docs-wiki-mermaid__viewport {',
    '  overflow: auto;',
    '  max-height: min(72vh, 780px);',
    '  border-radius: 12px;',
    '  padding: 0.25rem;',
    '}',
    '',
    '.docs-wiki-mermaid:fullscreen .docs-wiki-mermaid__viewport {',
    '  flex: 1;',
    '  max-height: none;',
    '  min-height: 0;',
    '}',
    '',
    '.docs-wiki-mermaid__stage {',
    '  display: inline-block;',
    '  transition: transform 0.12s ease;',
    '}',
    '',
    '.docs-wiki-mermaid__stage svg {',
    '  max-width: none;',
    '  height: auto;',
    '  display: block;',
    '}',
    '',
    '.docs-wiki--design .vp-doc h3,',
    '.docs-wiki--design-index .vp-doc h3,',
    '.docs-wiki--feature .vp-doc h3,',
    '.docs-wiki--module .vp-doc h3,',
    '.docs-wiki--workspace .vp-doc h3 {',
    '  margin-top: 1.5rem;',
    '}',
    '',
  ].join('\n');
}

function renderVitePressThemeEntry() {
  return [
    "import DefaultTheme from 'vitepress/theme';",
    "import { nextTick, watch } from 'vue';",
    "import { useRoute } from 'vitepress';",
    '',
    'let mermaidInstance = null;',
    'let mermaidLoadPromise = null;',
    '',
    'async function loadMermaidInstance() {',
    '  if (mermaidInstance) {',
    '    return mermaidInstance;',
    '  }',
    '',
    '  if (typeof window === "undefined" || typeof document === "undefined") {',
    '    return null;',
    '  }',
    '',
    '  if (!mermaidLoadPromise) {',
    '    mermaidLoadPromise = new Promise((resolve, reject) => {',
    '      if (window.mermaid) {',
    '        resolve(window.mermaid);',
    '        return;',
    '      }',
    '',
    '      const base = (window.__VP_SITE_DATA__ && window.__VP_SITE_DATA__.base) ? window.__VP_SITE_DATA__.base : "/";',
    '      const normalizedBase = base.endsWith("/") ? base : `${base}/`;',
    '      const script = document.createElement("script");',
    '      script.src = `${normalizedBase}mermaid.min.js`;',
    '      script.async = true;',
    '      script.onload = () => {',
    '        if (window.mermaid) {',
    '          resolve(window.mermaid);',
    '          return;',
    '        }',
    '        reject(new Error("Mermaid loaded without exposing window.mermaid."));',
    '      };',
    '      script.onerror = () => reject(new Error(`Failed to load ${script.src}`));',
    '      document.head.appendChild(script);',
    '    }).then((instance) => {',
    '      mermaidInstance = instance;',
    '      mermaidInstance.initialize({',
    '        startOnLoad: false,',
    '        securityLevel: "loose",',
    '        theme: document.documentElement.classList.contains("dark") ? "dark" : "default",',
    '        themeVariables: { fontSize: "15px", fontFamily: "ui-sans-serif, system-ui, sans-serif" },',
    '      });',
    '      return mermaidInstance;',
    '    });',
    '  }',
    '',
    '  return mermaidLoadPromise;',
    '}',
    '',
    'async function renderMermaidDiagrams() {',
    '  if (typeof document === "undefined" || typeof window === "undefined") {',
    '    return;',
    '  }',
    '',
    '  const mermaid = await loadMermaidInstance();',
    '  if (!mermaid) {',
    '    return;',
    '  }',
    '',
    '  const isDark = document.documentElement.classList.contains("dark");',
    '  try {',
    '    mermaid.initialize({',
    '      startOnLoad: false,',
    '      securityLevel: "loose",',
    '      theme: isDark ? "dark" : "default",',
    '      themeVariables: { fontSize: "15px", fontFamily: "ui-sans-serif, system-ui, sans-serif" },',
    '    });',
    '  } catch (_e) {',
    '    /* ignore */',
    '  }',
    '',
    '  const candidates = [];',
    '  document.querySelectorAll(\'div[class*="language-mermaid"]\').forEach((container) => {',
    '    const code = container.querySelector("pre code");',
    '    if (code) {',
    '      candidates.push({ container, code });',
    '    }',
    '  });',
    '  document.querySelectorAll("pre code.language-mermaid").forEach((code) => {',
    '    const pre = code.parentElement;',
    '    if (!pre) {',
    '      return;',
    '    }',
    '    const parent = pre.parentElement;',
    '    if (parent && parent.classList && [...parent.classList].some((c) => c.includes("language-mermaid"))) {',
    '      return;',
    '    }',
    '    candidates.push({ container: pre, code, legacy: true });',
    '  });',
    '',
    '  for (const { container, code, legacy } of candidates) {',
    '    const markTarget = legacy ? code.parentElement : container;',
    '    if (!markTarget || markTarget.dataset.docsWikiMermaid === "rendered" || markTarget.dataset.docsWikiMermaid === "error") {',
    '      continue;',
    '    }',
    '',
    '    const source = (code.textContent || "").replace(/\\u00a0/g, " ").trim();',
    '    if (!source) {',
    '      continue;',
    '    }',
    '',
    '    markTarget.dataset.docsWikiMermaid = "rendered";',
    '    const wrapper = document.createElement("div");',
    '    wrapper.className = "docs-wiki-mermaid";',
    '    const id = `docs-wiki-mermaid-${Math.random().toString(36).slice(2)}`;',
    '',
    '    try {',
    '      const out = await mermaid.render(id, source);',
    '      const svg = typeof out === "string" ? out : out.svg;',
    '      const bindFunctions = typeof out === "string" ? null : out.bindFunctions;',
    '      const stage = document.createElement("div");',
    '      stage.className = "docs-wiki-mermaid__stage";',
    '      stage.innerHTML = svg;',
    '      bindFunctions?.(stage);',
    '      const viewport = document.createElement("div");',
    '      viewport.className = "docs-wiki-mermaid__viewport";',
    '      viewport.appendChild(stage);',
    '      const toolbar = document.createElement("div");',
    '      toolbar.className = "docs-wiki-mermaid__toolbar";',
    '      const mkBtn = (label, title, action) => {',
    '        const b = document.createElement("button");',
    '        b.type = "button";',
    '        b.textContent = label;',
    '        b.title = title;',
    '        b.className = "docs-wiki-mermaid__btn";',
    '        b.addEventListener("click", action);',
    '        return b;',
    '      };',
    '      const defaultScale = 1.2;',
    '      let scale = defaultScale;',
    '      const applyScale = () => {',
    '        stage.style.transform = `scale(${scale})`;',
    '        stage.style.transformOrigin = "top left";',
    '      };',
    '      applyScale();',
    '      toolbar.appendChild(mkBtn("−", "Zoom out", () => {',
    '        scale = Math.max(0.45, scale - 0.2);',
    '        applyScale();',
    '      }));',
    '      toolbar.appendChild(mkBtn("+", "Zoom in", () => {',
    '        scale = Math.min(5, scale + 0.2);',
    '        applyScale();',
    '      }));',
    '      toolbar.appendChild(mkBtn("Reset", "Reset zoom", () => {',
    '        scale = defaultScale;',
    '        applyScale();',
    '      }));',
    '      toolbar.appendChild(mkBtn("⛶", "Fullscreen", () => {',
    '        if (document.fullscreenElement === wrapper) {',
    '          document.exitFullscreen?.().catch(() => {});',
    '        } else {',
    '          wrapper.requestFullscreen?.().catch(() => {});',
    '        }',
    '      }));',
    '      wrapper.appendChild(toolbar);',
    '      wrapper.appendChild(viewport);',
    '      viewport.addEventListener("wheel", (ev) => {',
    '        if (!ev.ctrlKey && !ev.metaKey) {',
    '          return;',
    '        }',
    '        ev.preventDefault();',
    '        const delta = ev.deltaY > 0 ? -0.12 : 0.12;',
    '        scale = Math.min(5, Math.max(0.45, scale + delta));',
    '        applyScale();',
    '      }, { passive: false });',
    '      if (legacy) {',
    '        markTarget.replaceWith(wrapper);',
    '      } else {',
    '        container.replaceWith(wrapper);',
    '      }',
    '    } catch (error) {',
    '      markTarget.dataset.docsWikiMermaid = "error";',
    '      console.error("[docs-wiki] Failed to render Mermaid diagram", error);',
    '    }',
    '  }',
    '}',
    '',
    'export default {',
    '  extends: DefaultTheme,',
    '  setup() {',
    '    const route = useRoute();',
    '',
    '    const scheduleRender = () => {',
    '      nextTick(() => {',
    '        const run = () => renderMermaidDiagrams();',
    '        if (typeof requestAnimationFrame === "function") {',
    '          requestAnimationFrame(() => setTimeout(run, 0));',
    '        } else {',
    '          setTimeout(run, 0);',
    '        }',
    '      });',
    '    };',
    '    watch(() => route.path, scheduleRender, { flush: "post" });',
    '    scheduleRender();',
    '  },',
    '};',
    '',
  ].join('\n');
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function buildSearchEntry({ id, kind, title, url, summary, content, keywords = [], meta = {} }) {
  return {
    id,
    kind,
    title,
    url,
    summary: clipText(summary, 220),
    keywords: uniqueSorted(keywords),
    content: normalizeText(content),
    meta,
  };
}

function getDesignModel(scanResult) {
  return scanResult.design || { project: { basicDesign: {}, detailDesign: {}, flows: [] }, modules: [], workspaces: [] };
}

function getModuleDesign(scanResult, directory) {
  return getDesignModel(scanResult).modules.find((entry) => entry.directory === directory) || null;
}

function getWorkspaceDesign(scanResult, directory) {
  return getDesignModel(scanResult).workspaces.find((entry) => entry.directory === directory) || null;
}

function getApiEndpointDesign(scanResult, endpointId) {
  const api = getDesignModel(scanResult).api;
  if (!api || !Array.isArray(api.endpoints)) {
    return null;
  }
  return api.endpoints.find((entry) => entry.id === endpointId) || null;
}

function renderMermaidDiagram(diagram) {
  return createFence(String(diagram || '').trim(), 'mermaid');
}

function renderStringList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return ['- n/a'];
  }
  return items.map((item) => `- ${escapeAngleBracketsForVueMarkdown(String(item))}`);
}

function renderModuleInteractionDiagram(interactions) {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    return '';
  }

  const lines = ['flowchart LR'];
  const nodes = new Set();
  for (const edge of interactions) {
    nodes.add(edge.from || 'root');
    nodes.add(edge.to || 'root');
  }
  for (const directory of Array.from(nodes).sort((left, right) => left.localeCompare(right))) {
    const nodeId = String(directory || 'root').replace(/[^a-zA-Z0-9_]/g, '_');
    const label = (directory || '(root)').replace(/"/g, '\'');
    lines.push(`  ${nodeId}["${label}"]`);
  }
  for (const edge of interactions) {
    const fromId = String(edge.from || 'root').replace(/[^a-zA-Z0-9_]/g, '_');
    const toId = String(edge.to || 'root').replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  ${fromId} -->|\"${edge.weight || 1} dep\"| ${toId}`);
  }
  return renderMermaidDiagram(lines.join('\n'));
}

function renderSearchIndex(scanResult, output) {
  const entries = [];
  const design = getDesignModel(scanResult);

  entries.push(buildSearchEntry({
    id: 'page:index',
    kind: 'overview',
    title: `${scanResult.projectName} Docs Wiki`,
    url: '/',
    summary: scanResult.package && scanResult.package.description
      ? scanResult.package.description
      : `Overview for ${scanResult.projectName}.`,
    content: [
      scanResult.package && scanResult.package.description,
      output.includeAiSections && scanResult.ai && scanResult.ai.project ? scanResult.ai.project.overview : '',
      scanResult.directories.map((module) => module.directory || '(root)').join(' '),
    ].join(' '),
    keywords: ['overview', 'index', scanResult.projectName],
    meta: {
      fileCount: scanResult.totals.filesParsed,
      symbolCount: scanResult.totals.symbols,
    },
  }));

  entries.push(buildSearchEntry({
    id: 'page:summary',
    kind: 'summary',
    title: 'Summary',
    url: toVitePressLink('SUMMARY.md'),
    summary: `Top-level wiki navigation for ${scanResult.projectName}.`,
    content: getSortedModules(scanResult).map((module) => module.directory || '(root)').join(' '),
    keywords: ['summary', 'navigation', scanResult.projectName],
  }));

  entries.push(buildSearchEntry({
    id: 'page:features',
    kind: 'feature-index',
    title: 'Feature Catalog',
    url: toVitePressLink(FEATURES_INDEX_FILE),
    summary: `Feature-oriented documentation for ${scanResult.projectName}.`,
    content: getFeatures(scanResult).map((feature) => `${feature.title} ${feature.summary}`).join(' '),
    keywords: ['feature', 'catalog', 'user story', 'business flow', scanResult.projectName],
  }));

  for (const feature of getFeatures(scanResult)) {
    entries.push(buildSearchEntry({
      id: `feature:${feature.id}`,
      kind: 'feature',
      title: feature.title,
      url: toVitePressLink(featurePagePath(feature.slug)),
      summary: feature.ai && feature.ai.overview ? feature.ai.overview : feature.summary,
      content: [
        feature.summary,
        feature.ai && feature.ai.overview ? feature.ai.overview : '',
        ...(feature.actors || []),
        ...(feature.userStories || []).map((story) => `${story.role} ${story.goal} ${story.benefit}`),
        ...(feature.files || []).map((file) => `${file.path} ${file.role} ${file.reason}`),
        ...(feature.apiContracts || []).map((endpoint) => `${endpoint.method} ${endpoint.path}`),
        ...(feature.flows || []).map((flow) => `${flow.name} ${flow.goal}`),
      ].join(' '),
      keywords: [
        'feature',
        feature.title,
        feature.domain,
        ...(feature.actors || []),
        ...(feature.files || []).map((file) => file.path),
      ],
      meta: {
        domain: feature.domain,
        action: feature.action || '',
        fileCount: feature.files.length,
      },
    }));
  }

  entries.push(buildSearchEntry({
    id: 'page:design-index',
    kind: 'design',
    title: 'Design Overview',
    url: toVitePressLink(DESIGN_INDEX_FILE),
    summary: design.project.basicDesign.summary || `Design overview for ${scanResult.projectName}.`,
    content: [
      design.project.basicDesign.summary,
      ...(design.project.basicDesign.actors || []),
      ...(design.project.flows || []).map((flow) => flow.name),
    ].join(' '),
    keywords: ['design', 'overview', 'architecture', scanResult.projectName],
  }));

  entries.push(buildSearchEntry({
    id: 'page:basic-design',
    kind: 'design',
    title: 'Basic Design',
    url: toVitePressLink(BASIC_DESIGN_FILE),
    summary: design.project.basicDesign.summary || `Basic design for ${scanResult.projectName}.`,
    content: [
      design.project.basicDesign.summary,
      ...(design.project.basicDesign.actors || []),
      ...(design.project.basicDesign.capabilities || []).map((item) => `${item.title} ${item.summary}`),
    ].join(' '),
    keywords: ['basic design', 'business capability', 'context', scanResult.projectName],
  }));

  entries.push(buildSearchEntry({
    id: 'page:detail-design',
    kind: 'design',
    title: 'Detail Design',
    url: toVitePressLink(DETAIL_DESIGN_FILE),
    summary: design.project.detailDesign.summary || `Detail design for ${scanResult.projectName}.`,
    content: [
      design.project.detailDesign.summary,
      ...(design.project.detailDesign.runtimeLayers || []),
      ...(design.project.detailDesign.modules || []).map((item) => `${item.title} ${item.detailDesign}`),
    ].join(' '),
    keywords: ['detail design', 'runtime', 'components', scanResult.projectName],
  }));

  entries.push(buildSearchEntry({
    id: 'page:api-contracts',
    kind: 'api',
    title: 'API Contracts',
    url: toVitePressLink(API_CONTRACTS_FILE),
    summary: `Inferred HTTP endpoint contracts for ${scanResult.projectName}.`,
    content: getApiContracts(scanResult)
      .map((endpoint) => `${endpoint.group || 'general'} ${endpoint.method} ${endpoint.path} ${endpoint.file} ${requestContractSummary(endpoint)} ${responseContractSummary(endpoint)}`)
      .join(' '),
    keywords: ['api', 'contract', 'http', 'endpoint', scanResult.projectName, ...getApiGroups(scanResult).map((group) => group.group)],
  }));

  entries.push(buildSearchEntry({
    id: 'page:flows',
    kind: 'flow',
    title: 'Flow Catalog',
    url: toVitePressLink(FLOW_CATALOG_FILE),
    summary: `Inferred business and request flows for ${scanResult.projectName}.`,
    content: (design.project.flows || []).map((flow) => `${flow.name} ${flow.goal}`).join(' '),
    keywords: ['flow', 'diagram', 'business flow', scanResult.projectName],
  }));

  entries.push(buildSearchEntry({
    id: 'page:reference-index',
    kind: 'reference-index',
    title: 'Reference Index',
    url: toVitePressLink(REFERENCE_INDEX_FILE),
    summary: `Reference pages for modules and files in ${scanResult.projectName}.`,
    content: [
      ...(scanResult.directories || []).map((module) => module.directory || '(root)'),
      ...(scanResult.files || []).map((file) => file.relativePath),
    ].join(' '),
    keywords: ['reference', 'module index', 'file reference', scanResult.projectName],
  }));

  for (const module of scanResult.directories) {
    const workspace = getWorkspaceForModule(scanResult, module.directory);
    const moduleDesign = getModuleDesign(scanResult, module.directory);
    entries.push(buildSearchEntry({
      id: `module:${module.directory || 'root'}`,
      kind: 'module',
      title: `Module ${module.directory || '(root)'}`,
      url: toVitePressLink(modulePagePath(module.directory)),
      summary: `${formatCount(module.fileCount, 'file')} and ${formatCount(module.symbolCount, 'symbol')} under ${module.directory || 'the project root'}.`,
      content: [
        module.directory,
        module.directFiles.join(' '),
        module.languages.join(' '),
        output.includeAiSections ? getKeyModuleReason(scanResult, module.directory) : '',
        getModuleApiContracts(scanResult, module.directory).map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(' '),
        moduleDesign ? `${moduleDesign.capability} ${moduleDesign.basicDesign} ${moduleDesign.flows.map((flow) => flow.name).join(' ')}` : '',
      ].join(' '),
      keywords: ['module', module.directory || 'root', ...(workspace ? [workspace.name] : []), ...module.languages],
      meta: {
        directory: module.directory,
        workspace: workspace ? workspace.directory : '',
      },
    }));
  }

  for (const workspace of scanResult.workspaces) {
    const workspaceDesign = getWorkspaceDesign(scanResult, workspace.directory);
    entries.push(buildSearchEntry({
      id: `workspace:${workspace.directory || 'root'}`,
      kind: 'workspace',
      title: `Workspace ${workspace.name}`,
      url: toVitePressLink(workspacePagePath(workspace.directory)),
      summary: `${formatCount(workspace.fileCount, 'file')} and ${formatCount(workspace.symbolCount, 'symbol')} in workspace ${workspace.name}.`,
      content: [
        workspace.description,
        workspace.files.join(' '),
        workspace.modules.join(' '),
        workspace.languages.join(' '),
        getWorkspaceApiContracts(scanResult, workspace.directory).map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(' '),
        workspaceDesign ? `${workspaceDesign.summary} ${workspaceDesign.topFlows.map((flow) => flow.name).join(' ')}` : '',
      ].join(' '),
      keywords: ['workspace', workspace.name, workspace.directory || 'root', ...workspace.languages],
      meta: {
        directory: workspace.directory,
        packageFile: workspace.relativePackagePath,
      },
    }));
  }

  for (const file of scanResult.files) {
    const publicSymbols = getPublicSymbols(file).map((symbol) => symbol.name);
    entries.push(buildSearchEntry({
      id: `file:${file.relativePath}`,
      kind: 'file',
      title: file.relativePath,
      url: toVitePressLink(filePagePath(file.relativePath)),
      summary: output.includeAiSections && file.ai && file.ai.summary
        ? file.ai.summary
        : `${file.language} source file with ${formatCount(file.symbols.length, 'symbol')}.`,
      content: [
        file.relativePath,
        file.language,
        file.symbols.map((symbol) => `${symbol.kind} ${symbol.name} ${symbol.signature}`).join(' '),
        Array.isArray(file.apiContracts) ? file.apiContracts.map((endpoint) => `${endpoint.method} ${endpoint.path} ${requestContractSummary(endpoint)} ${responseContractSummary(endpoint)}`).join(' ') : '',
        output.includeAiSections && file.ai && Array.isArray(file.ai.responsibilities) ? file.ai.responsibilities.join(' ') : '',
      ].join(' '),
      keywords: [
        'file',
        file.relativePath,
        file.language,
        ...publicSymbols,
        ...file.symbols.map((symbol) => symbol.name),
      ],
      meta: {
        module: file.directory,
        workspace: file.workspace ? file.workspace.directory : '',
        symbolCount: file.symbols.length,
      },
    }));
  }

  return JSON.stringify({
    schemaVersion: '1.0.0',
    generatedAt: scanResult.generatedAt,
    project: scanResult.projectName,
    entryCount: entries.length,
    entries,
  }, null, 2);
}

function featurePagePath(slug) {
  return path.join('features', `${encodeRouteSegment(slug)}.md`);
}

function legacyFilePagePath(relativePath) {
  const encoded = encodeRoutePath(relativePath);
  if (encoded.length === 0) {
    return path.join('files', 'root.md');
  }
  const fileName = encoded[encoded.length - 1];
  return path.join('files', ...encoded.slice(0, -1), `${fileName}.md`);
}

function filePagePath(relativePath) {
  const encoded = encodeRoutePath(relativePath);
  if (encoded.length === 0) {
    return path.join(REFERENCE_FILE_ROOT, 'root.md');
  }
  const fileName = encoded[encoded.length - 1];
  return path.join(REFERENCE_FILE_ROOT, ...encoded.slice(0, -1), `${fileName}.md`);
}

function legacyModulePagePath(directory) {
  if (!directory) {
    return path.join('modules', 'root.md');
  }

  const encoded = encodeRoutePath(directory);
  const name = encoded[encoded.length - 1];
  return path.join('modules', ...encoded.slice(0, -1), `${name}.md`);
}

function modulePagePath(directory) {
  if (!directory) {
    return path.join(REFERENCE_MODULE_ROOT, 'root.md');
  }

  const encoded = encodeRoutePath(directory);
  const name = encoded[encoded.length - 1];
  return path.join(REFERENCE_MODULE_ROOT, ...encoded.slice(0, -1), `${name}.md`);
}

function workspacePagePath(directory) {
  if (!directory) {
    return path.join('workspaces', 'root.md');
  }

  const encoded = encodeRoutePath(directory);
  const name = encoded[encoded.length - 1];
  return path.join('workspaces', ...encoded.slice(0, -1), `${name}.md`);
}

function designPageTitle(filePath) {
  if (filePath === BASIC_DESIGN_FILE) {
    return 'Basic Design';
  }
  if (filePath === DETAIL_DESIGN_FILE) {
    return 'Detail Design';
  }
  if (filePath === API_CONTRACTS_FILE) {
    return 'API Contracts';
  }
  if (filePath === FLOW_CATALOG_FILE) {
    return 'Flow Catalog';
  }
  return 'Design Overview';
}

function relativeLink(fromPath, toPath) {
  const fromDir = path.dirname(fromPath);
  return toPosixPath(path.relative(fromDir, toPath));
}

function formatCount(value, label) {
  return `${value} ${label}${value === 1 ? '' : 's'}`;
}

function getSortedModules(scanResult) {
  return scanResult.directories.slice().sort((left, right) => {
    if (left.directory === '') return -1;
    if (right.directory === '') return 1;
    if (right.symbolCount !== left.symbolCount) {
      return right.symbolCount - left.symbolCount;
    }
    if (right.fileCount !== left.fileCount) {
      return right.fileCount - left.fileCount;
    }
    return left.directory.localeCompare(right.directory);
  });
}

function getKeyModuleReason(scanResult, directory) {
  const modules = scanResult.ai && scanResult.ai.project && Array.isArray(scanResult.ai.project.keyModules)
    ? scanResult.ai.project.keyModules
    : [];
  const match = modules.find((entry) => entry.directory === directory);
  return match ? match.reason : null;
}

function getFileByPath(scanResult, relativePath) {
  return scanResult.files.find((file) => file.relativePath === relativePath) || null;
}

function getWorkspaceByDirectory(scanResult, directory) {
  return scanResult.workspaces.find((entry) => entry.directory === directory) || null;
}

function getWorkspaceForModule(scanResult, moduleDirectory) {
  const ordered = scanResult.workspaces.slice().sort((left, right) => right.directory.length - left.directory.length);
  return ordered.find((entry) => entry.directory === '' || moduleDirectory === entry.directory || moduleDirectory.startsWith(`${entry.directory}/`)) || ordered[0] || null;
}

function getFeatures(scanResult) {
  return Array.isArray(scanResult.features) ? scanResult.features : [];
}

function getFeaturesForFile(scanResult, relativePath) {
  return getFeatures(scanResult).filter((feature) => feature.files.some((file) => file.path === relativePath));
}

function getFeaturesForModule(scanResult, directory) {
  return getFeatures(scanResult).filter((feature) => feature.files.some((file) => {
    if (!directory) {
      return true;
    }
    return file.path.startsWith(`${directory}/`) || file.path === directory;
  }));
}

function getSymbolSummary(file, symbol) {
  if (!file.ai || !Array.isArray(file.ai.symbols)) {
    return '';
  }

  const key = `${symbol.kind}:${symbol.name}:${symbol.startLine}`;
  const match = file.ai.symbols.find((entry) => entry.key === key);
  return match ? match.summary : '';
}

function getPublicSymbols(file) {
  return file.symbols.filter((symbol) => symbol.exported);
}

function resolveOutputOptions(output) {
  return {
    template: output && typeof output.template === 'string' ? output.template : 'detailed',
    themePreset: output && typeof output.themePreset === 'string' ? output.themePreset : 'clean',
    flowDiagram: output && typeof output.flowDiagram === 'string' ? output.flowDiagram : 'flow',
    includeCodeBlocks: output && typeof output.includeCodeBlocks === 'boolean' ? output.includeCodeBlocks : DEFAULT_OUTPUT.includeCodeBlocks,
    includeAiSections: output && typeof output.includeAiSections === 'boolean' ? output.includeAiSections : DEFAULT_OUTPUT.includeAiSections,
    includeUsageNotes: output && typeof output.includeUsageNotes === 'boolean' ? output.includeUsageNotes : DEFAULT_OUTPUT.includeUsageNotes,
    highlightPublicApi: output && typeof output.highlightPublicApi === 'boolean' ? output.highlightPublicApi : DEFAULT_OUTPUT.highlightPublicApi,
  };
}

function shouldRenderFlowchart(output) {
  return ['flow', 'both'].includes(output.flowDiagram);
}

function shouldRenderSequence(output) {
  return ['sequence', 'both'].includes(output.flowDiagram);
}

function getApiContracts(scanResult) {
  return scanResult.api && Array.isArray(scanResult.api.endpoints) ? scanResult.api.endpoints : [];
}

function getApiGroups(scanResult) {
  return scanResult.api && Array.isArray(scanResult.api.groups) ? scanResult.api.groups : [];
}

function getModuleApiContracts(scanResult, directory) {
  return getApiContracts(scanResult).filter((endpoint) => (
    directory === ''
      ? true
      : endpoint.directory === directory || endpoint.directory.startsWith(`${directory}/`)
  ));
}

function getWorkspaceApiContracts(scanResult, directory) {
  return getApiContracts(scanResult).filter((endpoint) => (endpoint.workspace || '') === directory);
}

function requestContractSummary(endpoint) {
  const request = endpoint.request || {};
  return [
    request.bodyKeys && request.bodyKeys.length > 0 ? `body ${request.bodyKeys.join(', ')}` : '',
    request.queryKeys && request.queryKeys.length > 0 ? `query ${request.queryKeys.join(', ')}` : '',
    request.paramKeys && request.paramKeys.length > 0 ? `params ${request.paramKeys.join(', ')}` : '',
    request.headerKeys && request.headerKeys.length > 0 ? `headers ${request.headerKeys.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
}

function responseContractSummary(endpoint) {
  const responses = Array.isArray(endpoint.responses) ? endpoint.responses : [];
  return responses
    .map((response) => `${response.status}${response.bodyKeys && response.bodyKeys.length > 0 ? `: ${response.bodyKeys.join(', ')}` : ''}`)
    .join(' · ');
}

function renderApiRequestSection(lines, endpoint, heading = '#### Request Contract') {
  const request = endpoint.request || {};
  lines.push('', heading, '');
  if (
    (!request.bodyKeys || request.bodyKeys.length === 0)
    && (!request.queryKeys || request.queryKeys.length === 0)
    && (!request.paramKeys || request.paramKeys.length === 0)
    && (!request.headerKeys || request.headerKeys.length === 0)
    && (!request.bodySchemas || request.bodySchemas.length === 0)
  ) {
    lines.push('No request shape could be inferred from the handler code.');
    return;
  }

  if (request.bodyKeys && request.bodyKeys.length > 0) {
    lines.push(`- Body fields: ${request.bodyKeys.map((item) => markdownFencedInlineCode(item)).join(', ')}`);
  }
  if (request.queryKeys && request.queryKeys.length > 0) {
    lines.push(`- Query fields: ${request.queryKeys.map((item) => markdownFencedInlineCode(item)).join(', ')}`);
  }
  if (request.paramKeys && request.paramKeys.length > 0) {
    lines.push(`- Path params: ${request.paramKeys.map((item) => markdownFencedInlineCode(item)).join(', ')}`);
  }
  if (request.headerKeys && request.headerKeys.length > 0) {
    lines.push(`- Headers: ${request.headerKeys.map((item) => markdownFencedInlineCode(item)).join(', ')}`);
  }
  if (request.bodySchemas && request.bodySchemas.length > 0) {
    lines.push(`- Request schemas: ${request.bodySchemas.map((schema) => (
      `${markdownFencedInlineCode(schema.name)} (${schema.source})${schema.fields && schema.fields.length > 0 ? ` -> ${schema.fields.map((field) => markdownFencedInlineCode(field)).join(', ')}` : ''}`
    )).join('; ')}`);
  }
}

function renderApiResponseSection(lines, endpoint, heading = '#### Response Contract') {
  const responses = Array.isArray(endpoint.responses) ? endpoint.responses : [];
  lines.push('', heading, '');
  if (responses.length === 0 && (!endpoint.responseSchemas || endpoint.responseSchemas.length === 0)) {
    lines.push('No response contract could be inferred from the handler code.');
    return;
  }

  for (const response of responses) {
    const summary = response.bodyKeys && response.bodyKeys.length > 0
      ? response.bodyKeys.map((item) => markdownFencedInlineCode(item)).join(', ')
      : 'no body fields inferred';
    lines.push(`- ${markdownFencedInlineCode(`${response.status}`)} ${response.transport}: ${summary}`);
  }
  if (endpoint.responseSchemas && endpoint.responseSchemas.length > 0) {
    lines.push(`- Response schemas: ${endpoint.responseSchemas.map((schema) => (
      `${markdownFencedInlineCode(schema.name)} (${schema.source})${schema.fields && schema.fields.length > 0 ? ` -> ${schema.fields.map((field) => markdownFencedInlineCode(field)).join(', ')}` : ''}`
    )).join('; ')}`);
  }
}

function renderApiEndpoint(lines, endpoint, currentPath, endpointDesign, output, heading = '###') {
  lines.push(`${heading} ${endpoint.method} ${escapeAngleBracketsForVueMarkdown(endpoint.path)}`);
  lines.push('');
  lines.push(`- File: [${endpoint.file}](${relativeLink(currentPath, filePagePath(endpoint.file))})`);
  lines.push(`- Framework: ${markdownFencedInlineCode(endpoint.framework)}`);
  lines.push(`- Operation ID: ${markdownFencedInlineCode(endpoint.operationId)}`);
  if (endpoint.handler) {
    lines.push(`- Handler: ${markdownFencedInlineCode(endpoint.handler)}`);
  }
  if (endpoint.line) {
    lines.push(`- Declared around line: ${endpoint.line}`);
  }
  renderApiRequestSection(lines, endpoint);
  renderApiResponseSection(lines, endpoint);
  if (endpointDesign && Array.isArray(endpointDesign.steps) && endpointDesign.steps.length > 0) {
    lines.push('', '#### Endpoint Steps', '');
    for (const step of endpointDesign.steps) {
      lines.push(`- ${escapeAngleBracketsForVueMarkdown(step)}`);
    }
  }
  if (endpointDesign && shouldRenderFlowchart(output)) {
    lines.push('', '#### Endpoint Flow Diagram', '', renderMermaidDiagram(endpointDesign.mermaid), '');
  }
  if (endpointDesign && shouldRenderSequence(output)) {
    lines.push('', '#### Endpoint Sequence Diagram', '', renderMermaidDiagram(endpointDesign.sequenceMermaid), '');
  }
  lines.push('');
}

function renderLanguageBreakdown(scanResult) {
  const entries = Object.entries(scanResult.languages || {}).sort((left, right) => right[1].symbols - left[1].symbols);
  if (entries.length === 0) {
    return ['No supported source files were found.'];
  }

  return entries.map(([language, stats]) => `- ${language}: ${formatCount(stats.files, 'file')}, ${formatCount(stats.symbols, 'symbol')}`);
}

function renderSummary(scanResult) {
  const lines = [
    '# Summary',
    '',
    '- [Project Overview](index.md)',
    `- [Feature Catalog](${toPosixPath(FEATURES_INDEX_FILE)})`,
    '- [Design Overview](design/index.md)',
    '- [Basic Design](design/basic-design.md)',
    '- [Detail Design](design/detail-design.md)',
    '- [API Contracts](design/api-contracts.md)',
    '- [Flow Catalog](design/flows.md)',
    `- [Reference Index](${toPosixPath(REFERENCE_INDEX_FILE)})`,
    `- [Module Index](${toPosixPath(REFERENCE_MODULE_INDEX_FILE)})`,
    '- [Workspace Index](workspaces/index.md)',
  ];

  for (const feature of getFeatures(scanResult)) {
    lines.push(`- [Feature: ${feature.title}](${toPosixPath(featurePagePath(feature.slug))})`);
  }

  for (const workspace of scanResult.workspaces) {
    const title = workspace.directory || '(root)';
    lines.push(`- [Workspace: ${workspace.name} (${title})](${toPosixPath(workspacePagePath(workspace.directory))})`);
  }

  for (const module of getSortedModules(scanResult)) {
    const title = module.directory || '(root)';
    lines.push(`- [Module: ${title}](${toPosixPath(modulePagePath(module.directory))})`);
  }

  lines.push('');
  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Summary',
      description: `Top-level wiki navigation for ${scanResult.projectName}.`,
      kind: 'summary',
      outline: false,
      scanResult,
      meta: {
        page: 'SUMMARY',
        moduleCount: scanResult.totals.directories,
        workspaceCount: scanResult.totals.workspaces,
      },
    }),
    lines.join('\n'),
  );
}

function renderIndex(scanResult, output) {
  const lines = [];
  const features = getFeatures(scanResult);

  if (output.includeAiSections && scanResult.ai && scanResult.ai.project && scanResult.ai.project.overview) {
    lines.push('## Overview', '', escapeAngleBracketsForVueMarkdown(scanResult.ai.project.overview), '');
  }

  lines.push('## Snapshot', '');
  lines.push(`- Generated at: \`${scanResult.generatedAt}\``);
  lines.push(`- Project root: \`${scanResult.rootDir}\``);
  if (scanResult.package && scanResult.package.version) {
    lines.push(`- Package version: \`${scanResult.package.version}\``);
  }
  if (scanResult.settings && scanResult.settings.configPath) {
    lines.push(`- Config: \`${scanResult.settings.configPath}\``);
  }
  lines.push(`- Files parsed: ${scanResult.totals.filesParsed}/${scanResult.totals.filesDiscovered}`);
  lines.push(`- Symbols found: ${scanResult.totals.symbols}`);
  lines.push(`- Modules: ${scanResult.totals.directories}`);
  lines.push(`- Scan mode: ${scanResult.incremental.mode}`);
  lines.push(`- Supported extensions: ${scanResult.supportedExtensions.map((value) => `\`${value}\``).join(', ')}`);
  if (scanResult.ai && scanResult.ai.enabled) {
    lines.push(`- AI summaries: ${scanResult.ai.summarizedFiles}/${scanResult.totals.filesParsed} files using \`${scanResult.ai.model}\``);
  }

  lines.push('', '## Navigation', '');
  lines.push('- [Summary](SUMMARY.md)');
  lines.push(`- [Feature Catalog](${toPosixPath(FEATURES_INDEX_FILE)})`);
  lines.push('- [Design Overview](design/index.md)');
  lines.push('- [Basic Design](design/basic-design.md)');
  lines.push('- [Detail Design](design/detail-design.md)');
  lines.push('- [API Contracts](design/api-contracts.md)');
  lines.push('- [Flow Catalog](design/flows.md)');
  lines.push(`- [Reference Index](${toPosixPath(REFERENCE_INDEX_FILE)})`);
  lines.push(`- [Module Index](${toPosixPath(REFERENCE_MODULE_INDEX_FILE)})`);
  lines.push('- [Workspace Index](workspaces/index.md)');
  lines.push(`- [Root Module](${toPosixPath(modulePagePath(''))})`);
  lines.push(`- [Root Workspace](${toPosixPath(workspacePagePath(''))})`);

  lines.push('', '## Language Breakdown', '');
  lines.push(...renderLanguageBreakdown(scanResult));

  lines.push('', '## Feature Highlights', '');
  if (features.length === 0) {
    lines.push('No feature clusters were inferred yet.');
  } else {
    for (const feature of features.slice(0, 12)) {
      lines.push(`- [${feature.title}](${toPosixPath(featurePagePath(feature.slug))}) - ${formatCount(feature.files.length, 'file')}, ${formatCount(feature.apiContracts.length, 'endpoint')}`);
      lines.push(`  - ${escapeAngleBracketsForVueMarkdown(feature.summary)}`);
    }
  }

  lines.push('', '## Workspaces', '');
  for (const workspace of scanResult.workspaces) {
    const title = workspace.directory || '(root)';
    lines.push(`- [${workspace.name}](${toPosixPath(workspacePagePath(workspace.directory))}) - ${formatCount(workspace.fileCount, 'file')}, ${formatCount(workspace.symbolCount, 'symbol')}`);
  }

  const rankedModules = getSortedModules(scanResult).slice(0, 8);
  lines.push('', '## Key Modules', '');
  for (const module of rankedModules) {
    const title = module.directory || '(root)';
    const reason = output.includeAiSections ? getKeyModuleReason(scanResult, module.directory) : null;
    lines.push(`- [${title}](${toPosixPath(modulePagePath(module.directory))}) - ${formatCount(module.fileCount, 'file')}, ${formatCount(module.symbolCount, 'symbol')}`);
    if (reason) {
      lines.push(`  - ${escapeAngleBracketsForVueMarkdown(reason)}`);
    }
  }

  if (output.includeAiSections && scanResult.ai && scanResult.ai.project && Array.isArray(scanResult.ai.project.architecture) && scanResult.ai.project.architecture.length > 0) {
    lines.push('', '## Architecture Notes', '');
    for (const item of scanResult.ai.project.architecture) {
      lines.push(`- ${escapeAngleBracketsForVueMarkdown(item)}`);
    }
  }

  if (scanResult.errors.length > 0 || (scanResult.ai && Array.isArray(scanResult.ai.errors) && scanResult.ai.errors.length > 0)) {
    lines.push('', '## Errors', '');
    for (const entry of scanResult.errors) {
      lines.push(`- Parse: ${markdownFencedInlineCode(entry.relativePath)} - ${escapeAngleBracketsForVueMarkdown(entry.message)}`);
    }
    if (scanResult.ai) {
      for (const entry of scanResult.ai.errors) {
        lines.push(`- AI: ${markdownFencedInlineCode(entry.scope)} - ${escapeAngleBracketsForVueMarkdown(entry.message)}`);
      }
    }
  }

  lines.push('');
  const featureCards = [
    {
      icon: 'FEATURE',
      title: 'Feature Pages',
      details: `${formatCount(features.length, 'feature')} grouped across workspaces with user stories, flow diagrams, API contracts, and related files.`,
      link: '/features/',
      linkText: 'Browse features',
    },
    {
      icon: 'BDD',
      title: 'Basic Design',
      details: 'System intent, actors, primary capabilities, and context-level diagrams inferred from the codebase.',
      link: '/design/basic-design',
      linkText: 'Open BDD',
    },
    {
      icon: 'DDD',
      title: 'Detail Design',
      details: 'Module responsibilities, internal runtime layers, and implementation-oriented flow breakdowns.',
      link: '/design/detail-design',
      linkText: 'Open DDD',
    },
    {
      icon: 'API',
      title: 'API Contracts',
      details: `${formatCount(getApiContracts(scanResult).length, 'endpoint')} inferred with request and response shapes from route handlers.`,
      link: '/design/api-contracts',
      linkText: 'Inspect contracts',
    },
    {
      icon: 'CODE',
      title: 'Reference Docs',
      details: `${formatCount(scanResult.totals.filesParsed, 'file')} and ${formatCount(scanResult.totals.symbols, 'symbol')} extracted across ${Object.keys(scanResult.languages || {}).length} supported languages.`,
      link: '/reference/',
      linkText: 'Open reference',
    },
    {
      icon: 'FLOW',
      title: 'Flow Diagrams',
      details: 'Inferred request and business flows are rendered as Mermaid diagrams so the operational path is visible.',
      link: '/design/flows',
      linkText: 'Explore flows',
    },
    {
      icon: output.includeAiSections && scanResult.ai && scanResult.ai.enabled ? 'AI' : 'CFG',
      title: output.includeAiSections && scanResult.ai && scanResult.ai.enabled ? 'AI Enriched' : 'Deterministic Output',
      details: output.includeAiSections && scanResult.ai && scanResult.ai.enabled
        ? `Summaries generated with ${scanResult.ai.provider}/${scanResult.ai.model}.`
        : `Template ${output.template} with theme preset ${output.themePreset} and ${scanResult.incremental.mode} rendering.`,
      link: '/reference/',
      linkText: 'Inspect reference',
    },
  ];

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: `${scanResult.projectName} Docs Wiki`,
      description: scanResult.package && scanResult.package.description
        ? scanResult.package.description
        : `${scanResult.totals.filesParsed} files and ${scanResult.totals.symbols} symbols documented for ${scanResult.projectName}.`,
      kind: 'overview',
      layout: 'home',
      outline: false,
      scanResult,
      meta: {
        page: 'index',
        rootDir: scanResult.rootDir,
        fileCount: scanResult.totals.filesParsed,
        symbolCount: scanResult.totals.symbols,
        workspaceCount: scanResult.totals.workspaces,
      },
      extra: {
        sidebar: false,
        aside: false,
        hero: {
          name: scanResult.projectName,
          text: scanResult.package && scanResult.package.description
            ? escapeAngleBracketsForVueMarkdown(scanResult.package.description)
            : 'Generated internal docs wiki',
          tagline: `${formatCount(scanResult.totals.filesParsed, 'file')} · ${formatCount(scanResult.totals.symbols, 'symbol')} · ${formatCount(scanResult.totals.directories, 'module')} · theme ${output.themePreset}`,
          actions: [
            { theme: 'brand', text: 'Browse Features', link: '/features/' },
            { theme: 'alt', text: 'Open Summary', link: '/SUMMARY' },
          ],
        },
        features: featureCards,
      },
    }),
    lines.join('\n'),
  );
}

function renderFeatureIndex(scanResult) {
  const features = getFeatures(scanResult);
  const lines = [
    '# Feature Catalog',
    '',
    `- Project: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Summary: [SUMMARY](../SUMMARY.md)',
    `- Reference: [Reference Index](../${toPosixPath(REFERENCE_INDEX_FILE)})`,
    '',
    '## Features',
    '',
  ];

  if (features.length === 0) {
    lines.push('No feature clusters were inferred from the current codebase.');
  } else {
    for (const feature of features) {
      lines.push(`### [${feature.title}](${toPosixPath(path.relative('features', featurePagePath(feature.slug)))})`);
      lines.push('');
      lines.push(`- Domain: ${escapeAngleBracketsForVueMarkdown(feature.domainLabel || feature.domain)}`);
      if (feature.actionLabel) {
        lines.push(`- Action: ${escapeAngleBracketsForVueMarkdown(feature.actionLabel)}`);
      }
      lines.push(`- Scope: ${formatCount(feature.files.length, 'file')} · ${formatCount(feature.apiContracts.length, 'endpoint')} · ${formatCount(feature.workspaces.length, 'workspace')}`);
      lines.push(`- Summary: ${escapeAngleBracketsForVueMarkdown(feature.summary)}`);
      lines.push('');
    }
  }

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Feature Catalog',
      description: `Feature-oriented documentation for ${scanResult.projectName}.`,
      kind: 'feature-index',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(FEATURES_INDEX_FILE),
        featureCount: features.length,
      },
    }),
    lines.join('\n'),
  );
}

function renderReferenceIndex(scanResult) {
  const lines = [
    '# Reference Index',
    '',
    `- Project: [${scanResult.projectName} Docs Wiki](../index.md)`,
    `- Feature Catalog: [Features](../${toPosixPath(FEATURES_INDEX_FILE)})`,
    `- Module Index: [Modules](./modules/index.md)`,
    '- Workspace Index: [Workspaces](../workspaces/index.md)',
    '',
    '## Reference Layers',
    '',
    '- Feature pages are the primary docs surface for business understanding.',
    '- Reference pages keep the module and file-level detail linked from each feature page.',
    '',
    '## Quick Links',
    '',
    `- [Root Module](${toPosixPath(path.relative('reference', modulePagePath('')))})`,
    `- [Module Index](${toPosixPath(path.relative('reference', REFERENCE_MODULE_INDEX_FILE))})`,
    `- [Workspace Index](../workspaces/index.md)`,
  ];

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Reference Index',
      description: `Module and file reference pages for ${scanResult.projectName}.`,
      kind: 'reference-index',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(REFERENCE_INDEX_FILE),
      },
    }),
    lines.join('\n'),
  );
}

function renderLegacyReferenceStub(scanResult, title, currentPath, targetPath) {
  return withFrontmatter(
    buildVitePressFrontmatter({
      title,
      description: `${title} moved to the reference section.`,
      kind: 'reference-redirect',
      outline: false,
      scanResult,
      meta: {
        page: toPosixPath(currentPath),
        target: toPosixPath(targetPath),
      },
    }),
    [
      `# ${title}`,
      '',
      `This page moved to [${title}](${relativeLink(currentPath, targetPath)}).`,
      '',
      'Use the reference section for module and file-level detail, and the feature section for business-level docs.',
      '',
    ].join('\n'),
  );
}

function renderDesignIndex(scanResult) {
  const design = getDesignModel(scanResult);
  const lines = [
    '# Design Overview',
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Summary: [SUMMARY](../SUMMARY.md)',
    '- Basic design: [Basic Design](./basic-design.md)',
    '- Detail design: [Detail Design](./detail-design.md)',
    '- API contracts: [API Contracts](./api-contracts.md)',
    '- Flow catalog: [Flow Catalog](./flows.md)',
    '',
    '## What This Layer Adds',
    '',
    '- Basic Design maps business intent, actors, main capabilities, and context-level boundaries.',
    '- Detail Design maps runtime structure, module responsibilities, and implementation-level handoffs.',
    '- API Contracts extracts HTTP endpoints, request fields, and response shapes from route handlers.',
    '- Flow Catalog extracts request and business flows from folder structure, symbol names, AI file summaries, and import signals.',
    '',
    '## Dominant Capabilities',
    '',
  ];

  for (const capability of design.project.basicDesign.capabilities || []) {
    const target = capability.directory ? modulePagePath(capability.directory) : modulePagePath('');
    lines.push(`- [${capability.title}](${relativeLink(DESIGN_INDEX_FILE, target)}) - ${escapeAngleBracketsForVueMarkdown(capability.summary)}`);
  }

  if ((design.project.flows || []).length > 0) {
    lines.push('', '## Top Flows', '');
    for (const flow of design.project.flows) {
      lines.push(`- ${escapeAngleBracketsForVueMarkdown(flow.name)} - ${escapeAngleBracketsForVueMarkdown(flow.goal)}`);
    }
  }

  lines.push('');
  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Design Overview',
      description: `Design-level wiki pages for ${scanResult.projectName}.`,
      kind: 'design-index',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(DESIGN_INDEX_FILE),
        moduleCount: scanResult.totals.directories,
      },
    }),
    lines.join('\n'),
  );
}

function renderBasicDesign(scanResult) {
  const design = getDesignModel(scanResult);
  const lines = [
    '# Basic Design',
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Design overview: [Design Overview](./index.md)',
    '- Detail design: [Detail Design](./detail-design.md)',
    '- API contracts: [API Contracts](./api-contracts.md)',
    '- Flow catalog: [Flow Catalog](./flows.md)',
    '',
    '## System Intent',
    '',
    escapeAngleBracketsForVueMarkdown(design.project.basicDesign.summary || `${scanResult.projectName} business context inferred from the scanned codebase.`),
    '',
    '## Actors',
    '',
    ...renderStringList(design.project.basicDesign.actors || []),
    '',
    '## Context Diagram',
    '',
    renderMermaidDiagram(design.project.basicDesign.diagram || 'flowchart LR\n  caller["Caller"] --> system["System"]'),
    '',
    '## Primary Capabilities',
    '',
  ];

  for (const capability of design.project.basicDesign.capabilities || []) {
    const target = capability.directory ? modulePagePath(capability.directory) : modulePagePath('');
    lines.push(`### [${capability.title}](${relativeLink(BASIC_DESIGN_FILE, target)})`);
    lines.push('');
    lines.push(escapeAngleBracketsForVueMarkdown(capability.summary || 'Capability summary unavailable.'));
    lines.push('');
  }

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Basic Design',
      description: `Basic design and context model for ${scanResult.projectName}.`,
      kind: 'design',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(BASIC_DESIGN_FILE),
      },
    }),
    lines.join('\n'),
  );
}

function renderDetailDesign(scanResult) {
  const design = getDesignModel(scanResult);
  const lines = [
    '# Detail Design',
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Design overview: [Design Overview](./index.md)',
    '- Basic design: [Basic Design](./basic-design.md)',
    '- API contracts: [API Contracts](./api-contracts.md)',
    '- Flow catalog: [Flow Catalog](./flows.md)',
    '',
    '## Runtime View',
    '',
    escapeAngleBracketsForVueMarkdown(design.project.detailDesign.summary || `${scanResult.projectName} detail design inferred from runtime structure.`),
    '',
    '## Runtime Layers',
    '',
    ...renderStringList(design.project.detailDesign.runtimeLayers || []),
    '',
    '## Interaction Diagram',
    '',
    renderMermaidDiagram(design.project.detailDesign.diagram || 'flowchart LR\n  moduleA["Module A"] --> moduleB["Module B"]'),
    '',
  ];

  if (Array.isArray(design.project.detailDesign.moduleInteractions) && design.project.detailDesign.moduleInteractions.length > 0) {
    lines.push('## Module Interaction Graph', '');
    for (const interaction of design.project.detailDesign.moduleInteractions) {
      lines.push(`- ${markdownFencedInlineCode(interaction.from || '(root)')} -> ${markdownFencedInlineCode(interaction.to || '(root)')} (${interaction.weight} dependencies)`);
    }
    lines.push('');
  }

  lines.push(
    '## Module Responsibilities',
    '',
  );

  for (const module of design.project.detailDesign.modules || []) {
    const target = module.directory ? modulePagePath(module.directory) : modulePagePath('');
    lines.push(`### [${module.title}](${relativeLink(DETAIL_DESIGN_FILE, target)})`);
    lines.push('');
    lines.push(`- Basic design: ${escapeAngleBracketsForVueMarkdown(module.basicDesign || 'n/a')}`);
    lines.push(`- Detail design: ${escapeAngleBracketsForVueMarkdown(module.detailDesign || 'n/a')}`);
    lines.push('');
  }

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Detail Design',
      description: `Detail design and implementation shape for ${scanResult.projectName}.`,
      kind: 'design',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(DETAIL_DESIGN_FILE),
      },
    }),
    lines.join('\n'),
  );
}

function renderApiContracts(scanResult, output) {
  const endpoints = getApiContracts(scanResult);
  const groups = getApiGroups(scanResult);
  const lines = [
    '# API Contracts',
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Design overview: [Design Overview](./index.md)',
    '- Basic design: [Basic Design](./basic-design.md)',
    '- Detail design: [Detail Design](./detail-design.md)',
    '- Flow catalog: [Flow Catalog](./flows.md)',
    '',
    '## Endpoint Summary',
    '',
  ];

  if (endpoints.length === 0) {
    lines.push('No HTTP endpoints could be inferred from the current codebase.');
  } else {
    for (const group of groups) {
      const groupEndpoints = endpoints.filter((endpoint) => endpoint.group === group.group);
      lines.push(`- ${escapeAngleBracketsForVueMarkdown(group.title)}: ${formatCount(groupEndpoints.length, 'endpoint')}`);
    }

    for (const group of groups) {
      const groupEndpoints = endpoints.filter((endpoint) => endpoint.group === group.group);
      lines.push('', `## ${escapeAngleBracketsForVueMarkdown(group.title)}`, '');
      for (const endpoint of groupEndpoints) {
        const moduleLink = relativeLink(API_CONTRACTS_FILE, modulePagePath(endpoint.directory || ''));
        lines.push(`- Module: [${endpoint.directory || '(root)'}](${moduleLink})`);
        lines.push(`- Source: [${endpoint.file}](${relativeLink(API_CONTRACTS_FILE, filePagePath(endpoint.file))})`);
        renderApiEndpoint(lines, endpoint, API_CONTRACTS_FILE, getApiEndpointDesign(scanResult, endpoint.id), output);
      }
    }
  }

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'API Contracts',
      description: `Inferred HTTP request and response contracts for ${scanResult.projectName}.`,
      kind: 'design',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(API_CONTRACTS_FILE),
        endpointCount: endpoints.length,
      },
    }),
    lines.join('\n'),
  );
}

function renderFlowCatalog(scanResult, output) {
  const design = getDesignModel(scanResult);
  const flows = design.project.flows || [];
  const showFlowchart = shouldRenderFlowchart(output);
  const showSequence = shouldRenderSequence(output);
  const lines = [
    '# Flow Catalog',
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Design overview: [Design Overview](./index.md)',
    '- Basic design: [Basic Design](./basic-design.md)',
    '- Detail design: [Detail Design](./detail-design.md)',
    '- API contracts: [API Contracts](./api-contracts.md)',
    '',
    '## Inferred Flows',
    '',
  ];

  if (flows.length === 0) {
    lines.push('No business or request flow could be inferred from the current codebase.');
  } else {
    for (const flow of flows) {
      lines.push(`### ${escapeAngleBracketsForVueMarkdown(flow.name)}`);
      lines.push('');
      lines.push(escapeAngleBracketsForVueMarkdown(flow.goal));
      lines.push('');
      lines.push('#### Steps', '');
      for (const step of flow.steps || []) {
        lines.push(`- ${escapeAngleBracketsForVueMarkdown(step)}`);
      }

      if (showFlowchart) {
        lines.push('', '#### Flow Diagram', '', renderMermaidDiagram(flow.mermaid), '');
      }

      if (showSequence && flow.sequenceMermaid) {
        lines.push('', '#### Sequence Diagram', '', renderMermaidDiagram(flow.sequenceMermaid), '');
      }
    }
  }

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Flow Catalog',
      description: `Inferred business flows for ${scanResult.projectName}.`,
      kind: 'design',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(FLOW_CATALOG_FILE),
      },
    }),
    lines.join('\n'),
  );
}

function renderFeatureFileTable(currentPath, files) {
  const lines = [
    '| File | Workspace | Role | Why It Belongs |',
    '| --- | --- | --- | --- |',
  ];
  for (const file of files) {
    lines.push(`| [${file.path}](${relativeLink(currentPath, filePagePath(file.path))}) | ${escapeAngleBracketsForVueMarkdown(file.workspaceName || file.workspace || '(root)')} | ${escapeAngleBracketsForVueMarkdown(file.roleLabel || file.role)} | ${escapeAngleBracketsForVueMarkdown(file.reason)} |`);
  }
  return lines;
}

function renderFeatureEdgeCases(lines, feature) {
  const aiCases = feature.ai && Array.isArray(feature.ai.errorCases) ? feature.ai.errorCases : [];
  const inferredCases = [];

  for (const endpoint of feature.apiContracts || []) {
    for (const response of endpoint.responses || []) {
      if (Number(response.status) >= 400) {
        inferredCases.push({
          case: `${endpoint.method} ${endpoint.path} can return ${response.status}`,
          handling: response.bodyKeys && response.bodyKeys.length > 0
            ? `The handler exposes ${response.bodyKeys.join(', ')} when the error path is taken.`
            : 'The handler returns a non-success response path.',
        });
      }
    }
  }

  const cases = aiCases.length > 0 ? aiCases : inferredCases.slice(0, 8);
  if (cases.length === 0) {
    lines.push('No edge cases were inferred from the clustered code.');
    return;
  }

  for (const entry of cases) {
    lines.push(`- ${escapeAngleBracketsForVueMarkdown(entry.case)} — ${escapeAngleBracketsForVueMarkdown(entry.handling)}`);
  }
}

function renderFeaturePage(scanResult, feature, output) {
  const currentPath = featurePagePath(feature.slug);
  const showFlowchart = shouldRenderFlowchart(output);
  const showSequence = shouldRenderSequence(output);
  const lines = [
    `# ${feature.title}`,
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Feature catalog: [All features](${relativeLink(currentPath, FEATURES_INDEX_FILE)})`,
    `- Reference: [Reference Index](${relativeLink(currentPath, REFERENCE_INDEX_FILE)})`,
    '',
    '## Overview',
    '',
    escapeAngleBracketsForVueMarkdown(feature.ai && feature.ai.overview ? feature.ai.overview : (feature.overview || feature.summary)),
    '',
    '## Actors & User Stories',
    '',
  ];

  const userStories = feature.ai && Array.isArray(feature.ai.userStories) && feature.ai.userStories.length > 0
    ? feature.ai.userStories
    : (feature.userStories || []);

  if (userStories.length === 0) {
    lines.push(...renderStringList(feature.actors || []));
  } else {
    for (const story of userStories) {
      lines.push(`### As ${escapeAngleBracketsForVueMarkdown(story.role)}`);
      lines.push('');
      lines.push(`- Goal: ${escapeAngleBracketsForVueMarkdown(story.goal)}`);
      lines.push(`- Benefit: ${escapeAngleBracketsForVueMarkdown(story.benefit)}`);
      if (Array.isArray(story.acceptance) && story.acceptance.length > 0) {
        lines.push('', '#### Acceptance Criteria', '');
        for (const item of story.acceptance) {
          lines.push(`- ${escapeAngleBracketsForVueMarkdown(item)}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('## Business Flows', '');
  if (!feature.flows || feature.flows.length === 0) {
    lines.push('No feature flows were inferred.');
  } else {
    const flowNarratives = new Map(
      feature.ai && Array.isArray(feature.ai.flowNarratives)
        ? feature.ai.flowNarratives.map((flow) => [flow.name, flow])
        : [],
    );
    for (const flow of feature.flows) {
      lines.push(`### ${escapeAngleBracketsForVueMarkdown(flow.name)}`);
      lines.push('');
      lines.push(escapeAngleBracketsForVueMarkdown(flow.goal || feature.summary));
      lines.push('');
      lines.push('#### Steps', '');
      const narrative = flowNarratives.get(flow.name);
      const steps = narrative && Array.isArray(narrative.steps) && narrative.steps.length > 0
        ? narrative.steps
        : (flow.steps || []);
      for (const step of steps) {
        lines.push(`- ${escapeAngleBracketsForVueMarkdown(step)}`);
      }
      if (showFlowchart && flow.mermaid) {
        lines.push('', '#### Flow Diagram', '', renderMermaidDiagram(flow.mermaid), '');
      }
      if (showSequence && flow.sequenceMermaid) {
        lines.push('', '#### Sequence Diagram', '', renderMermaidDiagram(flow.sequenceMermaid), '');
      }
    }
  }

  lines.push('', '## Basic Design', '');
  lines.push(escapeAngleBracketsForVueMarkdown(
    feature.ai && feature.ai.basicDesign ? feature.ai.basicDesign.context : feature.summary,
  ));
  lines.push('', '### Boundaries', '');
  const boundaries = feature.ai && feature.ai.basicDesign && Array.isArray(feature.ai.basicDesign.boundaries) && feature.ai.basicDesign.boundaries.length > 0
    ? feature.ai.basicDesign.boundaries
    : [
      `Workspaces: ${(feature.workspaces || []).map((workspace) => workspace.name || workspace.directory || '(root)').join(', ') || '(root)'}`,
      `Entry points (FE): ${(feature.entryPoints && feature.entryPoints.fe ? feature.entryPoints.fe.join(', ') : '') || 'n/a'}`,
      `Entry points (BE): ${(feature.entryPoints && feature.entryPoints.be ? feature.entryPoints.be.join(', ') : '') || 'n/a'}`,
    ];
  lines.push(...renderStringList(boundaries));
  lines.push('', '### Context Diagram', '', renderMermaidDiagram(feature.contextDiagram), '');

  lines.push('## Detail Design', '');
  if (feature.ai && feature.ai.detailDesign) {
    lines.push(`- Data model: ${escapeAngleBracketsForVueMarkdown(feature.ai.detailDesign.dataModel)}`);
    lines.push(`- State management: ${escapeAngleBracketsForVueMarkdown(feature.ai.detailDesign.stateManagement)}`);
    if (Array.isArray(feature.ai.detailDesign.components) && feature.ai.detailDesign.components.length > 0) {
      lines.push('', '### Components', '');
      for (const component of feature.ai.detailDesign.components) {
        lines.push(`- ${escapeAngleBracketsForVueMarkdown(component.name)} (${escapeAngleBracketsForVueMarkdown(component.layer)}) — ${escapeAngleBracketsForVueMarkdown(component.responsibility)}`);
      }
    }
  } else {
    lines.push(`- Data stores: ${feature.dataStores.length > 0 ? feature.dataStores.map((item) => escapeAngleBracketsForVueMarkdown(item)).join(', ') : 'n/a'}`);
    lines.push(`- Integrations: ${feature.integrations.length > 0 ? feature.integrations.map((item) => escapeAngleBracketsForVueMarkdown(item)).join(', ') : 'n/a'}`);
  }
  lines.push('', '### Component Diagram', '', renderMermaidDiagram(feature.componentDiagram), '');

  lines.push('## API Contracts', '');
  if (feature.apiContracts.length === 0) {
    lines.push('No API contracts were linked to this feature.');
  } else {
    for (const endpoint of feature.apiContracts) {
      renderApiEndpoint(lines, endpoint, currentPath, getApiEndpointDesign(scanResult, endpoint.id), output);
    }
  }

  lines.push('', '## Edge Cases & Error Handling', '');
  renderFeatureEdgeCases(lines, feature);

  lines.push('', '## Related Files', '');
  lines.push(...renderFeatureFileTable(currentPath, feature.files));

  if (feature.ai && Array.isArray(feature.ai.openQuestions) && feature.ai.openQuestions.length > 0) {
    lines.push('', '## Open Questions', '');
    for (const question of feature.ai.openQuestions) {
      lines.push(`- ${escapeAngleBracketsForVueMarkdown(question)}`);
    }
  }

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: feature.title,
      description: feature.ai && feature.ai.overview ? feature.ai.overview : feature.summary,
      kind: 'feature',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(featurePagePath(feature.slug)),
        featureId: feature.id,
        domain: feature.domain,
        action: feature.action || '',
        fileCount: feature.files.length,
      },
    }),
    lines.join('\n'),
  );
}

function renderModuleIndex(scanResult) {
  const currentPath = REFERENCE_MODULE_INDEX_FILE;
  const lines = [
    '# Module Index',
    '',
    `- Project: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Summary: [SUMMARY](${relativeLink(currentPath, 'SUMMARY.md')})`,
    `- Feature Catalog: [Features](${relativeLink(currentPath, FEATURES_INDEX_FILE)})`,
    `- Workspaces: [Workspace Index](${relativeLink(currentPath, path.join('workspaces', 'index.md'))})`,
    '',
    '## Modules',
    '',
  ];

  for (const module of getSortedModules(scanResult)) {
    const title = module.directory || '(root)';
    lines.push(`- [${title}](${relativeLink(currentPath, modulePagePath(module.directory))}) - ${formatCount(module.fileCount, 'file')}, ${formatCount(module.symbolCount, 'symbol')}`);
  }

  lines.push('');
  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Module Index',
      description: `Directory-level index for ${scanResult.projectName}.`,
      kind: 'module-index',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(REFERENCE_MODULE_INDEX_FILE),
        moduleCount: scanResult.totals.directories,
      },
    }),
    lines.join('\n'),
  );
}

function renderWorkspaceIndex(scanResult) {
  const lines = [
    '# Workspace Index',
    '',
    `- Project: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Summary: [SUMMARY](../SUMMARY.md)',
    `- Feature Catalog: [Features](../${toPosixPath(FEATURES_INDEX_FILE)})`,
    `- Modules: [Module Index](../${toPosixPath(REFERENCE_MODULE_INDEX_FILE)})`,
    '',
    '## Workspaces',
    '',
  ];

  for (const workspace of scanResult.workspaces) {
    const title = workspace.directory || '(root)';
    lines.push(`- [${workspace.name}](${toPosixPath(path.relative('workspaces', workspacePagePath(workspace.directory)))}) - ${formatCount(workspace.fileCount, 'file')}, ${formatCount(workspace.symbolCount, 'symbol')}`);
  }

  lines.push('');
  return withFrontmatter(
    buildVitePressFrontmatter({
      title: 'Workspace Index',
      description: `Workspace and package index for ${scanResult.projectName}.`,
      kind: 'workspace-index',
      outline: [2, 3],
      scanResult,
      meta: {
        page: 'workspaces/index',
        workspaceCount: scanResult.totals.workspaces,
      },
    }),
    lines.join('\n'),
  );
}

function renderModulePage(scanResult, module, output) {
  const currentPath = modulePagePath(module.directory);
  const workspace = getWorkspaceForModule(scanResult, module.directory);
  const moduleDesign = getModuleDesign(scanResult, module.directory);
  const moduleApiContracts = getModuleApiContracts(scanResult, module.directory);
  const relatedFeatures = getFeaturesForModule(scanResult, module.directory);
  const lines = [
    `# Module ${module.directory || '(root)'}`,
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Summary: [SUMMARY](${relativeLink(currentPath, 'SUMMARY.md')})`,
    `- Feature catalog: [All features](${relativeLink(currentPath, FEATURES_INDEX_FILE)})`,
    `- Module index: [All modules](${relativeLink(currentPath, REFERENCE_MODULE_INDEX_FILE)})`,
    `- Workspace index: [All workspaces](${relativeLink(currentPath, path.join('workspaces', 'index.md'))})`,
    '',
    '## Snapshot',
    '',
    `- Path: \`${module.directory || '.'}\``,
    `- Descendant files: ${module.fileCount}`,
    `- Descendant symbols: ${module.symbolCount}`,
    `- Languages: ${module.languages.map((value) => `\`${value}\``).join(', ') || 'n/a'}`,
  ];
  if (workspace) {
    lines.push(`- Workspace: [${workspace.name}](${relativeLink(currentPath, workspacePagePath(workspace.directory))})`);
  }

  const reason = output.includeAiSections ? getKeyModuleReason(scanResult, module.directory) : null;
  if (reason) {
    lines.push('', '## Why It Matters', '', escapeAngleBracketsForVueMarkdown(reason));
  }

  if (relatedFeatures.length > 0) {
    lines.push('', '## Related Features', '');
    for (const feature of relatedFeatures) {
      lines.push(`- [${feature.title}](${relativeLink(currentPath, featurePagePath(feature.slug))}) - ${escapeAngleBracketsForVueMarkdown(feature.summary)}`);
    }
  }

  if (moduleDesign) {
    lines.push('', '## Business Capability', '', escapeAngleBracketsForVueMarkdown(moduleDesign.capability));
    lines.push('', '## Basic Design', '', escapeAngleBracketsForVueMarkdown(moduleDesign.basicDesign));

    if (moduleDesign.entryPoints.length > 0 || moduleDesign.dataStores.length > 0 || moduleDesign.integrations.length > 0) {
      lines.push('', '### Boundaries', '');
      if (moduleDesign.actors && moduleDesign.actors.length > 0) {
        lines.push(`- Actors: ${moduleDesign.actors.map((item) => escapeAngleBracketsForVueMarkdown(item)).join(', ')}`);
      }
      if (moduleDesign.entryPoints.length > 0) {
        lines.push(`- Entry points: ${moduleDesign.entryPoints.map((item) => markdownFencedInlineCode(item)).join(', ')}`);
      }
      if (moduleDesign.dataStores.length > 0) {
        lines.push(`- Data stores: ${moduleDesign.dataStores.map((item) => escapeAngleBracketsForVueMarkdown(item)).join(', ')}`);
      }
      if (moduleDesign.integrations.length > 0) {
        lines.push(`- External interfaces: ${moduleDesign.integrations.map((item) => markdownFencedInlineCode(item)).join(', ')}`);
      }
    }

    lines.push('', '## Detail Design', '', escapeAngleBracketsForVueMarkdown(moduleDesign.detailDesign));
    if (moduleDesign.components.length > 0) {
      lines.push('', '### Components', '');
      for (const component of moduleDesign.components) {
        lines.push(`- ${escapeAngleBracketsForVueMarkdown(component)}`);
      }
    }

    if (moduleDesign.interactions.length > 0) {
      lines.push('', '## Module Interactions', '');
      for (const interaction of moduleDesign.interactions) {
        const from = interaction.from || '(root)';
        const to = interaction.to || '(root)';
        lines.push(`- ${markdownFencedInlineCode(from)} -> ${markdownFencedInlineCode(to)} (${interaction.weight} dependencies)`);
      }
      lines.push('', '### Interaction Diagram', '', renderModuleInteractionDiagram(moduleDesign.interactions), '');
    }

    if (moduleDesign.flows.length > 0) {
      const showFlowchart = shouldRenderFlowchart(output);
      const showSequence = shouldRenderSequence(output);
      lines.push('', '## Inferred Business Flows', '');
      for (const flow of moduleDesign.flows) {
        lines.push(`### ${escapeAngleBracketsForVueMarkdown(flow.name)}`);
        lines.push('');
        lines.push(escapeAngleBracketsForVueMarkdown(flow.goal));
        lines.push('');
        lines.push('#### Steps', '');
        for (const step of flow.steps) {
          lines.push(`- ${escapeAngleBracketsForVueMarkdown(step)}`);
        }
        if (showFlowchart) {
          lines.push('', '#### Flow Diagram', '', renderMermaidDiagram(flow.mermaid), '');
        }
        if (showSequence && flow.sequenceMermaid) {
          lines.push('', '#### Sequence Diagram', '', renderMermaidDiagram(flow.sequenceMermaid), '');
        }
      }
    }
  }

  if (moduleApiContracts.length > 0) {
    lines.push('', '## API Contracts', '');
    for (const endpoint of moduleApiContracts) {
      renderApiEndpoint(lines, endpoint, currentPath, getApiEndpointDesign(scanResult, endpoint.id), output);
    }
  }

  lines.push('', '## Child Modules', '');
  if (module.childDirectories.length === 0) {
    lines.push('No child modules.');
  } else {
    for (const childDirectory of module.childDirectories) {
      const childModule = scanResult.directories.find((entry) => entry.directory === childDirectory);
      const childTitle = childDirectory || '(root)';
      lines.push(`- [${childTitle}](${relativeLink(currentPath, modulePagePath(childDirectory))}) - ${formatCount(childModule.fileCount, 'file')}, ${formatCount(childModule.symbolCount, 'symbol')}`);
    }
  }

  lines.push('', '## Direct Files', '');
  if (module.directFiles.length === 0) {
    lines.push('No files directly under this module.');
  } else {
    for (const relativePath of module.directFiles) {
      const file = getFileByPath(scanResult, relativePath);
      const summary = output.includeAiSections && file && file.ai && file.ai.summary
        ? ` — ${escapeAngleBracketsForVueMarkdown(file.ai.summary)}`
        : '';
      lines.push(`- [${relativePath}](${relativeLink(currentPath, filePagePath(relativePath))})${summary}`);
    }
  }

  lines.push('');
  return withFrontmatter(
    buildVitePressFrontmatter({
      title: `Module ${module.directory || '(root)'}`,
      description: `${formatCount(module.fileCount, 'file')} and ${formatCount(module.symbolCount, 'symbol')} under ${module.directory || 'the project root'}.`,
      kind: 'module',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(modulePagePath(module.directory)),
        directory: module.directory,
        fileCount: module.fileCount,
        symbolCount: module.symbolCount,
        workspace: workspace ? workspace.directory : '',
        languages: module.languages,
      },
    }),
    lines.join('\n'),
  );
}

function renderWorkspacePage(scanResult, workspace, output) {
  const currentPath = workspacePagePath(workspace.directory);
  const workspaceDesign = getWorkspaceDesign(scanResult, workspace.directory);
  const workspaceApiContracts = getWorkspaceApiContracts(scanResult, workspace.directory);
  const relatedFeatures = getFeatures(scanResult).filter((feature) => feature.workspaces.some((entry) => entry.directory === workspace.directory));
  const lines = [
    `# Workspace ${workspace.name}`,
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Summary: [SUMMARY](${relativeLink(currentPath, 'SUMMARY.md')})`,
    `- Workspace index: [All workspaces](${relativeLink(currentPath, path.join('workspaces', 'index.md'))})`,
    `- Feature catalog: [All features](${relativeLink(currentPath, FEATURES_INDEX_FILE)})`,
    `- Module index: [All modules](${relativeLink(currentPath, REFERENCE_MODULE_INDEX_FILE)})`,
    '',
    '## Snapshot',
    '',
    `- Directory: \`${workspace.directory || '.'}\``,
    `- Package file: \`${workspace.relativePackagePath}\``,
    `- Files: ${workspace.fileCount}`,
    `- Symbols: ${workspace.symbolCount}`,
    `- Languages: ${workspace.languages.map((value) => `\`${value}\``).join(', ') || 'n/a'}`,
  ];

  if (workspace.version) {
    lines.push(`- Version: \`${workspace.version}\``);
  }
  if (workspace.description) {
    lines.push('', '## Description', '', workspace.description);
  }

  if (relatedFeatures.length > 0) {
    lines.push('', '## Related Features', '');
    for (const feature of relatedFeatures) {
      lines.push(`- [${feature.title}](${relativeLink(currentPath, featurePagePath(feature.slug))}) - ${escapeAngleBracketsForVueMarkdown(feature.summary)}`);
    }
  }

  if (workspaceDesign) {
    lines.push('', '## Basic Design', '', escapeAngleBracketsForVueMarkdown(workspaceDesign.summary));
    if (workspaceDesign.topFlows.length > 0) {
      lines.push('', '## Flow Highlights', '');
      for (const flow of workspaceDesign.topFlows) {
        lines.push(`- ${escapeAngleBracketsForVueMarkdown(flow.name)} - ${escapeAngleBracketsForVueMarkdown(flow.goal)}`);
      }
    }
    if (workspaceDesign.interactions.length > 0) {
      lines.push('', '## Module Interaction Graph', '');
      for (const interaction of workspaceDesign.interactions) {
        lines.push(`- ${markdownFencedInlineCode(interaction.from || '(root)')} -> ${markdownFencedInlineCode(interaction.to || '(root)')} (${interaction.weight} dependencies)`);
      }
      lines.push('', renderModuleInteractionDiagram(workspaceDesign.interactions), '');
    }
  }

  if (workspaceApiContracts.length > 0) {
    lines.push('', '## API Surface', '');
    for (const endpoint of workspaceApiContracts) {
      renderApiEndpoint(lines, endpoint, currentPath, getApiEndpointDesign(scanResult, endpoint.id), output);
    }
  }

  lines.push('', '## Modules', '');
  if (workspace.modules.length === 0) {
    lines.push('No modules were discovered in this workspace.');
  } else {
    for (const moduleDirectory of workspace.modules) {
      const module = scanResult.directories.find((entry) => entry.directory === moduleDirectory);
      if (!module) {
        continue;
      }
      const title = moduleDirectory || '(root)';
      lines.push(`- [${title}](${relativeLink(currentPath, modulePagePath(moduleDirectory))}) - ${formatCount(module.fileCount, 'file')}, ${formatCount(module.symbolCount, 'symbol')}`);
    }
  }

  lines.push('', '## Files', '');
  for (const relativePath of workspace.files) {
    const file = getFileByPath(scanResult, relativePath);
    const summary = output.includeAiSections && file && file.ai && file.ai.summary
      ? ` — ${escapeAngleBracketsForVueMarkdown(file.ai.summary)}`
      : '';
    lines.push(`- [${relativePath}](${relativeLink(currentPath, filePagePath(relativePath))})${summary}`);
  }

  lines.push('');
  return withFrontmatter(
    buildVitePressFrontmatter({
      title: `Workspace ${workspace.name}`,
      description: `${formatCount(workspace.fileCount, 'file')} and ${formatCount(workspace.symbolCount, 'symbol')} in workspace ${workspace.name}.`,
      kind: 'workspace',
      outline: [2, 3],
      scanResult,
      meta: {
        page: toPosixPath(workspacePagePath(workspace.directory)),
        directory: workspace.directory,
        packageFile: workspace.relativePackagePath,
        fileCount: workspace.fileCount,
        symbolCount: workspace.symbolCount,
        languages: workspace.languages,
      },
    }),
    lines.join('\n'),
  );
}

function renderFilePage(scanResult, file, output) {
  const currentPath = filePagePath(file.relativePath);
  const workspace = getWorkspaceByDirectory(scanResult, file.workspace ? file.workspace.directory : '');
  const relatedFeatures = getFeaturesForFile(scanResult, file.relativePath);
  const lines = [
    `# ${file.relativePath}`,
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Summary: [SUMMARY](${relativeLink(currentPath, 'SUMMARY.md')})`,
    `- Feature catalog: [All features](${relativeLink(currentPath, FEATURES_INDEX_FILE)})`,
    `- Module: [${file.directory || '(root)'}](${relativeLink(currentPath, modulePagePath(file.directory))})`,
    `- Workspace: [${workspace ? workspace.name : (file.workspace ? file.workspace.name : '(root)')}](${relativeLink(currentPath, workspacePagePath(file.workspace ? file.workspace.directory : ''))})`,
    '',
    '## Snapshot',
    '',
    `- Language: ${file.language}`,
    `- Source path: \`${file.absolutePath}\``,
    `- Lines: ${file.lineCount}`,
    `- Symbols: ${file.symbols.length}`,
  ];

  if (relatedFeatures.length > 0) {
    lines.push('', '## Related Features', '');
    for (const feature of relatedFeatures) {
      lines.push(`- [${feature.title}](${relativeLink(currentPath, featurePagePath(feature.slug))}) - ${escapeAngleBracketsForVueMarkdown(feature.summary)}`);
    }
  }

  if (output.includeAiSections && file.ai && file.ai.summary) {
    lines.push('', '## AI Summary', '', escapeAngleBracketsForVueMarkdown(file.ai.summary));

    if (Array.isArray(file.ai.responsibilities) && file.ai.responsibilities.length > 0) {
      lines.push('', '### Responsibilities', '');
      for (const item of file.ai.responsibilities) {
        lines.push(`- ${escapeAngleBracketsForVueMarkdown(item)}`);
      }
    }

    if (output.includeUsageNotes && Array.isArray(file.ai.usageNotes) && file.ai.usageNotes.length > 0) {
      lines.push('', '### Usage Notes', '');
      for (const item of file.ai.usageNotes) {
        lines.push(`- ${escapeAngleBracketsForVueMarkdown(item)}`);
      }
    }
  }

  if (output.highlightPublicApi) {
    const publicSymbols = getPublicSymbols(file);
    if (publicSymbols.length > 0) {
      lines.push('', '## Public API', '');
      for (const symbol of publicSymbols) {
        const symbolSummary = output.includeAiSections ? getSymbolSummary(file, symbol) : '';
        const esc = symbolSummary ? escapeAngleBracketsForVueMarkdown(symbolSummary) : '';
        const sig = String(symbol.signature);
        if (sig.includes('\n') || sig.length > 200) {
          lines.push(`- ${markdownFencedInlineCode(symbol.name)}${esc ? ` — ${esc}` : ''}`);
          lines.push('');
          lines.push(createFence(sig, file.codeFence));
          lines.push('');
        } else {
          lines.push(`- ${markdownFencedInlineCode(sig)}${esc ? ` — ${esc}` : ''}`);
        }
      }
    }
  }

  if (Array.isArray(file.apiContracts) && file.apiContracts.length > 0) {
    lines.push('', '## API Contracts', '');
    for (const endpoint of file.apiContracts) {
      renderApiEndpoint(lines, endpoint, currentPath, getApiEndpointDesign(scanResult, endpoint.id), output);
    }
  }

  lines.push('', '## Symbols', '');
  const symbols = output.highlightPublicApi
    ? file.symbols.slice().sort((left, right) => Number(right.exported) - Number(left.exported))
    : file.symbols;

  if (symbols.length === 0) {
    lines.push('No documentable symbols were detected for this file.');
  } else {
    for (const symbol of symbols) {
      const symbolSummary = output.includeAiSections ? getSymbolSummary(file, symbol) : '';
      lines.push(`### ${symbol.kind} ${markdownFencedInlineCode(symbol.name)}`);
      lines.push('');
      const sig = String(symbol.signature);
      if (sig.includes('\n') || sig.length > 200) {
        lines.push('- Signature:');
        lines.push('');
        lines.push(createFence(sig, file.codeFence));
      } else {
        lines.push(`- Signature: ${markdownFencedInlineCode(sig)}`);
      }
      lines.push(`- Lines: ${symbol.startLine}-${symbol.endLine}`);
      lines.push(`- Exported: ${symbol.exported ? 'yes' : 'no'}`);
      if (symbolSummary) {
        lines.push(`- Summary: ${escapeAngleBracketsForVueMarkdown(symbolSummary)}`);
      }
      lines.push('');
      if (output.includeCodeBlocks) {
        lines.push(createFence(symbol.code, file.codeFence));
        lines.push('');
      }
    }
  }

  return withFrontmatter(
    buildVitePressFrontmatter({
      title: file.relativePath,
      description: output.includeAiSections && file.ai && file.ai.summary
        ? file.ai.summary
        : `${file.language} source file with ${formatCount(file.symbols.length, 'symbol')}.`,
      kind: 'file',
      outline: 'deep',
      scanResult,
      meta: {
        page: toPosixPath(filePagePath(file.relativePath)),
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        module: file.directory,
        workspace: file.workspace ? file.workspace.directory : '',
        language: file.language,
        symbolCount: file.symbols.length,
      },
    }),
    lines.join('\n'),
  );
}

function renderVitePressSchema() {
  return JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'docs-wiki VitePress Frontmatter',
    description: 'Schema for the custom docsWiki frontmatter emitted by docs-wiki markdown pages.',
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      layout: { type: 'string', enum: ['doc', 'page', 'home'] },
      sidebar: {
        oneOf: [
          { type: 'boolean' },
          { type: 'object' },
        ],
      },
      aside: {
        oneOf: [
          { type: 'boolean' },
          { type: 'string' },
        ],
      },
      outline: {
        oneOf: [
          { type: 'boolean' },
          { type: 'string', enum: ['deep'] },
          { type: 'number' },
          {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
          },
        ],
      },
      editLink: { type: 'boolean' },
      lastUpdated: {
        oneOf: [
          { type: 'boolean' },
          { type: 'string' },
        ],
      },
      pageClass: { type: 'string' },
      hero: { type: 'object' },
      features: {
        type: 'array',
        items: { type: 'object' },
      },
      docsWiki: {
        type: 'object',
        required: ['schemaVersion', 'kind', 'project', 'template', 'generatedAt'],
        properties: {
          schemaVersion: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['summary', 'overview', 'feature-index', 'feature', 'design-index', 'design', 'reference-index', 'reference-redirect', 'module-index', 'workspace-index', 'module', 'workspace', 'file'],
          },
          project: { type: 'string' },
          template: { type: 'string' },
          themePreset: { type: 'string' },
          generatedAt: { type: 'string' },
          page: { type: 'string' },
          target: { type: 'string' },
          rootDir: { type: 'string' },
          directory: { type: 'string' },
          featureId: { type: 'string' },
          domain: { type: 'string' },
          action: { type: 'string' },
          packageFile: { type: 'string' },
          relativePath: { type: 'string' },
          absolutePath: { type: 'string' },
          module: { type: 'string' },
          workspace: { type: 'string' },
          language: { type: 'string' },
          fileCount: { type: 'number' },
          moduleCount: { type: 'number' },
          workspaceCount: { type: 'number' },
          featureCount: { type: 'number' },
          symbolCount: { type: 'number' },
          languages: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  }, null, 2);
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function writeFileIfChanged(target, content) {
  try {
    const current = await fs.readFile(target, 'utf8');
    if (current === content) {
      return false;
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  await ensureDir(path.dirname(target));
  await fs.writeFile(target, content, 'utf8');
  return true;
}

async function loadBundledMermaidBrowserScript() {
  const packageJsonPath = require.resolve('mermaid/package.json');
  const packageRoot = path.dirname(packageJsonPath);
  return fs.readFile(path.join(packageRoot, 'dist', 'mermaid.min.js'), 'utf8');
}

async function removeFileIfExists(target) {
  try {
    await fs.unlink(target);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function writeDocs(scanResult, options = {}) {
  const outputRoot = path.resolve(scanResult.rootDir, scanResult.outDir);
  const output = resolveOutputOptions(options.output);
  const previousManifest = options.previousManifest || null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const partialRender = Boolean(
    scanResult.incremental.enabled
    && previousManifest
    && previousManifest.cache
    && previousManifest.cache.renderKey === scanResult.cache.renderKey,
  );

  await ensureDir(outputRoot);
  await ensureDir(path.join(outputRoot, '.vitepress'));
  await ensureDir(path.join(outputRoot, '.vitepress', 'theme'));
  await ensureDir(path.join(outputRoot, 'public'));
  await ensureDir(path.join(outputRoot, 'features'));
  await ensureDir(path.join(outputRoot, 'design'));
  await ensureDir(path.join(outputRoot, 'reference'));
  await ensureDir(path.join(outputRoot, 'reference', 'files'));
  await ensureDir(path.join(outputRoot, 'reference', 'modules'));
  await ensureDir(path.join(outputRoot, 'files'));
  await ensureDir(path.join(outputRoot, 'modules'));
  await ensureDir(path.join(outputRoot, 'workspaces'));

  const currentFiles = new Set(scanResult.files.map((file) => file.relativePath));
  const previousFiles = new Set(previousManifest && Array.isArray(previousManifest.files) ? previousManifest.files.map((file) => file.relativePath) : []);
  for (const relativePath of previousFiles) {
    if (!currentFiles.has(relativePath)) {
      await removeFileIfExists(path.join(outputRoot, filePagePath(relativePath)));
      await removeFileIfExists(path.join(outputRoot, legacyFilePagePath(relativePath)));
    }
  }

  const currentModules = new Set(scanResult.directories.map((entry) => entry.directory));
  const previousModules = new Set(previousManifest && Array.isArray(previousManifest.directories) ? previousManifest.directories.map((entry) => entry.directory) : []);
  for (const directory of previousModules) {
    if (!currentModules.has(directory)) {
      await removeFileIfExists(path.join(outputRoot, modulePagePath(directory)));
      await removeFileIfExists(path.join(outputRoot, legacyModulePagePath(directory)));
    }
  }
  const currentWorkspaces = new Set(scanResult.workspaces.map((entry) => entry.directory));
  const previousWorkspaces = new Set(previousManifest && Array.isArray(previousManifest.workspaces) ? previousManifest.workspaces.map((entry) => entry.directory) : []);
  for (const directory of previousWorkspaces) {
    if (!currentWorkspaces.has(directory)) {
      await removeFileIfExists(path.join(outputRoot, workspacePagePath(directory)));
    }
  }

  const currentFeatures = new Set(getFeatures(scanResult).map((feature) => feature.slug));
  const previousFeatures = new Set(previousManifest && Array.isArray(previousManifest.features) ? previousManifest.features.map((feature) => feature.slug || feature.id) : []);
  for (const slug of previousFeatures) {
    if (!currentFeatures.has(slug)) {
      await removeFileIfExists(path.join(outputRoot, featurePagePath(slug)));
    }
  }

  const changedFileSet = partialRender
    ? new Set([...scanResult.incremental.changedFiles, ...scanResult.incremental.aiChangedFiles])
    : new Set(scanResult.files.map((file) => file.relativePath));
  const changedModuleSet = partialRender
    ? new Set([...scanResult.incremental.changedModules, ...scanResult.incremental.aiChangedModules])
    : new Set(scanResult.directories.map((entry) => entry.directory));
  const changedWorkspaceSet = partialRender
    ? new Set([...scanResult.incremental.changedWorkspaces, ...scanResult.incremental.aiChangedWorkspaces])
    : new Set(scanResult.workspaces.map((entry) => entry.directory));

  const moduleWriteCount = scanResult.directories.filter((module) => changedModuleSet.has(module.directory)).length;
  const workspaceWriteCount = scanResult.workspaces.filter((workspace) => changedWorkspaceSet.has(workspace.directory)).length;
  const fileWriteCount = scanResult.files.filter((file) => changedFileSet.has(file.relativePath)).length;
  const featureWriteCount = getFeatures(scanResult).length;
  const writeTotal = 19 + featureWriteCount + moduleWriteCount + workspaceWriteCount + (fileWriteCount * 2);
  let writeStep = 0;

  function tickWrite(detail) {
    writeStep += 1;
    onProgress?.({
      type: 'write_progress',
      current: writeStep,
      total: writeTotal,
      detail,
    });
  }

  await writeFileIfChanged(path.join(outputRoot, 'SUMMARY.md'), renderSummary(scanResult));
  tickWrite('SUMMARY.md');
  await writeFileIfChanged(path.join(outputRoot, 'index.md'), renderIndex(scanResult, output));
  tickWrite('index.md');
  await writeFileIfChanged(path.join(outputRoot, FEATURES_INDEX_FILE), renderFeatureIndex(scanResult));
  tickWrite('features/index.md');
  await writeFileIfChanged(path.join(outputRoot, DESIGN_INDEX_FILE), renderDesignIndex(scanResult));
  tickWrite('design/index.md');
  await writeFileIfChanged(path.join(outputRoot, BASIC_DESIGN_FILE), renderBasicDesign(scanResult));
  tickWrite('design/basic-design.md');
  await writeFileIfChanged(path.join(outputRoot, DETAIL_DESIGN_FILE), renderDetailDesign(scanResult));
  tickWrite('design/detail-design.md');
  await writeFileIfChanged(path.join(outputRoot, API_CONTRACTS_FILE), renderApiContracts(scanResult, output));
  tickWrite('design/api-contracts.md');
  await writeFileIfChanged(path.join(outputRoot, FLOW_CATALOG_FILE), renderFlowCatalog(scanResult, output));
  tickWrite('design/flows.md');
  await writeFileIfChanged(path.join(outputRoot, 'manifest.json'), JSON.stringify(scanResult, null, 2));
  tickWrite('manifest.json');
  await writeFileIfChanged(path.join(outputRoot, VITEPRESS_CONFIG_FILE), renderVitePressConfig(scanResult));
  tickWrite('.vitepress/config.mjs');
  await writeFileIfChanged(path.join(outputRoot, VITEPRESS_THEME_FILE), renderVitePressThemeEntry());
  tickWrite('.vitepress/theme/index.mjs');
  await writeFileIfChanged(path.join(outputRoot, MERMAID_BROWSER_SCRIPT_FILE), await loadBundledMermaidBrowserScript());
  tickWrite('public/mermaid.min.js');
  await writeFileIfChanged(path.join(outputRoot, VITEPRESS_SCHEMA_FILE), renderVitePressSchema());
  tickWrite('vitepress.schema.json');
  await writeFileIfChanged(path.join(outputRoot, SEARCH_INDEX_FILE), renderSearchIndex(scanResult, output));
  tickWrite('search-index.json');
  await writeFileIfChanged(path.join(outputRoot, THEME_STYLES_FILE), renderThemeStyles(output));
  tickWrite('public/docs-wiki.css');
  await writeFileIfChanged(path.join(outputRoot, REFERENCE_INDEX_FILE), renderReferenceIndex(scanResult));
  tickWrite('reference/index.md');
  await writeFileIfChanged(path.join(outputRoot, REFERENCE_MODULE_INDEX_FILE), renderModuleIndex(scanResult));
  tickWrite('reference/modules/index.md');
  await writeFileIfChanged(path.join(outputRoot, 'modules', 'index.md'), renderLegacyReferenceStub(scanResult, 'Module Index', path.join('modules', 'index.md'), REFERENCE_MODULE_INDEX_FILE));
  tickWrite('modules/index.md');
  await writeFileIfChanged(path.join(outputRoot, 'workspaces', 'index.md'), renderWorkspaceIndex(scanResult));
  tickWrite('workspaces/index.md');

  for (const feature of getFeatures(scanResult)) {
    const outputPath = path.join(outputRoot, featurePagePath(feature.slug));
    await writeFileIfChanged(outputPath, renderFeaturePage(scanResult, feature, output));
    tickWrite(`features/${feature.slug}.md`);
  }

  for (const module of scanResult.directories) {
    if (!changedModuleSet.has(module.directory)) {
      continue;
    }
    const content = renderModulePage(scanResult, module, output);
    await writeFileIfChanged(path.join(outputRoot, modulePagePath(module.directory)), content);
    tickWrite(`reference/modules/${module.directory || 'root'}.md`);
    await writeFileIfChanged(
      path.join(outputRoot, legacyModulePagePath(module.directory)),
      renderLegacyReferenceStub(
        scanResult,
        `Module ${module.directory || '(root)'}`,
        legacyModulePagePath(module.directory),
        modulePagePath(module.directory),
      ),
    );
    tickWrite(`modules/${module.directory || 'root'}.md`);
  }

  for (const workspace of scanResult.workspaces) {
    if (!changedWorkspaceSet.has(workspace.directory)) {
      continue;
    }
    const outputPath = path.join(outputRoot, workspacePagePath(workspace.directory));
    await writeFileIfChanged(outputPath, renderWorkspacePage(scanResult, workspace, output));
    tickWrite(`workspaces/${workspace.directory || 'root'}.md`);
  }

  for (const file of scanResult.files) {
    if (!changedFileSet.has(file.relativePath)) {
      continue;
    }
    const content = renderFilePage(scanResult, file, output);
    await writeFileIfChanged(path.join(outputRoot, filePagePath(file.relativePath)), content);
    tickWrite(`reference/files/${file.relativePath}.md`);
    await writeFileIfChanged(
      path.join(outputRoot, legacyFilePagePath(file.relativePath)),
      renderLegacyReferenceStub(
        scanResult,
        file.relativePath,
        legacyFilePagePath(file.relativePath),
        filePagePath(file.relativePath),
      ),
    );
    tickWrite(file.relativePath);
  }

  await ensureGitignoreOutDir(scanResult.rootDir, scanResult.outDir);

  return outputRoot;
}

module.exports = {
  writeDocs,
  renderVitePressThemeEntry,
  renderThemeStyles,
  loadBundledMermaidBrowserScript,
};
