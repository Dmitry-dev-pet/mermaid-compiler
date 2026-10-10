import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAI } from "../core/useAI";
import { useMermaid } from "../core/useMermaid";
import { useLayout } from "../core/useLayout";
import { useChat } from "../core/useChat";
import { createStudioActions } from "./studioActions";
import { useHistory } from "../core/useHistory";
import { generateId } from "../../utils";
import { getOpenCodeGoSessionId } from "../../services/llm/openCodeGoClient";
import { getRevision } from "../../services/history/store";
import type { ProjectBundleFile } from "../../services/history/bundle";
import { useBuildDocs } from "./useBuildDocs";
import { useMarkdownMermaid } from "./useMarkdownMermaid";
import { useOperationLog } from "./useOperationLog";
import { useManualEditRecorder } from "./useManualEditRecorder";
import { usePromptPreview } from "./usePromptPreview";
import { useNotebookChat, useNotebookChatView } from "./useNotebookChat";
import { useProjects } from "./useProjects";
import { useProjectPreview } from "./useProjectPreview";
import { useStudioChatContext } from "./useStudioChatContext";
import { useStudioWhiteboard } from "./useStudioWhiteboard";
import { useStudioTabs } from "./useStudioTabs";
import type { DiagramMarker } from "../core/useHistory";
import { useStudioHydration } from "./useStudioHydration";
import { useStudioChatFlow } from "./useStudioChatFlow";
import { StorageConflictError } from "../../services/storage/types";
import { useStorageConfig } from "../core/useStorageConfig";
import { useStorageMode } from "../core/useStorageMode";
import { useCloudControlPlane } from "./useCloudControlPlane";
import { createSupabaseByoProvider } from "../../services/storage";
import type {
  DiagramIntent,
  DiagramType,
  DocsMode,
  ModelParams,
  Message,
  OperationKind,
} from "../../types";
import {
  appendEmptyMermaidBlockToMarkdown,
  createMermaidNotebookMarkdown,
  detectMermaidDiagramType,
  extractMermaidBlocksFromMarkdown,
  isMarkdownLike,
} from "../../services/mermaidService";
import { trackAnalyticsEvent as trackAnalyticsEventService } from "../../services/analyticsService";
import { createAnalyticsAdapter } from "../../services/analyticsAdapter";
import { useNotebookBuild } from "./useNotebookBuild";
import { useFixFlow } from "./useFixFlow";
import { useNotebookContext } from "./useNotebookContext";
import { useStudioHistoryRecorder } from "./useStudioHistoryRecorder";
import { useStudioOperationController } from "./useStudioOperationController";
import {
  MAIN_CHAT_CONTEXT_ID,
  resolveOperationLogContextId,
} from "../../utils/contextIds";
import {
  getSystemPromptModeFromPath,
  isSystemPromptPath,
} from "../../utils/systemPrompts";

