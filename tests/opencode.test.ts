import { describe, it, expect, mock, beforeEach } from 'bun:test';

import { OpencodeOrchestrator } from '../src/opencode.js';

process.env.VITEST = '1';

describe('OpencodeOrchestrator', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('throws an error if no auth/provider is configured', async () => {
    const mockClient = {
      config: {
        providers: mock().mockResolvedValue({
          data: {
            default: {},
            providers: [],
          },
        }),
      },
    } as any;
    const mockServer = { close: mock() } as any;

    await expect(OpencodeOrchestrator.initialize(undefined, mockClient, mockServer)).rejects.toThrow(
      /No LLM provider configured/,
    );
  });

  it('times out and aborts if prompt takes too long', async () => {
    const abortMock = mock().mockResolvedValue({});

    const promptMock = mock().mockImplementation(() => {
      return new Promise((_resolve) => {
        // Never resolves to simulate a hung provider
      });
    });

    const mockClient = {
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
    } as any;
    const mockServer = { close: mock() } as any;

    const orchestrator = await OpencodeOrchestrator.initialize(undefined, mockClient, mockServer);

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
