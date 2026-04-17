const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_AI_MODEL, DEFAULT_REASONING_EFFORT, DEFAULT_OLLAMA_MODEL_STRATEGY } = require('./ai');
const { hashObject } = require('./hash');

const TEMPLATE_PRESETS = {
  basic: {
    includeCodeBlocks: false,
    includeAiSections: false,
    includeUsageNotes: false,
    highlightPublicApi: false,
  },
  detailed: {
    includeCodeBlocks: true,
    includeAiSections: true,
    includeUsageNotes: true,
    highlightPublicApi: true,
  },
  'api-first': {
    includeCodeBlocks: false,
    includeAiSections: true,
    includeUsageNotes: false,
    highlightPublicApi: true,
  },
};

const DEFAULT_TEMPLATE = 'detailed';
const DEFAULT_OUTPUT = TEMPLATE_PRESETS[DEFAULT_TEMPLATE];
const THEME_PRESETS = ['clean', 'warm', 'enterprise'];
const DEFAULT_THEME_PRESET = 'clean';
const FLOW_DIAGRAM_MODES = ['flow', 'sequence', 'both', 'none'];
const DEFAULT_FLOW_DIAGRAM_MODE = 'flow';
const DEFAULT_FEATURE_OPTIONS = {
  enabled: true,
  maxFilesPerFeature: 40,
  splitByAction: true,
  customDomains: {},
};
const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
/** Default wiki output folder (hidden directory at project root). */
const DEFAULT_OUT_DIR = '.docs-wiki';

function toArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMaxFiles(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('`maxFiles` must be a positive number when set in docs-wiki config.');
  }

  return Number(value);
}

function normalizePositiveNumber(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`\`${fieldName}\` must be a positive number when set in docs-wiki config.`);
  }

  return parsed;
}

function normalizeCustomDomains(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .map(([key, keywords]) => ([
      String(key || '').trim(),
      Array.isArray(keywords)
        ? keywords.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    ]))
    .filter(([key, keywords]) => key && keywords.length > 0);

  return Object.fromEntries(entries);
}

function normalizeTemplate(value) {
  if (!value) {
    return DEFAULT_TEMPLATE;
  }

  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_PRESETS, value)) {
    throw new Error(`Unknown docs-wiki template: ${value}`);
  }

  return value;
}

function normalizeThemePreset(value) {
  if (!value) {
    return DEFAULT_THEME_PRESET;
  }

  if (!THEME_PRESETS.includes(value)) {
    throw new Error(`Unknown docs-wiki theme preset: ${value}`);
  }

  return value;
}

function normalizeFlowDiagramMode(value) {
  if (!value) {
    return DEFAULT_FLOW_DIAGRAM_MODE;
  }

  if (!FLOW_DIAGRAM_MODES.includes(value)) {
    throw new Error(`Unknown docs-wiki flow diagram mode: ${value}`);
  }

  return value;
}

/** @returns {'en'|'vi'} */
function normalizeAiLocale(value) {
  if (value === undefined || value === null || value === '') {
    return 'en';
  }

  const v = String(value).toLowerCase().trim();
  if (v === 'vi' || v === 'vn' || v === 'vietnamese') {
    return 'vi';
  }
  if (v === 'en' || v === 'en-us' || v === 'english') {
    return 'en';
  }

  throw new Error(`Invalid AI locale: ${value}. Use "en" or "vi" (config ai.locale, env DOCS_WIKI_LOCALE, or --locale).`);
}

async function loadUserConfig(rootDir, explicitConfigPath) {
  const configPath = explicitConfigPath ? path.resolve(explicitConfigPath) : path.join(rootDir, 'docs-wiki.config.json');

  try {
    const contents = await fs.readFile(configPath, 'utf8');
    return {
      path: configPath,
      config: JSON.parse(contents),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        path: null,
        config: {},
      };
    }

    throw new Error(`Failed to load config from ${configPath}: ${error.message}`);
  }
}

