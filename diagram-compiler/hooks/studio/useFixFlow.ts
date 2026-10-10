import { useCallback, type Dispatch, type SetStateAction } from "react";
import { AUTO_FIX_MAX_ATTEMPTS, LLM_TIMEOUT_RETRIES } from "../../constants";
import { detectLanguage } from "../../utils";
import type {
  AIConfig,
  MermaidState,
  ModelParams,
  Message,
  DiagramType,
} from "../../types";
import {
  extractMermaidBlocksFromMarkdown,
  extractMermaidCode,
  replaceMermaidBlockInMarkdown,
  validateMermaidDiagramCode,
} from "../../services/mermaidService";
import type { MermaidMarkdownBlock } from "../../services/mermaidService";
import { fixDiagram } from "../../services/llmService";
import type { LLMRequestStartNotice } from "../../services/llmRequestRunner";
import { runAutoFixLoop } from "./autoFix";
import { buildSystemPrompt } from "../../services/llm/prompts";
import { buildContextEventForLog } from "./logContextUtils";
import { toRunnerContextEvent } from "./operationTracer";
import { summarizeFixOutcome as buildFixSummary } from "./fixSummary";
import {
  collectMermaidProblems,
  explainMermaidProblemFix,
  getMermaidProblemLabels,
} from "../../utils/mermaidProblems";
import {
  createStudioOperationRunner,
  type StudioOperationRunner,
} from "./operationRunner";
import {
  fetchDiagramSyntaxDoc,
  formatDocsContext,
} from "../../services/docsContextService";
import { DIAGRAM_TYPES, normalizeDiagramType } from "../../utils/diagramTypes";
import { augmentMermaidErrorForAutoFix } from "../../utils/mermaidAutoFixHints";
import { sanitizeMermaidByType } from "../../utils/mermaidSanitizer";

