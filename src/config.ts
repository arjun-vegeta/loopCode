import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse } from 'smol-toml';
import type { ModelRoute } from './router.js';

export interface LoopcodeConfig {
  model?: {
    default?: string;
    planning?: string;
    verification?: string;
  };
}

export class ConfigManager {
  private static configPath = path.join(os.homedir(), '.loopcode', 'config.toml');

  /**
   * Load and parse config file. Returns parsed config or empty object on failure.
   */
  static loadConfig(): LoopcodeConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        return parse(content) as LoopcodeConfig;
      }
    } catch (err: any) {
      console.warn(`[Config] Failed to parse config file: ${err.message}. Using defaults.`);
    }
    return {};
  }

  /**
   * Convert TOML string routes (e.g. "anthropic/claude-5-sonnet") to ModelRoute objects.
   */
  static resolveModelRoute(modelStr?: string): ModelRoute | undefined {
    if (!modelStr) return undefined;
    const parts = modelStr.split('/');
    if (parts.length === 2) {
      return { providerID: parts[0], modelID: parts[1] };
    }
    return undefined;
  }
}
