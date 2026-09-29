import { describe, expect, it, vi } from 'vitest';
import { createStudioOperationRunner } from './operationRunner';
import { runLLMRequest } from '../../services/llmRequestRunner';
import type { runLLMRequest as runLLMRequestType } from '../../services/llmRequestRunner';

type RunLLMRequestArgs = Parameters<typeof runLLMRequestType>[0];

vi.mock('../../services/llmRequestRunner', () => ({
  runLLMRequest: vi.fn(async (args: RunLLMRequestArgs) => {
    const startedAt = Date.now();
    args.onStart?.({
      task: args.task,
      attempt: 1,
      maxAttempts: 2,
      startedAt,
    });
    args.onTimeout?.({ attempt: 1, maxAttempts: 2, error: new Error('timeout'), task: args.task });
    const result = await args.run();
    args.onFinish?.({
      status: 'success',
      durationMs: 12,
      task: args.task,
      attempt: 1,
      maxAttempts: 2,
      startedAt,
      finishedAt: startedAt + 12,
    });
    return result;
  }),
}));

describe('createStudioOperationRunner', () => {
  it('logs context, timeout, and stage lifecycle events', async () => {
    const logEvent = vi.fn();
    const onLLMRequestStart = vi.fn();
    const onStart = vi.fn();
    const onFinish = vi.fn();
    const runner = createStudioOperationRunner({ onLLMRequestStart }, { logEvent });

    const result = await runner.runLLM({
      task: 'build',
      phase: 'build',
      run: async () => 'ok',
      retries: 1,
      timeoutMs: 1000,
      stageTitle: 'Build',
      stageContextScope: 'block',
      contextEvent: { detail: 'ctx', tooltipDocs: 'docs' },
      onStart,
      onFinish,
      onTimeoutDetail: () => 'timeout detail',
    });

    expect(result).toBe('ok');
    expect(onLLMRequestStart).toHaveBeenCalled();
    expect(onStart).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalled();
    expect(runLLMRequest).toHaveBeenCalled();

    const titles = logEvent.mock.calls.map((call) => call[0].title);
    expect(titles).toContain('Контекст');
    expect(titles).toContain('LLM');
    expect(titles).toContain('Timeout');
    expect(titles).toContain('Build');
  });
});
