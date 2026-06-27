import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpencodeOrchestrator } from '../src/opencode.js';

// Mock the openCode module
vi.mock('@opencode-ai/sdk', () => {
  return {
    createOpencode: vi.fn()
  };
});

import { createOpencode } from '@opencode-ai/sdk';

describe('OpencodeOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws an error if no auth/provider is configured', async () => {
    // Mock the SDK response for config.providers() with no defaults and no ready providers
    (createOpencode as any).mockResolvedValue({
      client: {
        config: {
          providers: vi.fn().mockResolvedValue({
            data: {
              default: {},
              providers: []
            }
          })
        }
      },
      server: { close: vi.fn() }
    });

    await expect(OpencodeOrchestrator.initialize()).rejects.toThrow(/No LLM provider configured/);
  });

  it('times out and aborts if prompt takes too long', async () => {
    // Mock successful auth
    const abortMock = vi.fn().mockResolvedValue({});
    
    // Create a prompt function that hangs forever
    const promptMock = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        // Never resolves to simulate a hung provider
      });
    });

    (createOpencode as any).mockResolvedValue({
      client: {
        config: {
          providers: vi.fn().mockResolvedValue({
            data: {
              default: { model: "anthropic/claude" },
              providers: [{ state: "ready" }]
            }
          })
        },
        session: {
          create: vi.fn().mockResolvedValue({ data: { id: "test-session" } }),
          prompt: promptMock,
          abort: abortMock
        },
        event: {
          subscribe: vi.fn().mockResolvedValue({ stream: [] })
        }
      },
      server: { close: vi.fn() }
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
      timeout: 0.1 // 100ms timeout for test
    };

    const result = await orchestrator.executeTask(task);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Task timed out/);
    expect(abortMock).toHaveBeenCalledWith({ path: { id: "test-session" } });
  });
});
