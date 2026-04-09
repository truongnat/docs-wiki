const OpenAI = require('openai');
const { zodTextFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const DEFAULT_AI_MODEL = 'gpt-5.4-mini';
const DEFAULT_REASONING_EFFORT = 'none';
const DEFAULT_OLLAMA_MODEL_STRATEGY = 'family';
const DEFAULT_FILE_SYSTEM_PROMPT = 'You generate compact technical documentation for source files. Be precise, concise, and avoid speculation.';
const DEFAULT_MODULE_SYSTEM_PROMPT = 'You generate business-oriented module documentation from file summaries and code structure. Focus on capability, business flow, and module boundaries.';
const DEFAULT_FEATURE_SYSTEM_PROMPT = 'You generate feature-oriented design documentation from clustered code summaries. Focus on user journeys, cross-workspace boundaries, API contracts, and operational edge cases.';
const DEFAULT_PROJECT_SYSTEM_PROMPT = 'You generate top-level project overviews for internal engineering wikis. Keep it concrete and architecture-focused.';
const DEFAULT_OLLAMA_TIMEOUT_MS = 1200;

const FileSummarySchema = z.object({
  summary: z.string(),
  responsibilities: z.array(z.string()).max(5),
  usageNotes: z.array(z.string()).max(3).default([]),
  symbols: z.array(z.object({
    key: z.string(),
    summary: z.string(),
  })),
});

const ProjectSummarySchema = z.object({
  overview: z.string(),
  architecture: z.array(z.string()).max(5),
  keyModules: z.array(z.object({
    directory: z.string(),
    reason: z.string(),
  })).max(6),
});

const ModuleSummarySchema = z.object({
  capability: z.string(),
  basicDesign: z.string(),
  detailDesign: z.string(),
  actors: z.array(z.string()).max(4).default([]),
  entryPoints: z.array(z.string()).max(6).default([]),
  dataStores: z.array(z.string()).max(5).default([]),
  integrations: z.array(z.string()).max(5).default([]),
  components: z.array(z.object({
    name: z.string(),
    responsibility: z.string(),
  })).max(8).default([]),
  keyFlows: z.array(z.object({
    name: z.string(),
    goal: z.string(),
  })).max(4).default([]),
});

const FeatureSummarySchema = z.object({
  overview: z.string(),
  userStories: z.array(z.object({
    role: z.string(),
    goal: z.string(),
    benefit: z.string(),
    acceptance: z.array(z.string()).max(5).default([]),
  })).max(5).default([]),
  basicDesign: z.object({
    context: z.string(),
    boundaries: z.array(z.string()).max(6).default([]),
    externalSystems: z.array(z.string()).max(6).default([]),
  }),
  detailDesign: z.object({
    components: z.array(z.object({
      name: z.string(),
      layer: z.string(),
      responsibility: z.string(),
    })).max(10).default([]),
    dataModel: z.string(),
    stateManagement: z.string(),
  }),
  flowNarratives: z.array(z.object({
    name: z.string(),
    steps: z.array(z.string()).max(8).default([]),
  })).max(6).default([]),
  errorCases: z.array(z.object({
    case: z.string(),
    handling: z.string(),
  })).max(8).default([]),
  openQuestions: z.array(z.string()).max(6).default([]),
});

function createSymbolKey(symbol) {
  return `${symbol.kind}:${symbol.name}:${symbol.startLine}`;
}

function moduleAncestorsForFile(file) {
  if (!file.directory) {
    return [''];
  }

  const parts = file.directory.split('/');
  const modules = [''];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    modules.push(current);
  }
  return modules;
}

function filesForModule(files, directory) {
  if (!directory) {
    return files.slice();
  }
  return files.filter((file) => file.directory === directory || file.directory.startsWith(`${directory}/`));
}

