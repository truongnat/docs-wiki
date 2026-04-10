const fs = require('node:fs/promises');
const path = require('node:path');
const fg = require('fast-glob');
const { LANGUAGE_CONFIGS, createParser } = require('./languages');
const { hashText } = require('./hash');
const { DEFAULT_OUT_DIR } = require('./config');

const DEFAULT_IGNORES = [
  '**/.git/**',
  '**/.*/**',
  '**/node_modules/**',
  '**/agent/**',
  '**/agents/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/.parcel-cache/**',
  '**/.vite/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/.idea/**',
  '**/.vscode/**',
  '**/.dart_tool/**',
  '**/ios/Pods/**',
  '**/ios/.symlinks/**',
  '**/android/.gradle/**',
  '**/android/app/build/**',
];

const SUPPORTED_EXTENSIONS = new Set(Object.keys(LANGUAGE_CONFIGS));
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL'];
const GENERIC_GROUP_SEGMENTS = new Set([
  'api', 'apis', 'src', 'app', 'apps', 'pages', 'page', 'routes', 'route', 'router', 'controllers',
  'controller', 'handlers', 'handler', 'server', 'services', 'service', 'modules', 'module', 'lib',
  'internal', 'v1', 'v2', 'v3',
]);
const ACTION_LIKE_GROUP_SEGMENTS = new Set([
  'login', 'signin', 'logout', 'signout', 'register', 'signup', 'refresh', 'verify', 'reset',
  'create', 'update', 'delete', 'remove', 'list', 'search', 'get',
]);
const TYPE_EXPRESSION_IGNORES = new Set([
  'Promise', 'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Readonly',
  'ReturnType', 'Awaited', 'unknown', 'string', 'number', 'boolean', 'null', 'undefined', 'void',
  'any', 'object', 'Date', 'Error', 'Request', 'Response', 'NextRequest', 'NextResponse',
  'NextApiRequest', 'ZodSchema', 'ZodType', 'z',
]);

function supportedExtensions() {
  return Object.keys(LANGUAGE_CONFIGS).sort();
}

function buildPatterns(includePatterns) {
  if (Array.isArray(includePatterns) && includePatterns.length > 0) {
    return includePatterns;
  }

  const parts = supportedExtensions().map((value) => value.slice(1));
  return [`**/*.{${parts.join(',')}}`];
}

function normalizeOutDir(outDir) {
  if (!outDir) {
    return '';
  }
  let s = String(outDir).replace(/\\/g, '/');
  if (s.startsWith('./')) {
    s = s.slice(2);
  }
  return s.replace(/\/$/, '');
}

async function discoverFiles(rootDir, outDir, maxFiles = Infinity, includePatterns = [], customIgnores = []) {
  const normalizedOutDir = normalizeOutDir(outDir);
  const entries = await fg(buildPatterns(includePatterns), {
    cwd: rootDir,
    onlyFiles: true,
    dot: true,
    unique: true,
    absolute: false,
    followSymbolicLinks: false,
    ignore: normalizedOutDir ? [...DEFAULT_IGNORES, ...customIgnores, `${normalizedOutDir}/**`] : [...DEFAULT_IGNORES, ...customIgnores],
  });

  const sorted = entries.sort((left, right) => left.localeCompare(right));
  return Number.isFinite(maxFiles) ? sorted.slice(0, maxFiles) : sorted;
}

async function createPackageMetadata(rootDir) {
  return fs.readFile(path.join(rootDir, 'package.json'), 'utf8')
    .then((contents) => {
      const parsed = JSON.parse(contents);
      return {
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : path.basename(rootDir),
        version: typeof parsed.version === 'string' ? parsed.version : null,
        description: typeof parsed.description === 'string' ? parsed.description : null,
      };
    })
    .catch(() => ({
      name: path.basename(rootDir),
      version: null,
      description: null,
    }));
}

/**
 * Lists extensions present under root that Tree-sitter does not parse (for --verbose hints).
 * Uses a broad glob; only runs when explicitly requested.
 */
async function computeUnindexedExtensionStats(rootDir, outDir, customIgnores = []) {
  const normalizedOutDir = normalizeOutDir(outDir);
  const entries = await fg(['**/*'], {
    cwd: rootDir,
    onlyFiles: true,
    dot: true,
    unique: true,
    absolute: false,
    followSymbolicLinks: false,
    ignore: normalizedOutDir ? [...DEFAULT_IGNORES, ...customIgnores, `${normalizedOutDir}/**`] : [...DEFAULT_IGNORES, ...customIgnores],
  });

  const counts = new Map();
  let unindexedFileCount = 0;

  for (const relativePath of entries) {
    const ext = path.extname(relativePath).toLowerCase();
    if (!ext) {
      continue;
    }
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      continue;
    }
    unindexedFileCount += 1;
    counts.set(ext, (counts.get(ext) || 0) + 1);
  }

  const otherExtensions = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 36);

  return {
    unindexedFileCount,
    otherExtensions,
  };
}