function resolveOutput(templateName, outputConfig = {}, themePresetName) {
  const template = normalizeTemplate(templateName);
  const preset = TEMPLATE_PRESETS[template];
  const themePreset = normalizeThemePreset(themePresetName ?? outputConfig.themePreset);

  return {
    template,
    themePreset,
    flowDiagram: normalizeFlowDiagramMode(outputConfig.flowDiagram),
    includeCodeBlocks: normalizeBoolean(outputConfig.includeCodeBlocks, preset.includeCodeBlocks),
    includeAiSections: normalizeBoolean(outputConfig.includeAiSections, preset.includeAiSections),
    includeUsageNotes: normalizeBoolean(outputConfig.includeUsageNotes, preset.includeUsageNotes),
    highlightPublicApi: normalizeBoolean(outputConfig.highlightPublicApi, preset.highlightPublicApi),
  };
}

function resolveOptions(rootDir, cliOptions, loadedConfig) {
  const fileConfig = loadedConfig.config || {};
  const outputConfig = fileConfig.output || {};
  const aiConfig = fileConfig.ai || {};
  const featureConfig = fileConfig.features || {};
  const output = resolveOutput(
    cliOptions.template ?? fileConfig.template ?? outputConfig.template,
    {
      ...outputConfig,
      flowDiagram: cliOptions.flowDiagram ?? outputConfig.flowDiagram,
    },
    cliOptions.themePreset ?? fileConfig.themePreset ?? outputConfig.themePreset,
  );

  const resolved = {
    root: rootDir,
    outDir: cliOptions.outDir ?? fileConfig.outDir ?? DEFAULT_OUT_DIR,
    include: toArray(fileConfig.include),
    ignore: toArray(fileConfig.ignore),
    maxFiles: cliOptions.maxFiles ?? normalizeMaxFiles(fileConfig.maxFiles),
    incremental: cliOptions.incremental ?? normalizeBoolean(fileConfig.incremental, true),
    watch: cliOptions.watch ?? normalizeBoolean(fileConfig.watch, false),
    output,
    features: {
      enabled: normalizeBoolean(featureConfig.enabled, DEFAULT_FEATURE_OPTIONS.enabled),
      maxFilesPerFeature: normalizePositiveNumber(
        cliOptions.maxFilesPerFeature ?? featureConfig.maxFilesPerFeature,
        'features.maxFilesPerFeature',
        DEFAULT_FEATURE_OPTIONS.maxFilesPerFeature,
      ),
      splitByAction: cliOptions.splitByAction ?? normalizeBoolean(featureConfig.splitByAction, DEFAULT_FEATURE_OPTIONS.splitByAction),
      customDomains: normalizeCustomDomains(featureConfig.customDomains),
    },
    plugins: Array.isArray(fileConfig.plugins) ? fileConfig.plugins : [],
    ai: {
      enabled: cliOptions.ai ?? normalizeBoolean(aiConfig.enabled, false),
      provider: cliOptions.aiProvider ?? aiConfig.provider ?? 'auto',
      model: cliOptions.aiModel ?? aiConfig.model ?? process.env.DOCS_WIKI_OPENAI_MODEL ?? DEFAULT_AI_MODEL,
      reasoningEffort: aiConfig.reasoningEffort ?? process.env.DOCS_WIKI_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT,
      apiKey: cliOptions.openAIApiKey ?? process.env.OPENAI_API_KEY ?? '',
      baseURL: aiConfig.baseURL ?? process.env.OPENAI_BASE_URL ?? '',
      
      anthropicApiKey: cliOptions.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      anthropicModel: cliOptions.anthropicModel ?? aiConfig.anthropicModel ?? '',
      
      geminiApiKey: cliOptions.geminiApiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
      geminiModel: cliOptions.geminiModel ?? aiConfig.geminiModel ?? '',
      
      deepseekApiKey: cliOptions.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY ?? '',
      deepseekBaseURL: aiConfig.deepseekBaseURL ?? process.env.DEEPSEEK_BASE_URL ?? '',
      deepseekModel: cliOptions.deepseekModel ?? aiConfig.deepseekModel ?? '',

      ollamaBaseURL: aiConfig.ollamaBaseURL ?? DEFAULT_OLLAMA_BASE_URL,
      ollamaModel: aiConfig.ollamaModel ?? DEFAULT_OLLAMA_MODEL,
      ollamaModelStrategy: cliOptions.ollamaModelStrategy ?? aiConfig.ollamaModelStrategy ?? process.env.OLLAMA_MODEL_STRATEGY ?? DEFAULT_OLLAMA_MODEL_STRATEGY,
      ollamaApiKey: process.env.OLLAMA_API_KEY ?? 'ollama',
      filePrompt: typeof aiConfig.filePrompt === 'string' ? aiConfig.filePrompt.trim() : '',
      modulePrompt: typeof aiConfig.modulePrompt === 'string' ? aiConfig.modulePrompt.trim() : '',
      featurePrompt: typeof aiConfig.featurePrompt === 'string' ? aiConfig.featurePrompt.trim() : '',
      projectPrompt: typeof aiConfig.projectPrompt === 'string' ? aiConfig.projectPrompt.trim() : '',
      locale: normalizeAiLocale(
        cliOptions.locale
          ?? aiConfig.locale
          ?? process.env.DOCS_WIKI_LOCALE
          ?? process.env.DOCS_WIKI_AI_LOCALE,
      ),
    },
    config: {
      path: loadedConfig.path,
      loaded: Boolean(loadedConfig.path),
    },
  };

  resolved.cache = {
    scanKey: hashObject({
      include: resolved.include,
      ignore: resolved.ignore,
      maxFiles: resolved.maxFiles ?? 'all',
    }),
    aiKey: hashObject({
      enabled: resolved.ai.enabled,
      provider: resolved.ai.provider,
      model: resolved.ai.model,
      ollamaModel: resolved.ai.ollamaModel,
      ollamaModelStrategy: resolved.ai.ollamaModelStrategy,
      ollamaBaseURL: resolved.ai.ollamaBaseURL,
      reasoningEffort: resolved.ai.reasoningEffort,
      modulePrompt: resolved.ai.modulePrompt,
      featurePrompt: resolved.ai.featurePrompt,
      filePrompt: resolved.ai.filePrompt,
      projectPrompt: resolved.ai.projectPrompt,
      locale: resolved.ai.locale,
    }),
  };
  resolved.cache.renderKey = hashObject({
    output: resolved.output,
    aiKey: resolved.cache.aiKey,
    features: resolved.features,
  });

  resolved.settings = {
    configPath: resolved.config.path,
    include: resolved.include,
    ignore: resolved.ignore,
    maxFiles: resolved.maxFiles,
    incremental: resolved.incremental,
    watch: resolved.watch,
    output: resolved.output,
    features: resolved.features,
    ai: {
      enabled: resolved.ai.enabled,
      provider: resolved.ai.provider,
      model: resolved.ai.model,
      ollamaModel: resolved.ai.ollamaModel,
      ollamaBaseURL: resolved.ai.ollamaBaseURL,
      reasoningEffort: resolved.ai.reasoningEffort,
      modulePrompt: resolved.ai.modulePrompt,
      featurePrompt: resolved.ai.featurePrompt,
      locale: resolved.ai.locale,
    },
  };

  return resolved;
}

module.exports = {
  DEFAULT_OUTPUT,
  DEFAULT_THEME_PRESET,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_FEATURE_OPTIONS,
  DEFAULT_TEMPLATE,
  TEMPLATE_PRESETS,
  THEME_PRESETS,
  FLOW_DIAGRAM_MODES,
  DEFAULT_FLOW_DIAGRAM_MODE,
  DEFAULT_OUT_DIR,
  loadUserConfig,
  resolveOptions,
  normalizeAiLocale,
};
