const path = require('node:path');
const { hashObject } = require('./hash');

const BASE_DOMAIN_DEFINITIONS = [
  { id: 'auth', title: 'Authentication', summary: 'Identity, session, and access-control flows.', keywords: ['auth', 'login', 'logout', 'signin', 'signout', 'register', 'signup', 'session', 'token', 'password', 'credential', 'oauth', 'sso', 'mfa', 'otp', 'permission', 'role', 'access'] },
  { id: 'user', title: 'User Management', summary: 'Profile, account, and user lifecycle flows.', keywords: ['user', 'profile', 'account', 'member', 'identity', 'people'] },
  { id: 'payment', title: 'Payments', summary: 'Checkout, billing, subscription, and payment-state flows.', keywords: ['payment', 'billing', 'invoice', 'checkout', 'refund', 'charge', 'subscription', 'plan'] },
  { id: 'order', title: 'Order Management', summary: 'Order capture, cart, fulfillment, and inventory coordination.', keywords: ['order', 'cart', 'checkout', 'shipment', 'fulfillment', 'inventory'] },
  { id: 'notification', title: 'Notifications', summary: 'Email, messaging, alerting, and notification delivery flows.', keywords: ['notify', 'notification', 'email', 'sms', 'message', 'alert', 'webhook'] },
  { id: 'search', title: 'Search', summary: 'Search, filtering, and discovery-related flows.', keywords: ['search', 'query', 'filter', 'index', 'ranking'] },
  { id: 'reporting', title: 'Reporting', summary: 'Analytics, reporting, dashboards, and audit flows.', keywords: ['report', 'analytics', 'dashboard', 'metric', 'insight', 'audit'] },
  { id: 'admin', title: 'Administration', summary: 'Operational and backoffice workflows.', keywords: ['admin', 'management', 'console', 'backoffice', 'moderation'] },
  { id: 'storage', title: 'Storage', summary: 'File upload, document, and storage workflows.', keywords: ['file', 'files', 'upload', 'download', 'storage', 'bucket', 'blob', 'document'] },
  { id: 'integration', title: 'Integrations', summary: 'External provider and partner connectivity flows.', keywords: ['integration', 'provider', 'adapter', 'client', 'sdk', 'partner'] },
];

const ACTION_DEFINITIONS = [
  { id: 'login', title: 'Login', keywords: ['login', 'signin', 'authenticate', 'auth'] },
  { id: 'register', title: 'Registration', keywords: ['register', 'signup', 'invite', 'createaccount'] },
  { id: 'logout', title: 'Logout', keywords: ['logout', 'signout', 'revoke'] },
  { id: 'refresh', title: 'Token Refresh', keywords: ['refresh', 'renew'] },
  { id: 'verify', title: 'Verification', keywords: ['verify', 'validation', 'validate', 'check'] },
  { id: 'reset', title: 'Password Reset', keywords: ['reset', 'forgot', 'password'] },
  { id: 'create', title: 'Create', keywords: ['create', 'add', 'insert', 'save'] },
  { id: 'update', title: 'Update', keywords: ['update', 'edit', 'patch'] },
  { id: 'delete', title: 'Delete', keywords: ['delete', 'remove', 'destroy'] },
  { id: 'list', title: 'Read / List', keywords: ['list', 'fetch', 'get', 'read', 'load'] },
  { id: 'sync', title: 'Sync', keywords: ['sync', 'import', 'export'] },
  { id: 'notify', title: 'Notify', keywords: ['notify', 'send', 'message', 'email', 'sms'] },
];

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

const ROLE_ORDER = ['ui', 'entry', 'guard', 'service', 'integration', 'repository', 'model', 'worker', 'config', 'utility'];
const DOMAIN_ACTORS = {
  auth: ['Anonymous end user', 'Authenticated end user'],
  user: ['Authenticated end user'],
  payment: ['Customer', 'Payment provider'],
  order: ['Customer', 'Operations staff'],
  notification: ['System operator', 'End user'],
};

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
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

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'feature';
}

