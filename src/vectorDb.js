const fs = require('node:fs/promises');
const path = require('node:path');

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    mA += vecA[i] * vecA[i];
    mB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

class VectorStore {
  constructor(storagePath) {
    this.storagePath = storagePath;
    this.data = []; // { id, metadata, vector }
  }

  async load() {
    try {
      const content = await fs.readFile(this.storagePath, 'utf8');
      this.data = JSON.parse(content);
    } catch (e) {
      this.data = [];
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    await fs.writeFile(this.storagePath, JSON.stringify(this.data));
  }

  add(id, metadata, vector) {
    this.data.push({ id, metadata, vector });
  }

  search(queryVector, limit = 5) {
    return this.data
      .map(item => ({
        ...item,
        score: cosineSimilarity(queryVector, item.vector)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

module.exports = {
  VectorStore,
};
