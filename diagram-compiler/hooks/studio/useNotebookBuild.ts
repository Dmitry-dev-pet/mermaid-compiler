import { useCallback } from "react";
import type {
  DiagramIntent,
  DiagramType,
  Message,
  NotebookPlan,
  ModelParams,
} from "../../types";
import { LLM_TIMEOUT_MS } from "../../constants";
import { detectLanguage, generateId } from "../../utils";
import { normalizeIntentText } from "../../utils/intent";
import {
  normalizeSummaryText,
  sanitizeSummaryText,
} from "../../utils/buildSummary";
import { sanitizeMermaidByType } from "../../utils/mermaidSanitizer";
import {
  collectMermaidProblems,
  explainMermaidProblemFix,
  getMermaidProblemLabels,
} from "../../utils/mermaidProblems";
import { NOTEBOOK_BUILD_RETRY_CONFIG } from "./notebookBuildConfig";
import {
  extractMermaidBlocksFromMarkdown,
  replaceMermaidBlockInMarkdown,
  createMermaidNotebookMarkdownFromPlan,
} from "../../services/mermaidService";
import {
  formatDocsContext,
  getNotebookPlannerDocsPaths,
  type DocsEntry,
} from "../../services/docsContextService";
import { planNotebook, summarizeBuild } from "../../services/llmService";
import { buildSystemPrompt } from "../../services/llm/prompts";
import {
  normalizeNotebookPlan,
  parseNotebookPlan,
} from "../../services/notebookPlanService";
import type { LLMRequestContext } from "../../services/llm/types";
import { shouldStopOpenCodeGoOperation } from "../../services/llm/openCodeGoClient";
import { runLLMRequest } from "../../services/llmRequestRunner";
import { TimeoutError } from "../../services/llmTimeout";
import { formatTimeoutRetryMessage } from "./stepMessageUtils";
import { createProgressTracker } from "./progressTracker";
import { runBuildPipeline } from "./buildPipeline";
import {
  createStudioOperationRunner,
  type StudioOperationRunner,
} from "./operationRunner";
import { buildOperationLogViewModel } from "../../components/chat/operationLogUtils";
import {
  buildContextEventForLog,
} from "./logContextUtils";
import { toRunnerContextEvent } from "./operationTracer";
import { buildSelectionLine } from "./selectionLine";

const NOTEBOOK_STYLE_CONSTRAINT_EN =
  "No styling directives or color instructions (no theme/look/init/colors).";
const NOTEBOOK_STYLE_CONSTRAINT_RU =
  "Без стилевых директив и цветовых инструкций (без theme/look/init/colors).";