function clip(value, max = 180) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}…`;
}

function sortByRole(entries) {
  return entries.slice().sort((left, right) => {
    const leftRank = ROLE_ORDER.indexOf(left.role);
    const rightRank = ROLE_ORDER.indexOf(right.role);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.path.localeCompare(right.path);
  });
}

function buildDomainDefinitions(customDomains = {}) {
  const domains = BASE_DOMAIN_DEFINITIONS.map((entry) => ({ ...entry, keywords: entry.keywords.slice() }));
  for (const [id, keywords] of Object.entries(customDomains || {})) {
    const normalizedId = String(id || '').trim().toLowerCase();
    const normalizedKeywords = Array.isArray(keywords)
      ? keywords.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (!normalizedId || normalizedKeywords.length === 0) {
      continue;
    }

    const existing = domains.find((entry) => entry.id === normalizedId);
    if (existing) {
      existing.keywords = unique([...existing.keywords, ...normalizedKeywords]);
      continue;
    }

    domains.push({
      id: normalizedId,
      title: titleCase(normalizedId),
      summary: `${titleCase(normalizedId)} business workflows.`,
      keywords: normalizedKeywords,
    });
  }
  return domains;
}

function scoreDefinitions(tokens, definitions) {
  const tokenSet = new Set(tokens);
  return definitions
    .map((entry) => ({
      ...entry,
      score: entry.keywords.reduce((sum, keyword) => sum + (tokenSet.has(keyword) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function inferRole(file, tokens) {
  const tokenSet = new Set(tokens);
  for (const definition of ROLE_DEFINITIONS) {
    if (definition.keywords.some((keyword) => tokenSet.has(keyword))) {
      return definition.id;
    }
  }
  if (Array.isArray(file.apiContracts) && file.apiContracts.length > 0) {
    return 'entry';
  }
  if (Array.isArray(file.schemaDefinitions) && file.schemaDefinitions.length > 0) {
    return 'model';
  }
  return 'utility';
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

function buildFileGraph(scanResult) {
  const filesByPath = new Map(scanResult.files.map((file) => [file.relativePath, file]));
  const knownExtensions = unique(scanResult.files.map((file) => file.extension));
  const dependencies = new Map(scanResult.files.map((file) => [file.relativePath, new Set()]));
  const reverseDependencies = new Map(scanResult.files.map((file) => [file.relativePath, new Set()]));

  for (const file of scanResult.files) {
    for (const specifier of file.imports || []) {
      const resolved = resolveLocalImport(file.relativePath, specifier, filesByPath, knownExtensions);
      if (!resolved) {
        continue;
      }
      dependencies.get(file.relativePath).add(resolved);
      reverseDependencies.get(resolved).add(file.relativePath);
    }
  }

  return { filesByPath, dependencies, reverseDependencies };
}

function inferFileMetadata(scanResult, domainDefinitions, graph) {
  const moduleDesigns = Array.isArray(scanResult.design && scanResult.design.modules) ? scanResult.design.modules : [];
  const moduleByDirectory = new Map(moduleDesigns.map((module) => [module.directory, module]));

  return new Map(scanResult.files.map((file) => {
    const tokenSource = [
      file.relativePath,
      file.directory,
      ...(file.imports || []),
      ...(file.symbols || []).map((symbol) => `${symbol.kind} ${symbol.name} ${symbol.signature}`),
      ...(file.apiContracts || []).map((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.group || ''}`),
      ...(file.schemaDefinitions || []).map((schema) => `${schema.name} ${schema.kind} ${(schema.fields || []).join(' ')}`),
      file.ai && file.ai.summary ? file.ai.summary : '',
      ...(file.ai && Array.isArray(file.ai.responsibilities) ? file.ai.responsibilities : []),
    ].join(' ');

    const tokens = tokenize(tokenSource);
    const domains = scoreDefinitions(tokens, domainDefinitions);
    const actions = scoreDefinitions(tokens, ACTION_DEFINITIONS);
    const moduleDesign = moduleByDirectory.get(file.directory) || null;
    const moduleDomainId = moduleDesign && moduleDesign.domainId ? moduleDesign.domainId : null;
    const domainId = domains[0] ? domains[0].id : (moduleDomainId || 'general');
    const role = inferRole(file, tokens);
    const roleDefinition = ROLE_DEFINITIONS.find((entry) => entry.id === role);

    return [file.relativePath, {
      path: file.relativePath,
      role,
      roleLabel: roleDefinition ? roleDefinition.label : 'Utility',
      workspace: file.workspace ? file.workspace.directory : '',
      workspaceName: file.workspace ? file.workspace.name : '',
      directory: path.posix.dirname(file.relativePath) === '.' ? '' : path.posix.dirname(file.relativePath),
      tokens,
      domains,
      actions,
      domainId,
      localDependencies: Array.from(graph.dependencies.get(file.relativePath) || []),
      reverseDependencies: Array.from(graph.reverseDependencies.get(file.relativePath) || []),
    }];
  }));
}

