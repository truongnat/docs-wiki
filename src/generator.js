const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_OUTPUT } = require('./config');

const VITEPRESS_SCHEMA_VERSION = '1.0.0';
const VITEPRESS_SCHEMA_FILE = 'vitepress.schema.json';
const VITEPRESS_CONFIG_FILE = path.join('.vitepress', 'config.mjs');
const SEARCH_INDEX_FILE = 'search-index.json';
const THEME_STYLES_FILE = path.join('public', 'docs-wiki.css');
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

function createFence(code, language) {
  const fence = code.includes('```') ? '````' : '```';
  return `${fence}${language}\n${code}\n${fence}`;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
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
        { text: 'Modules', link: '/modules/' },
        { text: 'Workspaces', link: '/workspaces/' },
      ],
      sidebar: {
        '/': [
          createSidebarGroup('Overview', [
            { text: 'Project Overview', link: '/' },
            { text: 'Summary', link: toVitePressLink('SUMMARY.md') },
            { text: 'Module Index', link: toVitePressLink(path.join('modules', 'index.md')) },
            { text: 'Workspace Index', link: toVitePressLink(path.join('workspaces', 'index.md')) },
          ]),
        ].filter(Boolean),
        '/modules/': [
          createSidebarGroup('Modules', [
            { text: 'Module Index', link: toVitePressLink(path.join('modules', 'index.md')) },
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
        '/files/': buildFileSidebarGroups(scanResult),
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

function renderSearchIndex(scanResult, output) {
  const entries = [];

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

  for (const module of scanResult.directories) {
    const workspace = getWorkspaceForModule(scanResult, module.directory);
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
      ].join(' '),
      keywords: ['module', module.directory || 'root', ...(workspace ? [workspace.name] : []), ...module.languages],
      meta: {
        directory: module.directory,
        workspace: workspace ? workspace.directory : '',
      },
    }));
  }

  for (const workspace of scanResult.workspaces) {
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

function filePagePath(relativePath) {
  return path.join('files', `${relativePath}.md`);
}

function modulePagePath(directory) {
  if (!directory) {
    return path.join('modules', 'root.md');
  }

  return path.join('modules', `${directory}.md`);
}

function workspacePagePath(directory) {
  if (!directory) {
    return path.join('workspaces', 'root.md');
  }

  return path.join('workspaces', `${directory}.md`);
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
    includeCodeBlocks: output && typeof output.includeCodeBlocks === 'boolean' ? output.includeCodeBlocks : DEFAULT_OUTPUT.includeCodeBlocks,
    includeAiSections: output && typeof output.includeAiSections === 'boolean' ? output.includeAiSections : DEFAULT_OUTPUT.includeAiSections,
    includeUsageNotes: output && typeof output.includeUsageNotes === 'boolean' ? output.includeUsageNotes : DEFAULT_OUTPUT.includeUsageNotes,
    highlightPublicApi: output && typeof output.highlightPublicApi === 'boolean' ? output.highlightPublicApi : DEFAULT_OUTPUT.highlightPublicApi,
  };
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
    '- [Module Index](modules/index.md)',
    '- [Workspace Index](workspaces/index.md)',
  ];

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

  if (output.includeAiSections && scanResult.ai && scanResult.ai.project && scanResult.ai.project.overview) {
    lines.push('## Overview', '', scanResult.ai.project.overview, '');
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
  lines.push('- [Module Index](modules/index.md)');
  lines.push('- [Workspace Index](workspaces/index.md)');
  lines.push(`- [Root Module](${toPosixPath(modulePagePath(''))})`);
  lines.push(`- [Root Workspace](${toPosixPath(workspacePagePath(''))})`);

  lines.push('', '## Language Breakdown', '');
  lines.push(...renderLanguageBreakdown(scanResult));

  const rankedModules = getSortedModules(scanResult).slice(0, 12);
  lines.push('', '## Key Modules', '');
  for (const module of rankedModules) {
    const title = module.directory || '(root)';
    const reason = output.includeAiSections ? getKeyModuleReason(scanResult, module.directory) : null;
    lines.push(`- [${title}](${toPosixPath(modulePagePath(module.directory))}) - ${formatCount(module.fileCount, 'file')}, ${formatCount(module.symbolCount, 'symbol')}`);
    if (reason) {
      lines.push(`  - ${reason}`);
    }
  }

  lines.push('', '## Workspaces', '');
  for (const workspace of scanResult.workspaces) {
    const title = workspace.directory || '(root)';
    lines.push(`- [${workspace.name}](${toPosixPath(workspacePagePath(workspace.directory))}) - ${formatCount(workspace.fileCount, 'file')}, ${formatCount(workspace.symbolCount, 'symbol')}`);
  }

  if (output.includeAiSections && scanResult.ai && scanResult.ai.project && Array.isArray(scanResult.ai.project.architecture) && scanResult.ai.project.architecture.length > 0) {
    lines.push('', '## Architecture Notes', '');
    for (const item of scanResult.ai.project.architecture) {
      lines.push(`- ${item}`);
    }
  }

  if (scanResult.errors.length > 0 || (scanResult.ai && Array.isArray(scanResult.ai.errors) && scanResult.ai.errors.length > 0)) {
    lines.push('', '## Errors', '');
    for (const entry of scanResult.errors) {
      lines.push(`- Parse: \`${entry.relativePath}\` - ${entry.message}`);
    }
    if (scanResult.ai) {
      for (const entry of scanResult.ai.errors) {
        lines.push(`- AI: \`${entry.scope}\` - ${entry.message}`);
      }
    }
  }

  lines.push('');
  const featureCards = [
    {
      icon: 'MAP',
      title: 'Structure Map',
      details: `${formatCount(scanResult.totals.directories, 'module')} and ${formatCount(scanResult.totals.workspaces, 'workspace')} mapped into dedicated index pages.`,
      link: '/modules/',
      linkText: 'Browse modules',
    },
    {
      icon: 'CODE',
      title: 'Source Coverage',
      details: `${formatCount(scanResult.totals.filesParsed, 'file')} and ${formatCount(scanResult.totals.symbols, 'symbol')} extracted across ${Object.keys(scanResult.languages || {}).length} supported languages.`,
      link: '/SUMMARY',
      linkText: 'Open summary',
    },
    {
      icon: 'SEARCH',
      title: 'Search Ready',
      details: 'Local VitePress search is enabled, and docs-wiki also emits a portable JSON search index.',
      link: '/workspaces/',
      linkText: 'Explore workspaces',
    },
    {
      icon: output.includeAiSections && scanResult.ai && scanResult.ai.enabled ? 'AI' : 'CFG',
      title: output.includeAiSections && scanResult.ai && scanResult.ai.enabled ? 'AI Enriched' : 'Deterministic Output',
      details: output.includeAiSections && scanResult.ai && scanResult.ai.enabled
        ? `Summaries generated with ${scanResult.ai.provider}/${scanResult.ai.model}.`
        : `Template ${output.template} with theme preset ${output.themePreset} and ${scanResult.incremental.mode} rendering.`,
      link: '/files/',
      linkText: 'Inspect file docs',
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
            ? scanResult.package.description
            : 'Generated internal docs wiki',
          tagline: `${formatCount(scanResult.totals.filesParsed, 'file')} · ${formatCount(scanResult.totals.symbols, 'symbol')} · ${formatCount(scanResult.totals.directories, 'module')} · theme ${output.themePreset}`,
          actions: [
            { theme: 'brand', text: 'Open Summary', link: '/SUMMARY' },
            { theme: 'alt', text: 'Browse Modules', link: '/modules/' },
          ],
        },
        features: featureCards,
      },
    }),
    lines.join('\n'),
  );
}

