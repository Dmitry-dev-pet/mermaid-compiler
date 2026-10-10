import type { Dispatch, SetStateAction } from "react";
import type {
  AIConfig,
  AppState,
  ConnectionState,
  MermaidState,
  Message,
  DiagramIntent,
  DocsMode,
  ModelParams,
  OperationKind,
} from "../../types";
import {
  MermaidMarkdownBlock,
  replaceMermaidBlockInMarkdown,
  validateMermaid,
} from "../../services/mermaidService";
import type { AnalyticsContext } from "../../services/analyticsService";
import { detectLanguage } from "../../utils";
import { normalizeIntentText } from "../../utils/intent";
import type { StepMeta, TimeStepType } from "../../services/history/types";
import type { LLMRequestStartNotice } from "../../services/llmRequestRunner";
import type { HistorySession } from "../../services/history/types";
import type { LLMRequestContext } from "../../services/llm/types";

export type MermaidUpdateTarget =
  | { mode: "markdown"; block: MermaidMarkdownBlock }
  | { mode: "code" };

export type StudioActionsDeps = {
  llmSessionId?: string;
  aiConfig: AIConfig;
  connectionState: ConnectionState;
  appState: AppState;
  modelParams: ModelParams | null;
  isNotebookChatEnabled?: boolean;
  isNotebookChatMode?: boolean;
  mermaidState: MermaidState;
  diagramIntent: DiagramIntent | null;
  setDiagramIntent: Dispatch<SetStateAction<DiagramIntent | null>>;
  setMermaidState: Dispatch<SetStateAction<MermaidState>>;
  addMessage: (
    role: "user" | "assistant",
    content: string,
    mode?: Message["mode"],
  ) => Message;
  getMessages: () => Message[];
  getDiagramContextCode?: () => string;
  getAnalyticsContext: (mode: DocsMode) => Promise<AnalyticsContext>;
  trackAnalyticsEvent?: (
    event: string,
    payload?: Record<string, unknown>,
  ) => void;
  trackAnalyticsWithContext?: (
    event: string,
    mode: DocsMode,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  resolveMermaidUpdateTarget?: () => MermaidUpdateTarget | null;
  getNotebookChatIndex?: () => number | null;
  setIsProcessing: (value: boolean) => void;
  getDocsContext: (mode: DocsMode) => Promise<string>;
  getDocsSelectionSummary?: (mode: DocsMode) => Promise<{
    total: number;
    included: number;
    excluded: number;
    includedPaths: string[];
    excludedPaths: string[];
  }>;
  historySession?: HistorySession | null;
  recordTimeStep: (args: {
    type: TimeStepType;
    messages: Message[];
    meta?: StepMeta;
    nextMermaid?: Pick<
      MermaidState,
      "code" | "isValid" | "errorMessage" | "errorLine"
    > | null;
    setCurrentRevisionId?: string | null;
  }) => Promise<void>;
  startOperation: (
    title: string,
    contextId?: string,
    kind?: OperationKind,
  ) => string;
  addOperationEvent: (
    opId: string,
    args: {
      phase: import("../../types").OperationPhase;
      level: import("../../types").OperationLevel;
      title: string;
      detail?: string;
      diagramType?: import("../../types").DiagramType;
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
  onLLMRequestStart?: (notice: LLMRequestStartNotice) => void;
  getAbortSignal?: () => AbortSignal | null;
};

export type StudioContext = StudioActionsDeps & {
  getRelevantMessages: () => Message[];
  isNotebookChatEnabled: boolean;
  isNotebookChatMode: boolean;
  buildLLMRequestContext: (args: {
    diagramType?: import("../../types").DiagramType;
    allowedDiagramTypes?: import("../../types").DiagramType[] | null;
    docsContext: string;
    language: string;
  }) => LLMRequestContext;
  resolveLanguage: (text?: string) => string;
  resolveAnalyzeLanguage: () => string;
  normalizeText: (text: string) => string;
  getDiagramContextMessage: () => Message | null;
  getIntentMessage: (intentText: string) => Message;
  getCurrentIntent: () => DiagramIntent | null;
  setCurrentIntent: (intent: DiagramIntent | null) => void;
  buildLLMMessages: (relevantMessages: Message[]) => Message[];
  getLastUserText: (relevantMessages: Message[]) => string;
  resolveMermaidUpdate: (
    code: string,
    validation: Awaited<ReturnType<typeof validateMermaid>>,
  ) => Pick<MermaidState, "code" | "isValid" | "errorMessage" | "errorLine">;
  applyCompiledResult: (
    code: string,
    v: Awaited<ReturnType<typeof validateMermaid>>,
  ) => void;
  applyValidationPreservingSource: (
    code: string,
    v: Awaited<ReturnType<typeof validateMermaid>>,
  ) => void;
  getAnalyticsContext: (mode: DocsMode) => Promise<AnalyticsContext>;
  trackAnalyticsEvent: (
    event: string,
    payload?: Record<string, unknown>,
  ) => void;
  trackAnalyticsWithContext: (
    event: string,
    mode: DocsMode,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  getCurrentModelName: () => string;
  getDocsContext: (mode: DocsMode) => Promise<string>;
  getDocsSelectionSummary?: StudioActionsDeps["getDocsSelectionSummary"];
  getNotebookChatIndex?: () => number | null;
  safeRecordTimeStep: StudioActionsDeps["recordTimeStep"];
  onLLMRequestStart?: StudioActionsDeps["onLLMRequestStart"];
  getAbortSignal?: StudioActionsDeps["getAbortSignal"];
  historySession?: StudioActionsDeps["historySession"];
};

export const createStudioContext = (deps: StudioActionsDeps): StudioContext => {
  const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();
  const isStudioStatusMessage = (message: Message) => {
    if (message.role !== "assistant") return false;
    const content = message.content
      .replace(/^\[notebook-block:\d+\]\s*/i, "")
      .trim();
    if (!content) return false;
    const hasStatusHeader =
      /^(Build|Chat|Fix|Analyze|Recompile|Notebook|Planner|Notebook build|Notebook block|Сборка|Чат|Исправление|Анализ|Пересборка|Ноутбук|Планировщик)(:|\s|\n|—)/i.test(
        content,
      );
    if (!hasStatusHeader) return false;
    if (/\n-\s/.test(content)) return true;
    return /(попытк|attempt|auto-?fix|валид|невалид|готов|ready|request|start|failed|done|fallback)/i.test(
      content,
    );
  };

  const getRelevantMessages = () =>
    deps
      .getMessages()
      .filter(
        (m) =>
          m.id !== "init" && m.mode !== "system" && !isStudioStatusMessage(m),
      );
  const isNotebookChatEnabled = deps.isNotebookChatEnabled ?? true;
  const isNotebookChatMode = deps.isNotebookChatMode ?? false;

  const resolveLanguage = (text?: string): string => {
    if (deps.appState.language && deps.appState.language !== "auto") {
      return deps.appState.language;
    }
    const basis =
      text?.trim() ||
      deps
        .getMessages()
        .slice()
        .reverse()
        .find(
          (m) =>
            m.id !== "init" && m.role === "user" && m.content.trim().length > 0,
        )?.content;

    if (!basis) return "English";

    return detectLanguage(basis);
  };

  const resolveAnalyzeLanguage = (): string => {
    const configured = deps.appState.analyzeLanguage;
    if (configured && configured !== "auto") return configured;
    return resolveLanguage();
  };

  const getDiagramContextMessage = (): Message | null => {
    const code = deps.getDiagramContextCode
      ? deps.getDiagramContextCode().trim()
      : deps.mermaidState.code.trim();
    if (!code) return null;

    return {
      id: "diagram-context",
      role: "user",
      content: `Current Mermaid diagram code (context only; do not output Mermaid code in Chat mode and do not repeat this verbatim):
\`\`\`mermaid
${code}
\`\`\``,
      timestamp: Date.now(),
    };
  };

  const getIntentMessage = (intentText: string): Message => ({
    id: "diagram-intent",
    role: "user",
    content: `Intent:\n${normalizeIntentText(intentText)}`,
    timestamp: Date.now(),
  });

  const getCurrentIntent = () => deps.diagramIntent;
  const setCurrentIntent = (intent: DiagramIntent | null) => {
    deps.setDiagramIntent(intent);
  };

  const buildLLMMessages = (relevantMessages: Message[]) => {
    const diagramContext = getDiagramContextMessage();
    return diagramContext
      ? [...relevantMessages, diagramContext]
      : relevantMessages;
  };

  const getLastUserText = (relevantMessages: Message[]) =>
    relevantMessages
      .slice()
      .reverse()
      .find((m) => m.role === "user" && m.content.trim().length > 0)?.content ??
    "";

  const resolveMermaidUpdateTarget = () => {
    return deps.resolveMermaidUpdateTarget?.() ?? null;
  };

  const resolveMermaidCode = (code: string) => {
    const target = resolveMermaidUpdateTarget();
    if (target?.mode === "markdown") {
      return replaceMermaidBlockInMarkdown(
        deps.mermaidState.code,
        target.block,
        code,
      );
    }
    return code;
  };

  const resolveMermaidUpdate = (
    code: string,
    validation: Awaited<ReturnType<typeof validateMermaid>>,
  ): Pick<MermaidState, "code" | "isValid" | "errorMessage" | "errorLine"> => {
    const target = resolveMermaidUpdateTarget();
    if (target?.mode === "markdown") {
      return {
        code: resolveMermaidCode(code),
        isValid: true,
        errorMessage: undefined,
        errorLine: undefined,
      };
    }
    return {
      code,
      isValid: !!validation.isValid,
      errorMessage: validation.errorMessage,
      errorLine: validation.errorLine,
    };
  };

  const applyCompiledResult = (
    code: string,
    v: Awaited<ReturnType<typeof validateMermaid>>,
  ) => {
    const target = resolveMermaidUpdateTarget();
    if (target?.mode === "markdown") {
      const nextCode = replaceMermaidBlockInMarkdown(
        deps.mermaidState.code,
        target.block,
        code,
      );
      deps.setMermaidState((prev) => ({
        ...prev,
        code: nextCode,
        isValid: true,
        lastValidCode: nextCode,
        errorMessage: undefined,
        errorLine: undefined,
        status: nextCode.trim() ? "valid" : "empty",
        source: "compiled",
      }));
      return;
    }

    deps.setMermaidState((prev) => ({
      ...prev,
      code,
      isValid: v.isValid ?? false,
      lastValidCode: v.lastValidCode ?? prev.lastValidCode,
      errorMessage: v.errorMessage,
      errorLine: v.errorLine,
      status: v.isValid ? "valid" : "invalid",
      source: "compiled",
    }));
  };

  const getAnalyticsContext = (mode: DocsMode) => {
    return deps.getAnalyticsContext(mode);
  };

  const trackAnalyticsEvent = (
    event: string,
    payload: Record<string, unknown> = {},
  ) => {
    deps.trackAnalyticsEvent?.(event, payload);
  };

  const trackAnalyticsWithContext = async (
    event: string,
    mode: DocsMode,
    payload: Record<string, unknown> = {},
  ) => {
    if (deps.trackAnalyticsWithContext) {
      await deps.trackAnalyticsWithContext(event, mode, payload);
      return;
    }
    if (!deps.trackAnalyticsEvent) return;
    const context = await deps.getAnalyticsContext(mode);
    deps.trackAnalyticsEvent(event, { ...context, ...payload, mode });
  };

  const applyValidationPreservingSource = (
    code: string,
    v: Awaited<ReturnType<typeof validateMermaid>>,
  ) => {
    deps.setMermaidState((prev) => ({
      ...prev,
      code,
      isValid: v.isValid ?? false,
      lastValidCode: v.lastValidCode ?? prev.lastValidCode,
      errorMessage: v.errorMessage,
      errorLine: v.errorLine,
      status: v.isValid ? "valid" : "invalid",
    }));
  };

  const getCurrentModelName = () => {
    const modelId = deps.aiConfig.selectedModelId;
    return modelId ? `model=${modelId}` : "model=unknown";
  };

  const getNotebookChatIndex = () => deps.getNotebookChatIndex?.() ?? null;

  const buildLLMRequestContext = (args: {
    diagramType?: import("../../types").DiagramType;
    allowedDiagramTypes?: import("../../types").DiagramType[] | null;
    docsContext: string;
    language: string;
  }): LLMRequestContext => {
    const resolvedDiagramType = args.diagramType ?? deps.appState.diagramType;
    const resolvedAllowedDiagramTypes =
      args.allowedDiagramTypes ??
      (resolvedDiagramType === "auto" ? deps.appState.mainDiagramTypes : null);
    return {
      sessionId: deps.llmSessionId,
      chatGptAccountId: deps.connectionState.chatGptAccountId,
      diagramType: resolvedDiagramType,
      allowedDiagramTypes: resolvedAllowedDiagramTypes,
      docsContext: args.docsContext,
      language: args.language,
      thinkingStyle: deps.appState.thinkingStyle,
    };
  };

  const safeRecordTimeStep: StudioActionsDeps["recordTimeStep"] = async (
    args,
  ) => {
    try {
      await deps.recordTimeStep(args);
    } catch (e) {
      console.error("Failed to record history step", e);
    }
  };

  return {
    ...deps,
    getRelevantMessages,
    isNotebookChatEnabled,
    isNotebookChatMode,
    buildLLMRequestContext,
    resolveLanguage,
    resolveAnalyzeLanguage,
    normalizeText,
    getDiagramContextMessage,
    getIntentMessage,
    getCurrentIntent,
    setCurrentIntent,
    buildLLMMessages,
    getLastUserText,
    resolveMermaidUpdate,
    applyCompiledResult,
    applyValidationPreservingSource,
    getAnalyticsContext,
    trackAnalyticsEvent,
    trackAnalyticsWithContext,
    getCurrentModelName,
    getNotebookChatIndex,
    safeRecordTimeStep,
  };
};