function findDomainSeeds(scanResult, domainId, metadataByPath, domainDefinitions) {
  const domainDefinition = domainDefinitions.find((entry) => entry.id === domainId) || { keywords: [domainId] };
  const moduleSeeds = (scanResult.design && Array.isArray(scanResult.design.modules) ? scanResult.design.modules : [])
    .filter((module) => module.domainId === domainId)
    .flatMap((module) => scanResult.files
      .filter((file) => file.directory === module.directory || file.directory.startsWith(`${module.directory}/`))
      .map((file) => file.relativePath));

  const endpointSeeds = (scanResult.api && Array.isArray(scanResult.api.endpoints) ? scanResult.api.endpoints : [])
    .filter((endpoint) => endpoint.group === domainId || domainDefinition.keywords.some((keyword) => tokenize(`${endpoint.path} ${endpoint.handler || ''}`).includes(keyword)))
    .map((endpoint) => endpoint.file);

  const fileSeeds = Array.from(metadataByPath.values())
    .filter((meta) => meta.domainId === domainId || meta.domains.some((entry) => entry.id === domainId))
    .map((meta) => meta.path);

  return unique([...moduleSeeds, ...endpointSeeds, ...fileSeeds]);
}

function accumulateExpansion(seedPaths, graph, metadataByPath, domainId, maxDepth = 3) {
  const scores = new Map();
  const queue = [];

  for (const seedPath of seedPaths) {
    scores.set(seedPath, 6);
    queue.push({ path: seedPath, depth: 0, weight: 6 });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      continue;
    }

    const neighbors = unique([
      ...(graph.dependencies.get(current.path) || []),
      ...(graph.reverseDependencies.get(current.path) || []),
    ]);

    for (const neighbor of neighbors) {
      const meta = metadataByPath.get(neighbor);
      let nextWeight = Math.max(1, current.weight - 2);
      if (meta && (meta.domainId === domainId || meta.domains.some((entry) => entry.id === domainId))) {
        nextWeight += 2;
      }
      if (meta && ['entry', 'service', 'repository', 'model', 'ui'].includes(meta.role)) {
        nextWeight += 1;
      }
      if (nextWeight > (scores.get(neighbor) || 0)) {
        scores.set(neighbor, nextWeight);
        queue.push({ path: neighbor, depth: current.depth + 1, weight: nextWeight });
      }
    }
  }

  return scores;
}

function collectSchemaRefsFromEndpoints(endpoints) {
  return unique(endpoints.flatMap((endpoint) => [
    ...((endpoint.request && endpoint.request.bodySchemas) || []),
    ...(endpoint.responseSchemas || []),
  ]).map((schema) => schema && schema.file).filter(Boolean));
}

function getActionDefinition(actionId) {
  if (!actionId) {
    return null;
  }
  return ACTION_DEFINITIONS.find((entry) => entry.id === actionId) || {
    id: actionId,
    title: titleCase(actionId),
    keywords: [actionId],
  };
}

function actionMatches(actionId, value) {
  const definition = getActionDefinition(actionId);
  const tokenSet = new Set(tokenize(value));
  return definition.keywords.some((keyword) => tokenSet.has(keyword));
}

