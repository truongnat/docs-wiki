const { spawn } = require('node:child_process');
const path = require('node:path');

class LspClient {
  constructor(serverPath = 'typescript-language-server', args = ['--stdio']) {
    this.serverPath = serverPath;
    this.args = args;
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
  }

  async start(rootDir) {
    try {
      this.process = spawn(this.serverPath, this.args, {
        cwd: rootDir,
        stdio: ['pipe', 'pipe', 'inherit']
      });

      this.process.stdout.on('data', (data) => this._handleData(data));
      this.process.on('error', (err) => console.error('LSP Error:', err));

      // Initialize
      await this.request('initialize', {
        processId: process.pid,
        rootPath: rootDir,
        rootUri: `file://${rootDir}`,
        capabilities: {},
      });

      await this.notification('initialized', {});
      return true;
    } catch (e) {
      console.error(`Could not start LSP server "${this.serverPath}": ${e.message}`);
      return false;
    }
  }

  _handleData(data) {
    this.buffer += data.toString();
    while (true) {
      const match = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;

      const contentLength = parseInt(match[1], 10);
      const headerLength = match[0].length;
      if (this.buffer.length < headerLength + contentLength) break;

      const content = this.buffer.slice(headerLength, headerLength + contentLength);
      this.buffer = this.buffer.slice(headerLength + contentLength);

      try {
        const payload = JSON.parse(content);
        if (payload.id !== undefined) {
          const handler = this.pendingRequests.get(payload.id);
          if (handler) {
            this.pendingRequests.delete(payload.id);
            if (payload.error) handler.reject(payload.error);
            else handler.resolve(payload.result);
          }
        }
      } catch (e) {
        console.error('LSP JSON parse error:', e);
      }
    }
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.process.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    });
  }

  notification(method, params) {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  }

  async getDefinition(filePath, line, character) {
    return this.request('textDocument/definition', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character }
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
    }
  }
}

module.exports = LspClient;
