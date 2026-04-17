const path = require('node:path');

class PluginEngine {
  constructor() {
    this.plugins = [];
  }

  /**
   * Loads plugins from the config.
   * Plugins can be string names (to be required) or direct functions/objects.
   */
  async loadPlugins(pluginSpecs, rootDir) {
    if (!Array.isArray(pluginSpecs)) return;

    for (const spec of pluginSpecs) {
      try {
        let plugin;
        if (typeof spec === 'string') {
          // Try to load from local project node_modules or absolute path
          const pluginPath = spec.startsWith('.') 
            ? path.resolve(rootDir, spec) 
            : spec;
          plugin = require(pluginPath);
        } else if (typeof spec === 'object') {
          plugin = spec;
        }

        if (plugin) {
          this.plugins.push(plugin);
          // console.log(`Loaded plugin: ${plugin.name || spec}`);
        }
      } catch (e) {
        console.error(`Failed to load plugin "${spec}": ${e.message}`);
      }
    }
  }

  /**
   * Executes a hook across all registered plugins.
   * Returns the mutated data.
   */
  async runHook(hookName, data, context = {}) {
    let mutatedData = data;
    for (const plugin of this.plugins) {
      if (typeof plugin[hookName] === 'function') {
        try {
          const result = await plugin[hookName](mutatedData, context);
          if (result !== undefined) {
            mutatedData = result;
          }
        } catch (e) {
          console.error(`Error in plugin hook "${hookName}": ${e.message}`);
        }
      }
    }
    return mutatedData;
  }
}

// Singleton instance for the session
const engine = new PluginEngine();

module.exports = engine;