function collectActionCandidates(expandedPaths, scanResult, metadataByPath, domainId) {
  const scores = new Map();

  for (const meta of Array.from(expandedPaths).map((filePath) => metadataByPath.get(filePath)).filter(Boolean)) {
    for (const action of meta.actions) {
      scores.set(action.id, (scores.get(action.id) || 0) + action.score);
    }
  }

  for (const endpoint of (scanResult.api && Array.isArray(scanResult.api.endpoints) ? scanResult.api.endpoints : [])) {
    if (endpoint.group !== domainId && !expandedPaths.has(endpoint.file)) {
      continue;
    }
    for (const definition of ACTION_DEFINITIONS) {
      if (actionMatches(definition.id, `${endpoint.path} ${endpoint.handler || ''}`)) {
        scores.set(definition.id, (scores.get(definition.id) || 0) + 3);
      }
    }
  }

  for (const module of (scanResult.design && Array.isArray(scanResult.design.modules) ? scanResult.design.modules : [])) {
    if (module.domainId !== domainId) {
      continue;
    }
    for (const flow of module.flows || []) {
      for (const definition of ACTION_DEFINITIONS) {
        if (actionMatches(definition.id, `${flow.name} ${flow.goal}`)) {
          scores.set(definition.id, (scores.get(definition.id) || 0) + 4);
        }
      }
    }
  }

  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, score]) => ({ ...getActionDefinition(id), score }))
    .filter((entry) => entry.score > 0);
}

function expandWithinSet(seedPaths, allowedPaths, graph, metadataByPath, actionId, maxDepth = 2) {
  const visited = new Set();
  const queue = Array.from(seedPaths).map((pathValue) => ({ path: pathValue, depth: 0 }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!allowedPaths.has(current.path) || visited.has(current.path)) {
      continue;
    }
    visited.add(current.path);
    if (current.depth >= maxDepth) {
      continue;
    }

    const neighbors = unique([
      ...(graph.dependencies.get(current.path) || []),
      ...(graph.reverseDependencies.get(current.path) || []),
    ]);

    for (const neighbor of neighbors) {
      if (!allowedPaths.has(neighbor) || visited.has(neighbor)) {
        continue;
      }
      const meta = metadataByPath.get(neighbor);
      if (!meta) {
        continue;
      }
      if (meta.actions.some((entry) => entry.id === actionId) || ['service', 'repository', 'model', 'integration'].includes(meta.role)) {
        queue.push({ path: neighbor, depth: current.depth + 1 });
      }
    }
  }

  return visited;
}

function featureTitle(domainDefinition, actionDefinition) {
  return actionDefinition ? `${domainDefinition.title} ${actionDefinition.title}` : domainDefinition.title;
}

function featureSummary(domainDefinition, actionDefinition, workspaces, endpoints, flows) {
  const parts = [];
  if (actionDefinition) {
    parts.push(`${featureTitle(domainDefinition, actionDefinition)} captures the ${actionDefinition.title.toLowerCase()} workflow inside ${domainDefinition.title.toLowerCase()}.`);
  } else {
    parts.push(`${domainDefinition.title} captures the main ${domainDefinition.title.toLowerCase()} behavior discovered in the codebase.`);
  }
  if (workspaces.length > 1) {
    parts.push(`It spans ${workspaces.length} workspaces.`);
  }
  if (endpoints.length > 0) {
    parts.push(`${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} are linked to this feature.`);
  }
  if (flows.length > 0) {
    parts.push(`Key flows include ${flows.slice(0, 3).map((flow) => flow.name).join(', ')}.`);
  }
  return parts.join(' ');
}

function deriveFileReason(file, meta, endpointsByFile, schemaFiles, actionDefinition) {
  if (endpointsByFile.has(file.relativePath)) {
    return 'Owns one of the feature HTTP entry points.';
  }
  if (schemaFiles.has(file.relativePath)) {
    return 'Defines request/response schemas reused by the feature.';
  }
  if (actionDefinition && meta.actions.some((entry) => entry.id === actionDefinition.id)) {
    return `Matches the ${actionDefinition.title.toLowerCase()} action heuristics for this feature.`;
  }
  if (['service', 'repository', 'model', 'integration'].includes(meta.role)) {
    return `Supports the feature as ${meta.roleLabel.toLowerCase()}.`;
  }
  if (meta.reverseDependencies.length > 0) {
    return 'Pulled in through local dependencies from other feature files.';
  }
  return 'Grouped with the feature through shared domain signals.';
}

