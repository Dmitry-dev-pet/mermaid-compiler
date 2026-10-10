import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runLLMRequest } from './llmRequestRunner';
import { TimeoutError } from './llmTimeout';

const abortError = () => {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
};

describe('runLLMRequest transport cancellation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborts a slow request before reporting its timeout and does not retry when retries is one', async () => {
    const parent = new AbortController();
    const signals: AbortSignal[] = [];
    const run = vi.fn((signal?: AbortSignal | null) => {
      if (!signal) throw new Error('Expected an attempt signal');
      signals.push(signal);
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    });
    const onFinish = vi.fn(() => {
      expect(signals[0].aborted).toBe(true);
    });
    const onTimeout = vi.fn();
    const request = runLLMRequest({
      task: 'Go build', run, timeoutMs: 100, retries: 1, abortOnTimeout: true,
      signal: parent.signal, onFinish, onTimeout,
    });
    const rejection = expect(request).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;

    expect(run).toHaveBeenCalledTimes(1);
    expect(signals[0]).not.toBe(parent.signal);
    expect(signals[0].aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'timeout', attempt: 1 }));
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates parent cancellation to the active transport without another attempt', async () => {
    const parent = new AbortController();
    const signals: AbortSignal[] = [];
    const run = vi.fn((signal?: AbortSignal | null) => {
      if (!signal) throw new Error('Expected an attempt signal');
      signals.push(signal);
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    });
    const onTimeout = vi.fn();
    const request = runLLMRequest({
      task: 'Go chat', run, timeoutMs: 100, retries: 3, abortOnTimeout: true,
      signal: parent.signal, onTimeout,
    });
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    parent.abort();
    await rejection;

    expect(signals[0].aborted).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves legacy timeout retries without aborting the original signal', async () => {
    const parent = new AbortController();
    const run = vi.fn((_signal?: AbortSignal | null) => Promise.resolve('second attempt'))
      .mockImplementationOnce(() => new Promise<string>(() => {}));
    const onTimeout = vi.fn();
    const request = runLLMRequest({
      task: 'Legacy request', run, timeoutMs: 100, retries: 2,
      signal: parent.signal, onTimeout,
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(request).resolves.toBe('second attempt');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, parent.signal);
    expect(run).toHaveBeenNthCalledWith(2, parent.signal);
    expect(parent.signal.aborted).toBe(false);
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, maxAttempts: 2 }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'error'] as const)('removes the parent relay after %s', async (outcome) => {
    const parent = new AbortController();
    const signals: AbortSignal[] = [];
    const expectedError = new Error('Synthetic transport failure');
    const run = vi.fn((signal?: AbortSignal | null) => {
      if (!signal) throw new Error('Expected an attempt signal');
      signals.push(signal);
      return outcome === 'success' ? Promise.resolve('done') : Promise.reject(expectedError);
    });
    const request = runLLMRequest({ task: 'Go request', run, abortOnTimeout: true, signal: parent.signal });
    if (outcome === 'success') await expect(request).resolves.toBe('done');
    else await expect(request).rejects.toBe(expectedError);

    parent.abort();
    expect(signals[0].aborted).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not call the transport when the parent is already aborted', async () => {
    const parent = new AbortController();
    parent.abort();
    const run = vi.fn(() => Promise.resolve('unused'));
    await expect(runLLMRequest({
      task: 'Go request', run, abortOnTimeout: true, signal: parent.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
