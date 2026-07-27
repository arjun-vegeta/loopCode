import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { configStore } from '../config/store.js';
import { logger } from '../app/logger.js';
import { isHeadless } from '../platform/env.js';

export interface RunnerOptions {
  goal?: string;
  resumeTaskId?: string;
  dbPath: string;
  /** --login opens onboarding even when already authenticated. */
  forceLogin?: boolean;
}

/**
 * Bootstrap only: build the controller, decide TUI vs headless, render.
 * Compatible with both object options and legacy positional (goal, resumeTaskId, dbPath).
 */
export async function runCli(
  options?: RunnerOptions | string,
  resumeTaskIdArg?: string,
  dbPathArg = 'loopcode.db',
): Promise<number> {
  const opts: RunnerOptions =
    typeof options === 'object' && options !== null
      ? options
      : { goal: options, resumeTaskId: resumeTaskIdArg, dbPath: dbPathArg };

  const { notices } = configStore.load();
  for (const notice of notices) logger.notice('warn', notice);

  if (isHeadless()) {
    return 0;
  }

  // Stub controller for bootstrap UI rendering until full controller integration in Phase 4
  const dummyController: any = {
    config: configStore.get(),
    bus: { subscribe: () => () => {}, history: () => [] },
    snapshot: () => ({
      phase: 'idle',
      projectName: 'loopcode',
      gitBranch: 'main',
      permissionMode: 'acceptEdits',
      goalSpentUsd: 0,
      goalLimitUsd: 10,
      monthSpentUsd: 0,
      monthLimitUsd: 100,
      quota: null,
      tasks: [],
      verifications: [],
      sessions: [],
      proxy: { running: false, healthy: false },
    }),
    runGoal: async () => {},
    resume: async () => {},
    interrupt: async () => {},
    shutdown: async () => {},
    runCommand: async () => {},
    refreshCatalog: async () => ({ providers: [], defaults: {}, connected: [] }),
    catalog: () => null,
    findProvider: () => undefined,
    setApiKey: async () => ({ ok: true }),
    startOAuth: async () => ({}) as any,
    awaitOAuth: async () => ({ ok: true }),
    completeOAuth: async () => ({ ok: true }),
    startWebOnboarding: async () => ({ url: '', stop: () => {} }),
    setModelForRole: () => {},
    enableProxy: async () => ({ ok: true }),
    disableProxy: async () => {},
    proxyStatus: async () => ({ running: false, healthy: false }),
    acceptProxyRisk: () => {},
    trustDirectory: () => {},
    isDirectoryTrusted: () => true,
    renameSession: () => {},
    deleteSession: () => {},
    cyclePermissionMode: () => {},
    resolveApproval: () => {},
    resolveEscalation: () => {},
  };

  logger.setTuiActive(true);
  logger.attach(dummyController.bus);

  const instance = render(
    <App
      controller={dummyController}
      needsOnboarding={Boolean(opts.forceLogin)}
      initialGoal={opts.goal}
      resumeTaskId={opts.resumeTaskId}
    />,
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
  return 0;
}
