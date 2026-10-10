import { LLM_TIMEOUT_MS, LLM_TIMEOUT_RETRIES } from "../constants";
import { TimeoutError, withTimeout } from "./llmTimeout";

type TimeoutNotice = {
  attempt: number;
  maxAttempts: number;
  error: TimeoutError;
  task: string;
};

type RunLLMRequestArgs<T> = {
  task: string;
  run: (signal?: AbortSignal | null) => Promise<T>;
  timeoutMs?: number;
  retries?: number;
  onTimeout?: (notice: TimeoutNotice) => void;
  onStart?: (notice: LLMRequestStartNotice) => void;
  onFinish?: (notice: LLMRequestFinishNotice) => void;
  signal?: AbortSignal | null;
  abortOnTimeout?: boolean;
};

export type LLMRequestStartNotice = {
  task: string;
  attempt: number;
  maxAttempts: number;
  startedAt: number;
};

export type LLMRequestFinishNotice = {
  task: string;
  attempt: number;
  maxAttempts: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: "success" | "timeout" | "error";
};

export const runLLMRequest = async <T>(
  args: RunLLMRequestArgs<T>,
): Promise<T> => {
  const maxAttempts = args.retries ?? LLM_TIMEOUT_RETRIES;
  const timeoutMs = args.timeoutMs ?? LLM_TIMEOUT_MS;
  let lastError: unknown;
  const createAbortError = () => {
    const error = new Error("LLM request aborted");
    error.name = "AbortError";
    return error;
  };
  const isAbortError = (error: unknown) =>
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (args.signal?.aborted) {
      throw createAbortError();
    }
    const startedAt = Date.now();
    args.onStart?.({
      task: args.task,
      attempt,
      maxAttempts,
      startedAt,
    });
    const attemptController = args.abortOnTimeout ? new AbortController() : null;
    const attemptSignal = attemptController?.signal ?? args.signal;
    const relayAbort = () => attemptController?.abort(args.signal?.reason);
    if (attemptController && args.signal) {
      args.signal.addEventListener("abort", relayAbort, { once: true });
      if (args.signal.aborted) relayAbort();
    }
    try {
      if (attemptController?.signal.aborted) throw createAbortError();
      const result = await withTimeout(
        args.run(attemptSignal),
        timeoutMs,
        attemptSignal ?? undefined,
      );
      const finishedAt = Date.now();
      args.onFinish?.({
        task: args.task,
        attempt,
        maxAttempts,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        status: "success",
      });
      return result;
    } catch (error) {
      // Abort the underlying transport before reporting the timeout or retrying.
      // The outer operation signal stays usable for later explicit requests.
      if (error instanceof TimeoutError) attemptController?.abort(error);
      lastError = error;
      const finishedAt = Date.now();
      const aborted = isAbortError(error);
      args.onFinish?.({
        task: args.task,
        attempt,
        maxAttempts,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        status: error instanceof TimeoutError ? "timeout" : "error",
      });
      if (aborted) {
        throw error;
      }
      if (error instanceof TimeoutError) {
        if (attempt < maxAttempts) {
          args.onTimeout?.({
            attempt: attempt + 1,
            maxAttempts,
            error,
            task: args.task,
          });
          continue;
        }
      }
      throw error;
    } finally {
      if (attemptController && args.signal) {
        args.signal.removeEventListener("abort", relayAbort);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LLM request failed for ${args.task}.`);
};
