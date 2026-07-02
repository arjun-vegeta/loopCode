import { createOpencode, OpencodeClient } from '@opencode-ai/sdk';
import type { Task, TaskResult } from './types.js';
import { Router } from './router.js';

export class OpencodeOrchestrator {
  public client: OpencodeClient;
  private serverCloseCallback: () => void;
  private router: Router;

  private constructor(client: OpencodeClient, serverCloseCallback: () => void, router?: Router) {
    this.client = client;
    this.serverCloseCallback = serverCloseCallback;
    this.router = router || new Router();
  }

  static async initialize(router?: Router, mockClient?: any, mockServer?: any): Promise<OpencodeOrchestrator> {
    let client = mockClient;
    let server = mockServer;
    if (!client || !server) {
      const res = await createOpencode();
      client = client || res.client;
      server = server || res.server;
    }

    const orchestrator = new OpencodeOrchestrator(client, () => server?.close(), router);
    await orchestrator.checkAuth();

    if (router) {
      await orchestrator.updateRouterWithAvailableProviders(router);
    }

    return orchestrator;
  }

  private async checkAuth(): Promise<void> {
    const { data: config, error } = await this.client.config.providers();
    if (error || !config) {
      throw new Error(`Failed to fetch providers: ${JSON.stringify(error)}`);
    }

    // A simple heuristic: if no defaults are set, the user likely hasn't configured any API keys.
    const hasDefaults = config.default && Object.keys(config.default).length > 0;

    // We check if there are any configured/ready providers
    const hasReadyProviders =
      config.providers && config.providers.some((p: any) => p.state === 'ready' || p.configured);

    if (!hasDefaults && !hasReadyProviders) {
      if (process.env.VITEST || process.env.BUN_TEST) {
        throw new Error(
          'No LLM provider configured. Please run `opencode auth login` or configure your `~/.opencode/opencode.json`.',
        );
      }

      console.log('\n🔒 No LLM provider is configured in OpenCode.');

      const { confirm } = await import('@clack/prompts');
      const shouldLogin = await confirm({
        message: 'Would you like to log in to OpenCode now via the interactive CLI?',
      });

      if (shouldLogin === true) {
        const { spawnSync } = await import('node:child_process');
        console.log('\nStarting OpenCode login flow...\n');

        try {
          const result = spawnSync('opencode', ['auth', 'login'], { stdio: 'inherit' });

          if (result.status === 0) {
            console.log('\n✓ Login completed. Re-checking credentials...\n');
            return this.checkAuth();
          } else {
            throw new Error('OpenCode login failed or was cancelled.');
          }
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            console.log('\n❌ The `opencode` CLI binary was not found in your PATH.');
            const { confirm } = await import('@clack/prompts');
            const shouldInstall = await confirm({
              message: 'Would you like LoopCode to try installing the `opencode-ai` CLI globally via npm?',
            });

            if (shouldInstall === true) {
              const { spawnSync } = await import('node:child_process');
              console.log('\nInstalling opencode-ai globally...\n');

              const installResult = spawnSync('npm', ['install', '-g', 'opencode-ai'], { stdio: 'inherit' });

              if (installResult.status === 0) {
                console.log('\n✓ Installation completed. Starting OpenCode login...\n');
                return this.checkAuth();
              } else {
                throw new Error(
                  'Global installation failed. Please install OpenCode manually:\n' +
                    '  • npm:  npm install -g opencode-ai\n' +
                    '  • brew: brew install anomalyco/tap/opencode\n' +
                    '  • curl: curl -fsSL https://opencode.ai/install | bash',
                );
              }
            } else {
              throw new Error(
                'OpenCode is required to run LoopCode. Please install it using:\n' +
                  '  • npm:  npm install -g opencode-ai\n' +
                  '  • brew: brew install anomalyco/tap/opencode\n' +
                  '  • curl: curl -fsSL https://opencode.ai/install | bash',
              );
            }
          }
          throw err;
        }
      } else {
        throw new Error(
          'No LLM provider configured. Please run `opencode auth login` or configure your `~/.opencode/opencode.json`.',
        );
      }
    }
  }

  private async updateRouterWithAvailableProviders(router: Router): Promise<void> {
    try {
      const { data: config } = await this.client.config.providers();
      if (config && config.providers) {
        const readyProviders = config.providers
          .filter((p: any) => p.state === 'ready' || p.configured)
          .map((p: any) => p.id);

        router.updateModelsBasedOnProviders(readyProviders);
      }
    } catch (err) {
      // Ignore provider resolution errors to ensure fallback default routing is preserved
    }
  }

  async executeTask(task: Task): Promise<TaskResult> {
    const { data: session, error: createError } = await this.client.session.create({
      body: { title: `LoopCode Task: ${task.description}` },
    });

    if (!session || createError) {
      throw new Error('Failed to create OpenCode session: ' + JSON.stringify(createError));
    }

    const sessionId = session.id;

    // Start streaming events in the background for transparency
    const { stream } = await this.client.event.subscribe();

    // Asynchronous loop to print tool calls
    (async () => {
      try {
        for await (const event of stream) {
          if ((event as any).type === 'tool_call' || (event as any).event === 'tool_call') {
            // Simplified rendering of tool events
            console.log(`[Tool] ${JSON.stringify((event as any).data || (event as any).properties || event)}`);
          }
        }
      } catch (err) {
        // Stream may close abruptly
      }
    })();

    // Fold the system prompt/instructions into the main prompt
    const fullPrompt = `${task.systemPrompt}\n\nTask Goal:\n${task.goal}`;

    // Setup Timeout
    const abortController = new AbortController();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        abortController.abort();
        reject(new Error(`Task timed out after ${task.timeout} seconds`));
      }, task.timeout * 1000);
    });

    try {
      const modelRoute = this.router.route(task);

      const promptPromise = this.client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: fullPrompt }],
          model: modelRoute,
        },
        signal: abortController.signal,
      });

      const { data: result, error: promptError } = await Promise.race([promptPromise, timeoutPromise]);

      if (promptError) {
        throw new Error('Prompt error: ' + JSON.stringify(promptError));
      }

      return {
        success: true,
        message: (result?.info as any)?.text,
      };
    } catch (error: any) {
      // If it timed out, try to gracefully abort the session on the server
      if (error.message.includes('timed out')) {
        try {
          await this.client.session.abort({ path: { id: sessionId } });
        } catch (abortErr) {
          console.error('Failed to abort session on server:', abortErr);
        }
      }
      return {
        success: false,
        message: error.message || String(error),
      };
    }
  }

  close() {
    this.serverCloseCallback();
  }
}
