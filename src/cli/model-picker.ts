import { select, confirm } from '@clack/prompts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse, stringify } from 'smol-toml';
import { ModelPortfolio } from '../router/portfolio.js';
import type { LoopcodeConfig } from '../config.js';

const CONFIG_PATH = join(homedir(), '.loopcode', 'config.toml');

function loadModelConfig(): LoopcodeConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf-8');
      return parse(content) as LoopcodeConfig;
    }
  } catch (err: any) {
    console.warn(`Failed to read config: ${err.message}`);
  }
  return {};
}

function saveModelConfig(config: LoopcodeConfig) {
  try {
    const dir = join(CONFIG_PATH, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const content = stringify(config as any);
    writeFileSync(CONFIG_PATH, content, 'utf-8');
    console.log(`✓ Saved configuration to ${CONFIG_PATH}`);
  } catch (err: any) {
    console.error(`Failed to save config: ${err.message}`);
  }
}

export async function openModelPicker() {
  const config = loadModelConfig();
  if (!config.model) {
    config.model = {};
  }

  // 1. Select the task type to configure
  const taskType = await select({
    message: '🧠 Model Configuration\n\nWhich task type do you want to configure?',
    options: [
      { value: 'default', label: 'Default / Fallback Model' },
      { value: 'planning', label: 'Planning / Architecture' },
      { value: 'research', label: 'Research / Long Context' },
      { value: 'implementation', label: 'Implementation / Coding' },
      { value: 'review', label: 'Code Review' },
      { value: 'verification', label: 'Verification / Testing' },
      { value: 'quickFix', label: 'Quick Fix / Simple Tasks' },
    ],
  });

  if (typeof taskType === 'symbol') {
    return;
  }

  // 2. Select the model for that task type
  const modelOptions = Object.keys(ModelPortfolio).map((key) => {
    const spec = ModelPortfolio[key];
    return {
      value: `${spec.providerID}/${spec.modelID}`,
      label: `${spec.providerID}/${spec.modelID} (${spec.latencyRating} latency)`,
      hint: `In: $${spec.inputCostPerMillion}/M, Out: $${spec.outputCostPerMillion}/M`,
    };
  });

  const modelChoice = await select({
    message: `Select model for task type [${taskType}]:`,
    options: modelOptions,
  });

  if (typeof modelChoice === 'symbol') {
    return;
  }

  // Update config
  (config.model as any)[taskType] = modelChoice;

  // Ask for confirmation
  const shouldSave = await confirm({
    message: `Save changes to ${CONFIG_PATH}?`,
  });

  if (shouldSave === true) {
    saveModelConfig(config);
  }
}
