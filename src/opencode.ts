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

  static async initialize(router?: Router): Promise<OpencodeOrchestrator> {
    const { client, server } = await createOpencode();

    const orchestrator = new OpencodeOrchestrator(client, () => server.close(), router);
    await orchestrator.checkAuth();
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
      throw new Error(
        'No LLM provider configured. Please run `opencode auth login` or configure your `~/.opencode/opencode.json`.',
      );
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
    const streamPromise = (async () => {
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