function clip(value, limit) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n... [truncated]`;
}

function buildFilePrompt(file) {
  const symbolBlocks = file.symbols.map((symbol) => {
    const body = clip(symbol.code, 1200);
    return [
      `key: ${createSymbolKey(symbol)}`,
      `kind: ${symbol.kind}`,
      `name: ${symbol.name}`,
      `signature: ${symbol.signature}`,
      `lines: ${symbol.startLine}-${symbol.endLine}`,
      'code:',
      body,
    ].join('\n');
  });

  return [
    `File: ${file.relativePath}`,
    `Language: ${file.language}`,
    `Lines: ${file.lineCount}`,
    `Symbol count: ${file.symbols.length}`,
    '',
    'Write concise documentation-quality summaries.',
    'Focus on purpose, boundaries, and what each symbol contributes in this file.',
    'Do not invent behavior that is not visible in the code snippets.',
    'Return one symbol summary for every provided symbol key.',
    '',
    'Symbols:',
    symbolBlocks.length > 0 ? symbolBlocks.join('\n\n---\n\n') : '(no symbols found)',
  ].join('\n');
}

function buildProjectPrompt(scanResult) {
  const moduleBlocks = scanResult.ai && Array.isArray(scanResult.ai.modules)
    ? scanResult.ai.modules.slice(0, 24).map((module) => [
      `module: ${module.directory || '(root)'}`,
      `capability: ${module.capability || 'n/a'}`,
      `basicDesign: ${module.basicDesign || 'n/a'}`,
      `detailDesign: ${module.detailDesign || 'n/a'}`,
      `keyFlows: ${(module.keyFlows || []).map((flow) => flow.name).join('; ') || 'n/a'}`,
    ].join('\n'))
    : [];
  const fileBlocks = scanResult.files.slice(0, 80).map((file) => {
    const aiSummary = file.ai || {};
    return [
      `file: ${file.relativePath}`,
      `language: ${file.language}`,
      `module: ${file.directory || '(root)'}`,
      `summary: ${aiSummary.summary || 'n/a'}`,
      `responsibilities: ${(aiSummary.responsibilities || []).join('; ') || 'n/a'}`,
    ].join('\n');
  });

  return [
    `Project: ${scanResult.projectName}`,
    `Description: ${scanResult.package && scanResult.package.description ? scanResult.package.description : 'n/a'}`,
    `Files parsed: ${scanResult.totals.filesParsed}`,
    `Symbols: ${scanResult.totals.symbols}`,
    '',
    'Summarize the project at a docs landing-page level.',
    'Highlight architectural themes and the most important modules from the provided file summaries.',
    `The known modules are: ${scanResult.directories.map((entry) => entry.directory || '(root)').join(', ')}`,
    moduleBlocks.length > 0 ? '\nModule summaries:\n' : '',
    moduleBlocks.length > 0 ? moduleBlocks.join('\n\n') : '',
    '',
    'Files:',
    fileBlocks.join('\n\n'),
  ].join('\n');
}

function buildModulePrompt(module, files) {
  const fileBlocks = files.slice(0, 16).map((file) => {
    const aiSummary = file.ai || {};
    const publicSymbols = file.symbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name).slice(0, 8);
    return [
      `file: ${file.relativePath}`,
      `language: ${file.language}`,
      `imports: ${(file.imports || []).slice(0, 12).join(', ') || 'n/a'}`,
      `publicSymbols: ${publicSymbols.join(', ') || 'n/a'}`,
      `summary: ${aiSummary.summary || 'n/a'}`,
      `responsibilities: ${(aiSummary.responsibilities || []).join('; ') || 'n/a'}`,
    ].join('\n');
  });

  return [
    `Module directory: ${module.directory || '(root)'}`,
    `Module file count: ${files.length}`,
    `Module symbol count: ${files.reduce((sum, file) => sum + file.symbols.length, 0)}`,
    `Languages: ${Array.from(new Set(files.map((file) => file.language))).join(', ') || 'n/a'}`,
    '',
    'Infer the business capability and design intent of this module from the file summaries and source structure.',
    'Prefer business language such as login, onboarding, billing, reconciliation, notification delivery, etc when the evidence supports it.',
    'Do not restate symbol names unless they clarify the business flow.',
    'Keep the design statements specific enough to be useful in basic design and detail design documentation.',
    '',
    'Files:',
    fileBlocks.join('\n\n'),
  ].join('\n');
}

function buildFeaturePrompt(feature, scanResult) {
  const fileMap = new Map(scanResult.files.map((file) => [file.relativePath, file]));
  const fileBlocks = feature.files.slice(0, 32).map((fileRef) => {
    const file = fileMap.get(fileRef.path);
    const aiSummary = file && file.ai ? file.ai : {};
    return [
      `file: ${fileRef.path}`,
      `workspace: ${fileRef.workspaceName || fileRef.workspace || '(root)'}`,
      `role: ${fileRef.roleLabel || fileRef.role}`,
      `reason: ${fileRef.reason}`,
      `summary: ${aiSummary.summary || 'n/a'}`,
      `responsibilities: ${(aiSummary.responsibilities || []).join('; ') || 'n/a'}`,
    ].join('\n');
  });
  const endpointBlocks = (feature.apiContracts || []).slice(0, 16).map((endpoint) => [
    `endpoint: ${endpoint.method} ${endpoint.path}`,
    `handler: ${endpoint.handler || 'n/a'}`,
    `request: ${[
      endpoint.request && endpoint.request.bodyKeys && endpoint.request.bodyKeys.length > 0 ? `body ${endpoint.request.bodyKeys.join(', ')}` : '',
      endpoint.request && endpoint.request.queryKeys && endpoint.request.queryKeys.length > 0 ? `query ${endpoint.request.queryKeys.join(', ')}` : '',
      endpoint.request && endpoint.request.paramKeys && endpoint.request.paramKeys.length > 0 ? `params ${endpoint.request.paramKeys.join(', ')}` : '',
    ].filter(Boolean).join(' | ') || 'n/a'}`,
    `responses: ${(endpoint.responses || []).map((response) => `${response.status}:${(response.bodyKeys || []).join(', ')}`).join(' | ') || 'n/a'}`,
  ].join('\n'));
  const flowBlocks = (feature.flows || []).slice(0, 8).map((flow) => [
    `flow: ${flow.name}`,
    `goal: ${flow.goal || 'n/a'}`,
    `steps: ${(flow.steps || []).join(' | ') || 'n/a'}`,
  ].join('\n'));

  return [
    `Feature: ${feature.title}`,
    `Domain: ${feature.domainLabel || feature.domain}`,
    `Action: ${feature.actionLabel || 'n/a'}`,
    `Summary: ${feature.summary || 'n/a'}`,
    `Workspaces: ${(feature.workspaces || []).map((workspace) => workspace.name || workspace.directory || '(root)').join(', ') || 'n/a'}`,
    `Actors: ${(feature.actors || []).join(', ') || 'n/a'}`,
    `Entry points (FE): ${(feature.entryPoints && feature.entryPoints.fe ? feature.entryPoints.fe.join(', ') : '') || 'n/a'}`,
    `Entry points (BE): ${(feature.entryPoints && feature.entryPoints.be ? feature.entryPoints.be.join(', ') : '') || 'n/a'}`,
    '',
    'Generate feature-oriented design docs for this cluster.',
    'Use business language and explain the end-to-end journey across UI, API, services, and persistence.',
    'Do not invent systems or responsibilities that are not grounded in the provided summaries.',
    '',
    'Files:',
    fileBlocks.length > 0 ? fileBlocks.join('\n\n') : '(no files)',
    '',
    'API contracts:',
    endpointBlocks.length > 0 ? endpointBlocks.join('\n\n') : '(no endpoints)',
    '',
    'Flows:',
    flowBlocks.length > 0 ? flowBlocks.join('\n\n') : '(no flows)',
  ].join('\n');
}

function createClient(options) {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL || undefined,
  });
}

async function fetchOllamaModels(baseURL, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${baseURL.replace(/\/$/, '')}/models`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    return Array.isArray(payload && payload.data)
      ? payload.data
          .map((entry) => (entry && typeof entry.id === 'string' ? entry.id : ''))
          .filter(Boolean)
      : [];
  } catch (_error) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function pickOllamaModel(preferredModel, availableModels, strategy = DEFAULT_OLLAMA_MODEL_STRATEGY) {
  if (!Array.isArray(availableModels) || availableModels.length === 0) {
    return preferredModel;
  }

  if (preferredModel && availableModels.includes(preferredModel)) {
    return preferredModel;
  }

  if (strategy === 'exact') {
    return preferredModel;
  }

  if (preferredModel && strategy === 'family') {
    const sameFamily = availableModels.find((model) => model === preferredModel || model.startsWith(`${preferredModel}:`));
    if (sameFamily) {
      return sameFamily;
    }
  }

  return availableModels[0];
}

