const { enrichWithDesign } = require('./design');
const { clusterFeatures } = require('./featureClusterer');

function uniqueSorted(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortObject(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function mapBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (key) {
      map.set(key, item);
    }
  }
  return map;
}

function fingerprintEndpoint(endpoint) {
  return stableStringify({
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    file: endpoint.file,
    handler: endpoint.handler,
    request: {
      bodyFields: uniqueSorted(endpoint.request && endpoint.request.bodyFields),
      queryFields: uniqueSorted(endpoint.request && endpoint.request.queryFields),
      pathParams: uniqueSorted(endpoint.request && endpoint.request.pathParams),
      headers: uniqueSorted(endpoint.request && endpoint.request.headers),
      bodySchemas: (endpoint.request && endpoint.request.bodySchemas ? endpoint.request.bodySchemas : [])
        .map((schema) => `${schema.file}:${schema.name}:${schema.kind}`)
        .sort((left, right) => left.localeCompare(right)),
    },
    responses: (endpoint.responses || [])
      .map((response) => ({
        status: response.status,
        jsonKeys: uniqueSorted(response.jsonKeys),
      }))
      .sort((left, right) => String(left.status).localeCompare(String(right.status))),
    responseSchemas: (endpoint.responseSchemas || [])
      .map((schema) => `${schema.file}:${schema.name}:${schema.kind}`)
      .sort((left, right) => left.localeCompare(right)),
  });
}

function fingerprintFeature(feature) {
  return stableStringify({
    id: feature.id,
    hash: feature.hash,
    files: (feature.files || []).map((file) => file.path).sort((left, right) => left.localeCompare(right)),
    endpoints: (feature.apiContracts || []).map((endpoint) => endpoint.id).sort((left, right) => left.localeCompare(right)),
    schemas: (feature.schemas || []).map((schema) => `${schema.file}:${schema.name}`).sort((left, right) => left.localeCompare(right)),
    flows: (feature.flows || []).map((flow) => flow.id || flow.name).sort((left, right) => left.localeCompare(right)),
  });
}

function diffFingerprints(currentItems, previousItems, keyFn, fingerprintFn) {
  const currentMap = mapBy(currentItems, keyFn);
  const previousMap = mapBy(previousItems, keyFn);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, item] of currentMap.entries()) {
    if (!previousMap.has(key)) {
      added.push(item);
      continue;
    }
    if (fingerprintFn(item) !== fingerprintFn(previousMap.get(key))) {
      changed.push(item);
    }
  }

  for (const [key, item] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      removed.push(item);
    }
  }

  return { added, removed, changed };
}

function hydrateCachedAi(scanResult, previousManifest) {
  const canReuseAi = Boolean(
    previousManifest
    && previousManifest.cache
    && previousManifest.cache.aiKey === scanResult.cache.aiKey,
  );

  if (!canReuseAi) {
    return {
      ...scanResult,
      ai: {
        enabled: false,
        errors: [],
        modules: [],
        features: [],
        project: null,
      },
    };
  }

  const previousFilesByPath = mapBy(previousManifest.files || [], (file) => file.relativePath);
  const hydratedFiles = scanResult.files.map((file) => {
    const previous = previousFilesByPath.get(file.relativePath);
    if (previous && previous.hash === file.hash && previous.ai) {
      return {
        ...file,
        ai: previous.ai,
      };
    }
    return file;
  });

  return {
    ...scanResult,
    files: hydratedFiles,
    ai: {
      enabled: Boolean(previousManifest.ai && previousManifest.ai.enabled),
      provider: previousManifest.ai && previousManifest.ai.provider ? previousManifest.ai.provider : null,
      model: previousManifest.ai && previousManifest.ai.model ? previousManifest.ai.model : null,
      reasoningEffort: previousManifest.ai && previousManifest.ai.reasoningEffort ? previousManifest.ai.reasoningEffort : null,
      errors: [],
      summarizedFiles: hydratedFiles.filter((file) => file.ai && file.ai.summary).length,
      reusedFiles: hydratedFiles.filter((file) => file.ai).length,
      modules: previousManifest.ai && Array.isArray(previousManifest.ai.modules) ? previousManifest.ai.modules : [],
      features: previousManifest.ai && Array.isArray(previousManifest.ai.features) ? previousManifest.ai.features : [],
      reusedModules: previousManifest.ai && Array.isArray(previousManifest.ai.modules) ? previousManifest.ai.modules.length : 0,
      project: previousManifest.ai && previousManifest.ai.project ? previousManifest.ai.project : null,
    },
  };
}

function buildFreshState(scanResult, previousManifest, options) {
  const hydrated = hydrateCachedAi(scanResult, previousManifest);
  const designed = enrichWithDesign(hydrated);
  return clusterFeatures(designed, options.features || {});
}