type NotebookBuildDeps = {
  llmSessionId?: string;
  aiConfig: import("../../types").AIConfig;
  modelParams: ModelParams | null;
  appState: import("../../types").AppState;
  connectionState: import("../../types").ConnectionState;
  messages: Message[];
  diagramIntent: DiagramIntent | null;
  addMessage: (
    role: "user" | "assistant",
    content: string,
    mode?: Message["mode"],
  ) => Message;
  setMessages: import("react").Dispatch<
    import("react").SetStateAction<Message[]>
  >;
  safeAppendTimeStep: (args: {
    type: import("../../services/history/types").TimeStepType;
    messages: Message[];
    meta?: import("../../services/history/types").StepMeta;
    nextMermaid?: Pick<
      import("../../types").MermaidState,
      "code" | "isValid" | "errorMessage" | "errorLine"
    > | null;
    setCurrentRevisionId?: string | null;
  }) => Promise<void>;
  setIsProcessing: (value: boolean) => void;
  setMarkdownMermaidActiveIndex: (value: number) => void;
  setEditorTab: (tab: import("../../types").EditorTab) => void;
  setDiagramTypeAndWait: (type: DiagramType) => Promise<void>;
  setMermaidState: (
    updater: (
      prev: import("../../types").MermaidState,
    ) => import("../../types").MermaidState,
  ) => void;
  getDocsContext: (mode: import("../../types").DocsMode) => Promise<string>;
  getDocsSelectionSummary?: (mode: import("../../types").DocsMode) => Promise<{
    total: number;
    included: number;
    excluded: number;
    includedPaths: string[];
    excludedPaths: string[];
  }>;
  loadBuildDocsEntries: (type: DiagramType) => Promise<unknown>;
  buildLLMRequestContext: (args: {
    diagramType?: DiagramType;
    allowedDiagramTypes?: DiagramType[] | null;
    docsContext: string;
    language: string;
  }) => LLMRequestContext;
  startOperation: (
    title: string,
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
  onLLMRequestStart?: (
    notice: import("../../services/llmRequestRunner").LLMRequestStartNotice,
  ) => void;
  getAbortSignal?: () => AbortSignal | null;
};

export const parseNotebookCountFromText = (text: string): number | null => {
  const normalized = text.toLowerCase();
  const explicitMatch = normalized.match(
    /(?:^|\s)(?:n|count|qty|quantity|кол-?во|количество|число)\s*[:=]?\s*(\d+)(?:\s|$)/,
  );
  if (explicitMatch) {
    const value = Number(explicitMatch[1]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  const trailingMatch = normalized.match(
    /(?:^|\s)(\d+)\s*(?:diagrams?|diagram|blocks?|mermaid blocks?|диаграмм(?:ы|а)?|блок(?:ов|а|и)?|схем(?:ы|а)?)(?:\s|$)/,
  );
  if (trailingMatch) {
    const value = Number(trailingMatch[1]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  const leadingMatch = normalized.match(
    /(?:^|\s)(?:diagrams?|diagram|blocks?|mermaid blocks?|диаграмм(?:ы|а)?|блок(?:ов|а|и)?|схем(?:ы|а)?)\s*[:=]?\s*(\d+)(?:\s|$)/,
  );
  if (leadingMatch) {
    const value = Number(leadingMatch[1]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  return null;
};

export const parseNotebookCountFromIntent = (text: string): number | null => {
  const lines = text.split(/\r?\n/);
  let startIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^#{0,3}\s*(diagrams|диаграммы)(?:\s|$)/i.test(line)) {
      startIndex = i + 1;
      break;
    }
  }
  if (startIndex === -1) return null;
  let count = 0;
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (count > 0) break;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) break;
    if (/^\d+\.\s+/.test(line)) {
      count += 1;
      continue;
    }
    if (/^-\s+/.test(line)) {
      count += 1;
      continue;
    }
    if (count > 0) break;
  }
  return count > 0 ? count : null;
};

const formatNotebookRawIntent = (args: {
  diagram: NotebookPlan["diagrams"][number];
  plan: NotebookPlan;
  language: string;
}): string => {
  const { diagram, plan, language } = args;
  const label = "raw-intent.md";
  const lines: string[] = [label, ""];
  const pushSection = (title: string, value?: string) => {
    if (!value?.trim()) return;
    lines.push(`## ${title}`, value.trim(), "");
  };
  const pushList = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`## ${title}`, ...items.map((item) => `- ${item}`), "");
  };

  pushSection(language === "Russian" ? "Название" : "Title", diagram.title);
  pushSection(
    language === "Russian" ? "Тип" : "Diagram Type",
    diagram.diagramType,
  );
  pushSection(language === "Russian" ? "Цель" : "Goal", diagram.goal);
  pushSection(
    language === "Russian" ? "Описание" : "Description",
    diagram.description,
  );
  pushSection(
    language === "Russian" ? "Build Prompt" : "Build Prompt",
    diagram.buildPrompt,
  );

  if (diagram.acceptance?.length) {
    pushList(
      language === "Russian" ? "Критерии" : "Acceptance",
      diagram.acceptance,
    );
  }

  if (plan.glossary?.length) {
    const glossaryLines = plan.glossary
      .map((item) => {
        const term = item.term?.trim() || "";
        if (!term) return "";
        const meaning = item.meaning?.trim();
        const aliases = item.aliases?.filter(Boolean);
        const aliasText = aliases?.length ? ` (${aliases.join(", ")})` : "";
        return `${term}${meaning ? `: ${meaning}` : ""}${aliasText}`;
      })
      .filter(Boolean);
    pushList(language === "Russian" ? "Глоссарий" : "Glossary", glossaryLines);
  }

  const constraint =
    language === "Russian"
      ? NOTEBOOK_STYLE_CONSTRAINT_RU
      : NOTEBOOK_STYLE_CONSTRAINT_EN;
  pushList(language === "Russian" ? "Ограничения" : "Constraints", [
    constraint,
  ]);

  return lines.join("\n").trim();
};

const resolveNotebookPrompt = (
  messages: Message[],
  diagramIntent: DiagramIntent | null,
  prompt?: string,
) => {
  const trimmed = prompt?.trim() ?? "";
  if (trimmed) return { content: trimmed, source: "build" as const };
  if (diagramIntent?.content.trim()) {
    return { content: diagramIntent.content, source: diagramIntent.source };
  }
  return null;
};

const buildNotebookContextEvent = (args: {
  phase: import("../../types").OperationPhase;
  contextScope: import("../../types").OperationEvent["contextScope"];
  diagramType?: import("../../types").DiagramType | null;
  selectionLine?: string;
  systemPrompt: string;
  messages: Message[];
  docsContext: string;
  selectionSummary?: { includedPaths: string[] } | null;
  docsPrefix?: string;
}) => {
  return buildContextEventForLog({
    phase: args.phase,
    contextScope: args.contextScope,
    diagramType: args.diagramType ?? undefined,
    selectionLine: args.selectionLine || undefined,
    systemPrompt: args.systemPrompt,
    messages: args.messages,
    docsContext: args.docsContext,
    selectionSummary: args.selectionSummary ?? null,
    docsPrefix: args.docsPrefix,
  });
};

const resolveNotebookRequestedN = (args: {
  explicitCount: number | string | null;
  promptText: string;
  messages: Message[];
}): number | null => {
  if (typeof args.explicitCount === "number" && args.explicitCount > 0)
    return args.explicitCount;
  if (typeof args.explicitCount === "string" && args.explicitCount.trim())
    return null;
  const fromPrompt =
    parseNotebookCountFromText(args.promptText) ??
    parseNotebookCountFromIntent(args.promptText);
  if (fromPrompt) return fromPrompt;
  const lastUserText = args.messages
    .slice()
    .reverse()
    .find(
      (m) =>
        m.id !== "init" && m.role === "user" && m.content.trim().length > 0,
    )?.content;
  if (!lastUserText) return null;
  return parseNotebookCountFromText(lastUserText);
};

const parseNotebookRange = (range: string | null) => {
  if (!range) return null;
  const match = range.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min <= 0 ||
    max <= 0 ||
    min > max
  )
    return null;
  return { min, max };
};

const replaceNotebookBlock = (
  markdown: string,
  index: number,
  code: string,
) => {
  const blocks = extractMermaidBlocksFromMarkdown(markdown);
  const block = blocks[index];
  if (!block) return markdown;
  return replaceMermaidBlockInMarkdown(markdown, block, code);
};

const buildPlannerMessageContent = (args: {
  prompt: string;
  requestedN: number | null;
  requestedNRange?: string | null;
  attempt: number;
  lastCount: number | null;
  lastInvalidTypes: number | null;
  forcedDiagramType: DiagramType | null;
  allowedDiagramTypes: DiagramType[] | null;
}) => {
  const supportedTypes =
    "architecture, block, c4, class, er, flowchart, gantt, gitGraph, kanban, mindmap, packet, pie, quadrantChart, radar, requirementDiagram, sankey, sequence, state, timeline, treemap, userJourney, xychart, zenuml";
  const lines = [
    `userRequest: """${args.prompt}"""`,
    `requestedN: ${args.requestedN ?? "null"}`,
    `requestedNRange: ${args.requestedNRange ? `"${args.requestedNRange}"` : "null"}`,
    `forcedDiagramType: ${args.forcedDiagramType ?? "null"}`,
    `supportedDiagramTypes: ${supportedTypes}`,
  ];
  if (args.allowedDiagramTypes?.length) {
    lines.push(`allowedDiagramTypes: ${args.allowedDiagramTypes.join(", ")}`);
  }
  if (args.attempt > 1) {
    if (args.requestedN) {
      const mismatchNote = args.lastCount
        ? `Previous response had ${args.lastCount} diagrams.`
        : "";
      lines.push(
        `IMPORTANT: Return exactly ${args.requestedN} diagrams.${mismatchNote ? ` ${mismatchNote}` : ""}`,
      );
    } else if (args.requestedNRange) {
      const mismatchNote = args.lastCount
        ? `Previous response had ${args.lastCount} diagrams.`
        : "";
      lines.push(
        `IMPORTANT: Choose resolvedN within ${args.requestedNRange}.${mismatchNote ? ` ${mismatchNote}` : ""}`,
      );
    }
  }
  if (args.lastInvalidTypes && args.attempt > 1) {
    const invalidNote = `Previous response had ${args.lastInvalidTypes} unsupported diagram type(s).`;
    lines.push(`IMPORTANT: Use only supported diagram types. ${invalidNote}`);
  }
  return lines.join("\n");
};