async function discoverWorkspacePackages(rootDir, outDir, customIgnores = []) {
  const normalizedOutDir = normalizeOutDir(outDir);
  const packageFiles = await fg(['package.json', '**/package.json'], {
    cwd: rootDir,
    onlyFiles: true,
    dot: true,
    unique: true,
    absolute: false,
    followSymbolicLinks: false,
    ignore: normalizedOutDir ? [...DEFAULT_IGNORES, ...customIgnores, `${normalizedOutDir}/**`] : [...DEFAULT_IGNORES, ...customIgnores],
  });

  const workspaces = [];
  for (const relativePackagePath of packageFiles.sort((left, right) => left.localeCompare(right))) {
    try {
      const directory = path.posix.dirname(relativePackagePath === 'package.json' ? '.' : relativePackagePath).replace(/^\.$/, '');
      const contents = await fs.readFile(path.join(rootDir, relativePackagePath), 'utf8');
      const parsed = JSON.parse(contents);
      workspaces.push({
        directory,
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : directory || path.basename(rootDir),
        version: typeof parsed.version === 'string' ? parsed.version : null,
        description: typeof parsed.description === 'string' ? parsed.description : null,
        relativePackagePath,
        isRoot: directory === '',
      });
    } catch (_error) {
      // Ignore malformed nested package.json files; source scanning should keep running.
    }
  }

  if (!workspaces.some((entry) => entry.directory === '')) {
    workspaces.unshift({
      directory: '',
      name: path.basename(rootDir),
      version: null,
      description: null,
      relativePackagePath: 'package.json',
      isRoot: true,
    });
  }

  return workspaces.sort((left, right) => left.directory.localeCompare(right.directory));
}

