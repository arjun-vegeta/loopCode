import { describe, it, expect } from 'vitest';
import { Router } from '../src/router.js';
import type { Task } from '../src/types.js';

describe('Router', () => {
  const router = new Router();

  it('routes test and docs categories to cheap model', () => {
    const testTask = { category: 'test', expectedOutputs: [] } as any as Task;
    const docsTask = { category: 'docs', expectedOutputs: [] } as any as Task;

    expect(router.route(testTask).modelID).toBe('claude-5-sonnet');
    expect(router.route(docsTask).modelID).toBe('claude-5-sonnet');
  });

  it('routes security and refactor categories to strong model', () => {
    const securityTask = { category: 'security', expectedOutputs: [] } as any as Task;
    const refactorTask = { category: 'refactor', expectedOutputs: [] } as any as Task;

    expect(router.route(securityTask).modelID).toBe('claude-4.8-opus');
    expect(router.route(refactorTask).modelID).toBe('claude-4.8-opus');
  });

  it('routes complex features (many expected outputs) to strong model', () => {
    const complexFeature = { category: 'feature', expectedOutputs: ['a', 'b', 'c'] } as any as Task;
    const simpleFeature = { category: 'feature', expectedOutputs: ['a'] } as any as Task;

    expect(router.route(complexFeature).modelID).toBe('claude-4.8-opus');
    expect(router.route(simpleFeature).modelID).toBe('claude-5-sonnet');
  });

  it('honors model override parameter in the task', () => {
    const customTask = { category: 'test', model: 'openai/gpt-4o', expectedOutputs: [] } as any as Task;
    const routed = router.route(customTask);
    expect(routed.providerID).toBe('openai');
    expect(routed.modelID).toBe('gpt-4o');
  });
});