type FixFlowDeps = {
  aiConfig: AIConfig;
  modelParams: ModelParams | null;
  appDiagramType: DiagramType | null;
  thinkingStyle?: import("../../types").ThinkingStyle;
  buildLLMRequestContext?: (args: {
    diagramType?: DiagramType;
    allowedDiagramTypes?: DiagramType[] | null;
    docsContext: string;
    language: string;
  }) => import("../../services/llm/types").LLMRequestContext;
  connectionStatus: string;
  messages: Array<{ id: string; role: string; content: string }>;
  mermaidState: MermaidState;
  markdownMermaidBlocks: Array<{ code: string; diagramType?: string | null }>;
  markdownMermaidDiagnostics: Array<{
    isValid?: boolean;
    errorMessage?: string;
    errorLine?: number;
  }>;
  markdownMermaidActiveIndex: number;
  setMarkdownMermaidActiveIndex: (index: number) => void;
  handleMermaidChange: (code: string) => void;
  addMessage: (
    role: "assistant" | "user",
    content: string,
    mode?: string,
  ) => { id: string; role: string; content: string };
  setMessages: Dispatch<SetStateAction<Message[]>>;
  safeAppendTimeStep: (args: {
    type: string;
    messages: Array<{ id: string; role: string; content: string }>;
    nextMermaid?: {
      code: string;
      isValid: boolean;
      errorMessage?: string;
      errorLine?: number;
    };
    setCurrentRevisionId?: string | null | undefined;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
  getDocsContext: (mode: "fix") => Promise<string>;
  getDocsSelectionSummary?: (mode: "fix") => Promise<{
    total: number;
    included: number;
    excluded: number;
    includedPaths: string[];
    excludedPaths: string[];
  }>;
  trackAnalyticsWithContext: (
    event: string,
    mode: "fix",
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  setIsProcessing: (value: boolean) => void;
  baseHandleFixSyntax: () => Promise<void>;
  onLLMRequestStart?: (notice: LLMRequestStartNotice) => void;
  getAbortSignal?: () => AbortSignal | null;
  llmTimeoutMs: number;
  startOperation: (
    title: string,
    contextId?: string,
    kind?: import("../../types").OperationKind,
  ) => string;
  addOperationEvent: (
    opId: string,
    args: {
      phase: import("../../types").OperationPhase;
      level: import("../../types").OperationLevel;
      title: string;
      detail?: string;
      diagramType?: DiagramType;
      tooltip?: string;
      tooltipMessages?: string;
      tooltipDocs?: string;
      kind?: import("../../types").OperationEvent["kind"];
      contextScope?: import("../../types").OperationEvent["contextScope"];
      blockIndex?: number;
      attempt?: import("../../types").OperationEvent["attempt"];
      metrics?: import("../../types").OperationEvent["metrics"];
      error?: import("../../types").OperationEvent["error"];
    },
  ) => void;
  finishOperation: (
    opId: string,
    status: import("../../types").OperationLog["status"],
  ) => void;
  getOperationLog: (opId: string) => import("../../types").OperationLog | null;
};

type FixBlockMode = "block" | "markdown_all";

const buildFixBlockLabel = (
  index: number,
  total: number,
  diagramType: string | null,
) => {
  return `${index + 1}/${total} - ${diagramType ?? "unknown"} - Fix block`;
};

const resolveFixDiagramType = (
  block: MermaidMarkdownBlock,
  appDiagramType: DiagramType | null,
) => {
  return (
    block.diagramType ?? normalizeDiagramType(appDiagramType ?? "") ?? null
  );
};

export const useFixFlow = (deps: FixFlowDeps) => {
  const coerceToDiagramType = useCallback(
    (value: string | null | undefined): DiagramType | null => {
      const normalized = normalizeDiagramType(value ?? "") ?? null;
      if (!normalized) return null;
      const known = (DIAGRAM_TYPES as readonly string[]).includes(normalized);
      return known ? (normalized as DiagramType) : null;
    },
    [],
  );
  const resolveFixLanguage = useCallback(() => {
    const basis = deps.messages
      .slice()
      .reverse()
      .find(
        (m) =>
          m.id !== "init" && m.role === "user" && m.content.trim().length > 0,
      )?.content;
    if (!basis) return "English";
    return detectLanguage(basis);
  }, [deps.messages]);

  const summarizeFixOutcome = useCallback(buildFixSummary, []);

  const runMarkdownFix = useCallback(
    async (args: {
      runner: StudioOperationRunner;
      contextEvent?: ReturnType<typeof buildContextEventForLog>;
      block: MermaidMarkdownBlock;
      markdown: string;
      docs: string;
      language: string;
      initialValidation: Awaited<ReturnType<typeof validateMermaidDiagramCode>>;
      onAttempt?: (
        attempt: number,
        validation: Awaited<ReturnType<typeof validateMermaidDiagramCode>>,
      ) => void;
    }) => {
      const {
        runner,
        contextEvent,
        block,
        markdown,
        docs,
        language,
        initialValidation,
        onAttempt,
      } = args;
      let iteration = 0;
      let contextSent = false;
      const {
        code: currentCode,
        validation,
        attempts,
      } = await runAutoFixLoop({
        initialCode: block.code,
        initialValidation,
        maxAttempts: AUTO_FIX_MAX_ATTEMPTS,
        validate: (code) =>
          validateMermaidDiagramCode(code, { logError: false }),
        fix: async (code, errorMessage) => {
          const enrichedErrorMessage = augmentMermaidErrorForAutoFix(
            (block.diagramType ?? deps.appDiagramType ?? "auto") as DiagramType,
            errorMessage,
          );
          const fixInput = sanitizeMermaidByType(
            (block.diagramType ?? deps.appDiagramType ?? "auto") as DiagramType,
            code,
          );
          const fixedRaw = await runner.runLLM({
            task: "markdown-fix",
            phase: "fix",
            run: (signal) =>
              fixDiagram(
                fixInput,
                enrichedErrorMessage,
                deps.aiConfig,
                deps.buildLLMRequestContext
                  ? deps.buildLLMRequestContext({
                      diagramType: (block.diagramType ?? deps.appDiagramType ?? "auto") as DiagramType,
                      docsContext: docs,
                      language,
                    })
                  : {
                      diagramType: (block.diagramType ?? deps.appDiagramType ?? "auto") as DiagramType,
                      docsContext: docs,
                      language,
                      thinkingStyle: deps.thinkingStyle,
                    },
                deps.modelParams,
                signal,
              ),
            retries: LLM_TIMEOUT_RETRIES,
            timeoutMs: deps.llmTimeoutMs,
            stageContextScope: "block",
            contextEvent:
              contextEvent && !contextSent
                ? toRunnerContextEvent(contextEvent)
                : undefined,
          });
          contextSent = true;
          return extractMermaidCode(fixedRaw);
        },
        onIteration: (_code, nextValidation) => {
          if (iteration > 0) {
            onAttempt?.(iteration, nextValidation);
          }
          iteration += 1;
        },
      });

      const changed = currentCode !== block.code;
      const cleared = !currentCode.trim();
      const nextMarkdown =
        changed || cleared
          ? replaceMermaidBlockInMarkdown(markdown, block, currentCode)
          : markdown;

      const nextMermaid =
        changed || cleared
          ? {
              code: nextMarkdown,
              isValid: true,
              errorMessage: undefined,
              errorLine: undefined,
            }
          : null;

      return {
        currentCode,
        validation,
        attempts,
        changed,
        cleared,
        nextMarkdown,
        nextMermaid,
      };
    },
    [deps],
  );

  const runBlockFix = useCallback(
    async (args: {
      block: MermaidMarkdownBlock;
      blockIndex: number;
      totalBlocks: number;
      markdown: string;
      initialValidation: Awaited<ReturnType<typeof validateMermaidDiagramCode>>;
      fixMode: FixBlockMode;
      opId: string;
      logEvent: (args: Parameters<typeof deps.addOperationEvent>[1]) => void;
      onMarkdownChange: (nextMarkdown: string) => void;
      durationStart?: number;
    }) => {
      const {
        block,
        blockIndex,
        totalBlocks,
        markdown,
        initialValidation,
        fixMode,
        opId,
        logEvent,
        onMarkdownChange,
        durationStart,
      } = args;
      const diagramType = resolveFixDiagramType(
        block,
        deps.appDiagramType ?? null,
      );
      const diagramTypeForContext =
        coerceToDiagramType(diagramType) ?? deps.appDiagramType ?? "auto";
      const runner = createStudioOperationRunner(
        {
          aiConfig: deps.aiConfig,
          onLLMRequestStart: deps.onLLMRequestStart,
          getAbortSignal: deps.getAbortSignal,
        },
        {
          logEvent: (eventArgs) => {
            logEvent({ ...eventArgs, blockIndex });
          },
        },
      );
      const docsSelection = await deps.getDocsSelectionSummary?.("fix");
      const diagramTypeForDocs = coerceToDiagramType(diagramType);
      const syntaxDoc = diagramTypeForDocs
        ? await fetchDiagramSyntaxDoc(diagramTypeForDocs)
        : { text: "", path: null };
      const docsEntries = syntaxDoc.path
        ? [{ path: syntaxDoc.path, text: syntaxDoc.text }]
        : [];
      const docs = docsEntries.length
        ? formatDocsContext(docsEntries)
        : await deps.getDocsContext("fix");
      const language = resolveFixLanguage();
      const label = buildFixBlockLabel(blockIndex, totalBlocks, diagramType);
      const labels = getMermaidProblemLabels(language);
      const problemTitle = labels.problem;
      const beforeLabel = labels.before;
      const afterLabel = labels.after;
      const fixLabel = labels.fix;
      const maxProblems = 3;

      logEvent({
        phase: "fix",
        level: "info",
        title: "Block",
        detail: label,
        blockIndex,
        kind: "block",
        contextScope: "block",
      });
      const mergedProblems = await collectMermaidProblems({
        diagramType: diagramTypeForContext,
        code: block.code,
        language,
        maxProblems,
        parserMax: 1,
      });
      logEvent({
        phase: "fix",
        level: "info",
        title: "Fix",
        detail: `язык: ${language}`,
      });

      const fixMessage: Message = {
        id: `fix-input-${blockIndex + 1}`,
        role: "user",
        content: [
          "Code:",
          "```mermaid",
          block.code,
          "```",
          "",
          "Error:",
          (initialValidation.errorMessage ?? "").trim() ||
            (initialValidation.isValid === false
              ? "Validation error"
              : "Unknown error"),
        ].join("\n"),
        timestamp: Date.now(),
      };
      const systemPrompt = buildSystemPrompt(
        "fix",
        deps.buildLLMRequestContext
          ? deps.buildLLMRequestContext({
              diagramType: diagramTypeForContext,
              docsContext: "Documentation context redacted.",
              language,
            })
          : {
              diagramType: diagramTypeForContext,
              docsContext: "Documentation context redacted.",
              language,
              thinkingStyle: deps.thinkingStyle,
            },
      );
      const fixContextEvent = buildContextEventForLog({
        phase: "fix",
        contextScope: "block",
        diagramType: diagramTypeForContext,
        systemPrompt,
        messages: [fixMessage],
        docsContext: docs,
        selectionSummary: docsEntries.length
          ? { includedPaths: docsEntries.map((entry) => entry.path) }
          : docsSelection
            ? { includedPaths: docsSelection.includedPaths }
            : null,
      });
      await deps.trackAnalyticsWithContext("diagram_fix_started", "fix", {
        diagramType,
        mode: "fix",
        codeLength: block.code.length,
      });

      const {
        currentCode,
        validation,
        attempts,
        changed,
        cleared,
        nextMarkdown,
        nextMermaid,
      } = await runMarkdownFix({
        runner,
        contextEvent: fixContextEvent,
        block,
        markdown,
        docs,
        language,
        initialValidation,
        onAttempt: (attempt, nextValidation) => {
          logEvent({
            phase: "fix",
            level: "info",
            title: "Auto-fix",
            detail: `attempt ${attempt}/${AUTO_FIX_MAX_ATTEMPTS}`,
            blockIndex,
            attempt: { current: attempt, max: AUTO_FIX_MAX_ATTEMPTS },
            kind: "attempt",
            contextScope: "block",
          });
          if (nextValidation.errorMessage) {
            const line =
              nextValidation.errorMessage.split(/\r?\n/)[0]?.slice(0, 200) ??
              "";
            if (line) {
              logEvent({
                phase: "fix",
                level: "warn",
                title: "Auto-fix error",
                detail: line,
                blockIndex,
                attempt: { current: attempt, max: AUTO_FIX_MAX_ATTEMPTS },
                error: { code: "validation", message: line },
                kind: "attempt",
                contextScope: "block",
              });
            }
          }
        },
      });

      if (changed || cleared) {
        onMarkdownChange(nextMarkdown);
      }

      logEvent({
        phase: "validate",
        level: validation.isValid ? "info" : "warn",
        title: "Block validation",
        detail: validation.isValid ? "valid" : "invalid",
        blockIndex,
        metrics: attempts ? { autoFix: attempts } : undefined,
        kind: "block",
        contextScope: "block",
      });
      if (changed && !cleared && mergedProblems.length) {
        const afterLines = currentCode.split(/\r?\n/);
        mergedProblems.slice(0, maxProblems).forEach((problem, index) => {
          const afterLine = afterLines[problem.line - 1] ?? "";
          const explanation = explainMermaidProblemFix({
            diagramType: diagramTypeForContext,
            language,
            message: problem.message,
            beforeLine: problem.beforeLine,
            afterLine,
          });
          const detail = [
            `#${index + 1} (line ${problem.line}): ${problem.message}`,
            `${beforeLabel}: ${problem.beforeLine || "(empty)"}`,
            `${afterLabel}: ${afterLine || "(empty)"}`,
            explanation ? `${fixLabel}: ${explanation}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          logEvent({
            phase: "fix",
            level: "warn",
            title: problemTitle,
            detail,
            blockIndex,
            diagramType: diagramTypeForContext,
            contextScope: "block",
          });
        });
      }
      if (!validation.isValid) {
        const line =
          validation.errorMessage?.split(/\r?\n/)[0]?.slice(0, 200) ??
          "validation error";
        logEvent({
          phase: "validate",
          level: "error",
          title: "Ошибка",
          detail: line,
          blockIndex,
          error: { code: "validation", message: line },
          kind: "block",
          contextScope: "block",
        });
      }

      const resultMessage = deps.addMessage(
        "assistant",
        summarizeFixOutcome({
          indexLabel: `блок ${blockIndex + 1}${fixMode === "markdown_all" ? ` из ${totalBlocks}` : ""}`,
          attempts,
          changed,
          cleared,
          wasValid: !!validation.isValid,
          errorMessage: initialValidation.errorMessage,
          finalErrorMessage: validation.errorMessage,
          before: block.code,
          after: currentCode,
        }),
        "fix",
      );

      const shouldStop = fixMode === "markdown_all" && !validation.isValid;
      const stopMessage = shouldStop
        ? deps.addMessage(
            "assistant",
            `Fix остановлен после блока ${blockIndex + 1}: исправление не удалось.`,
            "fix",
          )
        : null;

      await deps.safeAppendTimeStep({
        type: "fix",
        messages: [resultMessage, stopMessage].filter(Boolean) as Message[],
        nextMermaid,
        setCurrentRevisionId: cleared ? null : undefined,
        meta: {
          attempts,
          changed,
          isValid: !!validation.isValid,
          cleared,
          diagramType,
          mode: "notebook",
          fixMode,
          blockIndex,
          totalBlocks,
          stopped: shouldStop ? true : undefined,
          operationLog: deps.getOperationLog(opId),
        },
      });

      if (!shouldStop && (fixMode === "block" || validation.isValid)) {
        await deps.trackAnalyticsWithContext("diagram_fix_success", "fix", {
          diagramType,
          mode: "fix",
          attempts,
          changed,
          cleared,
          isValid: !!validation.isValid,
          durationMs: durationStart ? Date.now() - durationStart : undefined,
          codeLength: currentCode.length,
          errorLine: validation.errorLine,
        });
      }

      return {
        currentCode,
        validation,
        attempts,
        changed,
        cleared,
        nextMarkdown,
        nextMermaid,
        shouldStop,
        diagramType,
      };
    },
    [
      coerceToDiagramType,
      deps,
      resolveFixLanguage,
      runMarkdownFix,
      summarizeFixOutcome,
    ],
  );

  const handleFixAllMarkdownBlocks = useCallback(async () => {
    if (deps.connectionStatus !== "connected") {
      deps.addMessage(
        "assistant",
        "Не могу запустить Fix: подключите AI.",
        "fix",
      );
      await deps.safeAppendTimeStep({
        type: "fix",
        messages: [],
        meta: { error: "offline", mode: "markdown_all" },
      });
      return;
    }

    const startedAt = Date.now();
    const opId = deps.startOperation("Fix", undefined, "fix");
    const logEvent = (args: Parameters<typeof deps.addOperationEvent>[1]) => {
      deps.addOperationEvent(opId, args);
    };
    deps.setIsProcessing(true);
    try {
      const language = resolveFixLanguage();
      let markdown = deps.mermaidState.code;
      let blocks = extractMermaidBlocksFromMarkdown(markdown);
      logEvent({
        phase: "fix",
        level: "info",
        title: "Fix",
        detail: `all blocks: ${blocks.length}, язык: ${language}`,
      });
      const applyMarkdownChange = (nextMarkdown: string) => {
        deps.handleMermaidChange(nextMarkdown);
        markdown = nextMarkdown;
        blocks = extractMermaidBlocksFromMarkdown(markdown);
      };
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        const initialValidation = await validateMermaidDiagramCode(block.code, {
          logError: false,
        });
        if (initialValidation.isValid !== false) continue;

        deps.setMarkdownMermaidActiveIndex(i);
        const totalBlocks = blocks.length;
        const result = await runBlockFix({
          block,
          blockIndex: i,
          totalBlocks,
          markdown,
          initialValidation,
          fixMode: "markdown_all",
          opId,
          logEvent,
          onMarkdownChange: applyMarkdownChange,
          durationStart: startedAt,
        });
        if (result.shouldStop) {
          deps.finishOperation(opId, "error");
          return;
        }
      }
      deps.finishOperation(opId, "done");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      deps.addMessage("assistant", `Fix failed: ${message}`, "fix");
      deps.finishOperation(opId, "error");
      await deps.trackAnalyticsWithContext("diagram_fix_failed", "fix", {
        mode: "fix",
        error: "exception",
        durationMs: Date.now() - startedAt,
      });
      await deps.safeAppendTimeStep({
        type: "fix",
        messages: [],
        meta: { error: message, mode: "markdown_all" },
      });
    } finally {
      deps.setIsProcessing(false);
    }
  }, [deps, runBlockFix, resolveFixLanguage]);

  const handleFixSyntax = useCallback(async () => {
    const activeBlock =
      deps.markdownMermaidBlocks[deps.markdownMermaidActiveIndex];
    const activeDiagnostics =
      deps.markdownMermaidDiagnostics[deps.markdownMermaidActiveIndex];
    const shouldFixMarkdownBlock =
      !!activeBlock && activeDiagnostics?.isValid === false;
    const firstInvalidIndex = deps.markdownMermaidDiagnostics.findIndex(
      (diag) => diag?.isValid === false,
    );
    const invalidCount = deps.markdownMermaidDiagnostics.filter(
      (diag) => diag?.isValid === false,
    ).length;
    const fallbackInvalidBlock =
      firstInvalidIndex >= 0
        ? deps.markdownMermaidBlocks[firstInvalidIndex]
        : undefined;
    const fallbackInvalidDiagnostics =
      firstInvalidIndex >= 0
        ? deps.markdownMermaidDiagnostics[firstInvalidIndex]
        : undefined;

    if (invalidCount > 1 && deps.markdownMermaidBlocks.length > 0) {
      await handleFixAllMarkdownBlocks();
      return;
    }

    const targetBlock = shouldFixMarkdownBlock
      ? activeBlock
      : fallbackInvalidBlock;
    const targetDiagnostics = shouldFixMarkdownBlock
      ? activeDiagnostics
      : fallbackInvalidDiagnostics;
    const targetIndex = shouldFixMarkdownBlock
      ? deps.markdownMermaidActiveIndex
      : firstInvalidIndex;

    if (!targetBlock || targetDiagnostics?.isValid !== false) {
      await deps.baseHandleFixSyntax();
      return;
    }

    if (
      !shouldFixMarkdownBlock &&
      firstInvalidIndex >= 0 &&
      firstInvalidIndex !== deps.markdownMermaidActiveIndex
    ) {
      deps.setMarkdownMermaidActiveIndex(firstInvalidIndex);
    }

    if (deps.connectionStatus !== "connected") {
      deps.addMessage(
        "assistant",
        "Не могу запустить Fix: подключите AI.",
        "fix",
      );
      await deps.trackAnalyticsWithContext("diagram_fix_failed", "fix", {
        mode: "fix",
        error: "offline",
        diagramType: targetBlock.diagramType ?? deps.appDiagramType,
      });
      await deps.safeAppendTimeStep({
        type: "fix",
        messages: [],
        meta: {
          error: "offline",
          diagramType: targetBlock.diagramType ?? deps.appDiagramType,
        },
      });
      return;
    }

    const startedAt = Date.now();
    const opId = deps.startOperation("Fix", undefined, "fix");
    const logEvent = (args: Parameters<typeof deps.addOperationEvent>[1]) => {
      deps.addOperationEvent(opId, args);
    };
    deps.setIsProcessing(true);
    try {
      const initialValidation = await validateMermaidDiagramCode(
        targetBlock.code,
        { logError: false },
      );
      const totalBlocks = deps.markdownMermaidBlocks.length;
      const result = await runBlockFix({
        block: targetBlock,
        blockIndex: targetIndex,
        totalBlocks,
        markdown: deps.mermaidState.code,
        initialValidation,
        fixMode: "block",
        opId,
        logEvent,
        onMarkdownChange: (nextMarkdown) =>
          deps.handleMermaidChange(nextMarkdown),
        durationStart: startedAt,
      });
      deps.finishOperation(opId, result.validation.isValid ? "done" : "error");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      deps.addMessage("assistant", `Fix failed: ${message}`, "fix");
      await deps.trackAnalyticsWithContext("diagram_fix_failed", "fix", {
        mode: "fix",
        error: "exception",
        durationMs: Date.now() - startedAt,
      });
      await deps.safeAppendTimeStep({
        type: "fix",
        messages: [],
        meta: { error: message },
      });
      deps.finishOperation(opId, "error");
    } finally {
      deps.setIsProcessing(false);
    }
  }, [deps, handleFixAllMarkdownBlocks, runBlockFix]);

  return {
    handleFixSyntax,
    handleFixAllMarkdownBlocks,
    summarizeFixOutcome,
  };
};