type PlannerRunner = (
  message: Message,
  signal?: AbortSignal | null,
) => Promise<string>;

export const requestNotebookPlan = async (args: {
  sessionId?: string;
  aiConfig: import("../../types").AIConfig;
  modelParams: ModelParams | null;
  prompt: string;
  requestedN: number | null;
  requestedNRange?: string | null;
  docs: string;
  language: string;
  thinkingStyle?: import("../../types").ThinkingStyle;
  buildLLMRequestContext?: (args: {
    diagramType?: DiagramType;
    allowedDiagramTypes?: DiagramType[] | null;
    docsContext: string;
    language: string;
  }) => LLMRequestContext;
  addMessage: NotebookBuildDeps["addMessage"];
  onLLMRequestStart?: NotebookBuildDeps["onLLMRequestStart"];
  timeoutMs?: number;
  forcedDiagramType?: DiagramType | null;
  allowedDiagramTypes?: DiagramType[] | null;
  runPlanner?: PlannerRunner;
  runner?: StudioOperationRunner;
  contextEvent?: ReturnType<typeof buildContextEventForLog>;
}): Promise<NotebookPlan> => {
  const runPlanner: PlannerRunner =
    args.runPlanner ??
    ((message, signal) =>
      planNotebook(
        [message],
        args.aiConfig,
        args.buildLLMRequestContext
          ? args.buildLLMRequestContext({
              diagramType: args.forcedDiagramType ?? "auto",
              allowedDiagramTypes: args.allowedDiagramTypes ?? null,
              docsContext: args.docs,
              language: args.language,
            })
          : {
              sessionId: args.sessionId,
              diagramType: args.forcedDiagramType ?? "auto",
              allowedDiagramTypes: args.allowedDiagramTypes ?? null,
              docsContext: args.docs,
              language: args.language,
              thinkingStyle: args.thinkingStyle,
            },
        args.modelParams,
        signal,
      ));
  const maxAttempts = Math.max(
    1,
    NOTEBOOK_BUILD_RETRY_CONFIG.plannerCountRetries + 1,
  );
  let lastCount: number | null = null;
  let lastInvalidTypes: number | null = null;
  let lastParseError: string | null = null;
  let contextSent = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const plannerMessage: Message = {
      id: `notebook-plan-${Date.now()}-${attempt}`,
      role: "user",
      content: buildPlannerMessageContent({
        prompt: args.prompt,
        requestedN: args.requestedN,
        requestedNRange: args.requestedNRange,
        attempt,
        lastCount,
        lastInvalidTypes,
        forcedDiagramType: args.forcedDiagramType ?? null,
        allowedDiagramTypes: args.allowedDiagramTypes ?? null,
      }),
      timestamp: Date.now(),
    };
    const rawPlan = args.runner
      ? await args.runner.runLLM({
          task: "planner",
          phase: "planning",
          run: (signal) => runPlanner(plannerMessage, signal),
          retries: NOTEBOOK_BUILD_RETRY_CONFIG.plannerTimeoutRetries,
          timeoutMs: args.timeoutMs ?? LLM_TIMEOUT_MS,
          stageContextScope: "planner",
          contextEvent:
            args.contextEvent && !contextSent
              ? toRunnerContextEvent(args.contextEvent)
              : undefined,
          onStart: args.onLLMRequestStart,
        })
      : await runLLMRequest({
          task: "planner",
          run: () => runPlanner(plannerMessage),
          retries: NOTEBOOK_BUILD_RETRY_CONFIG.plannerTimeoutRetries,
          timeoutMs: args.timeoutMs,
          onStart: args.onLLMRequestStart,
          onTimeout: (notice) => {
            args.addMessage(
              "assistant",
              formatTimeoutRetryMessage(
                "Planner",
                notice.attempt,
                notice.maxAttempts,
              ),
              "build",
            );
          },
        });
    contextSent = true;
    let parsedPlan: NotebookPlan;
    try {
      parsedPlan = parseNotebookPlan(rawPlan);
    } catch (error: unknown) {
      lastParseError = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts) {
        args.addMessage(
          "assistant",
          "Planner returned invalid JSON. Retrying...",
          "build",
        );
        continue;
      }
      throw new Error(lastParseError || "Planner returned invalid JSON.");
    }
    let normalized = normalizeNotebookPlan(parsedPlan, args.requestedN);
    const range = parseNotebookRange(args.requestedNRange ?? null);
    if (range) {
      const resolved = Number(
        normalized.resolvedN ?? normalized.diagrams.length,
      );
      if (resolved < range.min || resolved > range.max) {
        lastCount = resolved;
        if (attempt < maxAttempts) {
          args.addMessage(
            "assistant",
            `Planner returned ${resolved} diagrams. Expected ${range.min}-${range.max}. Retrying...`,
            "build",
          );
          continue;
        }
      }
    }
    const allowedTypes = args.allowedDiagramTypes?.length
      ? new Set(args.allowedDiagramTypes)
      : null;
    const invalidTypes = normalized.diagrams.filter((diagram) => {
      if (diagram.diagramType === "other") return true;
      if (!allowedTypes) return false;
      return !allowedTypes.has(diagram.diagramType);
    });
    if (invalidTypes.length) {
      lastInvalidTypes = invalidTypes.length;
      if (attempt < maxAttempts) {
        args.addMessage(
          "assistant",
          `Planner returned ${lastInvalidTypes} unsupported diagram type(s). Retrying...`,
          "build",
        );
        continue;
      }
      if (allowedTypes) {
        const fallbackType: DiagramType =
          args.allowedDiagramTypes?.[0] ?? "flowchart";
        normalized = {
          ...normalized,
          diagrams: normalized.diagrams.map((diagram) =>
            diagram.diagramType !== "other" &&
            allowedTypes.has(diagram.diagramType)
              ? diagram
              : { ...diagram, diagramType: fallbackType },
          ),
        };
      } else {
        throw new Error(
          `Planner returned ${lastInvalidTypes} unsupported diagram type(s).`,
        );
      }
    }
    if (args.requestedN && normalized.diagrams.length !== args.requestedN) {
      lastCount = normalized.diagrams.length;
      if (attempt < maxAttempts) {
        args.addMessage(
          "assistant",
          `Planner returned ${lastCount} diagrams; expected ${args.requestedN}. Retrying...`,
          "build",
        );
        continue;
      }
      throw new Error(
        `Planner returned ${normalized.diagrams.length} diagrams; expected ${args.requestedN}.`,
      );
    }
    if (!args.requestedN && normalized.diagrams.length < 2) {
      lastCount = normalized.diagrams.length;
      if (attempt < maxAttempts) {
        args.addMessage(
          "assistant",
          `Planner returned ${lastCount} diagram(s); expected at least 2. Retrying...`,
          "build",
        );
        continue;
      }
    }
    return normalized;
  }

  throw new Error("Planner retries exhausted.");
};