async function resolveAiProvider(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  if (dependencies.resolvedProvider) {
    return dependencies.resolvedProvider;
  }
  if (options.provider === 'openai') {
    if (!options.apiKey) {
      throw new Error('OpenAI provider requires OPENAI_API_KEY or --openai-api-key.');
    }

    return {
      provider: 'openai',
      client: createClient({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
      }),
      model: options.model,
    };
  }

  const ollamaModels = await fetchOllamaModels(options.ollamaBaseURL, fetchImpl);
  const ollamaAvailable = ollamaModels.length > 0;
  if (options.provider === 'ollama' || (!options.apiKey && ollamaAvailable)) {
    if (!ollamaAvailable) {
      throw new Error(`Ollama provider is not reachable at ${options.ollamaBaseURL}.`);
    }

    return {
      provider: 'ollama',
      client: createClient({
        apiKey: options.ollamaApiKey || 'ollama',
        baseURL: options.ollamaBaseURL,
      }),
      model: pickOllamaModel(options.ollamaModel, ollamaModels, options.ollamaModelStrategy),
      availableModels: ollamaModels,
    };
  }

  if (options.apiKey) {
    return {
      provider: 'openai',
      client: createClient({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
      }),
      model: options.model,
    };
  }

  throw new Error('AI summaries require either a reachable local Ollama server or OPENAI_API_KEY.');
}

function extractJsonPayload(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw error;
  }
}

