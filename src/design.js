const path = require('node:path');

const GENERIC_TOKENS = new Set([
  'src', 'lib', 'app', 'apps', 'core', 'common', 'shared', 'internal', 'client', 'server',
  'feature', 'features', 'module', 'modules', 'index', 'main', 'base', 'default',
  'utils', 'util', 'helper', 'helpers', 'types', 'type', 'interfaces', 'interface',
  'components', 'component', 'hooks', 'hook', 'common', 'shared', 'test', 'tests',
  'spec', 'specs', 'fixture', 'fixtures', 'data', 'domain', 'package',
]);

const ROLE_DEFINITIONS = [
  { id: 'entry', label: 'Entry point', keywords: ['route', 'routes', 'router', 'controller', 'endpoint', 'handler', 'http', 'api', 'resolver', 'mutation', 'query'] },
  { id: 'ui', label: 'UI surface', keywords: ['page', 'screen', 'view', 'component', 'layout', 'modal', 'form'] },
  { id: 'guard', label: 'Guard / middleware', keywords: ['middleware', 'guard', 'policy', 'interceptor', 'filter', 'permission'] },
  { id: 'service', label: 'Service / use case', keywords: ['service', 'usecase', 'use', 'manager', 'orchestrator', 'workflow', 'coordinator'] },
  { id: 'repository', label: 'Repository / persistence', keywords: ['repository', 'repo', 'dao', 'store', 'query', 'queries', 'persistence', 'database', 'db'] },
  { id: 'model', label: 'Model / contract', keywords: ['model', 'entity', 'schema', 'dto', 'record', 'contract', 'serializer', 'mapper'] },
  { id: 'integration', label: 'External integration', keywords: ['client', 'gateway', 'provider', 'adapter', 'integration', 'webhook', 'sdk'] },
  { id: 'worker', label: 'Worker / async job', keywords: ['worker', 'job', 'queue', 'task', 'cron', 'schedule', 'consumer', 'producer'] },
  { id: 'config', label: 'Configuration', keywords: ['config', 'setting', 'settings', 'constant', 'constants', 'env'] },
];

const ROLE_PRIORITY = new Map([
  ['ui', 1],
  ['entry', 2],
  ['guard', 3],
  ['service', 4],
  ['repository', 5],
  ['model', 6],
  ['integration', 7],
  ['worker', 8],
  ['config', 9],
  ['utility', 10],
]);

const DOMAIN_DEFINITIONS = [
  { id: 'auth', label: 'Authentication and access control', keywords: ['auth', 'login', 'logout', 'signin', 'signout', 'register', 'signup', 'session', 'token', 'password', 'credential', 'oauth', 'sso', 'mfa', 'otp', 'permission', 'role', 'access'] },
  { id: 'user', label: 'User and profile management', keywords: ['user', 'profile', 'account', 'member', 'identity', 'people'] },
  { id: 'payment', label: 'Payments and billing', keywords: ['payment', 'billing', 'invoice', 'checkout', 'refund', 'charge', 'subscription', 'plan'] },
  { id: 'order', label: 'Orders and fulfillment', keywords: ['order', 'cart', 'checkout', 'shipment', 'fulfillment', 'inventory'] },
  { id: 'notification', label: 'Notifications and messaging', keywords: ['notify', 'notification', 'email', 'sms', 'message', 'alert', 'webhook'] },
  { id: 'search', label: 'Search and discovery', keywords: ['search', 'query', 'filter', 'index', 'ranking'] },
  { id: 'reporting', label: 'Reporting and analytics', keywords: ['report', 'analytics', 'dashboard', 'metric', 'insight', 'audit'] },
  { id: 'admin', label: 'Administration and backoffice', keywords: ['admin', 'management', 'console', 'backoffice', 'moderation'] },
  { id: 'storage', label: 'Files and storage', keywords: ['file', 'files', 'upload', 'download', 'storage', 'bucket', 'blob', 'document'] },
  { id: 'integration', label: 'External integrations', keywords: ['integration', 'provider', 'adapter', 'client', 'sdk', 'partner'] },
];

