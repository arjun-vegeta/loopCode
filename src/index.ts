#!/usr/bin/env node
import { Command } from 'commander';
import { OpencodeOrchestrator } from './opencode.js';
import { Orchestrator } from './orchestrator.js';
import { Router } from './router.js';
import { ConfigManager } from './config.js';
import { Memory } from './memory.js';

const program = new Command();

program
  .name('loopcode')
  .description('LoopCode v1: Autonomous Software Engineering Orchestrator')
  .version('1.0.0');

program
  .argument('[goal]', 'The goal you want LoopCode to achieve')
  .option('-r, --resume <taskId>', 'Resume an in-progress task by its ID')
  .option('-d, --db <path>', 'Path to SQLite database file', 'loopcode.db')
  .action(async (goal, options) => {
    // Check parameters
    if (!goal && !options.resume) {
      console.error('Error: You must provide either a goal argument or the --resume <taskId> option.');
      process.exit(1);
    }

    console.log(`\n🚀 LoopCode v1 initializing...`);

    // 1. Load config override
    const tomlConfig = ConfigManager.loadConfig();
    const routerConfig: any = {};
    if (tomlConfig.model) {
      if (tomlConfig.model.default) routerConfig.default = ConfigManager.resolveModelRoute(tomlConfig.model.default);
      if (tomlConfig.model.planning) routerConfig.planning = ConfigManager.resolveModelRoute(tomlConfig.model.planning);
      if (tomlConfig.model.verification) routerConfig.verification = ConfigManager.resolveModelRoute(tomlConfig.model.verification);
    }

    // 2. Initialize Router & OpenCode
    const router = new Router(routerConfig);
    let opencode: OpencodeOrchestrator | null = null;
    let orchestrator: Orchestrator | null = null;

    try {
      opencode = await OpencodeOrchestrator.initialize(router);
      console.log('✅ OpenCode Server initialized and provider configured.');

      orchestrator = new Orchestrator(opencode, options.db, router);

      if (options.resume) {
        console.log(`🔄 Attempting to resume task: ${options.resume}`);
        await orchestrator.resumeTask(options.resume);
      } else if (goal) {
        console.log(`🎯 New Goal: "${goal}"`);
        await orchestrator.runGoal(goal);
      }

      // 3. Print cumulative cost
      const memory = new Memory(options.db);
      const allTasks = (memory as any).db.prepare('SELECT id, goal, state, total_cost FROM tasks').all();
      
      console.log(`\n=== Execution Summary ===`);
      for (const t of allTasks) {
        console.log(`- Task Goal: "${t.goal}"`);
        console.log(`  State: ${t.state}`);
        console.log(`  Total Cost: $${t.total_cost.toFixed(4)} USD`);
      }
      console.log(`=========================\n`);
      memory.close();

    } catch (err: any) {
      console.error(`\n❌ Fatal Error: ${err.message}`);
      process.exit(1);
    } finally {
      if (opencode) {
        opencode.close();
      }
    }
  });

program.parse();
