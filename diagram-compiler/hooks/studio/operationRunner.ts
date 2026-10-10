import type { OperationPhase } from "../../types";
import { runLLMRequest } from "../../services/llmRequestRunner";
import type { LLMRequestStartNotice } from "../../services/llmRequestRunner";
import type { LLMRequestFinishNotice } from "../../services/llmRequestRunner";
import type { StudioContext } from "./actionsContext";
import type { StudioOperationHelpers } from "./runStudioOperation";

type TimeoutNotice = {
  attempt: number;
  maxAttempts: number;
  error: Error;
  task: string;
};

type RunLLMArgs<T> = {
  task: string;
  phase: OperationPhase;
  run: (signal?: AbortSignal | null) => Promise<T>;
  retries: number;
  timeoutMs: number;
  stageTitle?: string;
  stageContextScope?: import("../../types").OperationEvent["contextScope"];
  contextEvent?: {
    title?: string;
    detail: string;
    tooltipMessages?: string;
    tooltipDocs?: string;
    kind?: import("../../types").OperationEvent["kind"];
    contextScope?: import("../../types").OperationEvent["contextScope"];
  };
  onTimeoutDetail?: (notice: TimeoutNotice) => string;
  onStart?: (notice: LLMRequestStartNotice) => void;
  onFinish?: (notice: LLMRequestFinishNotice) => void;
  signal?: AbortSignal | null;
};

export type StudioOperationRunner = {
  runLLM: <T>(args: RunLLMArgs<T>) => Promise<T>;
};

export const createStudioOperationRunner = (
  ctx: Pick<StudioContext, "onLLMRequestStart" | "getAbortSignal"> & {
    aiConfig?: Pick<StudioContext["aiConfig"], "provider">;
  },
  helpers: Pick<StudioOperationHelpers, "logEvent">,
): StudioOperationRunner => {
  const runLLM: StudioOperationRunner["runLLM"] = async (args) => {
    const stageTitle = args.stageTitle;
    const contextEvent = args.contextEvent;
    let stageStarted = false;
    let contextLogged = false;
    const signal = args.signal ?? ctx.getAbortSignal?.() ?? undefined;
    const isOpenCodeGo = ctx.aiConfig?.provider === "opencode-go";

    return runLLMRequest({
      task: args.task,
      run: (attemptSignal) => args.run(attemptSignal ?? signal ?? undefined),
      retries: isOpenCodeGo ? 1 : args.retries,
      abortOnTimeout: isOpenCodeGo,
      timeoutMs: args.timeoutMs,
      signal,
      onStart: (notice) => {
        ctx.onLLMRequestStart?.(notice);
        args.onStart?.(notice);
        if (contextEvent && !contextLogged) {
          contextLogged = true;
          helpers.logEvent({
            phase: args.phase,
            level: "info",
            title: contextEvent.title ?? "Контекст",
            detail: contextEvent.detail,
            tooltipMessages: contextEvent.tooltipMessages,
            tooltipDocs: contextEvent.tooltipDocs,
            kind: contextEvent.kind ?? "context",
            contextScope: contextEvent.contextScope ?? args.stageContextScope,
          });
        }
        helpers.logEvent({
          phase: args.phase,
          level: "info",
          title: "LLM",
          detail: `start ${notice.task}`,
          kind: "status",
          contextScope: args.stageContextScope,
        });
        if (stageTitle && !stageStarted) {
          stageStarted = true;
          helpers.logEvent({
            phase: args.phase,
            level: "info",
            title: stageTitle,
            detail: "generating",
            kind: "status",
            contextScope: args.stageContextScope,
          });
        }
      },
      onTimeout: (notice) => {
        const detail = args.onTimeoutDetail
          ? args.onTimeoutDetail(notice as unknown as TimeoutNotice)
          : `LLM timeout (${notice.attempt}/${notice.maxAttempts})`;
        helpers.logEvent({
          phase: args.phase,
          level: "warn",
          title: "Timeout",
          detail,
          kind: "status",
          contextScope: args.stageContextScope,
        });
      },
      onFinish: (notice) => {
        args.onFinish?.(notice);
        helpers.logEvent({
          phase: args.phase,
          level: notice.status === "success" ? "info" : "warn",
          title: "LLM",
          detail: notice.status,
          metrics: { durationMs: notice.durationMs },
          kind: "status",
          contextScope: args.stageContextScope,
        });
        if (stageTitle && notice.status === "success") {
          helpers.logEvent({
            phase: args.phase,
            level: "info",
            title: stageTitle,
            detail: "ready",
            metrics: { durationMs: notice.durationMs },
            kind: "status",
            contextScope: args.stageContextScope,
          });
        }
      },
    });
  };

  return { runLLM };
};