function renderModuleIndex(scanResult) {
  const lines = [
    '# Module Index',
    '',
    `- Project: [${scanResult.projectName} Docs Wiki](../index.md)`,
    '- Summary: [SUMMARY](../SUMMARY.md)',
    '- Workspaces: [Workspace Index](../workspaces/index.md)',
    '',
    '## Modules',
    '',
  ];

  for (const module of getSortedModules(scanResult)) {
    const title = module.directory || '(root)';
    lines.push(`- [${title}](${toPosixPath(path.relative('modules', modulePagePath(module.directory)))}) - ${formatCount(module.fileCount, 'file')}, ${formatCount(module.symbolCount, 'symbol')}`);
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
        page: 'modules/index',
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
    '- Modules: [Module Index](../modules/index.md)',
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
  const lines = [
    `# Module ${module.directory || '(root)'}`,
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Summary: [SUMMARY](${relativeLink(currentPath, 'SUMMARY.md')})`,
    `- Module index: [All modules](${relativeLink(currentPath, path.join('modules', 'index.md'))})`,
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
    lines.push('', '## Why It Matters', '', reason);
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
      const summary = output.includeAiSections && file && file.ai && file.ai.summary ? ` - ${file.ai.summary}` : '';
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
  const lines = [
    `# Workspace ${workspace.name}`,
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Summary: [SUMMARY](${relativeLink(currentPath, 'SUMMARY.md')})`,
    `- Workspace index: [All workspaces](${relativeLink(currentPath, path.join('workspaces', 'index.md'))})`,
    `- Module index: [All modules](${relativeLink(currentPath, path.join('modules', 'index.md'))})`,
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
    const summary = output.includeAiSections && file && file.ai && file.ai.summary ? ` - ${file.ai.summary}` : '';
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
  const lines = [
    `# ${file.relativePath}`,
    '',
    `- Overview: [${scanResult.projectName} Docs Wiki](${relativeLink(currentPath, 'index.md')})`,
    `- Summary: [SUMMARY](${relativeLink(currentPath, 'SUMMARY.md')})`,
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

  if (output.includeAiSections && file.ai && file.ai.summary) {
    lines.push('', '## AI Summary', '', file.ai.summary);

    if (Array.isArray(file.ai.responsibilities) && file.ai.responsibilities.length > 0) {
      lines.push('', '### Responsibilities', '');
      for (const item of file.ai.responsibilities) {
        lines.push(`- ${item}`);
      }
    }

    if (output.includeUsageNotes && Array.isArray(file.ai.usageNotes) && file.ai.usageNotes.length > 0) {
      lines.push('', '### Usage Notes', '');
      for (const item of file.ai.usageNotes) {
        lines.push(`- ${item}`);
      }
    }
  }

  if (output.highlightPublicApi) {
    const publicSymbols = getPublicSymbols(file);
    if (publicSymbols.length > 0) {
      lines.push('', '## Public API', '');
      for (const symbol of publicSymbols) {
        const symbolSummary = output.includeAiSections ? getSymbolSummary(file, symbol) : '';
        lines.push(`- \`${symbol.signature}\`${symbolSummary ? ` - ${symbolSummary}` : ''}`);
      }
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
      lines.push(`### ${symbol.kind} \`${symbol.name}\``);
      lines.push('');
      lines.push(`- Signature: \`${symbol.signature}\``);
      lines.push(`- Lines: ${symbol.startLine}-${symbol.endLine}`);
      lines.push(`- Exported: ${symbol.exported ? 'yes' : 'no'}`);
      if (symbolSummary) {
        lines.push(`- Summary: ${symbolSummary}`);
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
            enum: ['summary', 'overview', 'module-index', 'workspace-index', 'module', 'workspace', 'file'],
          },
          project: { type: 'string' },
          template: { type: 'string' },
          themePreset: { type: 'string' },
          generatedAt: { type: 'string' },
          page: { type: 'string' },
          rootDir: { type: 'string' },
          directory: { type: 'string' },
          packageFile: { type: 'string' },
          relativePath: { type: 'string' },
          absolutePath: { type: 'string' },
          module: { type: 'string' },
          workspace: { type: 'string' },
          language: { type: 'string' },
          fileCount: { type: 'number' },
          moduleCount: { type: 'number' },
          workspaceCount: { type: 'number' },
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
  const partialRender = Boolean(
    scanResult.incremental.enabled
    && previousManifest
    && previousManifest.cache
    && previousManifest.cache.renderKey === scanResult.cache.renderKey,
  );

  await ensureDir(outputRoot);
  await ensureDir(path.join(outputRoot, '.vitepress'));
  await ensureDir(path.join(outputRoot, 'public'));
  await ensureDir(path.join(outputRoot, 'files'));
  await ensureDir(path.join(outputRoot, 'modules'));
  await ensureDir(path.join(outputRoot, 'workspaces'));

  const currentFiles = new Set(scanResult.files.map((file) => file.relativePath));
  const previousFiles = new Set(previousManifest && Array.isArray(previousManifest.files) ? previousManifest.files.map((file) => file.relativePath) : []);
  for (const relativePath of previousFiles) {
    if (!currentFiles.has(relativePath)) {
      await removeFileIfExists(path.join(outputRoot, filePagePath(relativePath)));
    }
  }

  const currentModules = new Set(scanResult.directories.map((entry) => entry.directory));
  const previousModules = new Set(previousManifest && Array.isArray(previousManifest.directories) ? previousManifest.directories.map((entry) => entry.directory) : []);
  for (const directory of previousModules) {
    if (!currentModules.has(directory)) {
      await removeFileIfExists(path.join(outputRoot, modulePagePath(directory)));
    }
  }
  const currentWorkspaces = new Set(scanResult.workspaces.map((entry) => entry.directory));
  const previousWorkspaces = new Set(previousManifest && Array.isArray(previousManifest.workspaces) ? previousManifest.workspaces.map((entry) => entry.directory) : []);
  for (const directory of previousWorkspaces) {
    if (!currentWorkspaces.has(directory)) {
      await removeFileIfExists(path.join(outputRoot, workspacePagePath(directory)));
    }
  }

  await writeFileIfChanged(path.join(outputRoot, 'SUMMARY.md'), renderSummary(scanResult));
  await writeFileIfChanged(path.join(outputRoot, 'index.md'), renderIndex(scanResult, output));
  await writeFileIfChanged(path.join(outputRoot, 'manifest.json'), JSON.stringify(scanResult, null, 2));
  await writeFileIfChanged(path.join(outputRoot, VITEPRESS_CONFIG_FILE), renderVitePressConfig(scanResult));
  await writeFileIfChanged(path.join(outputRoot, VITEPRESS_SCHEMA_FILE), renderVitePressSchema());
  await writeFileIfChanged(path.join(outputRoot, SEARCH_INDEX_FILE), renderSearchIndex(scanResult, output));
  await writeFileIfChanged(path.join(outputRoot, THEME_STYLES_FILE), renderThemeStyles(output));
  await writeFileIfChanged(path.join(outputRoot, 'modules', 'index.md'), renderModuleIndex(scanResult));
  await writeFileIfChanged(path.join(outputRoot, 'workspaces', 'index.md'), renderWorkspaceIndex(scanResult));

  const changedFileSet = partialRender
    ? new Set([...scanResult.incremental.changedFiles, ...scanResult.incremental.aiChangedFiles])
    : new Set(scanResult.files.map((file) => file.relativePath));
  const changedModuleSet = partialRender
    ? new Set([...scanResult.incremental.changedModules, ...scanResult.incremental.aiChangedModules])
    : new Set(scanResult.directories.map((entry) => entry.directory));
  const changedWorkspaceSet = partialRender
    ? new Set([...scanResult.incremental.changedWorkspaces, ...scanResult.incremental.aiChangedWorkspaces])
    : new Set(scanResult.workspaces.map((entry) => entry.directory));

  for (const module of scanResult.directories) {
    if (!changedModuleSet.has(module.directory)) {
      continue;
    }
    const outputPath = path.join(outputRoot, modulePagePath(module.directory));
    await writeFileIfChanged(outputPath, renderModulePage(scanResult, module, output));
  }

  for (const workspace of scanResult.workspaces) {
    if (!changedWorkspaceSet.has(workspace.directory)) {
      continue;
    }
    const outputPath = path.join(outputRoot, workspacePagePath(workspace.directory));
    await writeFileIfChanged(outputPath, renderWorkspacePage(scanResult, workspace, output));
  }

  for (const file of scanResult.files) {
    if (!changedFileSet.has(file.relativePath)) {
      continue;
    }
    const outputPath = path.join(outputRoot, filePagePath(file.relativePath));
    await writeFileIfChanged(outputPath, renderFilePage(scanResult, file, output));
  }

  return outputRoot;
}

module.exports = {
  writeDocs,
};
