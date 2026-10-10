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
  it('uses one cancellable attempt for Go and forwards the child attempt signal', async () => {
    const parent = new AbortController();
    const child = new AbortController();
    const run = vi.fn(async () => 'ok');
    const runner = createStudioOperationRunner({
      aiConfig: { provider: 'opencode-go' },
      getAbortSignal: () => parent.signal,
    }, { logEvent: vi.fn() });

    await runner.runLLM({ task: 'chat', phase: 'chat', run, retries: 3, timeoutMs: 1000 });
    const calls = vi.mocked(runLLMRequest).mock.calls;
    const requestArgs = calls[calls.length - 1][0];
    expect(requestArgs.retries).toBe(1);
    expect(requestArgs.abortOnTimeout).toBe(true);
    expect(requestArgs.signal).toBe(parent.signal);
    await requestArgs.run(child.signal);
    expect(run).toHaveBeenLastCalledWith(child.signal);
  });

  it.each(['openrouter', 'agent', 'cliproxy'] as const)('preserves the %s timeout retry policy', async (provider) => {
    const runner = createStudioOperationRunner({ aiConfig: { provider } }, { logEvent: vi.fn() });
    await runner.runLLM({ task: 'chat', phase: 'chat', run: async () => 'ok', retries: 3, timeoutMs: 1000 });
    const calls = vi.mocked(runLLMRequest).mock.calls;
    const requestArgs = calls[calls.length - 1][0];
    expect(requestArgs.retries).toBe(3);
    expect(requestArgs.abortOnTimeout).toBe(false);
  });

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