function normalizeString(value) {
  const PLACEHOLDER_VALUES = new Set(['string', 'strings', 'array', 'object', 'objects', 'null', 'n/a', 'na']);

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) ? '' : trimmed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function isGenericSummary(text) {
  const normalized = normalizeString(text).toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    /^the [\w`'". -]+ (function|method|class|module|file|project)\.?$/,
    /^this (function|method|class|module|file|project)\b/,
    /^a simple (function|method|class|module|file|project)\b/,
    /^(function|method|class|module|file|project) summary\b/,
  ].some((pattern) => pattern.test(normalized));
}

function normalizeStringArray(value, maxItems) {
  let items = [];

  if (Array.isArray(value)) {
    items = value.map(normalizeString);
  } else if (typeof value === 'string') {
    items = value
      .split(/\n|;|•/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else if (value && typeof value === 'object') {
    items = Object.values(value).map(normalizeString);
  }

  return items.filter(Boolean).slice(0, maxItems);
}

function normalizeSymbolSummaries(value, file) {
  const fallback = file.symbols.map((symbol) => ({
    key: createSymbolKey(symbol),
    summary: '',
  }));

  if (Array.isArray(value)) {
    return file.symbols.map((symbol, index) => {
      const entry = value[index];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const key = normalizeString(entry.key) || createSymbolKey(symbol);
        const summary = normalizeString(entry.summary || entry.description || entry.text);
        return { key, summary };
      }

      return {
        key: createSymbolKey(symbol),
        summary: normalizeString(entry),
      };
    });
  }

  if (value && typeof value === 'object') {
    return file.symbols.map((symbol) => ({
      key: createSymbolKey(symbol),
      summary: normalizeString(
        value[createSymbolKey(symbol)]
        || value[symbol.name]
        || value[symbol.signature]
        || '',
      ),
    }));
  }

  return fallback;
}

function coerceFileSummary(raw, file) {
  const responsibilities = normalizeStringArray(raw && raw.responsibilities, 5);
  const usageNotes = normalizeStringArray(raw && raw.usageNotes, 3);
  const symbolSummaries = normalizeSymbolSummaries(raw && raw.symbols, file).map((entry) => ({
    ...entry,
    summary: isGenericSummary(entry.summary) ? '' : entry.summary,
  }));
  const rawSummary = normalizeString(raw && raw.summary);

  const normalized = {
    summary: !isGenericSummary(rawSummary)
      ? rawSummary
      : (responsibilities[0] || `Provides ${file.symbols.length} documented symbol${file.symbols.length === 1 ? '' : 's'} in ${file.relativePath}.`),
    responsibilities,
    usageNotes,
    symbols: symbolSummaries,
  };

  return FileSummarySchema.parse(normalized);
}

function normalizeKeyModules(value, directories) {
  const knownDirectories = new Set(directories.map((entry) => entry.directory));

  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const directory = normalizeString(entry.directory || entry.module || entry.path);
          const reason = normalizeString(entry.reason || entry.summary || entry.details);
          return directory && reason ? { directory, reason } : null;
        }

        const text = normalizeString(entry);
        if (!text) {
          return null;
        }

        const [directoryPart, ...reasonParts] = text.split(':');
        const directory = normalizeString(directoryPart);
        const reason = normalizeString(reasonParts.join(':')) || `Important area: ${text}`;
        return directory ? { directory, reason } : null;
      })
      .filter((entry) => entry && knownDirectories.has(entry.directory))
      .slice(0, 6);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([directory, reason]) => ({
        directory,
        reason: normalizeString(reason),
      }))
      .filter((entry) => entry.reason && knownDirectories.has(entry.directory))
      .slice(0, 6);
  }

  return [];
}

function coerceProjectSummary(raw, scanResult) {
  const architecture = normalizeStringArray(raw && raw.architecture, 5).filter((entry) => !isGenericSummary(entry));
  const rawOverview = normalizeString(raw && raw.overview);

  const normalized = {
    overview: !isGenericSummary(rawOverview)
      ? rawOverview
      : `${scanResult.projectName} documentation generated from ${scanResult.totals.filesParsed} files.`,
    architecture,
    keyModules: normalizeKeyModules(raw && raw.keyModules, scanResult.directories),
  };

  return ProjectSummarySchema.parse(normalized);
}

function normalizeComponentSummaries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const name = normalizeString(entry.name || entry.component || entry.file);
      const responsibility = normalizeString(entry.responsibility || entry.summary || entry.reason);
      if (!name || !responsibility) {
        return null;
      }
      return { name, responsibility };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeFlowSummaries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const name = normalizeString(entry.name || entry.flow || entry.title);
      const goal = normalizeString(entry.goal || entry.summary || entry.reason);
      if (!name || !goal) {
        return null;
      }
      return { name, goal };
    })
    .filter((entry) => !isGenericSummary(entry.name) && !isGenericSummary(entry.goal))
    .slice(0, 4);
}

function coerceModuleSummary(raw, module, files) {
  const rawCapability = normalizeString(raw && raw.capability);
  const rawBasicDesign = normalizeString(raw && raw.basicDesign);
  const rawDetailDesign = normalizeString(raw && raw.detailDesign);
  const fileNames = new Set(files.map((file) => file.relativePath));

  const normalized = {
    capability: !isGenericSummary(rawCapability)
      ? rawCapability
      : `${module.directory || '(root)'} handles business logic across ${files.length} file${files.length === 1 ? '' : 's'}.`,
    basicDesign: !isGenericSummary(rawBasicDesign)
      ? rawBasicDesign
      : `The module groups related entry points, orchestration, and persistence needed for ${module.directory || 'the current capability'}.`,
    detailDesign: !isGenericSummary(rawDetailDesign)
      ? rawDetailDesign
      : `Implementation details are split across ${files.slice(0, 4).map((file) => file.relativePath).join(', ')}.`,
    actors: normalizeStringArray(raw && raw.actors, 4),
    entryPoints: normalizeStringArray(raw && raw.entryPoints, 6).filter((entry) => fileNames.has(entry) || files.some((file) => file.relativePath.endsWith(entry))),
    dataStores: normalizeStringArray(raw && raw.dataStores, 5),
    integrations: normalizeStringArray(raw && raw.integrations, 5),
    components: normalizeComponentSummaries(raw && raw.components),
    keyFlows: normalizeFlowSummaries(raw && raw.keyFlows),
  };

  return ModuleSummarySchema.parse(normalized);
}

function normalizeUserStories(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const role = normalizeString(entry.role || entry.actor);
      const goal = normalizeString(entry.goal || entry.story);
      const benefit = normalizeString(entry.benefit || entry.outcome);
      const acceptance = normalizeStringArray(entry.acceptance, 5);
      if (!role || !goal || !benefit) {
        return null;
      }
      return { role, goal, benefit, acceptance };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeFeatureComponents(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const name = normalizeString(entry.name || entry.component || entry.file);
      const layer = normalizeString(entry.layer || entry.type || entry.kind);
      const responsibility = normalizeString(entry.responsibility || entry.summary || entry.reason);
      if (!name || !responsibility) {
        return null;
      }
      return {
        name,
        layer: layer || 'Component',
        responsibility,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeFlowNarratives(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const name = normalizeString(entry.name || entry.flow || entry.title);
      const steps = normalizeStringArray(entry.steps, 8);
      if (!name) {
        return null;
      }
      return { name, steps };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeErrorCases(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const caseSummary = normalizeString(entry.case || entry.name || entry.error);
      const handling = normalizeString(entry.handling || entry.mitigation || entry.response);
      if (!caseSummary || !handling) {
        return null;
      }
      return {
        case: caseSummary,
        handling,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function coerceFeatureSummary(raw, feature) {
  const rawOverview = normalizeString(raw && raw.overview);
  const basicDesign = raw && raw.basicDesign && typeof raw.basicDesign === 'object' ? raw.basicDesign : {};
  const detailDesign = raw && raw.detailDesign && typeof raw.detailDesign === 'object' ? raw.detailDesign : {};

  return FeatureSummarySchema.parse({
    overview: !isGenericSummary(rawOverview) ? rawOverview : (feature.summary || `${feature.title} coordinates a cross-cutting business workflow.`),
    userStories: normalizeUserStories(raw && raw.userStories),
    basicDesign: {
      context: normalizeString(basicDesign.context) || feature.summary || `${feature.title} spans multiple code units that together deliver the feature.`,
      boundaries: normalizeStringArray(basicDesign.boundaries, 6),
      externalSystems: normalizeStringArray(basicDesign.externalSystems, 6),
    },
    detailDesign: {
      components: normalizeFeatureComponents(detailDesign.components),
      dataModel: normalizeString(detailDesign.dataModel) || 'State and contracts are inferred from the related files and API schemas.',
      stateManagement: normalizeString(detailDesign.stateManagement) || 'State transitions are inferred from feature flow steps and endpoint contracts.',
    },
    flowNarratives: normalizeFlowNarratives(raw && raw.flowNarratives),
    errorCases: normalizeErrorCases(raw && raw.errorCases),
    openQuestions: normalizeStringArray(raw && raw.openQuestions, 6),
  });
}

async function summarizeFile(client, file, options, providerInfo) {
  const systemPrompt = options.filePrompt
    ? `${DEFAULT_FILE_SYSTEM_PROMPT}\n\nAdditional instruction:\n${options.filePrompt}`
    : DEFAULT_FILE_SYSTEM_PROMPT;

  if (providerInfo.provider === 'ollama') {
    const response = await client.chat.completions.create({
      model: providerInfo.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${systemPrompt}\nReturn valid JSON only.` },
        {
          role: 'user',
          content: `${buildFilePrompt(file)}\n\nReturn a JSON object with this exact shape:
{
  "summary": "string",
  "responsibilities": ["string"],
  "usageNotes": ["string"],
  "symbols": [
    { "key": "function:name:1", "summary": "string" }
  ]
}`,
        },
      ],
    });

    const content = response.choices[0] && response.choices[0].message ? response.choices[0].message.content : '';
    return coerceFileSummary(extractJsonPayload(content), file);
  }

  const response = await client.responses.parse({
    model: providerInfo.model,
    reasoning: { effort: options.reasoningEffort },
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildFilePrompt(file) },
    ],
    text: {
      format: zodTextFormat(FileSummarySchema, 'file_summary'),
    },
  });

  return response.output_parsed;
}

