#!/usr/bin/env node
import { Command } from 'commander';
import { runCli } from './cli/runner.js';

const program = new Command();

program.name('loopcode').description('LoopCode v3: Autonomous Software Engineering Orchestrator').version('3.0.0');

program
  .argument('[goal]', 'The goal you want LoopCode to achieve')
  .option('-r, --resume <taskId>', 'Resume an in-progress task by its ID')
  .option('-d, --db <path>', 'Path to SQLite database file', 'loopcode.db')
  .action(async (goal, options) => {
    try {
      await runCli(goal, options.resume, options.db);
    } catch (err: any) {
      console.error(`\n❌ Fatal Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
