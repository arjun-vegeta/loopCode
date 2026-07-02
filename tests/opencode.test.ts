import { describe, it, expect, mock, beforeEach } from 'bun:test';
mock.module('@opencode-ai/sdk', () => {
  return {
    createOpencode: mock(),
  };
});
import { OpencodeOrchestrator } from '../src/opencode.js';
import { createOpencode } from '@opencode-ai/sdk';

process.env.VITEST = '1';

describe('OpencodeOrchestrator', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('throws an error if no auth/provider is configured', async () => {
    // Mock the SDK response for config.providers() with no defaults and no ready providers
    (createOpencode as any).mockResolvedValue({
      client: {
        config: {
          providers: mock().mockResolvedValue({
            data: {
              default: {},
              providers: [],
            },
          }),
        },
      },
      server: { close: mock() },
    });

    await expect(OpencodeOrchestrator.initialize()).rejects.toThrow(/No LLM provider configured/);
  });

  it('times out and aborts if prompt takes too long', async () => {
    // Mock successful auth
    const abortMock = mock().mockResolvedValue({});

    // Create a prompt function that hangs forever
    const promptMock = mock().mockImplementation(() => {
      return new Promise((_resolve) => {
        // Never resolves to simulate a hung provider
      });
    });

    (createOpencode as any).mockResolvedValue({
      client: {
        config: {
          providers: mock().mockResolvedValue({
            data: {
              default: { model: 'anthropic/claude' },
              providers: [{ state: 'ready' }],
            },
          }),
        },
        session: {
          create: mock().mockResolvedValue({ data: { id: 'test-session' } }),
          prompt: promptMock,
          abort: abortMock,
        },
        event: {
          subscribe: mock().mockResolvedValue({ stream: [] }),
        },
      },
      server: { close: mock() },
    });

    const orchestrator = await OpencodeOrchestrator.initialize();

    const task = {
      id: '1',
      description: 'Test task',
      goal: 'Do nothing',
      category: 'test' as const,
      systemPrompt: 'You are helpful',
      expectedOutputs: [],
      writeAllowlist: [],
      verification: [],
      maxCost: 1,
      timeout: 0.1, // 100ms timeout for test
    };

    const result = await orchestrator.executeTask(task);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Task timed out/);
    expect(abortMock).toHaveBeenCalledWith({ path: { id: 'test-session' } });
  });
});