async function summarizeModule(client, module, files, options, providerInfo) {
  const systemPrompt = options.modulePrompt
    ? `${DEFAULT_MODULE_SYSTEM_PROMPT}\n\nAdditional instruction:\n${options.modulePrompt}`
    : DEFAULT_MODULE_SYSTEM_PROMPT;

  if (providerInfo.provider === 'ollama') {
    const response = await client.chat.completions.create({
      model: providerInfo.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${systemPrompt}\nReturn valid JSON only.` },
        {
          role: 'user',
          content: `${buildModulePrompt(module, files)}\n\nReturn a JSON object with this exact shape:
{
  "capability": "string",
  "basicDesign": "string",
  "detailDesign": "string",
  "actors": ["string"],
  "entryPoints": ["src/auth/login-route.ts"],
  "dataStores": ["string"],
  "integrations": ["string"],
  "components": [
    { "name": "auth-service.ts", "responsibility": "string" }
  ],
  "keyFlows": [
    { "name": "Auth login", "goal": "string" }
  ]
}`,
        },
      ],
    });

    const content = response.choices[0] && response.choices[0].message ? response.choices[0].message.content : '';
    return coerceModuleSummary(extractJsonPayload(content), module, files);
  }

  const response = await client.responses.parse({
    model: providerInfo.model,
    reasoning: { effort: options.reasoningEffort },
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildModulePrompt(module, files) },
    ],
    text: {
      format: zodTextFormat(ModuleSummarySchema, 'module_summary'),
    },
  });

  return response.output_parsed;
}

async function summarizeFeature(client, feature, scanResult, options, providerInfo) {
  const systemPrompt = options.featurePrompt
    ? `${DEFAULT_FEATURE_SYSTEM_PROMPT}\n\nAdditional instruction:\n${options.featurePrompt}`
    : DEFAULT_FEATURE_SYSTEM_PROMPT;

  if (providerInfo.provider === 'ollama') {
    const response = await client.chat.completions.create({
      model: providerInfo.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${systemPrompt}\nReturn valid JSON only.` },
        {
          role: 'user',
          content: `${buildFeaturePrompt(feature, scanResult)}\n\nReturn a JSON object with this exact shape:
{
  "overview": "string",
  "userStories": [
    { "role": "string", "goal": "string", "benefit": "string", "acceptance": ["string"] }
  ],
  "basicDesign": {
    "context": "string",
    "boundaries": ["string"],
    "externalSystems": ["string"]
  },
  "detailDesign": {
    "components": [
      { "name": "string", "layer": "string", "responsibility": "string" }
    ],
    "dataModel": "string",
    "stateManagement": "string"
  },
  "flowNarratives": [
    { "name": "string", "steps": ["string"] }
  ],
  "errorCases": [
    { "case": "string", "handling": "string" }
  ],
  "openQuestions": ["string"]
}`,
        },
      ],
    });

    const content = response.choices[0] && response.choices[0].message ? response.choices[0].message.content : '';
    return coerceFeatureSummary(extractJsonPayload(content), feature);
  }

  const response = await client.responses.parse({
    model: providerInfo.model,
    reasoning: { effort: options.reasoningEffort },
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildFeaturePrompt(feature, scanResult) },
    ],
    text: {
      format: zodTextFormat(FeatureSummarySchema, 'feature_summary'),
    },
  });

  return response.output_parsed;
}