export const useNotebookBuild = (deps: NotebookBuildDeps) => {
  const createEphemeralMessage = useCallback(
    (
      role: Message["role"],
      content: string,
      mode?: Message["mode"],
    ): Message => ({
      id: generateId(),
      role,
      content,
      timestamp: Date.now(),
      mode,
    }),
    [],
  );

  const applyNotebookMarkdown = useCallback(
    (nextMarkdown: string) => {
      deps.setMermaidState((prev) => ({
        ...prev,
        code: nextMarkdown,
        isValid: true,
        lastValidCode: nextMarkdown,
        errorMessage: undefined,
        errorLine: undefined,
        status: nextMarkdown.trim() ? "valid" : "empty",
        source: "compiled",
      }));
    },
    [deps],
  );

  const handleNotebookBuild = useCallback(
    async (text?: string) => {
      const pushStatus = (content: string) => {
        deps.addMessage("assistant", content, "build");
      };
      let resolvedPlanCount: number | null = null;
      let plan: NotebookPlan | null = null;
      let successBlocks = 0;
      let failedBlocks = 0;
      let summaryAdded = false;
      const opId = deps.startOperation("Notebook build", "build");
      const logEvent = (args: Parameters<typeof deps.addOperationEvent>[1]) => {
        deps.addOperationEvent(opId, args);
      };
      const runner = createStudioOperationRunner(
        {
          onLLMRequestStart: deps.onLLMRequestStart,
          getAbortSignal: deps.getAbortSignal,
        },
        { logEvent },
      );
      const finalizeOperation = async (
        status: "done" | "error",
        meta?: Record<string, unknown>,
        messages?: Message[],
        includeMainChatStep?: boolean,
      ) => {
        deps.finishOperation(opId, status);
        await deps.safeAppendTimeStep({
          type: "build",
          messages: messages ?? [],
          meta: {
            ...(meta ?? {}),
            mode: "notebook",
            operationLog: deps.getOperationLog(opId),
          },
        });
        if (includeMainChatStep && messages?.length) {
          await deps.safeAppendTimeStep({
            type: "build",
            messages,
            meta: {
              ...(meta ?? {}),
              operationLog: deps.getOperationLog(opId),
            },
          });
        }
      };
      if (deps.connectionState.status !== "connected") {
        pushStatus("Сборка ноутбука\n- офлайн: подключите AI");
        logEvent({
          phase: "build",
          level: "error",
          title: "Notebook build",
          detail: "offline",
          error: { code: "offline", message: "AI offline" },
        });
        await deps.safeAppendTimeStep({
          type: "build",
          messages: [
            deps.addMessage(
              "assistant",
              "Офлайн. Подключите AI для генерации диаграмм.",
              "build",
            ),
          ],
          meta: { error: "offline", operationLog: deps.getOperationLog(opId) },
        });
        deps.finishOperation(opId, "error");
        return;
      }

      const prompt = resolveNotebookPrompt(
        deps.messages,
        deps.diagramIntent,
        text,
      );
      if (!prompt) {
        pushStatus("Сборка ноутбука\n- нет intent");
        logEvent({
          phase: "planning",
          level: "error",
          title: "Intent",
          detail: "missing",
          error: { code: "no_intent", message: "Intent missing" },
        });
        await deps.safeAppendTimeStep({
          type: "build",
          messages: [
            deps.addMessage(
              "assistant",
              "Нет intent для сборки. Используйте чат, чтобы описать задачу.",
              "build",
            ),
          ],
          meta: {
            error: "no_intent",
            operationLog: deps.getOperationLog(opId),
          },
        });
        deps.finishOperation(opId, "error");
        return;
      }

      const originalDiagramType = deps.appState.diagramType;
      const fallbackDiagramType =
        originalDiagramType === "auto" ? "flowchart" : originalDiagramType;
      const requestedNRange =
        typeof deps.appState.notebookBuildCount === "string"
          ? deps.appState.notebookBuildCount
          : null;
      const requestedN = resolveNotebookRequestedN({
        explicitCount: deps.appState.notebookBuildCount ?? null,
        promptText: prompt.content,
        messages: deps.messages,
      });
      const requestedNLabel = requestedN ? String(requestedN) : null;
      const language =
        deps.appState.language !== "auto"
          ? deps.appState.language
          : detectLanguage(prompt.content);
      const forcedDiagramType =
        deps.appState.diagramType !== "auto" ? deps.appState.diagramType : null;
      const allowedDiagramTypes: DiagramType[] | null =
        deps.appState.diagramType === "auto"
          ? [...deps.appState.mainDiagramTypes]
          : null;

      deps.setIsProcessing(true);
      try {
        pushStatus(
          [
            "Сборка ноутбука",
            "- старт",
            `- язык: ${language}`,
            requestedNLabel ? `- N: ${requestedNLabel}` : "",
            forcedDiagramType ? `- тип: ${forcedDiagramType}` : "",
            allowedDiagramTypes
              ? `- main: ${allowedDiagramTypes.join(" / ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        logEvent({
          phase: "build",
          level: "info",
          title: "Notebook build",
          detail: requestedNLabel ? `N=${requestedNLabel}` : undefined,
          kind: "status",
        });
        const docs = await deps.getDocsContext("plan");
        const plannerSelection = await deps.getDocsSelectionSummary?.("plan");
        const plannerPaths = plannerSelection?.includedPaths?.length
          ? plannerSelection.includedPaths
          : getNotebookPlannerDocsPaths().map(({ path }) => path);
        const plannerMessage: Message = {
          id: "notebook-plan-context",
          role: "user",
          content: buildPlannerMessageContent({
            prompt: prompt.content,
            requestedN,
            requestedNRange,
            attempt: 1,
            lastCount: null,
            lastInvalidTypes: null,
            forcedDiagramType,
            allowedDiagramTypes,
          }),
          timestamp: Date.now(),
        };
        const plannerSystemPrompt = buildSystemPrompt(
          "plan_notebook",
          deps.buildLLMRequestContext({
            docsContext: "Documentation context redacted.",
            language,
            diagramType: forcedDiagramType ?? deps.appState.diagramType,
            allowedDiagramTypes,
          }),
        );
        const plannerContextEvent = buildNotebookContextEvent({
          phase: "planning",
          contextScope: "planner",
          diagramType: forcedDiagramType ?? deps.appState.diagramType,
          selectionLine: buildSelectionLine({
            diagramType: forcedDiagramType ?? deps.appState.diagramType,
            allowedDiagramTypes,
          }),
          systemPrompt: plannerSystemPrompt,
          messages: [plannerMessage],
          docsContext: docs,
          selectionSummary: { includedPaths: plannerPaths },
          docsPrefix: "planner docs",
        });
        const plannerStartAt = Date.now();
        pushStatus("Планировщик\n- запрашиваю план");
        logEvent({
          phase: "planning",
          level: "info",
          title: "Planner",
          detail: "request",
          kind: "planner",
        });
        plan = await requestNotebookPlan({
          sessionId: deps.llmSessionId,
          aiConfig: deps.aiConfig,
          modelParams: deps.modelParams,
          prompt: prompt.content,
          requestedN,
          requestedNRange,
          docs,
          language,
          thinkingStyle: deps.appState.thinkingStyle,
          buildLLMRequestContext: deps.buildLLMRequestContext,
          addMessage: createEphemeralMessage,
          timeoutMs: deps.appState.llmTimeoutMs,
          forcedDiagramType,
          allowedDiagramTypes,
          runner,
          contextEvent: plannerContextEvent,
        });
        resolvedPlanCount = plan.resolvedN;
        pushStatus(
          ["Планировщик", `- план готов`, `- диаграмм: ${plan.resolvedN}`].join(
            "\n",
          ),
        );
        logEvent({
          phase: "build",
          level: "info",
          title: "Notebook build",
          detail: `N=${plan.resolvedN}`,
          kind: "status",
        });
        logEvent({
          phase: "planning",
          level: "info",
          title: "Planner",
          detail: `ready (${plan.resolvedN})`,
          metrics: { durationMs: Date.now() - plannerStartAt },
          kind: "planner",
        });
        if (forcedDiagramType) {
          plan = {
            ...plan,
            diagrams: plan.diagrams.map((diagram) => ({
              ...diagram,
              diagramType: forcedDiagramType,
            })),
          };
        }

        let currentMarkdown = createMermaidNotebookMarkdownFromPlan(plan);
        applyNotebookMarkdown(currentMarkdown);
        deps.setMarkdownMermaidActiveIndex(0);
        pushStatus("Ноутбук\n- создан markdown-скелет");
        logEvent({
          phase: "build",
          level: "info",
          title: "Notebook",
          detail: "skeleton created",
        });

        // Seed per-block chats with their raw intent as soon as the plan is available.
        for (let i = 0; i < plan.diagrams.length; i += 1) {
          const diagram = plan.diagrams[i];
          const targetDiagramType =
            diagram.diagramType === "other"
              ? fallbackDiagramType
              : diagram.diagramType;
          const rawIntent = formatNotebookRawIntent({
            diagram,
            plan,
            language,
          });
          await deps.safeAppendTimeStep({
            type: "system",
            messages: [],
            meta: {
              mode: "notebook",
              blockIndex: i,
              totalBlocks: plan.diagrams.length,
              diagramType: targetDiagramType,
              notebookPlanIntent: rawIntent,
              phase: "plan",
            },
          });
        }
        pushStatus("Ноутбук\n- raw intent сохранён");
        logEvent({
          phase: "planning",
          level: "info",
          title: "Notebook",
          detail: "raw intent saved",
        });

        for (let i = 0; i < plan.diagrams.length; i += 1) {
          const diagram = plan.diagrams[i];
          const blockMessages: Message[] = [];
          const targetDiagramType =
            diagram.diagramType === "other"
              ? fallbackDiagramType
              : diagram.diagramType;
          const rawIntent = formatNotebookRawIntent({
            diagram,
            plan,
            language,
          });
          const diagramTitle = diagram.title?.trim() || `Diagram ${i + 1}`;
          const blockLabel = `${i + 1}/${plan.diagrams.length} - ${targetDiagramType} - ${diagramTitle}`;
          const tracker = createProgressTracker({
            setMessages: deps.setMessages,
            prefix: `[notebook-block:${i}] `,
            mode: "build",
          });
          const updateBlockMessage = (content: string) =>
            tracker.update(content);

          deps.setMarkdownMermaidActiveIndex(i);
          await deps.setDiagramTypeAndWait(targetDiagramType);
          const docsState = await deps.loadBuildDocsEntries(targetDiagramType);
          const docsEntries =
            (
              docsState as {
                entries?: Array<{
                  path: string;
                  text?: string;
                  isOptional?: boolean;
                }>;
              }
            ).entries ?? [];
          const docsSelections =
            (
              docsState as {
                selections?: Record<string, Record<string, boolean>>;
              }
            ).selections ?? {};
          const buildSelection = docsSelections.build ?? {};
          const selectedDocsEntries = docsEntries.filter(
            (entry) => buildSelection[entry.path] !== false,
          );
          const blockDocsEntries: DocsEntry[] = selectedDocsEntries.map(
            (entry) => ({
              path: entry.path,
              text: entry.text ?? "",
              isOptional: entry.isOptional,
            }),
          );
          const blockDocs = formatDocsContext(blockDocsEntries);
          updateBlockMessage(`Сборка: ${blockLabel} — старт.`);
          logEvent({
            phase: "build",
            level: "info",
            title: "Block",
            detail: blockLabel,
            blockIndex: i,
            kind: "block",
            diagramType: targetDiagramType,
          });

          const blockStartAt = Date.now();
          let success = false;
          let attempts = 0;
          let lastError = "";
          let lastAutoFix = 0;
          let firstAutoFixCode: string | null = null;
          let problemsLogged = false;
          const intentText = normalizeIntentText(diagram.buildPrompt || "");
          if (!intentText) {
            lastError = "empty_build_prompt";
            updateBlockMessage(`Сборка: ${blockLabel} — пустой build prompt.`);
          } else {
            try {
              const intentMessage: Message = {
                id: `notebook-intent-${i + 1}`,
                role: "user",
                content: `Intent:\n${intentText}`,
                timestamp: Date.now(),
              };
              const blockSystemPrompt = buildSystemPrompt(
                "generate",
                deps.buildLLMRequestContext({
                  diagramType: targetDiagramType,
                  docsContext: "Documentation context redacted.",
                  language,
                }),
              );
              const blockContextEvent = buildNotebookContextEvent({
                phase: "planning",
                contextScope: "block",
                diagramType: targetDiagramType,
                selectionLine: blockLabel,
                systemPrompt: blockSystemPrompt,
                messages: [intentMessage],
                docsContext: blockDocs,
                selectionSummary: {
                  includedPaths: selectedDocsEntries.map((entry) => entry.path),
                },
              });
              const blockRunner = createStudioOperationRunner(
                {
                  onLLMRequestStart: deps.onLLMRequestStart,
                  getAbortSignal: deps.getAbortSignal,
                },
                {
                  logEvent: (args) => {
                    logEvent({
                      ...args,
                      blockIndex: i,
                      diagramType: targetDiagramType,
                    });
                  },
                },
              );
              const buildResult = await runBuildPipeline({
                sessionId: deps.llmSessionId,
                aiConfig: deps.aiConfig,
                modelParams: deps.modelParams,
                diagramType: targetDiagramType,
                llmMessages: [intentMessage],
                docs: blockDocs,
                language,
                thinkingStyle: deps.appState.thinkingStyle,
                maxAttempts: NOTEBOOK_BUILD_RETRY_CONFIG.diagramAttempts,
                autoFixMaxAttempts: NOTEBOOK_BUILD_RETRY_CONFIG.autoFixAttempts,
                buildRequestRetries:
                  NOTEBOOK_BUILD_RETRY_CONFIG.buildRequestRetries,
                autoFixRequestRetries:
                  NOTEBOOK_BUILD_RETRY_CONFIG.fixRequestRetries,
                timeoutMs: deps.appState.llmTimeoutMs,
                allowFallback: false,
                runner: blockRunner,
                stageContextScope: "block",
                contextEvent: toRunnerContextEvent(blockContextEvent),
                callbacks: {
                  onAttempt: (attempt, max) => {
                    attempts = attempt;
                    updateBlockMessage(
                      `Сборка: ${blockLabel} — попытка ${attempt}/${max}.`,
                    );
                    logEvent({
                      phase: "build",
                      level: "info",
                      title: "Block attempt",
                      detail: blockLabel,
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      attempt: { current: attempt, max },
                      kind: "attempt",
                    });
                  },
                  onEmpty: (attempt, max) => {
                    updateBlockMessage(
                      `Сборка: ${blockLabel} — пустой ответ (${attempt}/${max}).`,
                    );
                    logEvent({
                      phase: "build",
                      level: "warn",
                      title: "Block",
                      detail: "no mermaid code",
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      kind: "block",
                    });
                  },
                  onError: (attempt, max, message) => {
                    lastError = message;
                    updateBlockMessage(
                      `Сборка: ${blockLabel} — попытка ${attempt}/${max} не удалась: ${message}`,
                    );
                    logEvent({
                      phase: "build",
                      level: "error",
                      title: "Block",
                      detail: message,
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      error: { code: "block_error", message },
                      kind: "block",
                    });
                  },
                  onJsonStatus: (attempt, status, reason) => {
                    lastError = reason || `json_status_${status}`;
                    updateBlockMessage(
                      `Сборка: ${blockLabel} — JSON status ${status}.`,
                    );
                    logEvent({
                      phase: "build",
                      level: "warn",
                      title: "Block",
                      detail: `json ${status}`,
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      kind: "block",
                    });
                  },
                  onTypeMismatch: (attempt, expected, received) => {
                    lastError = `type_mismatch:${received}`;
                    updateBlockMessage(
                      `Сборка: ${blockLabel} — ожидали ${expected}, получили ${received}. Повтор.`,
                    );
                    logEvent({
                      phase: "build",
                      level: "warn",
                      title: "Block",
                      detail: `type mismatch ${received}`,
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      kind: "block",
                    });
                  },
                  onAutoFixAttempt: (attempt, max, errorLine) => {
                    logEvent({
                      phase: "fix",
                      level: "info",
                      title: "Auto-fix",
                      detail: `attempt ${attempt}/${max}`,
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      attempt: { current: attempt, max },
                      kind: "attempt",
                    });
                    if (errorLine) {
                      logEvent({
                        phase: "fix",
                        level: "warn",
                        title: "Auto-fix error",
                        detail: errorLine,
                        blockIndex: i,
                        diagramType: targetDiagramType,
                        attempt: { current: attempt, max },
                        error: { code: "validation", message: errorLine },
                        kind: "attempt",
                      });
                    }
                  },
                  onAutoFixIteration: (code) => {
                    if (!firstAutoFixCode) {
                      firstAutoFixCode = code;
                    }
                    currentMarkdown = replaceNotebookBlock(
                      currentMarkdown,
                      i,
                      code,
                    );
                    applyNotebookMarkdown(currentMarkdown);
                  },
                  onValidation: (isValid, autoFixAttempts) => {
                    lastAutoFix = autoFixAttempts;
                    logEvent({
                      phase: "validate",
                      level: isValid ? "info" : "warn",
                      title: "Block validation",
                      detail: isValid ? "valid" : "invalid",
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      metrics: lastAutoFix
                        ? { autoFix: lastAutoFix }
                        : undefined,
                      kind: "block",
                    });
                  },
                  onValidationError: (errorLine) => {
                    logEvent({
                      phase: "validate",
                      level: "error",
                      title: "Ошибка",
                      detail: errorLine || "validation error",
                      blockIndex: i,
                      diagramType: targetDiagramType,
                      error: {
                        code: "validation",
                        message: errorLine || "validation error",
                      },
                      kind: "block",
                    });
                  },
                },
              });
              attempts = buildResult.attempts;
              lastAutoFix = buildResult.autoFixAttempts;
              if (buildResult.status === "ok" && buildResult.code) {
                const sanitizedCurrent = sanitizeMermaidByType(
                  targetDiagramType,
                  buildResult.code,
                );
                currentMarkdown = replaceNotebookBlock(
                  currentMarkdown,
                  i,
                  sanitizedCurrent,
                );
                applyNotebookMarkdown(currentMarkdown);
                if (buildResult.validation.isValid) {
                  success = true;
                  updateBlockMessage(`Сборка: ${blockLabel} — готово.`);
                } else {
                  lastError =
                    buildResult.validation.errorMessage || "invalid_mermaid";
                  updateBlockMessage(
                    `Сборка: ${blockLabel} — Mermaid всё ещё невалиден.`,
                  );
                }
              } else {
                lastError = buildResult.lastError || "no_mermaid_code";
                updateBlockMessage(`Сборка: ${blockLabel} — нет Mermaid кода.`);
              }
              const shouldLogProblems =
                !problemsLogged &&
                (buildResult.autoFixAttempts > 0 ||
                  !buildResult.validation.isValid) &&
                !!buildResult.code;
              if (shouldLogProblems) {
                problemsLogged = true;
                const sourceCode = firstAutoFixCode ?? buildResult.code ?? "";
                const afterCode = buildResult.code ?? sourceCode;
                const labels = getMermaidProblemLabels(language);
                const problems = await collectMermaidProblems({
                  diagramType: targetDiagramType,
                  code: sourceCode,
                  language,
                  maxProblems: 3,
                  parserMax: 1,
                });
                const afterLines = afterCode.split(/\r?\n/);
                problems.forEach((problem, index) => {
                  const afterLine = afterLines[problem.line - 1] ?? "";
                  const explanation = explainMermaidProblemFix({
                    diagramType: targetDiagramType,
                    language,
                    message: problem.message,
                    beforeLine: problem.beforeLine,
                    afterLine,
                  });
                  const detail = [
                    `#${index + 1} (line ${problem.line}): ${problem.message}`,
                    `${labels.before}: ${problem.beforeLine || "(empty)"}`,
                    `${labels.after}: ${afterLine || "(empty)"}`,
                    explanation ? `${labels.fix}: ${explanation}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n");
                  logEvent({
                    phase: buildResult.autoFixAttempts > 0 ? "fix" : "validate",
                    level: "warn",
                    title: labels.problem,
                    detail,
                    blockIndex: i,
                    diagramType: targetDiagramType,
                    contextScope: "block",
                  });
                });
              }
            } catch (e: unknown) {
              if (deps.aiConfig.provider === 'opencode-go' && shouldStopOpenCodeGoOperation(e)) throw e;
              lastError = e instanceof Error ? e.message : String(e);
              if (
                e instanceof TimeoutError &&
                attempts < NOTEBOOK_BUILD_RETRY_CONFIG.diagramAttempts
              ) {
                updateBlockMessage(
                  `Сборка: ${blockLabel} — таймаут, повтор ${attempts + 1}/${NOTEBOOK_BUILD_RETRY_CONFIG.diagramAttempts}.`,
                );
              }
              updateBlockMessage(
                `Сборка: ${blockLabel} — попытка ${attempts} не удалась (${deps.aiConfig.selectedModelId ? `model=${deps.aiConfig.selectedModelId}` : "model=unknown"}): ${lastError}`,
              );
              logEvent({
                phase: "build",
                level: "error",
                title: "Block",
                detail: lastError,
                blockIndex: i,
                diagramType: targetDiagramType,
                error: { code: "block_error", message: lastError },
                kind: "block",
              });
            }
          }

          if (!success) {
            updateBlockMessage(
              `Сборка: ${blockLabel} — невалиден после ${NOTEBOOK_BUILD_RETRY_CONFIG.diagramAttempts} попыток.`,
            );
          }

          updateBlockMessage(
            [
              `Сборка: ${blockLabel} — ${success ? "готов" : "невалиден"}.`,
              `- попытки: ${attempts}/${NOTEBOOK_BUILD_RETRY_CONFIG.diagramAttempts}`,
              lastAutoFix ? `- auto-fix: ${lastAutoFix}` : "",
              lastError ? `- последняя ошибка: ${lastError}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
          logEvent({
            phase: success ? "build" : "error",
            level: success ? "info" : "error",
            title: "Block",
            detail: `${blockLabel} — ${success ? "готов" : "невалиден"}`,
            blockIndex: i,
            diagramType: targetDiagramType,
            metrics: { durationMs: Date.now() - blockStartAt },
          });
          const progressMessage = tracker.getMessage();
          if (progressMessage) {
            blockMessages.push(progressMessage);
          }

          if (success) {
            successBlocks += 1;
          } else {
            failedBlocks += 1;
          }

          await deps.safeAppendTimeStep({
            type: "build",
            messages: blockMessages,
            nextMermaid: {
              code: currentMarkdown,
              isValid: true,
              errorMessage: undefined,
              errorLine: undefined,
            },
            meta: {
              diagramType: targetDiagramType,
              blockIndex: i,
              totalBlocks: plan.diagrams.length,
              attempts,
              success,
              error: success ? undefined : lastError,
              notebookPlanIntent: rawIntent,
              buildPrompt: diagram.buildPrompt?.trim() || "",
              mode: "notebook",
            },
          });
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        pushStatus(`Сборка ноутбука\n- ошибка: ${message}`);
        logEvent({
          phase: "build",
          level: "error",
          title: "Notebook build",
          detail: message,
          error: { code: "exception", message },
        });
        const summaryMessage = deps.addMessage(
          "assistant",
          `Итог: сборка ноутбука завершилась с ошибкой. ${message}`,
          "build",
        );
        summaryAdded = true;
        await deps.safeAppendTimeStep({
          type: "build",
          messages: [summaryMessage],
          meta: { error: message, operationLog: deps.getOperationLog(opId) },
        });
        deps.finishOperation(opId, "error");
      } finally {
        if (!summaryAdded) {
          const total = plan?.diagrams?.length ?? resolvedPlanCount ?? 0;
          const typeList =
            plan?.diagrams
              ?.map((diagram) => diagram.diagramType)
              .filter(Boolean) ?? [];
          const uniqueTypes = Array.from(new Set(typeList));
          const selectionItems =
            plan?.diagrams
              ?.map((diagram) => {
                const title = diagram.title?.trim() ?? "";
                const type = diagram.diagramType?.trim() ?? "";
                if (title && type) return `${title} — ${type}`;
                return type || title;
              })
              .filter(Boolean) ?? [];
          const selectionNote = selectionItems.length
            ? `Выбрано: ${selectionItems.join("; ")}.`
            : "";
          const fallbackSummaryParts = [
            "Итог: сборка ноутбука завершена.",
            total
              ? `Успешно ${successBlocks} из ${total}.`
              : `Успешно ${successBlocks}.`,
            failedBlocks ? `Ошибок: ${failedBlocks}.` : "",
            uniqueTypes.length ? `Типы: ${uniqueTypes.join(", ")}.` : "",
            selectionNote,
          ].filter(Boolean);
          let resolvedSummary = normalizeSummaryText(
            fallbackSummaryParts.join(" "),
          );
          try {
            const chatTranscript = (() => {
              const filtered = deps.messages.filter(
                (message) =>
                  message.id !== "init" &&
                  (message.mode === undefined || message.mode === "chat") &&
                  (message.role === "user" || message.role === "assistant") &&
                  message.content.trim().length > 0,
              );
              if (filtered.length === 0) return "";
              return [
                "Чат:",
                ...filtered.map((m) => `${m.role}: ${m.content}`),
              ].join("\n");
            })();
            const operationLogText = (() => {
              const operationLog = deps.getOperationLog(opId);
              if (!operationLog?.events?.length) return "";
              const now = Date.now();
              const snapshot = {
                ...operationLog,
                status: "done" as const,
                finishedAt: now,
              };
              const view = buildOperationLogViewModel(snapshot, {
                showSummaryLine: false,
                timeoutMs: deps.appState.llmTimeoutMs,
                now,
              });
              const lines = view.rows.map((row) => {
                if (!row.timeLabel) return row.text;
                const parts = row.text.split("\n");
                const head = `${row.timeLabel} ${parts[0] ?? ""}`.trimEnd();
                const tail = parts.slice(1).map((line) => `  ${line}`);
                return [head, ...tail].join("\n");
              });
              return `Логи:\n${lines.join("\n")}`.trim();
            })();
            const summaryInput = [
              `Блоки: ${total}`,
              `Успешно: ${successBlocks}`,
              `Ошибки: ${failedBlocks}`,
              uniqueTypes.length ? `Типы: ${uniqueTypes.join(", ")}` : "",
              selectionNote ? `\n${selectionNote}` : "",
              chatTranscript ? `\n${chatTranscript}` : "",
              operationLogText ? `\n${operationLogText}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            const summaryMessage = {
              id: "build-summary",
              role: "user",
              content: summaryInput,
              timestamp: Date.now(),
            } as const;
            const systemPrompt = buildSystemPrompt(
              "summary",
              deps.buildLLMRequestContext({
                docsContext: "Documentation context redacted.",
                language,
                diagramType: deps.appState.diagramType,
              }),
            );
            const summaryContextEvent = buildNotebookContextEvent({
              phase: "build",
              contextScope: "summary",
              diagramType: deps.appState.diagramType,
              systemPrompt,
              messages: [summaryMessage],
              docsContext: "",
              selectionSummary: null,
            });
            const summaryText = await runner.runLLM({
              task: "build-summary",
              phase: "build",
              retries: 1,
              timeoutMs: deps.appState.llmTimeoutMs,
              stageTitle: "Итог",
              stageContextScope: "summary",
              contextEvent: toRunnerContextEvent(summaryContextEvent),
              run: (signal) =>
                summarizeBuild(
                  [summaryMessage],
                  deps.aiConfig,
                  deps.buildLLMRequestContext({
                    diagramType: deps.appState.diagramType,
                    docsContext: "",
                    language,
                  }),
                  deps.modelParams,
                  signal,
                ),
            });
            const cleanedSummary = normalizeSummaryText(
              sanitizeSummaryText(summaryText),
            );
            if (cleanedSummary) {
              const summaryPrefix =
                language === "Russian" ? "Итог:" : "Summary:";
              resolvedSummary = cleanedSummary
                .toLowerCase()
                .startsWith(summaryPrefix.toLowerCase())
                ? cleanedSummary
                : `${summaryPrefix} ${cleanedSummary}`;
            }
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : String(error);
            logEvent({
              phase: "error",
              level: "warn",
              title: "Итог",
              detail: `fallback: ${message}`,
              kind: "status",
            });
          }
          if (selectionNote && !resolvedSummary.includes(selectionNote)) {
            resolvedSummary = `${resolvedSummary}\n${selectionNote}`.trim();
          }
          const summaryMessage = deps.addMessage(
            "assistant",
            resolvedSummary,
            "build",
          );
          await finalizeOperation(
            "done",
            { resolvedN: requestedN ?? resolvedPlanCount ?? null },
            [summaryMessage],
            true,
          );
        }
        await deps.setDiagramTypeAndWait(originalDiagramType);
        deps.setIsProcessing(false);
      }
    },
    [applyNotebookMarkdown, createEphemeralMessage, deps],
  );

  return { handleNotebookBuild };
};
