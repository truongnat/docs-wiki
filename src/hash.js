const crypto = require('node:crypto');

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function hashText(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function hashObject(value) {
  return hashText(stableSerialize(value));
}

module.exports = {
  hashObject,
  hashText,
  stableSerialize,
};