async function readPreviousManifest(rootDir, outDir) {
  try {
    const contents = await fs.readFile(path.join(rootDir, outDir, 'manifest.json'), 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function createDirectoryMap(files) {
  const map = new Map();

  function ensure(directory) {
    if (!map.has(directory)) {
      map.set(directory, {
        directory,
        name: directory === '' ? '(root)' : path.basename(directory),
        depth: directory === '' ? 0 : directory.split('/').length,
        childDirectories: new Set(),
        directFiles: [],
        fileCount: 0,
        symbolCount: 0,
        languages: new Set(),
      });
    }
    return map.get(directory);
  }

  ensure('');

  for (const file of files) {
    const normalizedPath = file.relativePath.split(path.sep).join('/');
    const segments = normalizedPath.split('/');
    const parentSegments = segments.slice(0, -1);
    let current = '';

    for (const segment of parentSegments) {
      const next = current ? `${current}/${segment}` : segment;
      ensure(current).childDirectories.add(next);
      current = next;
      ensure(current);
    }

    ensure(current).directFiles.push(file.relativePath);

    const ancestors = [''];
    if (parentSegments.length > 0) {
      let cursor = '';
      for (const segment of parentSegments) {
        cursor = cursor ? `${cursor}/${segment}` : segment;
        ancestors.push(cursor);
      }
    }

    for (const directory of ancestors) {
      const entry = ensure(directory);
      entry.fileCount += 1;
      entry.symbolCount += file.symbols.length;
      entry.languages.add(file.language);
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      directory: entry.directory,
      name: entry.name,
      depth: entry.depth,
      childDirectories: Array.from(entry.childDirectories).sort(),
      directFiles: entry.directFiles.slice().sort((left, right) => left.localeCompare(right)),
      fileCount: entry.fileCount,
      symbolCount: entry.symbolCount,
      languages: Array.from(entry.languages).sort(),
    }))
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

function createLanguageBreakdown(files) {
  const breakdown = {};
  for (const file of files) {
    if (!breakdown[file.language]) {
      breakdown[file.language] = { files: 0, symbols: 0 };
    }
    breakdown[file.language].files += 1;
    breakdown[file.language].symbols += file.symbols.length;
  }
  return breakdown;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function parseJsNamedBindings(clause, specifier, bindings) {
  const inner = clause.trim().replace(/^\{/, '').replace(/\}$/, '');
  for (const part of inner.split(',')) {
    const token = part.trim().replace(/^type\s+/i, '');
    if (!token) {
      continue;
    }
    const match = token.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    if (!match) {
      continue;
    }
    bindings.push({
      specifier,
      imported: match[1],
      local: match[2] || match[1],
      kind: 'named',
    });
  }
}

function parseJsImportClause(clause, specifier, bindings) {
  const trimmed = clause.trim();
  if (!trimmed) {
    return;
  }

  if (trimmed.startsWith('{')) {
    parseJsNamedBindings(trimmed, specifier, bindings);
    return;
  }

  if (trimmed.startsWith('* as ')) {
    const namespace = trimmed.slice(5).trim();
    if (namespace) {
      bindings.push({
        specifier,
        imported: '*',
        local: namespace,
        kind: 'namespace',
      });
    }
    return;
  }

  if (trimmed.includes('{')) {
    const braceIndex = trimmed.indexOf('{');
    const defaultPart = trimmed.slice(0, braceIndex).replace(/,$/, '').trim();
    if (defaultPart) {
      bindings.push({
        specifier,
        imported: 'default',
        local: defaultPart,
        kind: 'default',
      });
    }
    parseJsNamedBindings(trimmed.slice(braceIndex), specifier, bindings);
    return;
  }

  bindings.push({
    specifier,
    imported: 'default',
    local: trimmed,
    kind: 'default',
  });
}

function parsePythonImportBindings(source, imports, bindings) {
  for (const match of source.matchAll(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+([A-Za-z0-9_,\s]+)/gm)) {
    const specifier = match[1];
    imports.push(specifier);
    for (const part of match[2].split(',')) {
      const token = part.trim();
      if (!token) {
        continue;
      }
      const aliasMatch = token.match(/^([A-Za-z_][\w]*)(?:\s+as\s+([A-Za-z_][\w]*))?$/i);
      if (!aliasMatch) {
        continue;
      }
      bindings.push({
        specifier,
        imported: aliasMatch[1],
        local: aliasMatch[2] || aliasMatch[1],
        kind: 'named',
      });
    }
  }

  for (const match of source.matchAll(/^\s*import\s+([A-Za-z0-9_.,\s]+)/gm)) {
    for (const part of match[1].split(',')) {
      const token = part.trim();
      if (!token) {
        continue;
      }
      const aliasMatch = token.match(/^([A-Za-z0-9_\.]+)(?:\s+as\s+([A-Za-z_][\w]*))?$/i);
      if (!aliasMatch) {
        continue;
      }
      imports.push(aliasMatch[1]);
      bindings.push({
        specifier: aliasMatch[1],
        imported: aliasMatch[1].split('.').pop(),
        local: aliasMatch[2] || aliasMatch[1].split('.').pop(),
        kind: 'module',
      });
    }
  }
}

function extractDependencies(extension, source) {
  const imports = [];
  const importBindings = [];

  if (['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx'].includes(extension)) {
    for (const match of source.matchAll(/\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      imports.push(match[2]);
      parseJsImportClause(match[1], match[2], importBindings);
    }
    for (const match of source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
      imports.push(match[1]);
    }
    for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      imports.push(match[1]);
    }
    for (const match of source.matchAll(/\b(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      imports.push(match[2]);
      for (const part of match[1].split(',')) {
        const token = part.trim();
        if (!token) {
          continue;
        }
        const [importedRaw, localRaw] = token.split(':').map((entry) => entry && entry.trim());
        const imported = importedRaw && importedRaw.replace(/^type\s+/i, '');
        const local = (localRaw || imported) && (localRaw || imported).replace(/^type\s+/i, '');
        if (!imported || !local) {
          continue;
        }
        importBindings.push({
          specifier: match[2],
          imported,
          local,
          kind: 'named',
        });
      }
    }
    for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      imports.push(match[2]);
      importBindings.push({
        specifier: match[2],
        imported: 'default',
        local: match[1],
        kind: 'default',
      });
    }
    for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      imports.push(match[1]);
    }
  } else if (extension === '.py') {
    parsePythonImportBindings(source, imports, importBindings);
  } else if (extension === '.go') {
    for (const match of source.matchAll(/import\s+(?:\(([\s\S]*?)\)|"([^"]+)")/g)) {
      if (match[2]) {
        imports.push(match[2]);
        continue;
      }
      if (match[1]) {
        for (const nested of match[1].matchAll(/"([^"]+)"/g)) {
          imports.push(nested[1]);
        }
      }
    }
  } else if (extension === '.rs') {
    for (const match of source.matchAll(/^\s*use\s+([^;]+);/gm)) {
      imports.push(match[1].trim());
    }
  }

  return {
    imports: uniqueSorted(imports),
    importBindings: importBindings
      .filter((binding) => binding && binding.specifier && binding.local)
      .sort((left, right) => (
        left.specifier.localeCompare(right.specifier)
        || left.local.localeCompare(right.local)
      )),
  };
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function offsetToLine(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function skipWhitespace(source, index) {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function extractBalanced(source, startIndex, openChar, closeChar) {
  if (source[startIndex] !== openChar) {
    return null;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          text: source.slice(startIndex, index + 1),
          endIndex: index,
        };
      }
    }
  }

  return null;
}

function splitTopLevel(text, separatorChar = ',') {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;

    if (char === separatorChar && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function normalizeBindingName(value) {
  return String(value || '')
    .replace(/^[.\s]+/, '')
    .replace(/\?.*$/, '')
    .replace(/=.*$/, '')
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\s+as\s+.+$/i, '')
    .replace(/^\.{3}/, '')
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractDestructuredKeys(fragment) {
  return splitTopLevel(fragment)
    .map((part) => normalizeBindingName(part.split(':')[0]))
    .filter((value) => /^[A-Za-z_$][\w$-]*$/.test(value));
}

function extractTopLevelObjectKeys(objectLiteral) {
  if (!objectLiteral || objectLiteral[0] !== '{' || objectLiteral[objectLiteral.length - 1] !== '}') {
    return [];
  }

  const inner = objectLiteral.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  const keys = [];
  for (const part of splitTopLevel(inner)) {
    if (part.startsWith('...')) {
      continue;
    }
    const explicitMatch = part.match(/^["'`]?([A-Za-z_$][\w$-]*)["'`]?\s*:/);
    if (explicitMatch) {
      keys.push(explicitMatch[1]);
      continue;
    }
    const shorthandMatch = part.match(/^([A-Za-z_$][\w$]*)$/);
    if (shorthandMatch) {
      keys.push(shorthandMatch[1]);
    }
  }

  return uniqueStrings(keys);
}

function extractLeadingObjectLiteral(source, openParenIndex) {
  const valueStart = skipWhitespace(source, openParenIndex + 1);
  if (source[valueStart] !== '{') {
    return null;
  }
  return extractBalanced(source, valueStart, '{', '}');
}

function extractStatusFromOptions(optionsText) {
  const match = optionsText && optionsText.match(/\bstatus\s*:\s*(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function inferNextRoutePath(relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const dynamicToParam = (value) => value.replace(/\[([^\]]+)\]/g, ':$1');

  if (/^(?:src\/)?app\/api\/.+\/route\.(?:[cm]?js|jsx|ts|tsx)$/.test(normalizedPath)) {
    const apiPath = normalizedPath
      .replace(/^(?:src\/)?app\/api\//, '')
      .replace(/\/route\.(?:[cm]?js|jsx|ts|tsx)$/, '');
    return `/api/${dynamicToParam(apiPath)}`;
  }

  if (/^(?:src\/)?pages\/api\/.+\.(?:[cm]?js|jsx|ts|tsx)$/.test(normalizedPath)) {
    const apiPath = normalizedPath
      .replace(/^(?:src\/)?pages\/api\//, '')
      .replace(/\.(?:[cm]?js|jsx|ts|tsx)$/, '')
      .replace(/\/index$/, '');
    return `/api/${dynamicToParam(apiPath)}`;
  }

  return null;
}

function inferEndpointGroupFromPath(routePath) {
  const segments = String(routePath || '')
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(':') && !segment.startsWith('[') && !GENERIC_GROUP_SEGMENTS.has(segment));

  return segments[0] || null;
}

function inferEndpointGroupFromDirectory(directory) {
  const segments = String(directory || '')
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)
    .filter((segment) => !GENERIC_GROUP_SEGMENTS.has(segment));

  return segments.length > 0 ? segments[segments.length - 1] : null;
}

function getHandlerSnippet(symbols, handlerName, source) {
  if (!handlerName) {
    return source;
  }
  const symbol = symbols.find((entry) => entry.name === handlerName);
  return symbol && symbol.code ? symbol.code : source;
}

function collectRequestSignals(source) {
  const bodyKeys = new Set();
  const queryKeys = new Set();
  const paramKeys = new Set();
  const headerKeys = new Set();

  for (const match of source.matchAll(/\b(?:req|request)\.body\.([A-Za-z_$][\w$]*)/g)) {
    bodyKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:req|request)\.query\.([A-Za-z_$][\w$]*)/g)) {
    queryKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:req|request)\.params\.([A-Za-z_$][\w$]*)/g)) {
    paramKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:req|request)\.headers\.([A-Za-z_$][\w$-]*)/g)) {
    headerKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:req|request)\.headers\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) {
    headerKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:req|request)\.get\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    headerKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:req|request)\.headers\.get\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    headerKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\bsearchParams\.get\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    queryKeys.add(match[1]);
  }
  for (const match of source.matchAll(/\bconst\s*\{([^}]+)\}\s*=\s*(?:req|request)\.body\b/g)) {
    for (const key of extractDestructuredKeys(match[1])) {
      bodyKeys.add(key);
    }
  }
  for (const match of source.matchAll(/\bconst\s*\{([^}]+)\}\s*=\s*(?:req|request)\.query\b/g)) {
    for (const key of extractDestructuredKeys(match[1])) {
      queryKeys.add(key);
    }
  }
  for (const match of source.matchAll(/\bconst\s*\{([^}]+)\}\s*=\s*(?:req|request)\.params\b/g)) {
    for (const key of extractDestructuredKeys(match[1])) {
      paramKeys.add(key);
    }
  }
  for (const match of source.matchAll(/\bconst\s*\{([^}]+)\}\s*=\s*await\s+(?:req|request)\.json\(\s*\)/g)) {
    for (const key of extractDestructuredKeys(match[1])) {
      bodyKeys.add(key);
    }
  }

  const bodyVars = [];
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:req|request)\.json\(\s*\)/g)) {
    bodyVars.push(match[1]);
  }
  for (const bodyVar of bodyVars) {
    const propertyPattern = new RegExp(`\\b${bodyVar.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\.([A-Za-z_$][\\w$]*)`, 'g');
    for (const match of source.matchAll(propertyPattern)) {
      bodyKeys.add(match[1]);
    }
    const destructuringPattern = new RegExp(`\\bconst\\s*\\{([^}]+)\\}\\s*=\\s*${bodyVar.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'g');
    for (const match of source.matchAll(destructuringPattern)) {
      for (const key of extractDestructuredKeys(match[1])) {
        bodyKeys.add(key);
      }
    }
  }

  return {
    bodyKeys: uniqueStrings(Array.from(bodyKeys)),
    queryKeys: uniqueStrings(Array.from(queryKeys)),
    paramKeys: uniqueStrings(Array.from(paramKeys)),
    headerKeys: uniqueStrings(Array.from(headerKeys)),
  };
}

function collectResponseSignals(source) {
  const responses = [];
  const seen = new Set();

  function addResponse(status, transport, bodyKeys) {
    const normalizedStatus = Number.isFinite(status) ? status : 200;
    const normalizedKeys = uniqueStrings(bodyKeys);
    const key = `${normalizedStatus}:${transport}:${normalizedKeys.join(',')}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    responses.push({
      status: normalizedStatus,
      transport,
      bodyKeys: normalizedKeys,
    });
  }

  for (const match of source.matchAll(/\b(?:res|response)\.status\(\s*(\d{3})\s*\)\.(json|send)\s*\(/g)) {
    const objectLiteral = extractLeadingObjectLiteral(source, match.index + match[0].length - 1);
    addResponse(Number(match[1]), match[2], objectLiteral ? extractTopLevelObjectKeys(objectLiteral.text) : []);
  }

  for (const match of source.matchAll(/\b(?:res|response)\.(json|send)\s*\(/g)) {
    const objectLiteral = extractLeadingObjectLiteral(source, match.index + match[0].length - 1);
    addResponse(200, match[1], objectLiteral ? extractTopLevelObjectKeys(objectLiteral.text) : []);
  }

  for (const match of source.matchAll(/\b(?:NextResponse|Response)\.json\s*\(/g)) {
    const call = extractBalanced(source, match.index + match[0].length - 1, '(', ')');
    const objectLiteral = extractLeadingObjectLiteral(source, match.index + match[0].length - 1);
    const status = call ? extractStatusFromOptions(call.text) : null;
    addResponse(status || 200, 'json', objectLiteral ? extractTopLevelObjectKeys(objectLiteral.text) : []);
  }

  return responses.sort((left, right) => left.status - right.status || left.transport.localeCompare(right.transport));
}

function extractTypeFieldKeys(typeSource) {
  if (!typeSource) {
    return [];
  }

  const braceStart = typeSource.indexOf('{');
  if (braceStart === -1) {
    return [];
  }
  const balanced = extractBalanced(typeSource, braceStart, '{', '}');
  if (!balanced) {
    return [];
  }

  const keys = new Set();
  for (const line of balanced.text.slice(1, -1).split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\/\/.*$/, '');
    if (!trimmed || trimmed.startsWith('[')) {
      continue;
    }
    const match = trimmed.match(/^["'`]?([A-Za-z_$][\w$-]*)["'`]?\??\s*:/);
    if (match) {
      keys.add(match[1]);
    }
  }

  return uniqueStrings(Array.from(keys));
}

function extractTypeIdentifiers(typeExpression) {
  return uniqueStrings(
    (String(typeExpression || '').match(/[A-Za-z_$][\w$]*/g) || [])
      .filter((token) => !TYPE_EXPRESSION_IGNORES.has(token)),
  );
}

function extractSchemaDefinitions(extension, source, symbols) {
  if (!['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx'].includes(extension)) {
    return [];
  }

  const definitions = [];
  const seen = new Set();

  function addDefinition(definition) {
    if (!definition || !definition.name || seen.has(definition.name)) {
      return;
    }
    seen.add(definition.name);
    definitions.push(definition);
  }

  for (const symbol of symbols || []) {
    if (!['interface', 'type', 'class'].includes(symbol.kind)) {
      continue;
    }
    const fields = extractTypeFieldKeys(symbol.code);
    if (fields.length === 0 && !/(Request|Response|Dto|DTO|Body|Params|Query|Input|Output|Payload)/.test(symbol.name)) {
      continue;
    }
    addDefinition({
      name: symbol.name,
      kind: symbol.kind,
      source: 'type',
      fields,
      exported: Boolean(symbol.exported),
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    });
  }

  for (const match of source.matchAll(/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*z\.object\s*\(/g)) {
    const valueStart = skipWhitespace(source, match.index + match[0].length);
    const objectLiteral = extractBalanced(source, valueStart, '{', '}');
    addDefinition({
      name: match[1],
      kind: 'schema',
      source: 'zod',
      fields: objectLiteral ? extractTopLevelObjectKeys(objectLiteral.text) : [],
      exported: /\bexport\s+const\b/.test(match[0]),
      startLine: offsetToLine(source, match.index),
      endLine: objectLiteral ? offsetToLine(source, objectLiteral.endIndex) : offsetToLine(source, match.index),
    });
  }

  return definitions.sort((left, right) => left.name.localeCompare(right.name));
}

function collectSchemaHints(source) {
  const requestBodyRefs = new Set();
  const responseRefs = new Set();
  const jsonBodyVars = new Set();

  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:req|request)\.json\(\s*\)/g)) {
    jsonBodyVars.add(match[1]);
  }

  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\.(?:parse|safeParse)\(\s*(?:req|request)\.body\b/g)) {
    requestBodyRefs.add(match[1]);
  }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\.(?:parse|safeParse)\(\s*await\s+(?:req|request)\.json\(\s*\)/g)) {
    requestBodyRefs.add(match[1]);
  }
  for (const bodyVar of jsonBodyVars) {
    const bodyVarPattern = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\.(?:parse|safeParse)\\(\\s*${bodyVar.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'g');
    for (const match of source.matchAll(bodyVarPattern)) {
      requestBodyRefs.add(match[1]);
    }
  }

  for (const match of source.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*([^=]+?)\s*=\s*(?:req|request)\.body\b/g)) {
    for (const identifier of extractTypeIdentifiers(match[1])) {
      requestBodyRefs.add(identifier);
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*([^=]+?)\s*=\s*await\s+(?:req|request)\.json\(\s*\)/g)) {
    for (const identifier of extractTypeIdentifiers(match[1])) {
      requestBodyRefs.add(identifier);
    }
  }

  for (const match of source.matchAll(/\b(?:res|response)\s*:\s*NextApiResponse<([^>]+)>/g)) {
    for (const identifier of extractTypeIdentifiers(match[1])) {
      responseRefs.add(identifier);
    }
  }
  for (const match of source.matchAll(/\b(?:NextResponse|Response)\.json<([^>]+)>\s*\(/g)) {
    for (const identifier of extractTypeIdentifiers(match[1])) {
      responseRefs.add(identifier);
    }
  }

  return {
    requestBodyRefs: uniqueStrings(Array.from(requestBodyRefs)),
    responseRefs: uniqueStrings(Array.from(responseRefs)),
  };
}

function buildOperationId(relativePath, method, routePath, handlerName) {
  const filePart = relativePath.replace(/\\/g, '/').replace(/[/.]+/g, '_').replace(/^_+|_+$/g, '');
  const pathPart = String(routePath || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return uniqueStrings([method.toLowerCase(), pathPart, handlerName, filePart]).join('_');
}

function inferApiContracts(relativePath, extension, source, symbols) {
  if (!['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx'].includes(extension)) {
    return [];
  }

  const endpoints = [];
  const seen = new Set();
  const addEndpoint = ({ framework, method, routePath, handlerName, offset }) => {
    const normalizedMethod = String(method || '').toUpperCase();
    if (!HTTP_METHODS.includes(normalizedMethod)) {
      return;
    }
    const normalizedPath = String(routePath || '').trim();
    if (!normalizedPath) {
      return;
    }
    const directory = path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath).split(path.sep).join('/');
    const handlerSource = getHandlerSnippet(symbols, handlerName, source);
    const request = collectRequestSignals(handlerSource);
    const responses = collectResponseSignals(handlerSource);
    const schemaHints = collectSchemaHints(handlerSource);
    const id = `${normalizedMethod}:${normalizedPath}:${relativePath}:${handlerName || offsetToLine(source, offset)}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const pathGroup = inferEndpointGroupFromPath(normalizedPath);
    const directoryGroup = inferEndpointGroupFromDirectory(directory);
    const effectiveGroup = pathGroup && !ACTION_LIKE_GROUP_SEGMENTS.has(pathGroup)
      ? pathGroup
      : directoryGroup || pathGroup || 'general';

    endpoints.push({
      id,
      operationId: buildOperationId(relativePath, normalizedMethod, normalizedPath, handlerName),
      kind: 'http',
      framework,
      method: normalizedMethod,
      path: normalizedPath,
      file: relativePath,
      directory,
      group: effectiveGroup,
      handler: handlerName || null,
      line: offsetToLine(source, offset),
      request,
      responses,
      schemaHints,
    });
  };

  for (const match of source.matchAll(/\b(?:router|app)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*(['"`])([^'"`]+)\2\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    addEndpoint({
      framework: 'express',
      method: match[1],
      routePath: match[3],
      handlerName: match[4],
      offset: match.index,
    });
  }

  for (const match of source.matchAll(/\b(?:router|app)\.route\(\s*(['"`])([^'"`]+)\1\s*\)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
    addEndpoint({
      framework: 'express',
      method: match[3],
      routePath: match[2],
      handlerName: match[4],
      offset: match.index,
    });
  }

  const nextRoutePath = inferNextRoutePath(relativePath);
  if (nextRoutePath) {
    for (const match of source.matchAll(/\bexport\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/g)) {
      addEndpoint({
        framework: 'next',
        method: match[1],
        routePath: nextRoutePath,
        handlerName: match[1],
        offset: match.index,
      });
    }
  }

  return endpoints.sort((left, right) => {
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }
    if (left.method !== right.method) {
      return left.method.localeCompare(right.method);
    }
    return left.file.localeCompare(right.file);
  });
}

function resolveLocalImport(relativePath, specifier, filesByPath, knownExtensions) {
  if (!specifier || typeof specifier !== 'string') {
    return null;
  }

  const currentDirectory = path.posix.dirname(relativePath.replace(/\\/g, '/'));
  const normalizedSpecifier = specifier.replace(/\\/g, '/');
  let candidateBase = null;

  if (normalizedSpecifier.startsWith('.')) {
    candidateBase = path.posix.normalize(path.posix.join(currentDirectory === '.' ? '' : currentDirectory, normalizedSpecifier));
  } else if (normalizedSpecifier.startsWith('/')) {
    candidateBase = normalizedSpecifier.replace(/^\/+/, '');
  } else if (/^[A-Za-z0-9_\.]+$/.test(normalizedSpecifier) && normalizedSpecifier.includes('.')) {
    candidateBase = normalizedSpecifier.replace(/\./g, '/');
  }

  if (!candidateBase) {
    return null;
  }

  const candidates = new Set([candidateBase]);
  if (!path.posix.extname(candidateBase)) {
    for (const extension of knownExtensions) {
      candidates.add(`${candidateBase}${extension}`);
      candidates.add(path.posix.join(candidateBase, `index${extension}`));
    }
    candidates.add(path.posix.join(candidateBase, '__init__.py'));
  }

  for (const candidate of candidates) {
    if (filesByPath.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveSchemaReference(file, refName, filesByPath, knownExtensions) {
  if (!file || !refName) {
    return null;
  }

  const localDefinition = (file.schemaDefinitions || []).find((definition) => definition.name === refName);
  if (localDefinition) {
    return {
      name: localDefinition.name,
      kind: localDefinition.kind,
      source: localDefinition.source,
      file: file.relativePath,
      fields: localDefinition.fields || [],
    };
  }

  for (const binding of file.importBindings || []) {
    if (binding.local !== refName) {
      continue;
    }
    const resolvedFilePath = resolveLocalImport(file.relativePath, binding.specifier, filesByPath, knownExtensions);
    if (!resolvedFilePath) {
      continue;
    }
    const targetFile = filesByPath.get(resolvedFilePath);
    if (!targetFile) {
      continue;
    }
    const targetName = binding.imported && binding.imported !== 'default' && binding.imported !== '*'
      ? binding.imported
      : refName;
    const targetDefinition = (targetFile.schemaDefinitions || []).find((definition) => definition.name === targetName);
    if (targetDefinition) {
      return {
        name: targetDefinition.name,
        kind: targetDefinition.kind,
        source: targetDefinition.source,
        file: targetFile.relativePath,
        fields: targetDefinition.fields || [],
      };
    }
  }

  return null;
}

function enrichApiSchemas(files) {
  const filesByPath = new Map(files.map((file) => [file.relativePath, file]));
  const knownExtensions = uniqueStrings(files.map((file) => file.extension));

  for (const file of files) {
    for (const endpoint of file.apiContracts || []) {
      const requestBodySchemas = uniqueStrings((endpoint.schemaHints && endpoint.schemaHints.requestBodyRefs) || [])
        .map((refName) => resolveSchemaReference(file, refName, filesByPath, knownExtensions))
        .filter(Boolean);
      const responseSchemas = uniqueStrings((endpoint.schemaHints && endpoint.schemaHints.responseRefs) || [])
        .map((refName) => resolveSchemaReference(file, refName, filesByPath, knownExtensions))
        .filter(Boolean);

      endpoint.request.bodySchemas = requestBodySchemas;
      endpoint.responseSchemas = responseSchemas;
      delete endpoint.schemaHints;
    }
  }
}

function buildApiIndex(files) {
  const endpoints = files
    .flatMap((file) => Array.isArray(file.apiContracts) ? file.apiContracts.map((endpoint) => ({
      ...endpoint,
      workspace: file.workspace ? file.workspace.directory : '',
      workspaceName: file.workspace ? file.workspace.name : '',
      language: file.language,
    })) : [])
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.file.localeCompare(right.file));

  const modules = new Map();
  const workspaces = new Map();
  const groups = new Map();

  for (const endpoint of endpoints) {
    const moduleKey = endpoint.directory || '';
    if (!modules.has(moduleKey)) {
      modules.set(moduleKey, []);
    }
    modules.get(moduleKey).push(endpoint.id);

    const workspaceKey = endpoint.workspace || '';
    if (!workspaces.has(workspaceKey)) {
      workspaces.set(workspaceKey, []);
    }
    workspaces.get(workspaceKey).push(endpoint.id);

    const groupKey = endpoint.group || 'general';
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(endpoint.id);
  }

  return {
    endpoints,
    modules: Array.from(modules.entries())
      .map(([directory, endpointIds]) => ({ directory, endpointIds }))
      .sort((left, right) => left.directory.localeCompare(right.directory)),
    workspaces: Array.from(workspaces.entries())
      .map(([directory, endpointIds]) => ({ directory, endpointIds }))
      .sort((left, right) => left.directory.localeCompare(right.directory)),
    groups: Array.from(groups.entries())
      .map(([group, endpointIds]) => ({
        group,
        title: titleCase(group),
        endpointIds,
      }))
      .sort((left, right) => left.title.localeCompare(right.title)),
  };
}

function moduleAncestorsForPath(relativePath) {
  const normalizedPath = relativePath.split(path.sep).join('/');
  const directory = path.posix.dirname(normalizedPath);
  if (directory === '.') {
    return [''];
  }

  const parts = directory.split('/');
  const modules = [''];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    modules.push(current);
  }
  return modules;
}

function normalizePreviousFile(rootDir, previousFile) {
  const relativePath = previousFile.relativePath;
  return {
    ...previousFile,
    absolutePath: path.join(rootDir, relativePath),
    directory: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath).split(path.sep).join('/'),
  };
}

function assignWorkspace(relativePath, workspaces) {
  const normalizedDirectory = path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath).split(path.sep).join('/');
  const ordered = workspaces.slice().sort((left, right) => right.directory.length - left.directory.length);
  return ordered.find((entry) => entry.directory === '' || normalizedDirectory === entry.directory || normalizedDirectory.startsWith(`${entry.directory}/`)) || workspaces[0];
}

function createWorkspaceMap(files, workspaces) {
  const workspaceStats = new Map(workspaces.map((entry) => [entry.directory, {
    ...entry,
    fileCount: 0,
    symbolCount: 0,
    languages: new Set(),
    modules: new Set(),
    files: [],
  }]));

  for (const file of files) {
    const workspace = assignWorkspace(file.relativePath, workspaces);
    file.workspace = {
      directory: workspace.directory,
      name: workspace.name,
      relativePackagePath: workspace.relativePackagePath,
    };

    const entry = workspaceStats.get(workspace.directory);
    entry.fileCount += 1;
    entry.symbolCount += file.symbols.length;
    entry.languages.add(file.language);
    entry.modules.add(file.directory);
    entry.files.push(file.relativePath);
  }

  return Array.from(workspaceStats.values())
    .map((entry) => ({
      directory: entry.directory,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      relativePackagePath: entry.relativePackagePath,
      isRoot: entry.isRoot,
      fileCount: entry.fileCount,
      symbolCount: entry.symbolCount,
      languages: Array.from(entry.languages).sort(),
      modules: Array.from(entry.modules).sort(),
      files: entry.files.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

function parseFileFromSource(rootDir, relativePath, source) {
  const extension = path.extname(relativePath).toLowerCase();
  const config = LANGUAGE_CONFIGS[extension];
  if (!config) {
    return null;
  }

  const lineCount = source === '' ? 0 : source.split(/\r?\n/).length;

  if (config.plainText) {
    const symbols = config.extractSymbols(null, source);
    const dependencies = extractDependencies(extension, source);
    return {
      relativePath,
      absolutePath: path.join(rootDir, relativePath),
      directory: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath).split(path.sep).join('/'),
      extension,
      language: config.label,
      codeFence: config.codeFence,
      lineCount,
      hash: hashText(source),
      imports: dependencies.imports,
      importBindings: dependencies.importBindings,
      schemaDefinitions: extractSchemaDefinitions(extension, source, symbols),
      apiContracts: inferApiContracts(relativePath, extension, source, symbols),
      symbols,
    };
  }

  const parser = createParser(extension);
  const tree = parser.parse(source);
  const symbols = config.extractSymbols(tree.rootNode, source);
  const dependencies = extractDependencies(extension, source);

  return {
    relativePath,
    absolutePath: path.join(rootDir, relativePath),
    directory: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath).split(path.sep).join('/'),
    extension,
    language: config.label,
    codeFence: config.codeFence,
    lineCount,
    hash: hashText(source),
    imports: dependencies.imports,
    importBindings: dependencies.importBindings,
    schemaDefinitions: extractSchemaDefinitions(extension, source, symbols),
    apiContracts: inferApiContracts(relativePath, extension, source, symbols),
    symbols,
  };
}

async function scanProject(rootDir, options = {}) {
  const outDir = options.outDir || DEFAULT_OUT_DIR;
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : Infinity;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const previousManifest = options.incremental ? await readPreviousManifest(rootDir, outDir) : null;
  onProgress?.({ type: 'discover_start' });
  const workspacePackages = await discoverWorkspacePackages(rootDir, outDir, options.ignore);
  const canReuseScan = Boolean(previousManifest && previousManifest.cache && previousManifest.cache.scanKey === options.cache.scanKey);
  const previousByPath = new Map(
    canReuseScan && Array.isArray(previousManifest.files)
      ? previousManifest.files.map((file) => [file.relativePath, file])
      : [],
  );

  const files = await discoverFiles(rootDir, outDir, maxFiles, options.include, options.ignore);
  onProgress?.({ type: 'discover_done', count: files.length });
  const scannedFiles = [];
  const errors = [];
  const changedFiles = [];
  const reusedFiles = [];

  const totalToRead = files.length;
  for (let index = 0; index < files.length; index += 1) {
    const relativePath = files[index];
    onProgress?.({
      type: 'parse_progress',
      current: index + 1,
      total: totalToRead,
      file: relativePath,
    });
    const absolutePath = path.join(rootDir, relativePath);

    try {
      const source = await fs.readFile(absolutePath, 'utf8');
      const hash = hashText(source);
      const previous = previousByPath.get(relativePath);
      const extension = path.extname(relativePath).toLowerCase();

      if (
        previous
        && previous.hash === hash
        && previous.extension === extension
        && Array.isArray(previous.imports)
        && Array.isArray(previous.importBindings)
        && Array.isArray(previous.schemaDefinitions)
        && Array.isArray(previous.apiContracts)
      ) {
        scannedFiles.push(normalizePreviousFile(rootDir, previous));
        reusedFiles.push(relativePath);
        continue;
      }

      const record = parseFileFromSource(rootDir, relativePath, source);
      if (record) {
        scannedFiles.push(record);
        changedFiles.push(relativePath);
      }
    } catch (error) {
      errors.push({
        relativePath,
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  onProgress?.({
    type: 'parse_done',
    parsed: scannedFiles.length,
    discovered: files.length,
  });

  const currentFileSet = new Set(scannedFiles.map((file) => file.relativePath));
  const deletedFiles = canReuseScan
    ? Array.from(previousByPath.keys()).filter((relativePath) => !currentFileSet.has(relativePath))
    : [];

  const changedModuleSet = new Set();
  for (const relativePath of [...changedFiles, ...deletedFiles]) {
    for (const modulePath of moduleAncestorsForPath(relativePath)) {
      changedModuleSet.add(modulePath);
    }
  }

  const packageMetadata = await createPackageMetadata(rootDir);
  const workspaceSummary = createWorkspaceMap(scannedFiles, workspacePackages);
  enrichApiSchemas(scannedFiles);
  const api = buildApiIndex(scannedFiles);
  const directories = createDirectoryMap(scannedFiles);
  const currentDirectorySet = new Set(directories.map((entry) => entry.directory));
  const deletedModules = canReuseScan && Array.isArray(previousManifest.directories)
    ? previousManifest.directories
        .map((entry) => entry.directory)
        .filter((directory) => !currentDirectorySet.has(directory))
    : [];
  const previousWorkspaceFiles = new Map(
    canReuseScan && Array.isArray(previousManifest.files)
      ? previousManifest.files
          .filter((file) => file.workspace && typeof file.workspace.directory === 'string')
          .map((file) => [file.relativePath, file.workspace.directory])
      : [],
  );
  const changedWorkspaceSet = new Set();
  for (const file of scannedFiles) {
    if (changedFiles.includes(file.relativePath) && file.workspace) {
      changedWorkspaceSet.add(file.workspace.directory);
    }
  }
  for (const relativePath of deletedFiles) {
    if (previousWorkspaceFiles.has(relativePath)) {
      changedWorkspaceSet.add(previousWorkspaceFiles.get(relativePath));
    }
  }
  const currentWorkspaceSet = new Set(workspaceSummary.map((entry) => entry.directory));
  const deletedWorkspaces = canReuseScan && Array.isArray(previousManifest.workspaces)
    ? previousManifest.workspaces
        .map((entry) => entry.directory)
        .filter((directory) => !currentWorkspaceSet.has(directory))
    : [];

  let discoveryHints = null;
  if (options.scanDiagnostics) {
    discoveryHints = await computeUnindexedExtensionStats(rootDir, outDir, options.ignore);
  }

  const scanResult = {
    rootDir,
    outDir,
    projectName: packageMetadata.name,
    package: packageMetadata,
    generatedAt: new Date().toISOString(),
    supportedExtensions: supportedExtensions(),
    settings: options.settings,
    cache: options.cache,
    files: scannedFiles,
    api,
    directories,
    workspaces: workspaceSummary,
    languages: createLanguageBreakdown(scannedFiles),
    errors,
    discoveryHints,
    incremental: {
      enabled: Boolean(options.incremental),
      mode: canReuseScan ? 'incremental' : 'full',
      reusedFiles,
      changedFiles,
      deletedFiles,
      changedModules: Array.from(changedModuleSet).sort(),
      deletedModules,
      changedWorkspaces: Array.from(changedWorkspaceSet).sort(),
      deletedWorkspaces,
      aiChangedFiles: [],
      aiChangedModules: [],
      aiChangedWorkspaces: [],
      aiProjectChanged: false,
    },
    totals: {
      filesDiscovered: files.length,
      filesParsed: scannedFiles.length,
      symbols: scannedFiles.reduce((sum, file) => sum + file.symbols.length, 0),
      directories: directories.length,
      workspaces: workspaceSummary.length,
    },
  };

  return {
    scanResult,
    previousManifest,
  };
}

module.exports = {
  scanProject,
  computeUnindexedExtensionStats,
};