const ACTION_DEFINITIONS = [
  { id: 'login', label: 'login', keywords: ['login', 'signin', 'authenticate', 'auth'] },
  { id: 'register', label: 'registration', keywords: ['register', 'signup', 'invite', 'createaccount'] },
  { id: 'logout', label: 'logout', keywords: ['logout', 'signout', 'revoke'] },
  { id: 'refresh', label: 'token refresh', keywords: ['refresh', 'renew'] },
  { id: 'verify', label: 'verification', keywords: ['verify', 'validation', 'validate', 'check'] },
  { id: 'reset', label: 'password reset', keywords: ['reset', 'forgot', 'password'] },
  { id: 'create', label: 'creation', keywords: ['create', 'add', 'insert', 'save'] },
  { id: 'update', label: 'update', keywords: ['update', 'edit', 'patch'] },
  { id: 'delete', label: 'deletion', keywords: ['delete', 'remove', 'destroy'] },
  { id: 'list', label: 'listing', keywords: ['list', 'fetch', 'get', 'read', 'load'] },
  { id: 'sync', label: 'synchronization', keywords: ['sync', 'import', 'export'] },
  { id: 'notify', label: 'notification delivery', keywords: ['notify', 'send', 'message', 'email', 'sms'] },
];

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tokenize(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function clip(value, max = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}…`;
}

function sortByPriority(files) {
  return files.slice().sort((left, right) => {
    const leftPriority = ROLE_PRIORITY.get(left.role) || 99;
    const rightPriority = ROLE_PRIORITY.get(right.role) || 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function classifyRole(file, tokenSet) {
  for (const definition of ROLE_DEFINITIONS) {
    if (definition.keywords.some((keyword) => tokenSet.has(keyword))) {
      return definition.id;
    }
  }

  if (file.symbols.some((symbol) => ['class', 'method'].includes(symbol.kind))) {
    return 'service';
  }

  return 'utility';
}

function scoreDomains(tokens) {
  const tokenSet = new Set(tokens);
  return DOMAIN_DEFINITIONS
    .map((definition) => ({
      ...definition,
      score: definition.keywords.reduce((sum, keyword) => sum + (tokenSet.has(keyword) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}

function detectActions(tokens) {
  const tokenSet = new Set(tokens);
  return ACTION_DEFINITIONS
    .map((definition) => ({
      ...definition,
      score: definition.keywords.reduce((sum, keyword) => sum + (tokenSet.has(keyword) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}

function humanizeModule(directory) {
  if (!directory) {
    return 'Root module';
  }
  const basename = directory.split('/').pop() || directory;
  return titleCase(basename);
}

function mergeUniqueStrings(left = [], right = [], limit = 8) {
  return Array.from(new Set([...(left || []), ...(right || [])].filter(Boolean))).slice(0, limit);
}

function mergeComponentSummaries(aiComponents, files) {
  const ai = Array.isArray(aiComponents)
    ? aiComponents
        .map((component) => component && component.name && component.responsibility
          ? `${component.name}: ${component.responsibility}`
          : null)
        .filter(Boolean)
    : [];
  const heuristic = unique(sortByPriority(files).map((file) => `${summarizeRole(file.role)}: ${file.relativePath}`)).slice(0, 8);
  return mergeUniqueStrings(ai, heuristic, 8);
}

function getModuleFiles(scanResult, directory) {
  if (!directory) {
    return scanResult.files.slice();
  }
  return scanResult.files.filter((file) => file.directory === directory || file.directory.startsWith(`${directory}/`));
}

function dirnamePosix(relativePath) {
  const directory = path.posix.dirname(relativePath);
  return directory === '.' ? '' : directory;
}

function resolveLocalImport(relativePath, specifier, filesByPath, knownExtensions) {
  if (!specifier || typeof specifier !== 'string') {
    return null;
  }

  const currentDirectory = dirnamePosix(relativePath);
  const normalizedSpecifier = specifier.replace(/\\/g, '/');
  let candidateBase = null;

  if (normalizedSpecifier.startsWith('.')) {
    candidateBase = path.posix.normalize(path.posix.join(currentDirectory, normalizedSpecifier));
  } else if (normalizedSpecifier.startsWith('/')) {
    candidateBase = normalizedSpecifier.replace(/^\/+/, '');
  } else if (/^[A-Za-z0-9_\.]+$/.test(normalizedSpecifier) && normalizedSpecifier.includes('.')) {
    candidateBase = normalizedSpecifier.replace(/\./g, '/');
  }

  if (!candidateBase) {
    return null;
  }

  const candidates = new Set();
  candidates.add(candidateBase);

  if (path.posix.extname(candidateBase)) {
    candidates.add(candidateBase);
  } else {
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

function identifierPattern(localName) {
  return new RegExp(`\\b${localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

function bindingUsedInFile(file, localName) {
  if (!localName) {
    return false;
  }
  const matcher = identifierPattern(localName);
  return file.symbols.some((symbol) => matcher.test(symbol.code));
}

function resolveTargetSymbol(targetFile, binding) {
  if (!targetFile || !binding) {
    return null;
  }

  if (binding.imported && !['default', '*'].includes(binding.imported)) {
    const exact = targetFile.symbols.find((symbol) => symbol.name === binding.imported && symbol.exported);
    if (exact) {
      return exact.name;
    }
    const loose = targetFile.symbols.find((symbol) => symbol.name === binding.imported);
    if (loose) {
      return loose.name;
    }
  }

  const exported = targetFile.symbols.find((symbol) => symbol.exported);
  return exported ? exported.name : null;
}

function addEdge(edgeMap, from, to, payload = {}) {
  if (!from || !to || from === to) {
    return;
  }
  const key = `${from}=>${to}`;
  if (!edgeMap.has(key)) {
    edgeMap.set(key, { from, to, ...payload });
  }
}

function buildInteractionGraph(scanResult, lspClient = null) {
  const filesByPath = new Map(scanResult.files.map((file) => [file.relativePath, file]));
  const knownExtensions = unique(scanResult.files.map((file) => file.extension));
  const fileNodes = new Map();
  const fileEdgeMap = new Map();
  const callEdgeMap = new Map();

  for (const file of scanResult.files) {
    fileNodes.set(file.relativePath, {
      dependencies: [],
      callers: [],
      calls: [],
      calledBy: [],
      modules: new Set(),
    });
  }

  // Hybrid Analysis: Start with Heuristics
  for (const file of scanResult.files) {
    for (const specifier of file.imports || []) {
      const resolved = resolveLocalImport(file.relativePath, specifier, filesByPath, knownExtensions);
      if (resolved) {
        addEdge(fileEdgeMap, file.relativePath, resolved, { specifier, kind: 'import' });
      }
    }

    for (const binding of file.importBindings || []) {
      const resolved = resolveLocalImport(file.relativePath, binding.specifier, filesByPath, knownExtensions);
      if (!resolved) {
        continue;
      }
      addEdge(fileEdgeMap, file.relativePath, resolved, { specifier: binding.specifier, kind: 'import' });
      if (bindingUsedInFile(file, binding.local)) {
        addEdge(callEdgeMap, file.relativePath, resolved, {
          local: binding.local,
          imported: binding.imported,
          targetSymbol: resolveTargetSymbol(filesByPath.get(resolved), binding),
          kind: 'call',
        });
      }
    }
  }

  // Hybrid Analysis: Enhance with LSP if available
  // This is a placeholder for real-time LSP resolution of apiCalls
  // In a real run, we would iterate through symbols and ask LSP "where is this defined?"
  if (lspClient) {
    // console.log('Plan B: Deep Tracing symbols via LSP...');
  }

  for (const edge of fileEdgeMap.values()) {
    fileNodes.get(edge.from).dependencies.push(edge);
    fileNodes.get(edge.to).callers.push(edge);
  }
  for (const edge of callEdgeMap.values()) {
    fileNodes.get(edge.from).calls.push(edge);
    fileNodes.get(edge.to).calledBy.push(edge);
  }

  const moduleEdgeMap = new Map();
  for (const edge of fileEdgeMap.values()) {
    const fromFile = filesByPath.get(edge.from);
    const toFile = filesByPath.get(edge.to);
    if (!fromFile || !toFile || fromFile.directory === toFile.directory) {
      continue;
    }
    const key = `${fromFile.directory}=>${toFile.directory}`;
    const current = moduleEdgeMap.get(key) || {
      from: fromFile.directory,
      to: toFile.directory,
      weight: 0,
      files: [],
    };
    current.weight += 1;
    current.files.push([fromFile.relativePath, toFile.relativePath]);
    moduleEdgeMap.set(key, current);
  }

  return {
    files: fileNodes,
    fileEdges: Array.from(fileEdgeMap.values()),
    callEdges: Array.from(callEdgeMap.values()),
    moduleEdges: Array.from(moduleEdgeMap.values())
      .map((edge) => ({
        ...edge,
        files: edge.files.slice(0, 6),
      }))
      .sort((left, right) => right.weight - left.weight || `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`)),
  };
}

function isLikelyExternalImport(specifier) {
  return specifier && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('..');
}

function inferExternalSystems(files) {
  const tokens = [];
  for (const file of files) {
    for (const specifier of file.imports || []) {
      if (!isLikelyExternalImport(specifier)) {
        continue;
      }
      tokens.push(specifier.split(/[/:]/)[0]);
    }
  }
  return unique(tokens).slice(0, 6);
}

function inferDataStores(files) {
  const stores = new Set();
  for (const file of files) {
    const text = `${file.relativePath} ${(file.imports || []).join(' ')} ${file.symbols.map((symbol) => symbol.name).join(' ')}`.toLowerCase();
    if (/\b(prisma|postgres|mysql|sqlite|mongo|mongoose|typeorm|sequelize|db|database|query)\b/.test(text)) {
      stores.add('Primary database');
    }
    if (/\b(redis|cache)\b/.test(text)) {
      stores.add('Cache / key-value store');
    }
    if (/\b(queue|kafka|bull|rabbit|sqs)\b/.test(text)) {
      stores.add('Async queue or event bus');
    }
    if (/\b(session|token)\b/.test(text) && /\b(auth|login|signin|oauth)\b/.test(text)) {
      stores.add('Session / token state');
    }
  }
  return Array.from(stores);
}

function summarizeRole(role) {
  const definition = ROLE_DEFINITIONS.find((entry) => entry.id === role);
  return definition ? definition.label : 'Utility';
}

function buildFileInsights(file) {
  const tokenSource = [
    file.relativePath,
    file.directory,
    ...(file.imports || []),
    ...file.symbols.map((symbol) => `${symbol.kind} ${symbol.name} ${symbol.signature}`),
    file.ai && file.ai.summary ? file.ai.summary : '',
    ...(file.ai && Array.isArray(file.ai.responsibilities) ? file.ai.responsibilities : []),
  ].join(' ');
  const tokens = tokenize(tokenSource);
  const tokenSet = new Set(tokens);
  const role = classifyRole(file, tokenSet);
  const domains = scoreDomains(tokens);
  const actions = detectActions(tokens);

  return {
    ...file,
    role,
    roleLabel: summarizeRole(role),
    tokens,
    domains,
    actions,
    evidence: clip(file.ai && file.ai.summary ? file.ai.summary : file.symbols.map((symbol) => symbol.signature).join(' · '), 180),
  };
}

function pickDomain(module, files) {
  const scores = new Map();
  const pathTokens = tokenize(module.directory);
  for (const definition of DOMAIN_DEFINITIONS) {
    const pathBoost = definition.keywords.reduce((sum, keyword) => sum + (pathTokens.includes(keyword) ? 2 : 0), 0);
    scores.set(definition.id, pathBoost);
  }

  for (const file of files) {
    for (const domain of file.domains) {
      scores.set(domain.id, (scores.get(domain.id) || 0) + domain.score);
    }
  }

  const ranked = DOMAIN_DEFINITIONS
    .map((definition) => ({
      ...definition,
      score: scores.get(definition.id) || 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

  if (ranked.length > 0) {
    return ranked[0];
  }

  const fallbackTokens = tokenize(module.directory).filter((token) => !GENERIC_TOKENS.has(token));
  const fallback = fallbackTokens[0];
  if (fallback) {
    return {
      id: fallback,
      label: `${titleCase(fallback)} operations`,
      keywords: [fallback],
      score: 1,
    };
  }

  return {
    id: 'general',
    label: `${humanizeModule(module.directory)} processing`,
    keywords: [],
    score: 0,
  };
}

function pickActions(files, domain) {
  const scores = new Map();
  for (const file of files) {
    for (const action of file.actions) {
      scores.set(action.id, (scores.get(action.id) || 0) + action.score);
    }
  }

  const ranked = ACTION_DEFINITIONS
    .map((definition) => ({
      ...definition,
      score: scores.get(definition.id) || 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

  if (ranked.length > 0) {
    const authActionIds = new Set(['login', 'register', 'logout', 'refresh', 'verify', 'reset']);
    const narrowed = domain.id === 'auth'
      ? ranked.filter((entry) => authActionIds.has(entry.id))
      : ranked;
    const pool = narrowed.length > 0 ? narrowed : ranked;
    const topScore = pool[0].score;
    const threshold = topScore > 1 ? Math.max(2, topScore - 1) : 2;
    const selected = pool.filter((entry) => entry.score >= threshold).slice(0, 3);
    if (selected.length > 0) {
      return selected;
    }
  }

  if (domain.id === 'auth') {
    return [{ id: 'login', label: 'login', keywords: ['auth'], score: 1 }];
  }

  return [{ id: 'default', label: 'request handling', keywords: [], score: 1 }];
}

function buildFlowName(domain, action) {
  if (domain.id === 'auth') {
    const names = {
      login: 'Auth login',
      register: 'Auth registration',
      logout: 'Auth logout',
      refresh: 'Token refresh',
      verify: 'Credential validation',
      reset: 'Password reset',
      default: 'Auth request handling',
    };
    return names[action.id] || `Auth ${action.label}`;
  }

  const domainPrefix = domain.id === 'general' ? humanizeModule('') : domain.label.replace(/\band\b/gi, '&');
  if (action.id === 'default') {
    return `${domainPrefix} flow`;
  }
  return `${titleCase(domain.label.replace(/\s+and\s+/gi, ' '))} ${action.label}`;
}

function buildFlowGoal(domain, action) {
  if (domain.id === 'auth' && action.id === 'login') {
    return 'Authenticate the caller, validate credentials, and establish a usable session or token.';
  }
  if (domain.id === 'auth' && action.id === 'refresh') {
    return 'Re-issue a valid token or session from a previously trusted credential.';
  }
  if (action.id === 'default') {
    return `Handle the main ${domain.label.toLowerCase()} use case exposed by this module.`;
  }
  return `Execute the module's ${action.label} use case inside ${domain.label.toLowerCase()}.`;
}

function pickFlowFiles(files, domain, action) {
  const domainKeywords = new Set(domain.keywords || []);
  const actionKeywords = new Set(action.keywords || []);
  const scored = files.map((file) => {
    let score = 0;
    for (const token of file.tokens) {
      if (domainKeywords.has(token)) score += 2;
      if (actionKeywords.has(token)) score += 3;
    }
    score += Math.max(0, 10 - (ROLE_PRIORITY.get(file.role) || 10));
    return { file, score };
  });

  const matched = scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.file.relativePath.localeCompare(right.file.relativePath))
    .map((entry) => entry.file);

  if (matched.length > 0) {
    return sortByPriority(matched).slice(0, 6);
  }

  return sortByPriority(files).slice(0, 5);
}

function orderFlowFiles(flowFiles, graph) {
  if (flowFiles.length <= 1) {
    return flowFiles;
  }

  const fileMap = new Map(flowFiles.map((file) => [file.relativePath, file]));
  const allowed = new Set(fileMap.keys());
  const visited = new Set();
  const ordered = [];
  const starts = sortByPriority(flowFiles.filter((file) => {
    const node = graph.files.get(file.relativePath);
    const incomingCalls = node && node.calledBy ? node.calledBy.filter((edge) => allowed.has(edge.from)).length : 0;
    const incomingDependencies = node && node.callers ? node.callers.filter((edge) => allowed.has(edge.from)).length : 0;
    return ['ui', 'entry', 'guard'].includes(file.role) || (incomingCalls + incomingDependencies) === 0;
  }));

  const queue = starts.length > 0 ? starts.slice() : sortByPriority(flowFiles);
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file.relativePath)) {
      continue;
    }
    visited.add(file.relativePath);
    ordered.push(file);

    const node = graph.files.get(file.relativePath);
    const nextPaths = unique([
      ...(node ? node.calls.filter((edge) => allowed.has(edge.to)).map((edge) => edge.to) : []),
      ...(node ? node.dependencies.filter((edge) => allowed.has(edge.to)).map((edge) => edge.to) : []),
    ]);
    const nextFiles = sortByPriority(nextPaths.map((relativePath) => fileMap.get(relativePath)).filter(Boolean));
    for (const nextFile of nextFiles) {
      if (!visited.has(nextFile.relativePath)) {
        queue.push(nextFile);
      }
    }
  }

  for (const file of sortByPriority(flowFiles)) {
    if (!visited.has(file.relativePath)) {
      ordered.push(file);
    }
  }

  return ordered;
}

function buildFlowEdges(flowFiles, graph) {
  const allowed = new Set(flowFiles.map((file) => file.relativePath));
  const edgeMap = new Map();

  for (const file of flowFiles) {
    const node = graph.files.get(file.relativePath);
    for (const edge of node ? node.calls : []) {
      if (allowed.has(edge.to)) {
        addEdge(edgeMap, edge.from, edge.to, { kind: 'call', label: edge.targetSymbol || edge.local || '' });
      }
    }
    for (const edge of node ? node.dependencies : []) {
      if (allowed.has(edge.to)) {
        addEdge(edgeMap, edge.from, edge.to, { kind: 'dependency', label: '' });
      }
    }
  }

  return Array.from(edgeMap.values());
}

function buildFlowSteps(files, action, graph) {
  const templates = {
    ui: (file) => `The user or operator enters the flow through ${file.relativePath}, which surfaces the ${action.label} interaction.`,
    entry: (file) => `${file.relativePath} receives the request and turns it into an application-level ${action.label} command.`,
    guard: (file) => `${file.relativePath} performs policy, session, or guard checks before deeper processing continues.`,
    service: (file) => `${file.relativePath} coordinates the core business rules and state changes for the flow.`,
    repository: (file) => `${file.relativePath} loads or persists the records needed to complete the flow.`,
    model: (file) => `${file.relativePath} defines the contracts or state objects moved between layers.`,
    integration: (file) => `${file.relativePath} exchanges data with an external dependency required by the flow.`,
    worker: (file) => `${file.relativePath} continues the flow asynchronously after the initial request path finishes.`,
    config: (file) => `${file.relativePath} supplies runtime configuration that shapes how the flow behaves.`,
    utility: (file) => `${file.relativePath} provides helper logic used during the flow.`,
  };

  const orderedFiles = orderFlowFiles(files, graph);
  return orderedFiles.map((file) => {
    const template = templates[file.role] || templates.utility;
    const node = graph.files.get(file.relativePath);
    const localTargets = unique([
      ...(node ? node.calls.map((edge) => edge.targetSymbol || path.posix.basename(edge.to)) : []),
      ...(node ? node.dependencies.map((edge) => path.posix.basename(edge.to)) : []),
    ]).slice(0, 3);
    const suffix = localTargets.length > 0
      ? ` It then hands off to ${localTargets.join(', ')}.`
      : '';
    return `${template(file)}${suffix}`;
  });
}

function sanitizeNodeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_]/g, '_') || 'node';
}

