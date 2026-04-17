const test = require('node:test');
const assert = require('node:assert/strict');
const { neutralizeTopLevelMarkdownEsm } = require('../src/markdownSafe');

test('neutralizeTopLevelMarkdownEsm guards top-level import/export lines', () => {
  const input = [
    '# Summary',
    '',
    '- Parse: `src/a.ts` - failed to parse:',
    'import { renderToString } from "vue/server-renderer";',
    'export const broken = true;',
    '',
    'regular text',
  ].join('\n');

  const output = neutralizeTopLevelMarkdownEsm(input);
  assert.match(output, /&#8203;import \{ renderToString \} from "vue\/server-renderer";/);
  assert.match(output, /&#8203;export const broken = true;/);
});

test('neutralizeTopLevelMarkdownEsm keeps fenced code blocks untouched', () => {
  const input = [
    '```ts',
    'import { renderToString } from "vue/server-renderer";',
    'export const ok = true;',
    '```',
  ].join('\n');

  const output = neutralizeTopLevelMarkdownEsm(input);
  assert.equal(output, input);
});
