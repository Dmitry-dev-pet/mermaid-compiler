import {
  detectMermaidDiagramType,
  extractMermaidCode,
  parseMermaidJsonResponse,
  prepareMermaid,
  validateMermaid,
  validatePreparedMermaid,
} from "../../services/mermaidService";
import { generateDiagram, fixDiagram } from "../../services/llmService";
import { runAttemptLoop } from "./retry";
import { runAutoFixLoop } from "./autoFix";
import { runLLMRequest } from "../../services/llmRequestRunner";
import { LLM_TIMEOUT_MS, LLM_TIMEOUT_RETRIES } from "../../constants";
import {
  formatMermaidErrorLine,
  sanitizeMermaidByType,
} from "../../utils/mermaidSanitizer";
import { augmentMermaidErrorForAutoFix } from "../../utils/mermaidAutoFixHints";
import type { AIConfig, DiagramType, Message, ModelParams, ThinkingStyle } from "../../types";
import type { LLMRequestContext } from "../../services/llm/types";
import { shouldStopOpenCodeGoOperation } from "../../services/llm/openCodeGoClient";
import type { StudioOperationRunner } from "./operationRunner";

const parseHttpStatusFromErrorMessage = (message: string): number | null => {
  const apiMatch = message.match(/API Error\s*\((\d{3})\b/);
  if (apiMatch) return Number(apiMatch[1]);
  const codeMatch = message.match(/\bcode=(\d{3})\b/);
  if (codeMatch) return Number(codeMatch[1]);
  const jsonCodeMatch = message.match(/"code"\s*:\s*(\d{3})\b/);
  if (jsonCodeMatch) return Number(jsonCodeMatch[1]);
  return null;
};

const shouldRetryBuildAttemptOnError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const status = parseHttpStatusFromErrorMessage(message);
  if (status && status >= 400 && status < 500) {
    return false;
  }
  return true;
};

type BuildAttemptCallbacks = {
  onAttempt?: (attempt: number, maxAttempts: number) => void;
  onEmpty?: (attempt: number, maxAttempts: number) => void;
  onError?: (attempt: number, maxAttempts: number, message: string) => void;
  onJsonStatus?: (attempt: number, status: string, reason?: string) => void;
  onTypeMismatch?: (
    attempt: number,
    expected: DiagramType,
    received: string,
  ) => void;
};

type BuildAutoFixCallbacks = {
  onAutoFixAttempt?: (
    attempt: number,
    maxAttempts: number,
    errorLine?: string,
  ) => void;
  onAutoFixIteration?: (
    code: string,
    validation: Awaited<ReturnType<typeof validateMermaid>>,
  ) => void;
};

type BuildValidationCallbacks = {
  onValidation?: (isValid: boolean, autoFixAttempts: number) => void;
  onValidationError?: (errorLine: string) => void;
};

type BuildPipelineOptions = {
  sessionId?: string;
  aiConfig: AIConfig;
  modelParams?: ModelParams | null;
  diagramType: DiagramType;
  llmMessages: Message[];
  docs: string;
  language: string;
  thinkingStyle?: ThinkingStyle;
  maxAttempts: number;
  autoFixMaxAttempts: number;
  buildRequestRetries?: number;
  autoFixRequestRetries?: number;
  timeoutMs?: number;
  fallbackCode?: string | null;
  allowFallback?: boolean;
  callbacks?: BuildAttemptCallbacks &
    BuildAutoFixCallbacks &
    BuildValidationCallbacks;
  onLLMRequestStart?: (
    notice: import("../../services/llmRequestRunner").LLMRequestStartNotice,
  ) => void;
  runner?: StudioOperationRunner;
  stageContextScope?: import("../../types").OperationEvent["contextScope"];
  contextEvent?: {
    title?: string;
    detail: string;
    tooltipMessages?: string;
    tooltipDocs?: string;
    kind?: import("../../types").OperationEvent["kind"];
    contextScope?: import("../../types").OperationEvent["contextScope"];
  };
};

type BuildPipelineResult = {
  status: "ok" | "error";
  code: string;
  validation: Awaited<ReturnType<typeof validateMermaid>>;
  autoFixAttempts: number;
  attempts: number;
  emptyResponses: number;
  usedFallback: boolean;
  lastError?: string;
};