export const useDiagramStudio = () => {
  const { aiConfig, setAiConfig, connectionState, connectAI, disconnectAI } =
    useAI();
  const { mermaidState, setMermaidState, handleMermaidChange } = useMermaid();
  const {
    appState,
    setAppState,
    startResize,
    setDiagramType,
    setMainDiagramTypes,
    setThemePreset,
    toggleTheme,
    setAnalyzeLanguage,
    setLLMTimeoutMs,
    togglePreviewFullScreen,
  } = useLayout();
  const {
    messages,
    setMessages,
    setMessagesForContext,
    addMessage,
    clearMessages,
    resetMessages,
    getMessages,
    getMessagesForContext,
    activeContextId,
    setActiveContextId,
  } = useChat();
  const [modelParams, setModelParams] = useState<ModelParams | null>(null);
  // A single draft scope keeps Go usable if local history cannot create a project.
  const [draftProjectId] = useState(() => `draft-${generateId()}`);
  const {
    isHistoryReady,
    historySession,
    historyLoadResult,
    historySteps,
    appendTimeStep,
    updateCurrentRevision,
    updateCurrentRevisionWhiteboard,
    diagramMarkers,
    diagramStepAnchors,
    selectedStepId,
    selectDiagramStep,
    startNewSession,
    sessions,
    loadSession,
    renameHistorySession,
    saveSessionSettings,
    scheduleDeleteSession,
    undoDeleteSession,
    deleteUndoMs: historyDeleteUndoMs,
    loadSessionPreview,
    loadSessionSnapshot,
    exportProjectBundle,
    importProjectBundle,
  } = useHistory();

  const {
    isProcessing,
    setIsProcessing,
    stopActiveOperation,
    getAbortSignal,
    runWithAbortController,
    onLLMRequestStart: handleLLMRequestStart,
  } = useStudioOperationController();
  const [diagramIntentByContext, setDiagramIntentByContext] = useState<
    Record<string, DiagramIntent | null>
  >({});
  const prevBuildDocsScopeRef = useRef<"notebook" | "diagram">("notebook");
  const {
    editorTab,
    setEditorTab,
    buildDocsScope,
    setBuildDocsScope,
    setNextBuildDocsScope,
  } = useStudioTabs();
  const { previewMermaidState, showProjectPreview, clearProjectPreview } =
    useProjectPreview({
      loadSessionSnapshot,
    });

  const isHydratingRef = useRef(true);
  const hydratedSessionIdRef = useRef<string | null>(null);
  const seededNotebookSessionIdsRef = useRef<Set<string>>(new Set());
  const lastManualRecordedCodeRef = useRef<string>("");
  const diagramTypeWaitRef = useRef<{
    target: DiagramType;
    resolve: () => void;
  } | null>(null);

  const {
    markdownMermaidBlocks,
    markdownMermaidDiagnostics,
    markdownMermaidActiveIndex,
    setMarkdownMermaidActiveIndex,
  } = useMarkdownMermaid({
    code: mermaidState.code,
    editorTab,
    setEditorTab,
  });

  const {
    operationLogs,
    setOperationLogs,
    startOperation,
    addOperationEvent,
    finishOperation,
    getOperationLog,
    hydrateOperationLogs,
  } = useOperationLog();

  const notebookContext = useNotebookContext({
    editorTab,
    buildDocsScope,
    mermaidCode: mermaidState.code,
    markdownBlocksLength: markdownMermaidBlocks.length,
  });
  const { isNotebookChatMode, isNotebookDataEnabled, isNotebookChatEnabled } =
    notebookContext;

  const { activeChatContextId, getNotebookChatIndex } = useStudioChatContext({
    isNotebookChatMode,
    markdownMermaidActiveIndex,
    markdownMermaidBlocksLength: markdownMermaidBlocks.length,
    activeContextId,
    setActiveContextId,
  });

  const { safeAppendTimeStep, safeRecordTimeStep } = useStudioHistoryRecorder({
    appendTimeStep,
    isNotebookChatMode,
    activeChatContextId,
    mermaidCode: mermaidState.code,
    editorTab,
    markdownMermaidBlocksLength: markdownMermaidBlocks.length,
    markdownMermaidActiveIndex,
    getNotebookChatIndex,
  });

  const {
    whiteboardSceneJson,
    whiteboardBundleJson,
    saveWhiteboardForCurrentRevision,
    setWhiteboardFromRaw,
  } = useStudioWhiteboard({
    historyLoadResult,
    historySession,
    getRevision,
    updateCurrentRevisionWhiteboard,
    markdownMermaidBlocksLength: markdownMermaidBlocks.length,
    markdownMermaidActiveIndex,
    mermaidState,
    safeAppendTimeStep,
  });

  const startOperationForContext = useCallback(
    (title: string, contextId?: string, kind?: OperationKind) =>
      startOperation(title, contextId ?? activeChatContextId, kind),
    [activeChatContextId, startOperation],
  );

  const addMessageForActiveContext = useCallback(
    (role: Message["role"], content: string, mode?: Message["mode"]) =>
      addMessage(role, content, mode, activeChatContextId),
    [activeChatContextId, addMessage],
  );

  const getMessagesForActiveContext = useCallback(
    () => getMessages(activeChatContextId),
    [activeChatContextId, getMessages],
  );

  const activeMessages =
    activeContextId === activeChatContextId
      ? messages
      : getMessagesForContext(activeChatContextId);

  const diagramIntent = useMemo(
    () => diagramIntentByContext[activeChatContextId] ?? null,
    [activeChatContextId, diagramIntentByContext],
  );

  const setDiagramIntentForActiveContext = useCallback(
    (intent: DiagramIntent | null) => {
      setDiagramIntentByContext((prev) => ({
        ...prev,
        [activeChatContextId]: intent,
      }));
    },
    [activeChatContextId],
  );

  const resetDiagramIntents = useCallback(() => {
    setDiagramIntentByContext({});
  }, []);

  const historyModeByStepId = useMemo(() => {
    const map = new Map<string, string | undefined>();
    historySteps.forEach((step) => {
      const meta = step.meta as Record<string, unknown> | undefined;
      map.set(step.id, typeof meta?.mode === "string" ? meta.mode : undefined);
    });
    return map;
  }, [historySteps]);

  const editorDiagramMarkers = useMemo(() => {
    const isMarkdownContext =
      isMarkdownLike(mermaidState.code) && markdownMermaidBlocks.length > 0;
    const isDiagramTab = editorTab === "markdown_mermaid";
    return diagramMarkers.filter((marker) => {
      const mode = historyModeByStepId.get(marker.stepId);
      if (isMarkdownContext) {
        if (marker.type !== "build") return false;
        if (isDiagramTab) {
          const meta = (marker.meta ?? {}) as Record<string, unknown>;
          const blockIndex =
            typeof meta.blockIndex === "number" ? meta.blockIndex : null;
          return blockIndex === markdownMermaidActiveIndex;
        }
        return (
          mode === "markdown" || mode === "markdown_all" || mode === "notebook"
        );
      }
      return (
        mode !== "markdown" && mode !== "markdown_all" && mode !== "notebook"
      );
    });
  }, [
    diagramMarkers,
    editorTab,
    historyModeByStepId,
    markdownMermaidActiveIndex,
    markdownMermaidBlocks.length,
    mermaidState.code,
  ]);

  const toggleScrollSync = useCallback(() => {
    setAppState((prev) => ({
      ...prev,
      isScrollSyncEnabled: !prev.isScrollSyncEnabled,
    }));
  }, [setAppState]);

  const setNotebookBuildCount = useCallback(
    (count: number | string | null) => {
      setAppState((prev) => ({ ...prev, notebookBuildCount: count }));
    },
    [setAppState],
  );

  const setThinkingStyle = useCallback(
    (style: import("../../types").ThinkingStyle) => {
      setAppState((prev) => ({ ...prev, thinkingStyle: style }));
    },
    [setAppState],
  );

  useEffect(() => {
    const pending = diagramTypeWaitRef.current;
    if (pending && appState.diagramType === pending.target) {
      diagramTypeWaitRef.current = null;
      pending.resolve();
    }
  }, [appState.diagramType]);

  const detectedDiagramType = useMemo(() => {
    if (editorTab === "markdown_mermaid") {
      const activeBlock =
        markdownMermaidBlocks[markdownMermaidActiveIndex] ??
        markdownMermaidBlocks[0];
      return (
        activeBlock?.diagramType ??
        detectMermaidDiagramType(activeBlock?.code ?? "")
      );
    }
    if (editorTab !== "code") return null;
    if (isMarkdownLike(mermaidState.code)) return null;
    return detectMermaidDiagramType(mermaidState.code);
  }, [
    editorTab,
    markdownMermaidActiveIndex,
    markdownMermaidBlocks,
    mermaidState.code,
  ]);

  const resolvedAppDiagramType = useMemo<DiagramType>(() => {
    if (appState.diagramType !== "auto") return appState.diagramType;
    return detectedDiagramType ?? "flowchart";
  }, [appState.diagramType, detectedDiagramType]);

  const notebookDiagramTypeByBlock = useMemo(() => {
    const map = new Map<number, DiagramType>();
    historySteps.forEach((step) => {
      const meta = step.meta as Record<string, unknown> | undefined;
      if (!meta || meta.mode !== "notebook") return;
      const blockIndex =
        typeof meta.blockIndex === "number" ? meta.blockIndex : null;
      const diagramType =
        typeof meta.diagramType === "string"
          ? (meta.diagramType as DiagramType)
          : null;
      if (blockIndex === null || !diagramType) return;
      map.set(blockIndex, diagramType);
    });
    return map;
  }, [historySteps]);

  const docsDiagramType = useMemo<DiagramType>(() => {
    if (markdownMermaidBlocks.length > 0) {
      const plannedType =
        notebookDiagramTypeByBlock.get(markdownMermaidActiveIndex) ??
        notebookDiagramTypeByBlock.get(0) ??
        null;
      const activeBlock =
        markdownMermaidBlocks[markdownMermaidActiveIndex] ??
        markdownMermaidBlocks[0];
      return plannedType ?? activeBlock?.diagramType ?? resolvedAppDiagramType;
    }
    return resolvedAppDiagramType;
  }, [
    markdownMermaidActiveIndex,
    markdownMermaidBlocks,
    notebookDiagramTypeByBlock,
    resolvedAppDiagramType,
  ]);

  const {
    buildDocsEntries,
    buildDocsSelection,
    buildDocsSelectionKey,
    buildDocsActivePath,
    setBuildDocsActivePath,
    setBuildDocsActivePathForMode,
    getDocsContext,
    getViewerDocsContext,
    getDocsSelectionSummary,
    loadBuildDocsEntries,
    toggleBuildDocSelection,
    docsMode,
    setDocsMode,
    systemPromptRawByMode,
    setSystemPromptRaw,
    buildDocsSelectionsByMode,
    setBuildDocSelectionForMode,
    resetDocsSelectionsToDefault,
    buildDocsType,
  } = useBuildDocs(docsDiagramType);

  useEffect(() => {
    if (editorTab !== "build_docs") return;
    if (!buildDocsActivePath || !isSystemPromptPath(buildDocsActivePath))
      return;
    const modeFromPath = getSystemPromptModeFromPath(buildDocsActivePath);
    if (!modeFromPath) return;
    if (docsMode !== modeFromPath) {
      setDocsMode(modeFromPath);
    }
  }, [buildDocsActivePath, docsMode, editorTab, setDocsMode]);

  useEffect(() => {
    if (appState.diagramType === "auto") return;
    if (!detectedDiagramType) return;
    if (editorTab !== "code" && editorTab !== "markdown_mermaid") return;
    if (editorTab === "code" && mermaidState.source === "compiled") return;
    if (detectedDiagramType !== appState.diagramType) {
      setDiagramType(detectedDiagramType);
    }
  }, [
    appState.diagramType,
    detectedDiagramType,
    editorTab,
    mermaidState.source,
    setDiagramType,
  ]);

  const resolveActiveMermaidContext = useCallback(() => {
    if (markdownMermaidBlocks.length) {
      const activeBlock = markdownMermaidBlocks[markdownMermaidActiveIndex];
      const diagnostics =
        markdownMermaidDiagnostics[markdownMermaidActiveIndex];
      if (activeBlock) {
        return {
          code: activeBlock.code.trim(),
          errorMessage: diagnostics?.errorMessage,
          diagramType:
            notebookDiagramTypeByBlock.get(markdownMermaidActiveIndex) ??
            activeBlock.diagramType ??
            resolvedAppDiagramType,
          isValid: diagnostics?.isValid,
        };
      }
    }
    const rawCode = mermaidState.code.trim();
    if (isMarkdownLike(rawCode)) {
      return {
        code: "",
        errorMessage: undefined,
        diagramType: resolvedAppDiagramType,
        isValid: true,
      };
    }
    return {
      code: rawCode,
      errorMessage: mermaidState.errorMessage,
      diagramType: detectedDiagramType ?? resolvedAppDiagramType,
      isValid: mermaidState.isValid,
    };
  }, [
    detectedDiagramType,
    markdownMermaidActiveIndex,
    markdownMermaidBlocks,
    markdownMermaidDiagnostics,
    mermaidState.code,
    mermaidState.errorMessage,
    mermaidState.isValid,
    notebookDiagramTypeByBlock,
    resolvedAppDiagramType,
  ]);

  const chatMessagesForView = useNotebookChatView({
    isNotebookChatMode,
    messages: activeMessages,
  });

  const filteredOperationLogs = useMemo(() => {
    return operationLogs.filter(
      (log) => resolveOperationLogContextId(log) === activeChatContextId,
    );
  }, [activeChatContextId, operationLogs]);

  const filteredActiveOperationLog = useMemo(() => {
    for (let i = filteredOperationLogs.length - 1; i >= 0; i -= 1) {
      if (filteredOperationLogs[i].status === "running")
        return filteredOperationLogs[i];
    }
    return null;
  }, [filteredOperationLogs]);

  const activeOperationKind = useMemo(
    () => filteredActiveOperationLog?.kind ?? null,
    [filteredActiveOperationLog],
  );

  const {
    buildPromptPreview,
    promptPreviewByMode,
    resetPromptPreview,
    setPromptPreview,
  } = usePromptPreview({
    diagramType:
      editorTab === "build_docs"
        ? (buildDocsType ?? docsDiagramType)
        : docsDiagramType,
    mainDiagramTypes: appState.mainDiagramTypes,
    analyzeLanguage: appState.analyzeLanguage ?? "auto",
    appLanguage: appState.language ?? "auto",
    thinkingStyle: appState.thinkingStyle,
    isNotebookChatMode,
    isNotebookDataEnabled,
    promptScope:
      editorTab === "build_docs" && isNotebookDataEnabled
        ? buildDocsScope
        : null,
    messages: chatMessagesForView,
    diagramIntent,
    resolveActiveMermaidContext,
    getDocsContext:
      editorTab === "build_docs" ? getViewerDocsContext : getDocsContext,
  });

  useEffect(() => {
    if (editorTab !== "build_docs") {
      prevBuildDocsScopeRef.current = buildDocsScope;
      return;
    }
    const prevScope = prevBuildDocsScopeRef.current;
    if (prevScope !== buildDocsScope) {
      prevBuildDocsScopeRef.current = buildDocsScope;
      resetPromptPreview();
    }
  }, [buildDocsScope, editorTab, resetPromptPreview]);

  const { buildDocsIntentText } = useNotebookChat({
    isNotebookChatMode,
    isNotebookDataEnabled,
    getNotebookChatIndex,
    markdownMermaidBlocksLength: markdownMermaidBlocks.length,
    historySteps,
    getMessagesForContext,
    setMessagesForContext,
    diagramIntent,
    setDiagramIntent: setDiagramIntentForActiveContext,
  });
  const resolvedBuildDocsIntentText = useMemo(
    () => buildDocsIntentText?.trim() || "",
    [buildDocsIntentText],
  );

  useStudioHydration({
    historyLoadResult,
    historySteps,
    historySession,
    isHistoryReady,
    setMessagesForContext,
    setMermaidState,
    hydrateOperationLogs,
    safeAppendTimeStep,
    isHydratingRef,
    hydratedSessionIdRef,
    seededNotebookSessionIdsRef,
    lastManualRecordedCodeRef,
    mainContextId: MAIN_CHAT_CONTEXT_ID,
  });

  const {
    projects,
    activeProjectId,
    startNewProject,
    openProject,
    renameProject,
    removeProject,
    undoRemoveProject,
    deleteUndoMs: projectsUndoMs,
  } = useProjects({
    isProcessing,
    appState,
    setAppState,
    aiConfig,
    setAiConfig,
    modelParams,
    setModelParams,
    historySession,
    sessions,
    startNewSession,
    loadSession,
    renameHistorySession,
    scheduleDeleteSession,
    undoDeleteSession,
    deleteUndoMs: historyDeleteUndoMs,
    saveSessionSettings,
    loadSessionPreview,
    loadSessionSnapshot,
    resetMessages,
    resetPromptPreview,
    resetDiagramIntents,
    setEditorTab,
    setMermaidState,
    setOperationLogs,
    clearProjectPreview,
    lastManualRecordedCodeRef,
    isHydratingRef,
  });

  const { byoConfig, updateByoConfig } = useStorageConfig();
  const { storageMode, setStorageMode } = useStorageMode();

  const testByoConfig = useCallback(async () => {
    const provider = createSupabaseByoProvider(byoConfig);
    return provider.init();
  }, [byoConfig]);

  const cloud = useCloudControlPlane({
    enabled: storageMode === "cloud_hosted" || storageMode === "cloud_byo",
    mode: storageMode === "cloud_byo" ? "cloud_byo" : "cloud_hosted",
    byoConfig,
    localProjects: sessions,
    activeProjectId: historySession?.id ?? null,
    exportProjectBundle,
    importProjectBundle,
    openProject,
  });

  const cloudSync = cloud.sync;
  const cloudProjects = cloud.projects;
  const cloudMigration = cloud.migration;

  const sanitizeFileName = useCallback((value: string) => {
    return value
      .trim()
      .replace(/[\s/\\]+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "project";
  }, []);

  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportProject = useCallback(
    async (sessionId: string) => {
      const bundle = await exportProjectBundle(sessionId);
      if (!bundle) throw new Error("Project not found");
      const payload: ProjectBundleFile = {
        schema: "mermaid-langgraph.project",
        version: 1,
        exportedAt: Date.now(),
        bundle,
      };
      const safeTitle = sanitizeFileName(bundle.session.title ?? "project");
      const ts = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, "-");
      const filename = `${safeTitle}-${ts}.mlg.json`;
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      triggerDownload(blob, filename);
    },
    [exportProjectBundle, sanitizeFileName, triggerDownload]
  );

  const handleImportProject = useCallback(
    async (file: File, action: "copy" | "overwrite" | "open" = "copy") => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as Partial<ProjectBundleFile>;
        if (parsed?.schema !== "mermaid-langgraph.project" || parsed.version !== 1 || !parsed.bundle) {
          throw new Error("Invalid project backup format");
        }
        if (action === "open" && activeProjectId) {
          await openProject(activeProjectId);
          return;
        }
        if (action === "overwrite" && activeProjectId) {
          await importProjectBundle(
            { ...parsed.bundle, session: { ...parsed.bundle.session, id: activeProjectId } },
            { mode: "replace", setActive: true }
          );
          await openProject(activeProjectId);
          return;
        }
        const session = await importProjectBundle(parsed.bundle, { mode: "new", setActive: true });
        if (session?.id) {
          await openProject(session.id);
        }
      } catch (error) {
        if (error instanceof StorageConflictError) {
          return;
        }
        throw error;
      }
    },
    [activeProjectId, importProjectBundle, openProject]
  );

  useEffect(() => {
    if (editorTab !== "build_docs") return;
    if (buildDocsEntries.length > 0) return;
    void loadBuildDocsEntries(appState.diagramType);
  }, [
    appState.diagramType,
    buildDocsEntries.length,
    editorTab,
    loadBuildDocsEntries,
  ]);

  useManualEditRecorder({
    isHistoryReady,
    isHydratingRef,
    isProcessing,
    mermaidState,
    lastManualRecordedCodeRef,
    historySessionCurrentRevisionId: historySession?.currentRevisionId,
    appendTimeStep,
    updateCurrentRevision,
  });

  const resolveMermaidUpdateTarget = useCallback(() => {
    if (markdownMermaidBlocks.length > 0) {
      const activeBlock =
        markdownMermaidBlocks[markdownMermaidActiveIndex] ??
        markdownMermaidBlocks[0];
      if (activeBlock) return { mode: "markdown" as const, block: activeBlock };
    }
    return { mode: "code" as const };
  }, [markdownMermaidActiveIndex, markdownMermaidBlocks]);

  const startMarkdownNotebook = useCallback(
    (args?: { blocks?: number }) => {
      if (isProcessing) return;

      const fallback = () => {
        const nextMarkdown = createMermaidNotebookMarkdown({
          blocks: args?.blocks ?? 3,
        });
        handleMermaidChange(nextMarkdown);
        setMarkdownMermaidActiveIndex(0);
        setEditorTab("markdown_mermaid");
      };

      void (async () => {
        try {
          const res = await fetch("/diagram-notebook.md", {
            cache: "no-cache",
          });
          if (!res.ok) return fallback();
          const template = await res.text();
          if (!template.trim()) return fallback();
          handleMermaidChange(template);
          setMarkdownMermaidActiveIndex(0);
          setEditorTab("markdown_mermaid");
        } catch {
          fallback();
        }
      })();
    },
    [
      handleMermaidChange,
      isProcessing,
      setEditorTab,
      setMarkdownMermaidActiveIndex,
    ],
  );

  const appendMarkdownMermaidBlock = useCallback(() => {
    if (isProcessing) return;
    const nextMarkdown = appendEmptyMermaidBlockToMarkdown(mermaidState.code);
    handleMermaidChange(nextMarkdown);
    setMarkdownMermaidActiveIndex(markdownMermaidBlocks.length);
    setEditorTab("markdown_mermaid");
  }, [
    handleMermaidChange,
    isProcessing,
    markdownMermaidBlocks.length,
    mermaidState.code,
    setEditorTab,
    setMarkdownMermaidActiveIndex,
  ]);

  const openNotebookBlock = useCallback(
    (index: number) => {
      if (!markdownMermaidBlocks.length) return;
      const safeIndex = Math.max(
        0,
        Math.min(index, markdownMermaidBlocks.length - 1),
      );
      setMarkdownMermaidActiveIndex(safeIndex);
      setEditorTab("markdown_mermaid");
    },
    [markdownMermaidBlocks.length, setEditorTab, setMarkdownMermaidActiveIndex],
  );

  const backToNotebookMainChat = useCallback(() => {
    if (markdownMermaidBlocks.length) {
      setMarkdownMermaidActiveIndex(0);
    }
    setEditorTab("code");
  }, [
    markdownMermaidBlocks.length,
    setMarkdownMermaidActiveIndex,
    setEditorTab,
  ]);

  const setDiagramTypeAndWait = useCallback(
    (target: DiagramType) => {
      if (appState.diagramType === target) return Promise.resolve();
      return new Promise<void>((resolve) => {
        diagramTypeWaitRef.current = { target, resolve };
        setDiagramType(target);
      });
    },
    [appState.diagramType, setDiagramType],
  );

  const llmSessionId = getOpenCodeGoSessionId(historySession?.id ?? draftProjectId, activeChatContextId);

  const buildLLMRequestContext = useCallback(
    (args: {
      diagramType?: DiagramType;
      allowedDiagramTypes?: DiagramType[] | null;
      docsContext: string;
      language: string;
    }) => {
      const resolvedDiagramType = args.diagramType ?? appState.diagramType;
      const resolvedAllowedDiagramTypes =
        args.allowedDiagramTypes ??
        (resolvedDiagramType === "auto" ? appState.mainDiagramTypes : null);
      return {
        sessionId: llmSessionId,
        diagramType: resolvedDiagramType,
        allowedDiagramTypes: resolvedAllowedDiagramTypes,
        docsContext: args.docsContext,
        language: args.language,
        thinkingStyle: appState.thinkingStyle,
      };
    },
    [appState.diagramType, appState.mainDiagramTypes, appState.thinkingStyle, llmSessionId],
  );

  const { handleNotebookBuild } = useNotebookBuild({
    llmSessionId,
    aiConfig,
    modelParams,
    appState,
    connectionState,
    messages: activeMessages,
    diagramIntent,
    addMessage: addMessageForActiveContext,
    setMessages,
    safeAppendTimeStep,
    setIsProcessing,
    setMarkdownMermaidActiveIndex,
    setEditorTab,
    setDiagramTypeAndWait,
    setMermaidState,
    getDocsContext,
    getDocsSelectionSummary,
    loadBuildDocsEntries,
    buildLLMRequestContext,
    startOperation: (title, kind) => startOperation(title, "main", kind),
    addOperationEvent,
    finishOperation,
    getOperationLog,
    onLLMRequestStart: handleLLMRequestStart,
    getAbortSignal,
  });

  const analyticsAdapter = useMemo(() => {
    return createAnalyticsAdapter({
      aiConfig,
      appState,
      modelParams,
      getDocsUsageSummary: getDocsSelectionSummary,
      resolveDiagramType: () =>
        resolveActiveMermaidContext().diagramType ?? appState.diagramType,
      trackEvent: trackAnalyticsEventService,
    });
  }, [
    aiConfig,
    appState,
    getDocsSelectionSummary,
    modelParams,
    resolveActiveMermaidContext,
  ]);

  const getAnalyticsContext = useCallback(
    (mode: DocsMode) => {
      return analyticsAdapter.getContext(mode);
    },
    [analyticsAdapter],
  );

  const trackAnalyticsEvent = useCallback(
    (event: string, payload?: Record<string, unknown>) => {
      analyticsAdapter.track(event, payload);
    },
    [analyticsAdapter],
  );

  const trackAnalyticsWithContext = useCallback(
    (event: string, mode: DocsMode, payload?: Record<string, unknown>) => {
      return analyticsAdapter.trackWithContext(event, mode, payload);
    },
    [analyticsAdapter],
  );

  const {
    handleChatMessage: baseHandleChatMessage,
    handleBuildFromPrompt: baseHandleBuildFromPrompt,
    handleRecompile,
    handleFixSyntax: baseHandleFixSyntax,
    handleAnalyze,
  } = createStudioActions({
    llmSessionId,
    aiConfig,
    connectionState,
    appState,
    isNotebookChatEnabled,
    isNotebookChatMode,
    modelParams,
    mermaidState,
    diagramIntent,
    setDiagramIntent: setDiagramIntentForActiveContext,
    setMermaidState,
    addMessage: addMessageForActiveContext,
    getMessages: getMessagesForActiveContext,
    getDiagramContextCode: () => resolveActiveMermaidContext().code,
    resolveMermaidUpdateTarget,
    getNotebookChatIndex,
    getAnalyticsContext,
    trackAnalyticsEvent,
    trackAnalyticsWithContext,
    getDocsContext,
    getDocsSelectionSummary,
    setIsProcessing,
    recordTimeStep: safeRecordTimeStep,
    startOperation: startOperationForContext,
    addOperationEvent,
    finishOperation,
    getOperationLog,
    historySession,
    onLLMRequestStart: handleLLMRequestStart,
    getAbortSignal,
  });

  const { handleFixSyntax } = useFixFlow({
    aiConfig,
    modelParams,
    appDiagramType: resolvedAppDiagramType,
    thinkingStyle: appState.thinkingStyle,
    buildLLMRequestContext,
    connectionStatus: connectionState.status,
    messages: activeMessages,
    mermaidState,
    markdownMermaidBlocks,
    markdownMermaidDiagnostics,
    markdownMermaidActiveIndex,
    setMarkdownMermaidActiveIndex,
    handleMermaidChange,
    addMessage: addMessageForActiveContext,
    setMessages,
    safeAppendTimeStep,
    getDocsContext,
    getDocsSelectionSummary,
    trackAnalyticsWithContext,
    setIsProcessing,
    baseHandleFixSyntax,
    onLLMRequestStart: handleLLMRequestStart,
    getAbortSignal,
    llmTimeoutMs: appState.llmTimeoutMs,
    startOperation: startOperationForContext,
    addOperationEvent,
    finishOperation,
    getOperationLog,
  });

  const baseHandleChatMessageWithAbort = useCallback(
    (text: string) => runWithAbortController(() => baseHandleChatMessage(text)),
    [baseHandleChatMessage, runWithAbortController],
  );

  const baseHandleBuildFromPromptWithAbort = useCallback(
    (text?: string) =>
      runWithAbortController(() => baseHandleBuildFromPrompt(text)),
    [baseHandleBuildFromPrompt, runWithAbortController],
  );

  const handleNotebookBuildWithAbort = useCallback(
    (text?: string) => runWithAbortController(() => handleNotebookBuild(text)),
    [handleNotebookBuild, runWithAbortController],
  );

  const handleFixSyntaxWithAbort = useCallback(
    () => runWithAbortController(() => handleFixSyntax()),
    [handleFixSyntax, runWithAbortController],
  );

  const handleAnalyzeWithAbort = useCallback(
    () => runWithAbortController(() => handleAnalyze()),
    [handleAnalyze, runWithAbortController],
  );

  const handleRecompileWithAbort = useCallback(
    () => runWithAbortController(() => handleRecompile()),
    [handleRecompile, runWithAbortController],
  );

  const {
    handleChatMessage,
    handleBuildFromPrompt,
  } = useStudioChatFlow({
    activeChatContextId,
    mainContextId: MAIN_CHAT_CONTEXT_ID,
    appDiagramType: appState.diagramType,
    resolveActiveMermaidContext,
    setDiagramTypeAndWait,
    loadBuildDocsEntries,
    baseHandleChatMessage: baseHandleChatMessageWithAbort,
    baseHandleBuildFromPrompt: baseHandleBuildFromPromptWithAbort,
    handleNotebookBuild: handleNotebookBuildWithAbort,
  });

  const handleManualSnapshot = useCallback(async () => {
    if (isProcessing) return;
    const code = mermaidState.code;
    if (!code.trim()) return;
    const activeDiagnostics =
      markdownMermaidDiagnostics[markdownMermaidActiveIndex];
    const isMarkdownSnapshot = editorTab === "markdown_mermaid";
    const isSnapshotInvalid = isMarkdownSnapshot
      ? activeDiagnostics?.isValid === false
      : !mermaidState.isValid;
    if (isSnapshotInvalid) return;
    lastManualRecordedCodeRef.current = code;

    await safeAppendTimeStep({
      type: "manual_edit",
      messages: [],
      nextMermaid: {
        code,
        isValid: mermaidState.isValid,
        errorMessage: mermaidState.errorMessage,
        errorLine: mermaidState.errorLine,
      },
    });
  }, [
    editorTab,
    isProcessing,
    mermaidState.code,
    mermaidState.errorLine,
    mermaidState.errorMessage,
    mermaidState.isValid,
    markdownMermaidActiveIndex,
    markdownMermaidDiagnostics,
    safeAppendTimeStep,
  ]);

  const goToDiagramStep = async (
    marker: DiagramMarker | Pick<DiagramMarker, "stepId"> | string,
  ) => {
    const stepId = typeof marker === "string" ? marker : marker.stepId;
    const markerMeta =
      typeof marker === "string"
        ? null
        : "meta" in marker
          ? (marker.meta ?? null)
          : null;
    const revision = await selectDiagramStep(stepId);
    if (!revision) return;

    lastManualRecordedCodeRef.current = revision.mermaid;
    setWhiteboardFromRaw(revision.whiteboard ?? null);
    setMermaidState((prev) => ({
      ...prev,
      code: revision.mermaid,
      isValid: revision.diagnostics?.isValid ?? true,
      lastValidCode:
        revision.diagnostics?.isValid === false
          ? prev.lastValidCode
          : revision.mermaid,
      errorMessage: revision.diagnostics?.errorMessage,
      errorLine: revision.diagnostics?.errorLine,
      status: revision.mermaid.trim()
        ? (revision.diagnostics?.isValid ?? true)
          ? "valid"
          : "invalid"
        : "empty",
      source: "compiled",
    }));
    if (isMarkdownLike(revision.mermaid)) {
      const blocks = extractMermaidBlocksFromMarkdown(revision.mermaid);
      const metaBlockIndex =
        markerMeta && typeof markerMeta.blockIndex === "number"
          ? markerMeta.blockIndex
          : null;
      const safeMetaIndex =
        metaBlockIndex !== null &&
        metaBlockIndex >= 0 &&
        metaBlockIndex < blocks.length
          ? metaBlockIndex
          : null;
      const firstNonEmptyIndex = blocks.findIndex(
        (block) => block.code.trim().length > 0,
      );
      const nextIndex =
        safeMetaIndex !== null
          ? safeMetaIndex
          : firstNonEmptyIndex >= 0
            ? firstNonEmptyIndex
            : 0;
      setMarkdownMermaidActiveIndex(nextIndex);
      if (editorTab === "build_docs") {
        setBuildDocsScope("diagram");
      }
    }
  };

  const handleDiagramTypeChange = async (type: DiagramType) => {
    setDiagramType(type);
    setDiagramIntentForActiveContext(null);
    resetPromptPreview();
    setNotebookBuildCount(type === "auto" ? null : 1);
    void loadBuildDocsEntries(type);
  };

  return {
    aiConfig,
    setAiConfig,
    modelParams,
    setModelParams,
    connectionState,
    mermaidState,
    messages: chatMessagesForView,
    setMessages, // Kept for compatibility if needed, though addMessage/clearMessages is preferred
    appState,
    setAppState,
    isProcessing,
    connectAI,
    disconnectAI,
    handleMermaidChange,
    handleChatMessage,
    handleBuildFromPrompt,
    handleRecompile: handleRecompileWithAbort,
    handleFixSyntax: handleFixSyntaxWithAbort,
    handleAnalyze: handleAnalyzeWithAbort,
    stopActiveOperation,
    handleManualSnapshot,
    diagramMarkers,
    diagramStepAnchors,
    editorDiagramMarkers,
    selectedStepId,
    projects,
    activeProjectId,
    diagramIntent,
    promptPreviewByMode,
    editorTab,
    buildDocsScope,
    buildDocsEntries,
    buildDocsSelection,
    toggleBuildDocSelection,
    buildDocsSelectionKey,
    buildDocsActivePath,
    setBuildDocsActivePath,
    setBuildDocsActivePathForMode,
    loadBuildDocsEntries,
    docsMode,
    setDocsMode,
    systemPromptRawByMode,
    setSystemPromptRaw,
    buildDocsSelectionsByMode,
    setBuildDocSelectionForMode,
    resetDocsSelectionsToDefault,
    markdownMermaidBlocks,
    markdownMermaidDiagnostics,
    markdownMermaidActiveIndex,
    setMarkdownMermaidActiveIndex,
    detectedDiagramType,
    goToDiagramStep,
    startResize,
    setDiagramType: handleDiagramTypeChange,
    setMainDiagramTypes,
    clearMessages,
    startNewProject,
    openProject,
    renameProject,
    removeProject,
    undoRemoveProject,
    exportProject: handleExportProject,
    importProject: handleImportProject,
    byoConfig,
    updateByoConfig,
    testByoConfig,
    storageMode,
    setStorageMode,
    cloudSync,
    cloudProjects,
    cloudMigration,
    deleteUndoMs: projectsUndoMs,
    loadSessionPreview,
    showProjectPreview,
    clearProjectPreview,
    previewMermaidState,
    toggleTheme,
    setThemePreset,
    setAnalyzeLanguage,
    setLLMTimeoutMs,
    togglePreviewFullScreen,
    toggleScrollSync,
    setNotebookBuildCount,
    setThinkingStyle,
    buildDocsIntentText: resolvedBuildDocsIntentText,
    buildPromptPreview,
    setPromptPreview,
    setEditorTab,
    setNextBuildDocsScope,
    startMarkdownNotebook,
    appendMarkdownMermaidBlock,
    openNotebookBlock,
    backToNotebookMainChat,
    isNotebookChatMode,
    operationLogs: filteredOperationLogs,
    activeOperationLog: filteredActiveOperationLog,
    activeOperationKind,
    onLLMRequestStart: handleLLMRequestStart,

    historySessionCurrentRevisionId: historySession?.currentRevisionId ?? null,
    whiteboardSceneJson,
    whiteboardBundleJson,
    saveWhiteboardForCurrentRevision,
  };
};
