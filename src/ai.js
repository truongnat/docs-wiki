const OpenAI = require('openai');
const { zodTextFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const DEFAULT_AI_MODEL = 'gpt-5.4-mini';
const DEFAULT_REASONING_EFFORT = 'none';
const DEFAULT_OLLAMA_MODEL_STRATEGY = 'family';
const DEFAULT_FILE_SYSTEM_PROMPT = 'You generate compact technical documentation for source files. Be precise, concise, and avoid speculation.';
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
    '',
    'Files:',
    fileBlocks.join('\n\n'),
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

  for (const file of scanResult.files) {
    const previous = previousByPath.get(file.relativePath);
    const canReuseFileAi = Boolean(
      canReuseAi
      && previous
      && previous.hash === file.hash
      && previous.ai
      && !sourceChanged.has(file.relativePath),
    );

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

  let project = null;
  let aiProjectChanged = false;

  if (canReuseAi && previousManifest.ai && previousManifest.ai.project && sourceChanged.size === 0 && aiChangedFiles.length === 0) {
    project = previousManifest.ai.project;
  } else {
    try {
      const interimResult = {
        ...scanResult,
        files,
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

module.exports = {
  DEFAULT_AI_MODEL,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_OLLAMA_MODEL_STRATEGY,
  fetchOllamaModels,
  pickOllamaModel,
  resolveAiProvider,
  enrichWithAi,
};