export const getFallbackMermaid = (diagramType: DiagramType): string | null => {
  switch (diagramType) {
    case "flowchart":
      return ["flowchart TD", 'A["Start"] --> B["End"]'].join("\n");
    case "sequence":
      return [
        "sequenceDiagram",
        "participant A as User",
        "participant B as System",
        "A->>B: Request",
        "B-->>A: Response",
      ].join("\n");
    case "er":
      return [
        "erDiagram",
        "USER ||--o{ ORDER : places",
        "USER {",
        "  int id",
        "}",
        "ORDER {",
        "  int id",
        "}",
      ].join("\n");
    case "architecture":
      return [
        "architecture-beta",
        "  service client(server)[Client]",
        "  service proxy(server)[Proxy]",
        "  service target(server)[Target]",
        "  client:R -- L:proxy",
        "  proxy:R -- L:target",
      ].join("\n");
    default:
      return null;
  }
};

export const runBuildPipeline = async (
  options: BuildPipelineOptions,
): Promise<BuildPipelineResult> => {
  const {
    sessionId,
    aiConfig,
    modelParams,
    diagramType,
    llmMessages,
    docs,
    language,
    thinkingStyle,
    maxAttempts,
    autoFixMaxAttempts,
    buildRequestRetries = 1,
    autoFixRequestRetries = LLM_TIMEOUT_RETRIES,
    timeoutMs,
    fallbackCode,
    allowFallback = true,
    callbacks,
    onLLMRequestStart,
    runner,
    stageContextScope,
    contextEvent,
  } = options;
  let currentAttempt = 0;
  let suppressEmpty = false;
  let contextSent = false;
  let goStopError: Error | null = null;
  const attemptResult = await runAttemptLoop({
    maxAttempts,
    onAttempt: (attempt) => {
      currentAttempt = attempt;
      callbacks?.onAttempt?.(attempt, maxAttempts);
    },
    onEmpty: (attempt) => {
      if (suppressEmpty) {
        suppressEmpty = false;
        return;
      }
      callbacks?.onEmpty?.(attempt, maxAttempts);
    },
    onError: (attempt, error) => {
      if (aiConfig.provider === 'opencode-go' && shouldStopOpenCodeGoOperation(error)) goStopError = error;
      const message = error instanceof Error ? error.message : String(error);
      callbacks?.onError?.(attempt, maxAttempts, message);
    },
    shouldRetryOnError: (_attempt, error) =>
      !(aiConfig.provider === 'opencode-go' && shouldStopOpenCodeGoOperation(error)) && shouldRetryBuildAttemptOnError(error),
    execute: async () => {
      const requestContext: LLMRequestContext = {
        sessionId,
        diagramType,
        docsContext: docs,
        language,
        thinkingStyle,
      };
      const rawCode = runner
        ? await runner.runLLM({
            task: "build",
            phase: "build",
            run: (signal) =>
              generateDiagram(
                llmMessages,
                aiConfig,
                requestContext,
                modelParams,
                signal,
              ),
            retries: buildRequestRetries,
            timeoutMs: timeoutMs ?? LLM_TIMEOUT_MS,
            stageContextScope,
            contextEvent:
              contextEvent && !contextSent ? contextEvent : undefined,
          })
        : await runLLMRequest({
            task: "build",
            run: (signal) =>
              generateDiagram(
                llmMessages,
                aiConfig,
                requestContext,
                modelParams,
                signal,
              ),
            retries: aiConfig.provider === "opencode-go" ? 1 : buildRequestRetries,
            abortOnTimeout: aiConfig.provider === "opencode-go",
            timeoutMs,
            onStart: onLLMRequestStart,
          });
      contextSent = true;
      const parsed = parseMermaidJsonResponse(rawCode);
      if (parsed) {
        if (parsed.status !== "ok") {
          suppressEmpty = true;
          callbacks?.onJsonStatus?.(
            currentAttempt,
            parsed.status,
            parsed.reason,
          );
          return null;
        }
        if (!parsed.mermaid?.trim()) {
          return null;
        }
        if (
          diagramType !== "auto" &&
          parsed.diagramType &&
          parsed.diagramType !== diagramType
        ) {
          suppressEmpty = true;
          callbacks?.onTypeMismatch?.(
            currentAttempt,
            diagramType,
            parsed.diagramType,
          );
          return null;
        }
        return parsed.mermaid;
      }
      const cleanCode = extractMermaidCode(rawCode);
      if (!cleanCode.trim()) return null;
      if (diagramType !== "auto") {
        const detectedType = detectMermaidDiagramType(cleanCode.trim());
        if (detectedType && detectedType !== diagramType) {
          suppressEmpty = true;
          callbacks?.onTypeMismatch?.(
            currentAttempt,
            diagramType,
            detectedType,
          );
          return null;
        }
      }
      return cleanCode;
    },
  });

  if (goStopError) throw goStopError;

  const resolvedFallback = allowFallback
    ? (fallbackCode ?? getFallbackMermaid(diagramType))
    : (fallbackCode ?? "");
  const resolvedCode =
    attemptResult.value?.trim() || resolvedFallback?.trim() || "";
  const usedFallback = !attemptResult.value?.trim() && !!resolvedFallback;

  if (!resolvedCode) {
    return {
      status: "error",
      code: "",
      validation: await validateMermaid("", { logError: false }),
      autoFixAttempts: 0,
      attempts: attemptResult.attempts,
      emptyResponses: attemptResult.emptyResponses,
      usedFallback: false,
      lastError: attemptResult.lastError ?? "no_mermaid_code",
    };
  }

  const prepared = prepareMermaid(resolvedCode, diagramType);
  const initialValidation = await validatePreparedMermaid(prepared, {
    logError: false,
  });
  let autoFixAttempt = 0;
  const {
    code: currentCode,
    validation,
    attempts: autoFixAttempts,
  } = await runAutoFixLoop({
    initialCode: prepared.sanitizedCode,
    initialValidation,
    maxAttempts: autoFixMaxAttempts,
    validate: (code) =>
      validatePreparedMermaid(prepareMermaid(code, diagramType), {
        logError: false,
      }),
    fix: async (code, errorMessage) => {
      autoFixAttempt += 1;
      const currentAttempt = Math.min(autoFixAttempt, autoFixMaxAttempts);
      const enrichedErrorMessage = augmentMermaidErrorForAutoFix(
        diagramType,
        errorMessage,
      );
      const errorLine = formatMermaidErrorLine(enrichedErrorMessage, 200);
      callbacks?.onAutoFixAttempt?.(
        currentAttempt,
        autoFixMaxAttempts,
        errorLine || undefined,
      );
      const fixInput = prepareMermaid(code, diagramType).sanitizedCode;
      const fixContext: LLMRequestContext = {
        sessionId,
        diagramType,
        docsContext: docs,
        language,
        thinkingStyle,
      };
      const fixedRaw = runner
        ? await runner.runLLM({
            task: "auto-fix",
            phase: "fix",
            run: (signal) =>
              fixDiagram(
                fixInput,
                enrichedErrorMessage,
                aiConfig,
                fixContext,
                modelParams,
                signal,
              ),
            retries: autoFixRequestRetries,
            timeoutMs: timeoutMs ?? LLM_TIMEOUT_MS,
            stageContextScope,
          })
        : await runLLMRequest({
            task: "auto-fix",
            run: (signal) =>
              fixDiagram(
                fixInput,
                enrichedErrorMessage,
                aiConfig,
                fixContext,
                modelParams,
                signal,
              ),
            retries: aiConfig.provider === "opencode-go" ? 1 : autoFixRequestRetries,
            abortOnTimeout: aiConfig.provider === "opencode-go",
            timeoutMs,
            onStart: onLLMRequestStart,
          });
      return sanitizeMermaidByType(diagramType, extractMermaidCode(fixedRaw));
    },
    onIteration: (code, nextValidation) => {
      callbacks?.onAutoFixIteration?.(code, nextValidation);
    },
  });

  callbacks?.onValidation?.(validation.isValid, autoFixAttempts);
  if (!validation.isValid && validation.errorMessage) {
    const errorLine = formatMermaidErrorLine(validation.errorMessage, 180);
    if (errorLine) callbacks?.onValidationError?.(errorLine);
  }

  return {
    status: "ok",
    code: currentCode,
    validation,
    autoFixAttempts,
    attempts: attemptResult.attempts,
    emptyResponses: attemptResult.emptyResponses,
    usedFallback,
    lastError: attemptResult.lastError ?? undefined,
  };
};
