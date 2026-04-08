const fs = require('node:fs/promises');
const path = require('node:path');
const fg = require('fast-glob');
const { LANGUAGE_CONFIGS, createParser } = require('./languages');
const { hashText } = require('./hash');

const DEFAULT_IGNORES = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/.idea/**',
  '**/.vscode/**',
];

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
  return outDir.replace(/^[./]+/, '').replace(/\\/g, '/').replace(/\/$/, '');
}

async function discoverFiles(rootDir, outDir, maxFiles = Infinity, includePatterns = [], customIgnores = []) {
  const normalizedOutDir = normalizeOutDir(outDir);
  const entries = await fg(buildPatterns(includePatterns), {
    cwd: rootDir,
    onlyFiles: true,
    dot: false,
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

async function discoverWorkspacePackages(rootDir, outDir, customIgnores = []) {
  const normalizedOutDir = normalizeOutDir(outDir);
  const packageFiles = await fg(['package.json', '**/package.json'], {
    cwd: rootDir,
    onlyFiles: true,
    dot: false,
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

  const parser = createParser(extension);
  const tree = parser.parse(source);
  const symbols = config.extractSymbols(tree.rootNode, source);

  return {
    relativePath,
    absolutePath: path.join(rootDir, relativePath),
    directory: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath).split(path.sep).join('/'),
    extension,
    language: config.label,
    codeFence: config.codeFence,
    lineCount: source === '' ? 0 : source.split(/\r?\n/).length,
    hash: hashText(source),
    symbols,
  };
}

async function scanProject(rootDir, options = {}) {
  const outDir = options.outDir || 'docs-wiki';
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : Infinity;
  const previousManifest = options.incremental ? await readPreviousManifest(rootDir, outDir) : null;
  const workspacePackages = await discoverWorkspacePackages(rootDir, outDir, options.ignore);
  const canReuseScan = Boolean(previousManifest && previousManifest.cache && previousManifest.cache.scanKey === options.cache.scanKey);
  const previousByPath = new Map(
    canReuseScan && Array.isArray(previousManifest.files)
      ? previousManifest.files.map((file) => [file.relativePath, file])
      : [],
  );

  const files = await discoverFiles(rootDir, outDir, maxFiles, options.include, options.ignore);
  const scannedFiles = [];
  const errors = [];
  const changedFiles = [];
  const reusedFiles = [];

  for (const relativePath of files) {
    const absolutePath = path.join(rootDir, relativePath);

    try {
      const source = await fs.readFile(absolutePath, 'utf8');
      const hash = hashText(source);
      const previous = previousByPath.get(relativePath);
      const extension = path.extname(relativePath).toLowerCase();

      if (previous && previous.hash === hash && previous.extension === extension) {
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
    directories,
    workspaces: workspaceSummary,
    languages: createLanguageBreakdown(scannedFiles),
    errors,
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
};