function mermaidLabel(file) {
  const role = summarizeRole(file.role).replace(/"/g, '\'');
  const basename = file.relativePath.replace(/"/g, '\'');
  return `${basename}\\n${role}`;
}

function resolveEffectiveFlowEdges(files, edges) {
  if (Array.isArray(edges) && edges.length > 0) {
    return edges;
  }

  return files.slice(0, -1).map((file, index) => ({
    from: file.relativePath,
    to: files[index + 1].relativePath,
    label: '',
  }));
}

function buildMermaidFlow(name, files, edges, dataStores, integrations) {
  const lines = ['flowchart LR', '  caller["Caller / upstream trigger"]'];
  const nodes = files.map((file, index) => ({
    id: `n${index + 1}_${sanitizeNodeId(path.basename(file.relativePath))}`,
    label: mermaidLabel(file),
    file,
  }));

  for (const node of nodes) {
    lines.push(`  ${node.id}["${node.label}"]`);
  }

  if (nodes.length === 0) {
    lines.push('  outcome["Business outcome"]');
    lines.push('  caller --> outcome');
    return lines.join('\n');
  }

  const nodeByPath = new Map(nodes.map((node) => [node.file.relativePath, node]));
  const effectiveEdges = resolveEffectiveFlowEdges(files, edges);
  const inboundCounts = new Map(nodes.map((node) => [node.file.relativePath, 0]));
  for (const edge of effectiveEdges) {
    inboundCounts.set(edge.to, (inboundCounts.get(edge.to) || 0) + 1);
  }
  const starts = nodes.filter((node) => (inboundCounts.get(node.file.relativePath) || 0) === 0);
  for (const node of starts.length > 0 ? starts : [nodes[0]]) {
    lines.push(`  caller --> ${node.id}`);
  }
  for (const edge of effectiveEdges) {
    const fromNode = nodeByPath.get(edge.from);
    const toNode = nodeByPath.get(edge.to);
    if (!fromNode || !toNode) {
      continue;
    }
    const label = edge.label ? `|\"${String(edge.label).replace(/"/g, '\'')}\"|` : '';
    lines.push(`  ${fromNode.id} -->${label} ${toNode.id}`);
  }

  const outbound = new Set(effectiveEdges.map((edge) => edge.from));
  const tailNodes = nodes.filter((node) => !outbound.has(node.file.relativePath));
  const tailId = (tailNodes[tailNodes.length - 1] || nodes[nodes.length - 1]).id;
  if (dataStores.length > 0) {
    lines.push('  store["State / data store"]');
    lines.push(`  ${tailId} --> store`);
  }
  if (integrations.length > 0) {
    lines.push('  ext["External dependency"]');
    lines.push(`  ${tailId} --> ext`);
  }
  lines.push(`  outcome["${name.replace(/"/g, '\'')} outcome"]`);
  lines.push(`  ${tailId} --> outcome`);
  return lines.join('\n');
}

function flowParticipantLabel(file) {
  const role = summarizeRole(file.role);
  const basename = path.posix.basename(file.relativePath).replace(/"/g, '\'');
  return `${basename} (${role})`;
}

function sequenceMessage(actionLabel, edge, fallback) {
  const label = edge && edge.label ? String(edge.label) : '';
  if (label) {
    return label.replace(/"/g, '\'');
  }
  return fallback || actionLabel || 'handoff';
}

function buildSequenceMermaid(name, files, edges, dataStores, integrations) {
  const effectiveEdges = resolveEffectiveFlowEdges(files, edges);
  const lines = ['sequenceDiagram', '  autonumber', `  actor Caller as Caller`];
  const participantIds = new Map();

  files.forEach((file, index) => {
    const participantId = `P${index + 1}_${sanitizeNodeId(path.posix.basename(file.relativePath))}`;
    participantIds.set(file.relativePath, participantId);
    lines.push(`  participant ${participantId} as ${flowParticipantLabel(file)}`);
  });

  if (dataStores.length > 0) {
    lines.push('  participant DataStore as State store');
  }
  if (integrations.length > 0) {
    lines.push('  participant External as External dependency');
  }

  if (files.length === 0) {
    lines.push('  Caller-->>Caller: No inferred implementation flow');
    return lines.join('\n');
  }

  const firstParticipant = participantIds.get(files[0].relativePath);
  lines.push(`  Caller->>${firstParticipant}: ${name.replace(/"/g, '\'')} request`);

  for (const edge of effectiveEdges) {
    const fromId = participantIds.get(edge.from);
    const toId = participantIds.get(edge.to);
    if (!fromId || !toId) {
      continue;
    }
    lines.push(`  ${fromId}->>${toId}: ${sequenceMessage(name, edge, 'delegate')}`);
  }

  const tailFile = files[files.length - 1];
  const tailId = participantIds.get(tailFile.relativePath);
  if (dataStores.length > 0) {
    lines.push(`  ${tailId}->>DataStore: persist or read business state`);
    lines.push(`  DataStore-->>${tailId}: state loaded`);
  }
  if (integrations.length > 0) {
    lines.push(`  ${tailId}->>External: call external dependency`);
    lines.push(`  External-->>${tailId}: dependency response`);
  }
  lines.push(`  ${tailId}-->>Caller: return ${name.replace(/"/g, '\'')} outcome`);
  return lines.join('\n');
}

function summarizeModule(module, files, domain, flows, dataStores, integrations, graph, aiModule) {
  const roleCounts = new Map();
  for (const file of files) {
    roleCounts.set(file.role, (roleCounts.get(file.role) || 0) + 1);
  }
  const dominantRoles = Array.from(roleCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([role]) => summarizeRole(role));

  const aiHints = unique(files.map((file) => file.ai && file.ai.summary ? file.ai.summary : '').filter(Boolean)).slice(0, 2);
  const capability = aiModule && aiModule.capability
    ? clip(aiModule.capability, 180)
    : aiHints[0]
      ? clip(aiHints[0], 180)
      : `${humanizeModule(module.directory)} appears to implement ${domain.label.toLowerCase()} through ${dominantRoles.join(', ').toLowerCase() || 'supporting code'}.`;

  const basicDesign = aiModule && aiModule.basicDesign
    ? aiModule.basicDesign
    : [
      `${humanizeModule(module.directory)} is inferred as a ${domain.label.toLowerCase()} area.`,
      dominantRoles.length > 0 ? `The visible implementation layers are ${dominantRoles.join(', ')}.` : '',
      dataStores.length > 0 ? `State is likely persisted in ${dataStores.join(', ').toLowerCase()}.` : '',
      integrations.length > 0 ? `The module also integrates with ${integrations.join(', ')}.` : '',
    ].filter(Boolean).join(' ');

  const detailDesign = aiModule && aiModule.detailDesign
    ? aiModule.detailDesign
    : [
      flows.length > 0 ? `Primary flow coverage includes ${flows.map((flow) => flow.name).join(', ')}.` : '',
      files.length > 0 ? `Representative files are ${files.slice(0, 5).map((file) => file.relativePath).join(', ')}.` : '',
      aiHints.length > 1 ? `Observed behavior hints: ${aiHints[1]}` : '',
    ].filter(Boolean).join(' ');

  const entryPoints = mergeUniqueStrings(
    aiModule && Array.isArray(aiModule.entryPoints) ? aiModule.entryPoints : [],
    sortByPriority(files).filter((file) => ['ui', 'entry', 'guard'].includes(file.role)).slice(0, 6).map((file) => file.relativePath),
    6,
  );
  const mergedDataStores = mergeUniqueStrings(aiModule && aiModule.dataStores, dataStores, 6);
  const mergedIntegrations = mergeUniqueStrings(aiModule && aiModule.integrations, integrations, 6);
  const components = mergeComponentSummaries(aiModule && aiModule.components, files);
  const mergedFlows = flows.map((flow, index) => {
    const aiFlow = aiModule && Array.isArray(aiModule.keyFlows) ? aiModule.keyFlows[index] : null;
    if (!aiFlow) {
      return flow;
    }
    return {
      ...flow,
      name: aiFlow.name || flow.name,
      goal: aiFlow.goal || flow.goal,
    };
  });

  return {
    directory: module.directory,
    title: humanizeModule(module.directory),
    domainId: domain.id,
    domainLabel: domain.label,
    capability,
    basicDesign,
    detailDesign,
    actors: mergeUniqueStrings(aiModule && aiModule.actors, [], 4),
    entryPoints,
    dataStores: mergedDataStores,
    integrations: mergedIntegrations,
    components,
    interactions: graph.moduleEdges.filter((edge) => edge.from === module.directory || edge.to === module.directory).slice(0, 10),
    flows: mergedFlows,
  };
}

function buildModuleDesign(scanResult, module, fileInsights, graph, aiModule) {
  const files = getModuleFiles(scanResult, module.directory)
    .map((file) => fileInsights.get(file.relativePath))
    .filter(Boolean);
  const domain = pickDomain(module, files);
  const actions = pickActions(files, domain);
  const dataStores = inferDataStores(files);
  const integrations = inferExternalSystems(files);
  const flows = actions.map((action) => {
    const flowFiles = orderFlowFiles(pickFlowFiles(files, domain, action), graph);
    const edges = buildFlowEdges(flowFiles, graph);
    const steps = buildFlowSteps(flowFiles, action, graph);
    const flowName = buildFlowName(domain, action);
    return {
      id: `${module.directory || 'root'}:${action.id}`,
      name: flowName,
      goal: buildFlowGoal(domain, action),
      involvedFiles: flowFiles.map((file) => file.relativePath),
      edges,
      steps,
      mermaid: buildMermaidFlow(flowName, flowFiles, edges, dataStores, integrations),
      sequenceMermaid: buildSequenceMermaid(flowName, flowFiles, edges, dataStores, integrations),
    };
  });

  return summarizeModule(module, files, domain, flows, dataStores, integrations, graph, aiModule);
}

function buildProjectDesign(scanResult, moduleDesigns, graph) {
  const rankedModules = moduleDesigns
    .filter((module) => module.directory !== '')
    .filter((module) => !moduleDesigns.some((other) => (
      other.directory
      && other.directory.startsWith(`${module.directory}/`)
      && other.domainId === module.domainId
      && other.flows.length >= module.flows.length
    )))
    .sort((left, right) => right.flows.length - left.flows.length || left.directory.localeCompare(right.directory));
  const topModules = rankedModules.slice(0, 6);
  const topFlows = topModules.flatMap((module) => module.flows.slice(0, 1)).slice(0, 6);
  const actors = unique(topModules.flatMap((module) => module.actors || []));
  if (moduleDesigns.some((module) => module.domainId === 'auth')) actors.push('Authenticated end user');
  if (moduleDesigns.some((module) => module.components.some((entry) => entry.startsWith('Worker / async job')))) actors.push('Background worker');
  if (moduleDesigns.some((module) => module.integrations.length > 0)) actors.push('External provider');
  if (actors.length === 0) actors.push('Application caller');

  const contextLines = ['flowchart TD', '  caller["Caller / external trigger"]'];
  for (const module of topModules.slice(0, 5)) {
    const nodeId = sanitizeNodeId(module.directory || 'root');
    contextLines.push(`  ${nodeId}["${module.title.replace(/"/g, '\'')}\\n${module.domainLabel.replace(/"/g, '\'')}"]`);
    contextLines.push(`  caller --> ${nodeId}`);
  }
  if (topModules.some((module) => module.dataStores.length > 0)) {
    contextLines.push('  store["Stateful store"]');
    for (const module of topModules.filter((entry) => entry.dataStores.length > 0).slice(0, 4)) {
      contextLines.push(`  ${sanitizeNodeId(module.directory || 'root')} --> store`);
    }
  }

  const detailLines = ['flowchart LR'];
  const selectedModules = topModules.slice(0, 5);
  for (const module of selectedModules) {
    detailLines.push(`  ${sanitizeNodeId(module.directory || 'root')}["${module.title.replace(/"/g, '\'')}"]`);
  }
  const selectedSet = new Set(selectedModules.map((module) => module.directory));
  const interactionEdges = graph.moduleEdges.filter((edge) => selectedSet.has(edge.from) && selectedSet.has(edge.to));
  if (interactionEdges.length > 0) {
    for (const edge of interactionEdges) {
      detailLines.push(`  ${sanitizeNodeId(edge.from || 'root')} -->|\"${edge.weight} dep\"| ${sanitizeNodeId(edge.to || 'root')}`);
    }
  } else {
    for (let index = 0; index < Math.max(0, selectedModules.length - 1); index += 1) {
      detailLines.push(`  ${sanitizeNodeId(selectedModules[index].directory || 'root')} --> ${sanitizeNodeId(selectedModules[index + 1].directory || 'root')}`);
    }
  }

  return {
    basicDesign: {
      summary: scanResult.ai && scanResult.ai.project && scanResult.ai.project.overview
        ? scanResult.ai.project.overview
        : `${scanResult.projectName} is organized around ${topModules.length} main modules with ${scanResult.totals.filesParsed} scanned files and ${scanResult.totals.symbols} documented symbols.`,
      actors,
      capabilities: topModules.map((module) => ({
        directory: module.directory,
        title: module.title,
        summary: module.capability,
      })),
      diagram: contextLines.join('\n'),
    },
    detailDesign: {
      summary: topModules.length > 0
        ? `The runtime shape is dominated by ${topModules.map((module) => module.title).join(', ')}.`
        : `No dominant modules were identified for ${scanResult.projectName}.`,
      runtimeLayers: unique(topModules.flatMap((module) => module.components.map((entry) => entry.split(':', 1)[0]))),
      moduleInteractions: interactionEdges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
      })),
      modules: topModules.map((module) => ({
        directory: module.directory,
        title: module.title,
        basicDesign: module.basicDesign,
        detailDesign: module.detailDesign,
      })),
      diagram: detailLines.join('\n'),
    },
    flows: topFlows,
  };
}

function buildWorkspaceDesign(scanResult, workspace, moduleDesigns, graph) {
  const modules = moduleDesigns.filter((module) => workspace.modules.includes(module.directory));
  const topFlows = modules.flatMap((module) => module.flows.slice(0, 1)).slice(0, 4);
  return {
    directory: workspace.directory,
    summary: modules.length > 0
      ? `${workspace.name} groups ${modules.length} modules that mostly cover ${unique(modules.map((module) => module.domainLabel.toLowerCase())).join(', ')}.`
      : `${workspace.name} contains support code with limited business evidence.`,
    topFlows,
    interactions: graph.moduleEdges.filter((edge) => workspace.modules.includes(edge.from) || workspace.modules.includes(edge.to)).slice(0, 10),
  };
}

function buildEndpointAction(endpoint, entryFile) {
  const tokens = tokenize([
    endpoint.method,
    endpoint.path,
    endpoint.handler || '',
    entryFile ? entryFile.relativePath : '',
    entryFile ? entryFile.symbols.map((symbol) => symbol.name).join(' ') : '',
  ].join(' '));
  const actions = detectActions(tokens);
  if (actions.length > 0) {
    return actions[0];
  }

  return {
    id: endpoint.method.toLowerCase(),
    label: endpoint.method.toLowerCase(),
    keywords: [endpoint.method.toLowerCase()],
    score: 1,
  };
}

function pickEndpointFlowFiles(endpoint, entryFile, graph, fileInsights, scanResult) {
  if (!entryFile) {
    return [];
  }

  const filesByPath = new Map(scanResult.files.map((file) => [file.relativePath, file]));
  const ordered = [];
  const visited = new Set();
  const queue = [entryFile];
  const workspaceDirectory = entryFile.workspace ? entryFile.workspace.directory : '';

  while (queue.length > 0 && ordered.length < 6) {
    const file = queue.shift();
    if (!file || visited.has(file.relativePath)) {
      continue;
    }
    visited.add(file.relativePath);
    ordered.push(file);

    const node = graph.files.get(file.relativePath);
    const nextPaths = unique([
      ...(node ? node.calls.map((edge) => edge.to) : []),
      ...(node ? node.dependencies.map((edge) => edge.to) : []),
    ]);
    const nextFiles = sortByPriority(
      nextPaths
        .map((relativePath) => fileInsights.get(relativePath) || filesByPath.get(relativePath))
        .filter(Boolean)
        .filter((candidate) => (
          candidate.relativePath !== entryFile.relativePath
          && (
            !candidate.workspace
            || candidate.workspace.directory === workspaceDirectory
          )
        )),
    );
    for (const nextFile of nextFiles) {
      if (!visited.has(nextFile.relativePath)) {
        queue.push(nextFile);
      }
    }
  }

  return orderFlowFiles(ordered, graph);
}

function buildEndpointDesigns(scanResult, graph, fileInsights) {
  const filesByPath = new Map(scanResult.files.map((file) => [file.relativePath, file]));
  return (scanResult.api && Array.isArray(scanResult.api.endpoints) ? scanResult.api.endpoints : []).map((endpoint) => {
    const entryFile = fileInsights.get(endpoint.file) || filesByPath.get(endpoint.file);
    const action = buildEndpointAction(endpoint, entryFile);
    const flowFiles = pickEndpointFlowFiles(endpoint, entryFile, graph, fileInsights, scanResult);
    const edges = buildFlowEdges(flowFiles, graph);
    const dataStores = inferDataStores(flowFiles);
    const integrations = inferExternalSystems(flowFiles);
    const name = `${endpoint.method} ${endpoint.path}`;

    return {
      id: endpoint.id,
      name,
      involvedFiles: flowFiles.map((file) => file.relativePath),
      steps: buildFlowSteps(flowFiles, action, graph),
      mermaid: buildMermaidFlow(name, flowFiles, edges, dataStores, integrations),
      sequenceMermaid: buildSequenceMermaid(name, flowFiles, edges, dataStores, integrations),
    };
  });
}

function enrichWithDesign(scanResult, context = {}) {
  const { lspClient = null } = context;
  const rawInsights = new Map(scanResult.files.map((file) => [file.relativePath, buildFileInsights(file)]));
  const graph = buildInteractionGraph(scanResult, lspClient);
  const aiModulesByDirectory = new Map(
    scanResult.ai && Array.isArray(scanResult.ai.modules)
      ? scanResult.ai.modules.map((module) => [module.directory, module])
      : [],
  );
  const fileInsights = new Map(scanResult.files.map((file) => {
    const node = graph.files.get(file.relativePath) || { dependencies: [], callers: [], calls: [], calledBy: [] };
    return [file.relativePath, {
      ...rawInsights.get(file.relativePath),
      localDependencies: node.dependencies.map((edge) => edge.to),
      calledFiles: node.calls.map((edge) => edge.to),
      calledByFiles: node.calledBy.map((edge) => edge.from),
    }];
  }));
  const modules = scanResult.directories.map((module) => buildModuleDesign(scanResult, module, fileInsights, graph, aiModulesByDirectory.get(module.directory) || null));
  const workspaces = scanResult.workspaces.map((workspace) => buildWorkspaceDesign(scanResult, workspace, modules, graph));
  const api = {
    endpoints: buildEndpointDesigns(scanResult, graph, fileInsights),
  };

  return {
    ...scanResult,
    design: {
      generatedAt: scanResult.generatedAt,
      project: buildProjectDesign(scanResult, modules, graph),
      modules,
      workspaces,
      api,
      graph: {
        moduleEdges: graph.moduleEdges,
      },
    },
  };
}

module.exports = {
  enrichWithDesign,
};