function checkDocsDrift(scanResult, previousManifest, options = {}) {
  if (!previousManifest) {
    return {
      ok: false,
      problems: ['No existing manifest was found. Generate docs before running `docs-wiki check`.'],
      warnings: [],
      summary: {
        changedFiles: [],
        deletedFiles: [],
        changedFeatures: [],
        changedEndpoints: [],
      },
    };
  }

  const problems = [];
  const warnings = [];

  if (!previousManifest.cache || previousManifest.cache.scanKey !== scanResult.cache.scanKey) {
    problems.push('Scan settings changed since the existing docs were generated.');
  }

  if (!previousManifest.cache || previousManifest.cache.renderKey !== scanResult.cache.renderKey) {
    problems.push('Render settings changed since the existing docs were generated.');
  }

  if (scanResult.incremental.changedFiles.length > 0) {
    problems.push(`Changed files: ${scanResult.incremental.changedFiles.join(', ')}`);
  }

  if (scanResult.incremental.deletedFiles.length > 0) {
    problems.push(`Deleted files: ${scanResult.incremental.deletedFiles.join(', ')}`);
  }

  const freshState = buildFreshState(scanResult, previousManifest, options);
  const featureDiff = diffFingerprints(
    freshState.features || [],
    previousManifest.features || [],
    (feature) => feature.id,
    fingerprintFeature,
  );

  const endpointDiff = diffFingerprints(
    freshState.api && Array.isArray(freshState.api.endpoints) ? freshState.api.endpoints : [],
    previousManifest.api && Array.isArray(previousManifest.api.endpoints) ? previousManifest.api.endpoints : [],
    (endpoint) => endpoint.id || `${endpoint.method}:${endpoint.path}:${endpoint.file}`,
    fingerprintEndpoint,
  );

  const changedFeatures = uniqueSorted([
    ...featureDiff.added.map((feature) => feature.title || feature.id),
    ...featureDiff.changed.map((feature) => feature.title || feature.id),
    ...featureDiff.removed.map((feature) => feature.title || feature.id),
  ]);
  const changedEndpoints = uniqueSorted([
    ...endpointDiff.added.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    ...endpointDiff.changed.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    ...endpointDiff.removed.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
  ]);

  if (changedFeatures.length > 0) {
    problems.push(`Changed features: ${changedFeatures.join(', ')}`);
  }

  if (changedEndpoints.length > 0) {
    problems.push(`Changed API contracts: ${changedEndpoints.join(', ')}`);
  }

  if (options.ai && options.ai.enabled) {
    if (!previousManifest.cache || previousManifest.cache.aiKey !== scanResult.cache.aiKey) {
      problems.push('AI settings changed since the existing docs were generated.');
    }

    if (!previousManifest.ai || !previousManifest.ai.enabled) {
      problems.push('AI docs are not present in the existing manifest. Re-run with --ai.');
    } else {
      const previousFilesByPath = mapBy(previousManifest.files || [], (file) => file.relativePath);
      const missingFileSummaries = scanResult.files
        .filter((file) => {
          const previous = previousFilesByPath.get(file.relativePath);
          return previous && previous.hash === file.hash && (!previous.ai || !previous.ai.summary);
        })
        .map((file) => file.relativePath);
      if (missingFileSummaries.length > 0) {
        problems.push(`Missing AI file summaries: ${missingFileSummaries.join(', ')}`);
      }

      const previousModulesByDirectory = mapBy(previousManifest.ai.modules || [], (module) => module.directory || '');
      const missingModuleSummaries = (scanResult.directories || [])
        .filter((directory) => {
          const previous = previousModulesByDirectory.get(directory.directory || '');
          return !previous || !previous.capability;
        })
        .map((directory) => directory.directory || '(root)');
      if (missingModuleSummaries.length > 0) {
        warnings.push(`Missing AI module summaries: ${missingModuleSummaries.join(', ')}`);
      }

      const previousFeaturesById = mapBy(previousManifest.features || [], (feature) => feature.id);
      const missingFeatureSummaries = (freshState.features || [])
        .filter((feature) => {
          const previous = previousFeaturesById.get(feature.id);
          return !previous || previous.hash !== feature.hash || !previous.ai;
        })
        .map((feature) => feature.title);
      if (missingFeatureSummaries.length > 0) {
        problems.push(`Missing AI feature summaries: ${missingFeatureSummaries.join(', ')}`);
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    summary: {
      changedFiles: scanResult.incremental.changedFiles.slice(),
      deletedFiles: scanResult.incremental.deletedFiles.slice(),
      changedFeatures,
      changedEndpoints,
      featureCount: Array.isArray(freshState.features) ? freshState.features.length : 0,
      endpointCount: freshState.api && Array.isArray(freshState.api.endpoints) ? freshState.api.endpoints.length : 0,
    },
  };
}

function formatDriftReport(report) {
  const lines = [];
  if (report.ok) {
    lines.push('Docs are up to date.');
    if (report.summary.featureCount !== undefined) {
      lines.push(`Features checked: ${report.summary.featureCount}`);
    }
    if (report.summary.endpointCount !== undefined) {
      lines.push(`API contracts checked: ${report.summary.endpointCount}`);
    }
    return lines.join('\n');
  }

  lines.push('Docs are stale.');
  for (const problem of report.problems) {
    lines.push(`- ${problem}`);
  }
  for (const warning of report.warnings || []) {
    lines.push(`- Warning: ${warning}`);
  }
  lines.push('Run `docs-wiki` again to regenerate the wiki output.');
  return lines.join('\n');
}

module.exports = {
  checkDocsDrift,
  formatDriftReport,
};
