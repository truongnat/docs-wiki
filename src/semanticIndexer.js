const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveAiProvider, summarizeDomain } = require('./ai');
const { hashObject } = require('./hash');

const BASE_DOMAIN_DEFINITIONS = [
  { id: 'auth', keywords: ['auth', 'login', 'logout', 'signin', 'signout', 'register', 'signup', 'session', 'token', 'password', 'credential', 'oauth', 'sso', 'mfa', 'otp', 'permission', 'role', 'access'] },
  { id: 'user', keywords: ['user', 'profile', 'account', 'member', 'identity', 'people'] },
  { id: 'payment', keywords: ['payment', 'billing', 'invoice', 'checkout', 'refund', 'charge', 'subscription', 'plan'] },
  { id: 'order', keywords: ['order', 'cart', 'checkout', 'shipment', 'fulfillment', 'inventory'] },
  { id: 'notification', keywords: ['notify', 'notification', 'email', 'sms', 'message', 'alert', 'webhook'] },
  { id: 'search', keywords: ['search', 'query', 'filter', 'index', 'ranking'] },
  { id: 'reporting', keywords: ['report', 'analytics', 'dashboard', 'metric', 'insight', 'audit'] },
  { id: 'admin', keywords: ['admin', 'management', 'console', 'backoffice', 'moderation'] },
  { id: 'storage', keywords: ['file', 'files', 'upload', 'download', 'storage', 'bucket', 'blob', 'document'] },
  { id: 'integration', keywords: ['integration', 'provider', 'adapter', 'client', 'sdk', 'partner'] },
];

function tokenize(text) {
  return (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function scoreDomain(file, domain) {
  const fileTokens = new Set([...file.keywords, ...tokenize(file.relativePath)]);
  return domain.keywords.reduce((score, kw) => score + (fileTokens.has(kw) ? 1 : 0), 0);
}

async function generateSemanticIndex(rootDir, options = {}) {
  const atlasPath = path.join(rootDir, options.outDir || '.docs-wiki', 'project-atlas.json');
  const atlas = JSON.parse(await fs.readFile(atlasPath, 'utf8'));

  const domainClusters = new Map();
  BASE_DOMAIN_DEFINITIONS.forEach(d => domainClusters.set(d.id, []));
  domainClusters.set('general', []);

  // Simple clustering based on Atlas keywords
  for (const file of atlas.files) {
    let bestDomain = 'general';
    let maxScore = 0;

    for (const domain of BASE_DOMAIN_DEFINITIONS) {
      const score = scoreDomain(file, domain);
      if (score > maxScore) {
        maxScore = score;
        bestDomain = domain.id;
      }
    }
    domainClusters.get(bestDomain).push(file);
  }

  const domains = [];
  let providerInfo = null;
  if (options.ai && options.ai.enabled) {
    providerInfo = await resolveAiProvider(options.ai);
  }

  for (const [domainId, files] of domainClusters.entries()) {
    if (files.length === 0) continue;

    let summary = null;
    if (providerInfo) {
      console.log(`  AI summarizing domain: ${domainId} (${files.length} files)`);
      try {
        summary = await summarizeDomain(providerInfo.client, domainId, files, options.ai, providerInfo);
      } catch (e) {
        console.error(`  AI error for domain ${domainId}: ${e.message}`);
      }
    }

    domains.push({
      id: domainId,
      summary,
      fileCount: files.length,
      files: files.map(f => f.relativePath)
    });
  }

  const semanticIndex = {
    generatedAt: new Date().toISOString(),
    projectContext: atlas.topKeywords.slice(0, 10),
    domains
  };

  const indexPath = path.join(rootDir, options.outDir || '.docs-wiki', 'semantic-index.json');
  await fs.writeFile(indexPath, JSON.stringify(semanticIndex, null, 2));

  return semanticIndex;
}

module.exports = {
  generateSemanticIndex
};
