const { resolveAiProvider } = require('./ai');

async function createEmbeddings(text, options = {}) {
  const providerInfo = await resolveAiProvider(options);
  const client = providerInfo.client;

  if (providerInfo.provider === 'openai') {
    const response = await client.embeddings.create({
      model: options.embeddingModel || 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }

  if (providerInfo.provider === 'ollama') {
    // Note: OpenAI SDK can talk to Ollama's /v1/embeddings if supported,
    // otherwise we use a direct fetch to Ollama API.
    const baseUrl = options.ollamaBaseURL.replace(/\/v1$/, '');
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      body: JSON.stringify({
        model: options.ollamaModel,
        prompt: text,
      }),
    });
    const json = await response.json();
    return json.embedding;
  }

  throw new Error('Unsupported AI provider for embeddings');
}

module.exports = {
  createEmbeddings,
};