function buildFeatureContextDiagram(feature) {
  const lines = ['flowchart LR'];
  const actors = feature.actors.length > 0 ? feature.actors : ['Caller'];
  const actorIds = actors.map((actor, index) => ({ id: `actor_${index + 1}`, label: actor.replace(/"/g, '\'') }));
  for (const actor of actorIds) {
    lines.push(`  ${actor.id}["${actor.label}"]`);
  }
  const featureNodeId = `feature_${feature.slug.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  lines.push(`  ${featureNodeId}["${feature.title.replace(/"/g, '\'')}\\nFeature boundary"]`);
  for (const actor of actorIds) {
    lines.push(`  ${actor.id} --> ${featureNodeId}`);
  }
  const externalSystems = unique(feature.integrations);
  if (externalSystems.length === 0) {
    lines.push('  state_store["State / data store"]');
    lines.push(`  ${featureNodeId} --> state_store`);
  } else {
    externalSystems.slice(0, 6).forEach((system, index) => {
      const systemId = `ext_${index + 1}`;
      lines.push(`  ${systemId}["${String(system).replace(/"/g, '\'')}"]`);
      lines.push(`  ${featureNodeId} --> ${systemId}`);
    });
  }
  return lines.join('\n');
}

function buildFeatureComponentDiagram(feature) {
  const ordered = sortByRole(feature.files).slice(0, 8);
  const lines = ['flowchart LR'];
  const nodes = ordered.map((file, index) => ({
    id: `cmp_${index + 1}`,
    label: `${path.posix.basename(file.path)}\\n${file.roleLabel}`.replace(/"/g, '\''),
  }));

  for (const node of nodes) {
    lines.push(`  ${node.id}["${node.label}"]`);
  }
  for (let index = 0; index < Math.max(0, nodes.length - 1); index += 1) {
    lines.push(`  ${nodes[index].id} --> ${nodes[index + 1].id}`);
  }
  if (feature.schemas.length > 0 && nodes.length > 0) {
    lines.push('  schema_store["Contracts / schemas"]');
    lines.push(`  ${nodes[Math.max(0, nodes.length - 1)].id} --> schema_store`);
  }
  if (feature.dataStores.length > 0 && nodes.length > 0) {
    lines.push('  data_store["State / persistence"]');
    lines.push(`  ${nodes[Math.max(0, nodes.length - 1)].id} --> data_store`);
  }
  return lines.join('\n');
}

function buildFallbackUserStories(feature) {
  const actor = feature.actors[0] || 'user';
  const mainFlow = feature.flows[0];
  if (!mainFlow) {
    return [];
  }
  return [{
    role: actor,
    goal: mainFlow.name,
    benefit: clip(mainFlow.goal, 120) || `complete ${feature.title.toLowerCase()}`,
    acceptance: (mainFlow.steps || []).slice(0, 3),
  }];
}

function findGlobalBusinessVariables(files) {
  const varCounts = new Map();
  const BUSINESS_VARIABLE_PATTERNS = [
    /\b(organization|tenant|school|branch|store|rls|user)Id\b/g,
    /\b(target|current)(Year|Date|Period)\b/g,
    /\b(fiscal|academic)Year\b/g
  ];

  for (const file of files) {
    if (!file.symbols) continue;
    for (const symbol of file.symbols) {
      for (const pattern of BUSINESS_VARIABLE_PATTERNS) {
        const matches = symbol.code.matchAll(pattern);
        for (const match of matches) {
          const varName = match[0];
          varCounts.set(varName, (varCounts.get(varName) || 0) + 1);
        }
      }
    }
  }

  return Array.from(varCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(e => e[1] >= 2)
    .map(e => ({ name: e[0], occurrences: e[1] }));
}

function buildFeature(scanResult, domainDefinitions, domainId, actionId, selectedPaths, metadataByPath) {
  const domainDefinition = domainDefinitions.find((entry) => entry.id === domainId) || {
    id: domainId,
    title: titleCase(domainId),
    summary: `${titleCase(domainId)} business workflows.`,
    keywords: [domainId],
  };
  const actionDefinition = getActionDefinition(actionId);
  const filesByPath = new Map(scanResult.files.map((file) => [file.relativePath, file]));
  const selectedFiles = Array.from(selectedPaths)
    .map((filePath) => filesByPath.get(filePath))
    .filter(Boolean)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (selectedFiles.length === 0) {
    return null;
  }

  const endpoints = (scanResult.api && Array.isArray(scanResult.api.endpoints) ? scanResult.api.endpoints : [])
    .filter((endpoint) => selectedPaths.has(endpoint.file) || endpoint.group === domainId)
    .filter((endpoint) => !actionDefinition || actionMatches(actionDefinition.id, `${endpoint.path} ${endpoint.handler || ''}`));
  const endpointFiles = new Set(endpoints.map((endpoint) => endpoint.file));
  const schemaFiles = new Set(collectSchemaRefsFromEndpoints(endpoints));
  const schemaRefs = unique(endpoints.flatMap((endpoint) => [
    ...((endpoint.request && endpoint.request.bodySchemas) || []),
    ...(endpoint.responseSchemas || []),
  ]).map((schema) => schema && JSON.stringify(schema))).map((entry) => JSON.parse(entry));

  // Cross-Layer API Client Linkage
  const linkedEndpoints = [];
  for (const file of selectedFiles) {
    if (file.apiCalls) {
      for (const call of file.apiCalls) {
        const matchedApi = (scanResult.api && scanResult.api.endpoints || []).find(e => 
          e.path === call.path && e.method === call.method
        );
        if (matchedApi) {
          linkedEndpoints.push(matchedApi);
        }
      }
    }
  }

  const globalVars = findGlobalBusinessVariables(selectedFiles);

  const modules = unique(selectedFiles.map((file) => file.directory));
  const moduleDesigns = (scanResult.design && Array.isArray(scanResult.design.modules) ? scanResult.design.modules : [])
    .filter((module) => modules.includes(module.directory));

  const flows = [];
  const seenFlowIds = new Set();
  for (const module of moduleDesigns) {
    for (const flow of module.flows || []) {
      const intersects = (flow.involvedFiles || []).some((filePath) => selectedPaths.has(filePath));
      const actionMatch = !actionDefinition || actionMatches(actionDefinition.id, `${flow.name} ${flow.goal}`);
      if (!intersects || !actionMatch) {
        continue;
      }
      const key = flow.id || `${flow.name}:${(flow.involvedFiles || []).join('|')}`;
      if (seenFlowIds.has(key)) {
        continue;
      }
      seenFlowIds.add(key);
      flows.push({ ...flow, source: 'module', module: module.directory });
    }
  }
  for (const endpointDesign of (scanResult.design && scanResult.design.api && Array.isArray(scanResult.design.api.endpoints) ? scanResult.design.api.endpoints : [])) {
    if (!endpoints.some((endpoint) => endpoint.id === endpointDesign.id)) {
      continue;
    }
    const key = endpointDesign.id || endpointDesign.name;
    if (seenFlowIds.has(key)) {
      continue;
    }
    seenFlowIds.add(key);
    flows.push({ ...endpointDesign, source: 'endpoint', goal: `Handle ${endpointDesign.name}.` });
  }

  const workspaces = unique(selectedFiles.map((file) => file.workspace ? file.workspace.directory : '')).map((directory) => ({
    directory,
    name: selectedFiles.find((file) => (file.workspace ? file.workspace.directory : '') === directory)?.workspace?.name || '(root)',
  }));

  const actors = unique([
    ...moduleDesigns.flatMap((module) => module.actors || []),
    ...(DOMAIN_ACTORS[domainId] || []),
  ]);
  const integrations = unique(moduleDesigns.flatMap((module) => module.integrations || []));
  const dataStores = unique(moduleDesigns.flatMap((module) => module.dataStores || []));

  const files = sortByRole(selectedFiles.map((file) => {
    const meta = metadataByPath.get(file.relativePath);
    return {
      path: file.relativePath,
      role: meta ? meta.role : 'utility',
      roleLabel: meta ? meta.roleLabel : 'Utility',
      workspace: file.workspace ? file.workspace.directory : '',
      workspaceName: file.workspace ? file.workspace.name : '',
      reason: deriveFileReason(file, meta || { role: 'utility', roleLabel: 'Utility', actions: [], reverseDependencies: [] }, endpointFiles, schemaFiles, actionDefinition),
    };
  }));

  const entryPoints = {
    fe: files
      .filter((file) => ['ui', 'entry', 'guard'].includes(file.role) && !endpointFiles.has(file.path))
      .slice(0, 8)
      .map((file) => file.path),
    be: unique([
      ...endpoints.map((endpoint) => endpoint.file),
      ...files.filter((file) => ['entry', 'service', 'repository'].includes(file.role)).slice(0, 8).map((file) => file.path),
    ]).slice(0, 8),
  };

  const title = featureTitle(domainDefinition, actionDefinition);
  const slug = toSlug(actionDefinition ? `${domainDefinition.id}-${actionDefinition.id}` : domainDefinition.id);
  const summary = featureSummary(domainDefinition, actionDefinition, workspaces, endpoints, flows);
  const overview = clip(unique([
    ...moduleDesigns.map((module) => module.capability).filter(Boolean),
    summary,
  ]).join(' '), 260);

  const feature = {
    id: slug,
    slug,
    title,
    domain: domainDefinition.id,
    domainLabel: domainDefinition.title,
    action: actionDefinition ? actionDefinition.id : null,
    actionLabel: actionDefinition ? actionDefinition.title : '',
    summary,
    overview,
    actors,
    files,
    modules,
    workspaces,
    apiContracts: endpoints,
    schemas: schemaRefs,
    flows: flows.slice(0, 8),
    entryPoints,
    integrations,
    dataStores,
    linkedEndpoints,
    globalVariables: globalVars,
  };

  feature.userStories = buildFallbackUserStories(feature);
  feature.contextDiagram = buildFeatureContextDiagram(feature);
  feature.componentDiagram = buildFeatureComponentDiagram(feature);
  feature.hash = hashObject({
    id: feature.id,
    files: feature.files.map((file) => file.path),
    endpoints: feature.apiContracts.map((endpoint) => endpoint.id),
    flows: feature.flows.map((flow) => flow.id || flow.name),
    schemas: feature.schemas.map((schema) => `${schema.file}:${schema.name}`),
  });
  return feature;
}

function dedupeFeatures(features) {
  const deduped = [];
  const seen = new Set();
  for (const feature of features) {
    if (!feature) {
      continue;
    }
    const key = hashObject({
      files: feature.files.map((file) => file.path).sort(),
      endpoints: feature.apiContracts.map((endpoint) => endpoint.id).sort(),
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(feature);
  }
  return deduped.sort((left, right) => {
    if (right.files.length !== left.files.length) {
      return right.files.length - left.files.length;
    }
    return left.title.localeCompare(right.title);
  });
}

function clusterFeatures(scanResult, rawOptions = {}) {
  const options = {
    enabled: rawOptions.enabled !== false,
    maxFilesPerFeature: Number.isFinite(rawOptions.maxFilesPerFeature) ? rawOptions.maxFilesPerFeature : 40,
    splitByAction: rawOptions.splitByAction !== false,
    customDomains: rawOptions.customDomains || {},
  };

  if (!options.enabled) {
    return {
      ...scanResult,
      features: [],
      featureIndex: {
        byFile: {},
        total: 0,
        generatedAt: scanResult.generatedAt,
      },
    };
  }

  const domainDefinitions = buildDomainDefinitions(options.customDomains);
  const graph = buildFileGraph(scanResult);
  const metadataByPath = inferFileMetadata(scanResult, domainDefinitions, graph);
  const candidateDomainIds = unique([
    ...(scanResult.design && Array.isArray(scanResult.design.modules) ? scanResult.design.modules.map((module) => module.domainId) : []),
    ...Array.from(metadataByPath.values()).map((meta) => meta.domainId),
    ...((scanResult.api && Array.isArray(scanResult.api.endpoints) ? scanResult.api.endpoints : []).map((endpoint) => endpoint.group || 'general')),
  ]).filter((domainId) => domainId && domainId !== 'general');

  const features = [];

  for (const domainId of candidateDomainIds) {
    const seedPaths = findDomainSeeds(scanResult, domainId, metadataByPath, domainDefinitions);
    if (seedPaths.length === 0) {
      continue;
    }

    const expansionScores = accumulateExpansion(seedPaths, graph, metadataByPath, domainId, 3);
    const expandedPaths = new Set(
      Array.from(expansionScores.entries())
        .filter(([filePath, score]) => {
          const meta = metadataByPath.get(filePath);
          return score >= 2 || (meta && meta.domains.some((entry) => entry.id === domainId));
        })
        .map(([filePath]) => filePath),
    );
    for (const seedPath of seedPaths) {
      expandedPaths.add(seedPath);
    }

    const actionCandidates = collectActionCandidates(expandedPaths, scanResult, metadataByPath, domainId)
      .filter((entry) => entry.id !== 'list' || entry.score > 2);
    const shouldSplit = options.splitByAction && (expandedPaths.size > options.maxFilesPerFeature || actionCandidates.length > 1);

    if (shouldSplit) {
      for (const action of actionCandidates.slice(0, 4)) {
        const actionSeeds = new Set(Array.from(expandedPaths).filter((filePath) => {
          const meta = metadataByPath.get(filePath);
          return meta && meta.actions.some((entry) => entry.id === action.id);
        }));
        const actionEndpoints = (scanResult.api && Array.isArray(scanResult.api.endpoints) ? scanResult.api.endpoints : [])
          .filter((endpoint) => (endpoint.group === domainId || expandedPaths.has(endpoint.file)) && actionMatches(action.id, `${endpoint.path} ${endpoint.handler || ''}`));
        for (const endpoint of actionEndpoints) {
          actionSeeds.add(endpoint.file);
          for (const schemaFile of collectSchemaRefsFromEndpoints([endpoint])) {
            actionSeeds.add(schemaFile);
          }
        }
        if (actionSeeds.size === 0) {
          continue;
        }
        const scopedPaths = expandWithinSet(actionSeeds, expandedPaths, graph, metadataByPath, action.id, 2);
        const feature = buildFeature(scanResult, domainDefinitions, domainId, action.id, scopedPaths, metadataByPath);
        if (feature && feature.files.length > 0) {
          features.push(feature);
        }
      }
    }

    if (!shouldSplit || features.filter((feature) => feature.domain === domainId).length === 0) {
      const feature = buildFeature(scanResult, domainDefinitions, domainId, null, expandedPaths, metadataByPath);
      if (feature) {
        features.push(feature);
      }
    }
  }

  const deduped = dedupeFeatures(features);
  const featureIdsByFile = {};
  for (const feature of deduped) {
    for (const file of feature.files) {
      featureIdsByFile[file.path] ||= [];
      featureIdsByFile[file.path].push(feature.id);
    }
  }

  return {
    ...scanResult,
    features: deduped,
    featureIndex: {
      byFile: featureIdsByFile,
      total: deduped.length,
      generatedAt: scanResult.generatedAt,
    },
  };
}

function formatFeatureDebug(features) {
  return JSON.stringify((features || []).map((feature) => ({
    id: feature.id,
    title: feature.title,
    domain: feature.domain,
    action: feature.action,
    workspaces: feature.workspaces.map((workspace) => workspace.directory || '(root)'),
    files: feature.files.map((file) => ({ path: file.path, role: file.role, reason: file.reason })),
    endpoints: feature.apiContracts.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
  })), null, 2);
}

module.exports = {
  clusterFeatures,
  formatFeatureDebug,
};