async function summarizeProject(client, scanResult, options, providerInfo) {
  const systemPrompt = options.projectPrompt
    ? `${DEFAULT_PROJECT_SYSTEM_PROMPT}\n\nAdditional instruction:\n${options.projectPrompt}`
    : DEFAULT_PROJECT_SYSTEM_PROMPT;

  if (providerInfo.provider === 'ollama') {
    const response = await client.chat.completions.create({
      model: providerInfo.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${systemPrompt}\nReturn valid JSON only.` },
        {
          role: 'user',
          content: `${buildProjectPrompt(scanResult)}\n\nReturn a JSON object with this exact shape:
{
  "overview": "string",
  "architecture": ["string"],
  "keyModules": [
    { "directory": "src", "reason": "string" }
  ]
}`,
        },
      ],
    });

    const content = response.choices[0] && response.choices[0].message ? response.choices[0].message.content : '';
    return coerceProjectSummary(extractJsonPayload(content), scanResult);
  }

  const response = await client.responses.parse({
    model: providerInfo.model,
    reasoning: { effort: options.reasoningEffort },
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildProjectPrompt(scanResult) },
    ],
    text: {
      format: zodTextFormat(ProjectSummarySchema, 'project_summary'),
    },
  });

  return response.output_parsed;
}

function applyFileSummary(file, parsed) {
  const byKey = new Map(parsed.symbols.map((entry) => [entry.key, entry.summary]));

  return {
    ...file,
    ai: {
      summary: parsed.summary,
      responsibilities: parsed.responsibilities,
      usageNotes: parsed.usageNotes,
      symbols: file.symbols.map((symbol) => ({
        key: createSymbolKey(symbol),
        summary: byKey.get(createSymbolKey(symbol)) || '',
      })),
    },
  };
}

async function enrichWithAi(scanResult, rawOptions = {}) {
  const options = {
    enabled: Boolean(rawOptions.enabled),
    provider: rawOptions.provider || 'auto',
    apiKey: rawOptions.apiKey || process.env.OPENAI_API_KEY || '',
    baseURL: rawOptions.baseURL || process.env.OPENAI_BASE_URL || '',
    model: rawOptions.model || process.env.DOCS_WIKI_OPENAI_MODEL || DEFAULT_AI_MODEL,
    ollamaBaseURL: rawOptions.ollamaBaseURL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
    ollamaModel: rawOptions.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2',
    ollamaModelStrategy: rawOptions.ollamaModelStrategy || process.env.OLLAMA_MODEL_STRATEGY || DEFAULT_OLLAMA_MODEL_STRATEGY,
    ollamaApiKey: rawOptions.ollamaApiKey || process.env.OLLAMA_API_KEY || 'ollama',
    reasoningEffort: rawOptions.reasoningEffort || process.env.DOCS_WIKI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
    filePrompt: rawOptions.filePrompt || '',
    modulePrompt: rawOptions.modulePrompt || '',
    featurePrompt: rawOptions.featurePrompt || '',
    projectPrompt: rawOptions.projectPrompt || '',
    previousManifest: rawOptions.previousManifest || null,
  };

  if (!options.enabled) {
    return {
      ...scanResult,
      ai: {
        enabled: false,
        model: null,
        errors: [],
        modules: [],
        features: [],
      },
      incremental: {
        ...scanResult.incremental,
        aiChangedFiles: [],
        aiChangedModules: [],
        aiChangedWorkspaces: [],
        aiProjectChanged: false,
      },
    };
  }

  const onProgress = typeof rawOptions.onProgress === 'function' ? rawOptions.onProgress : null;
  onProgress?.({ type: 'ai_resolve' });

  const providerInfo = await resolveAiProvider(options, rawOptions.dependencies);
  const client = providerInfo.client;
  const sourceChanged = new Set(scanResult.incremental.changedFiles);
  const previousManifest = options.previousManifest;
  const canReuseAi = Boolean(previousManifest && previousManifest.cache && previousManifest.cache.aiKey === scanResult.cache.aiKey);
  const previousByPath = new Map(
    canReuseAi && Array.isArray(previousManifest.files)
      ? previousManifest.files.map((file) => [file.relativePath, file])
      : [],
  );

  const files = [];
  const errors = [];
  const aiChangedFiles = [];
  let reusedAiFiles = 0;
  const previousModulesByDirectory = new Map(
    canReuseAi && previousManifest.ai && Array.isArray(previousManifest.ai.modules)
      ? previousManifest.ai.modules.map((module) => [module.directory, module])
      : [],
  );
  const aiTotalSteps = scanResult.files.length + scanResult.directories.length + 1;
  let aiStep = 0;

  for (const file of scanResult.files) {
    const previous = previousByPath.get(file.relativePath);
    const canReuseFileAi = Boolean(
      canReuseAi
      && previous
      && previous.hash === file.hash
      && previous.ai
      && !sourceChanged.has(file.relativePath),
    );

    aiStep += 1;
    onProgress?.({
      type: 'ai_progress',
      current: aiStep,
      total: aiTotalSteps,
      file: file.relativePath,
      mode: canReuseFileAi ? 'cached' : 'summarize',
    });

    if (canReuseFileAi) {
      files.push({
        ...file,
        ai: previous.ai,
      });
      reusedAiFiles += 1;
      continue;
    }

    try {
      const parsed = await summarizeFile(client, file, options, providerInfo);
      files.push(applyFileSummary(file, parsed));
      aiChangedFiles.push(file.relativePath);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      errors.push({ scope: file.relativePath, message });
      files.push({
        ...file,
        ai: {
          summary: null,
          responsibilities: [],
          usageNotes: [],
          symbols: file.symbols.map((symbol) => ({
            key: createSymbolKey(symbol),
            summary: '',
          })),
          error: message,
        },
      });
      aiChangedFiles.push(file.relativePath);
    }
  }

  const aiChangedModules = Array.from(new Set(
    files
      .filter((file) => aiChangedFiles.includes(file.relativePath))
      .flatMap((file) => moduleAncestorsForFile(file)),
  )).sort();
  const aiChangedWorkspaces = Array.from(new Set(
    files
      .filter((file) => aiChangedFiles.includes(file.relativePath) && file.workspace)
      .map((file) => file.workspace.directory),
  )).sort();

  const modules = [];
  let reusedAiModules = 0;
  const sourceChangedSet = new Set(aiChangedFiles.length > 0 ? aiChangedFiles : Array.from(sourceChanged));

  for (const module of scanResult.directories) {
    const moduleFiles = filesForModule(files, module.directory);
    const previousModule = previousModulesByDirectory.get(module.directory);
    const moduleHasChangedFiles = moduleFiles.some((file) => sourceChangedSet.has(file.relativePath));
    const canReuseModuleAi = Boolean(
      canReuseAi
      && previousModule
      && !moduleHasChangedFiles
      && !aiChangedModules.includes(module.directory)
    );

    aiStep += 1;
    onProgress?.({
      type: 'ai_progress',
      current: aiStep,
      total: aiTotalSteps,
      file: module.directory || '(root module)',
      mode: canReuseModuleAi ? 'cached' : 'summarize',
    });

    if (canReuseModuleAi) {
      modules.push(previousModule);
      reusedAiModules += 1;
      continue;
    }

    try {
      const parsed = await summarizeModule(client, module, moduleFiles, options, providerInfo);
      modules.push({
        directory: module.directory,
        ...parsed,
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      errors.push({ scope: module.directory || '(root module)', message });
      modules.push({
        directory: module.directory,
        capability: null,
        basicDesign: null,
        detailDesign: null,
        actors: [],
        entryPoints: [],
        dataStores: [],
        integrations: [],
        components: [],
        keyFlows: [],
        error: message,
      });
    }
  }

  let project = null;
  let aiProjectChanged = false;

  if (canReuseAi && previousManifest.ai && previousManifest.ai.project && sourceChanged.size === 0 && aiChangedFiles.length === 0) {
    project = previousManifest.ai.project;
    onProgress?.({
      type: 'ai_progress',
      current: aiTotalSteps,
      total: aiTotalSteps,
      file: '(project overview)',
      mode: 'cached',
    });
  } else {
    try {
      onProgress?.({
        type: 'ai_progress',
        current: aiTotalSteps,
        total: aiTotalSteps,
        file: '(project overview)',
        mode: 'summarize',
      });
      const interimResult = {
        ...scanResult,
        files,
        ai: {
          modules,
        },
      };
      project = await summarizeProject(client, interimResult, options, providerInfo);
      aiProjectChanged = true;
    } catch (error) {
      errors.push({
        scope: '(project)',
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  return {
    ...scanResult,
    files,
    ai: {
      enabled: true,
      provider: providerInfo.provider,
      model: providerInfo.model,
      reasoningEffort: options.reasoningEffort,
      errors,
      summarizedFiles: files.filter((file) => file.ai && file.ai.summary).length,
      reusedFiles: reusedAiFiles,
      modules,
      features: [],
      reusedModules: reusedAiModules,
      project,
    },
    incremental: {
      ...scanResult.incremental,
      aiChangedFiles,
      aiChangedModules,
      aiChangedWorkspaces,
      aiProjectChanged,
    },
  };
}

async function enrichFeaturesWithAi(scanResult, rawOptions = {}) {
  const options = {
    enabled: Boolean(rawOptions.enabled),
    provider: rawOptions.provider || 'auto',
    apiKey: rawOptions.apiKey || process.env.OPENAI_API_KEY || '',
    baseURL: rawOptions.baseURL || process.env.OPENAI_BASE_URL || '',
    model: rawOptions.model || process.env.DOCS_WIKI_OPENAI_MODEL || DEFAULT_AI_MODEL,
    ollamaBaseURL: rawOptions.ollamaBaseURL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
    ollamaModel: rawOptions.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2',
    ollamaModelStrategy: rawOptions.ollamaModelStrategy || process.env.OLLAMA_MODEL_STRATEGY || DEFAULT_OLLAMA_MODEL_STRATEGY,
    ollamaApiKey: rawOptions.ollamaApiKey || process.env.OLLAMA_API_KEY || 'ollama',
    reasoningEffort: rawOptions.reasoningEffort || process.env.DOCS_WIKI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
    featurePrompt: rawOptions.featurePrompt || '',
    previousManifest: rawOptions.previousManifest || null,
  };

  if (!Array.isArray(scanResult.features) || scanResult.features.length === 0) {
    return {
      ...scanResult,
      ai: {
        ...(scanResult.ai || {}),
        features: [],
      },
    };
  }

  if (!options.enabled) {
    return {
      ...scanResult,
      features: scanResult.features.map((feature) => ({ ...feature, ai: null })),
      ai: {
        ...(scanResult.ai || {}),
        features: [],
      },
    };
  }

  const providerInfo = await resolveAiProvider(options, rawOptions.dependencies);
  const client = providerInfo.client;
  const previousManifest = options.previousManifest;
  const canReuseAi = Boolean(previousManifest && previousManifest.cache && previousManifest.cache.aiKey === scanResult.cache.aiKey);
  const previousFeaturesById = new Map(
    canReuseAi && Array.isArray(previousManifest.features)
      ? previousManifest.features.map((feature) => [feature.id, feature])
      : [],
  );

  const features = [];
  const aiFeatures = [];
  const errors = [];

  for (const feature of scanResult.features) {
    const previousFeature = previousFeaturesById.get(feature.id);
    const canReuseFeatureAi = Boolean(
      canReuseAi
      && previousFeature
      && previousFeature.hash === feature.hash
      && previousFeature.ai,
    );

    if (canReuseFeatureAi) {
      features.push({
        ...feature,
        ai: previousFeature.ai,
      });
      aiFeatures.push({
        id: feature.id,
        title: feature.title,
      });
      continue;
    }

    try {
      const parsed = await summarizeFeature(client, feature, scanResult, options, providerInfo);
      features.push({
        ...feature,
        ai: parsed,
      });
      aiFeatures.push({
        id: feature.id,
        title: feature.title,
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      errors.push({
        scope: `feature:${feature.id}`,
        message,
      });
      features.push({
        ...feature,
        ai: null,
      });
    }
  }

  return {
    ...scanResult,
    features,
    ai: {
      ...(scanResult.ai || {}),
      enabled: true,
      provider: providerInfo.provider,
      model: providerInfo.model,
      reasoningEffort: options.reasoningEffort,
      errors: [...((scanResult.ai && scanResult.ai.errors) || []), ...errors],
      features: aiFeatures,
    },
  };
}

module.exports = {
  DEFAULT_AI_MODEL,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_OLLAMA_MODEL_STRATEGY,
  fetchOllamaModels,
  pickOllamaModel,
  resolveAiProvider,
  enrichWithAi,
  enrichFeaturesWithAi,
};
