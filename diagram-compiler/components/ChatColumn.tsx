import React, {
  useCallback,
  useRef,
  useEffect,
  useState,
} from "react";
import {
  ArrowLeft,
  MessageSquare,
  Play,
  Plus,
  Trash2,
  Loader2,
  Square,
} from "lucide-react";
import {
  LLMRequestPreview,
  Message,
  PromptPreviewMode,
  PromptTokenCounts,
} from "../types";
import type { DiagramType } from "../types";
import ChatProjects from "./ChatProjects";
import { Button } from "./ui/Button";
import { MODE_BUTTON_DISABLED, MODE_UI } from "../utils/uiModes";
import "./chat-markdown.css";
import ChatSummaryCard from "./chat/ChatSummaryCard";
import ChatMessageList from "./chat/ChatMessageList";
import { useChatColumnViewModel } from "./chat/useChatColumnViewModel";
import type { OperationLog } from "../types";
import { useResizablePane } from "../hooks/core/useResizablePane";

interface ChatColumnProps {
  messages: Message[];
  onChat: (text: string) => void;
  onBuild: (text?: string) => void;
  onClear: () => void;
  onNewProject: () => void;
  isProcessing: boolean;
  simpleMode?: boolean;
  isAIReady?: boolean;
  onStop?: () => void;
  hasIntent: boolean;
  onSetPromptPreview: (
    mode: PromptPreviewMode,
    title: string,
    redactedContent: string,
    rawContent: string,
    tokenCounts?: PromptTokenCounts,
    systemPrompt?: string,
    systemPromptRedacted?: string,
    language?: string,
    intentText?: string,
  ) => void;
  intentText?: string;
  diagramType: DiagramType;
  onDiagramTypeChange: (type: DiagramType) => void;
  mainDiagramTypes: DiagramType[];
  onMainDiagramTypesChange: (types: DiagramType[]) => void;
  detectedDiagramType: DiagramType | null;
  onPreviewPrompt: (
    mode: PromptPreviewMode,
    input: string,
  ) => Promise<LLMRequestPreview>;
  buildDocsSelectionKey: string;
  promptPreviewKey: string;
  onOpenNotebookBlock?: (index: number) => void;
  isNotebookChatMode?: boolean;
  onBackToNotebookMainChat?: () => void;
  projects: React.ComponentProps<typeof ChatProjects>["projects"];
  activeProjectId: React.ComponentProps<typeof ChatProjects>["activeProjectId"];
  onOpenProject: (sessionId: string) => void | Promise<void>;
  onRenameProject: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteProject: (sessionId: string) => void | Promise<void>;
  onUndoDeleteProject: (sessionId: string) => void;
  onPreviewProjectSnapshot: (sessionId: string) => Promise<void>;
  onClearProjectPreview: () => void;
  onExportProject: (sessionId: string) => Promise<void>;
  onImportProject: (file: File, action?: "copy" | "overwrite" | "open") => Promise<void>;
  byoConfig: { url: string; anonKey: string };
  onByoConfigChange: (updates: { url?: string; anonKey?: string }) => void;
  onTestByoConfig: () => Promise<{ ok: boolean; error?: string }>;
  deleteUndoMs: number;
  notebookBuildCount: number | string | null;
  onNotebookBuildCountChange: (count: number | string | null) => void;
  llmTimeoutMs: number;
  appLanguage: string;
  thinkingStyle: import("../types").ThinkingStyle;
  onThinkingStyleChange: (style: import("../types").ThinkingStyle) => void;
  operationLogs?: OperationLog[];
  activeOperationKind?: "chat" | "build" | "analyze" | "fix" | "compile" | null;
  onOpenBuildDocsFile?: (
    fileName: string,
    mode: import("../types").DocsMode,
    options?: { blockIndex?: number | null },
  ) => void;
  headerAddon?: React.ReactNode;
}

const ChatColumn: React.FC<ChatColumnProps> = ({
  messages,
  onChat,
  onBuild,
  onClear,
  onNewProject,
  isProcessing,
  simpleMode = false,
  isAIReady = true,
  onStop,
  hasIntent,
  onSetPromptPreview,
  diagramType,
  onDiagramTypeChange,
  mainDiagramTypes,
  onMainDiagramTypesChange,
  detectedDiagramType,
  onPreviewPrompt,
  buildDocsSelectionKey,
  promptPreviewKey,
  onOpenNotebookBlock,
  isNotebookChatMode = false,
  onBackToNotebookMainChat,
  projects,
  activeProjectId,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onUndoDeleteProject,
  onPreviewProjectSnapshot,
  onClearProjectPreview,
  onExportProject,
  onImportProject,
  byoConfig,
  onByoConfigChange,
  onTestByoConfig,
  deleteUndoMs,
  notebookBuildCount,
  onNotebookBuildCountChange,
  llmTimeoutMs,
  appLanguage,
  thinkingStyle,
  onThinkingStyleChange,
  intentText,
  operationLogs,
  activeOperationKind,
  onOpenBuildDocsFile,
  headerAddon,
}) => {
  const [input, setInput] = useState("");
  const columnRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessagesCountRef = useRef(messages.length);
  const previewRequestRef = useRef(0);
  const previewTimerRef = useRef<number | null>(null);
  const lastMessageTimestamp = messages[messages.length - 1]?.timestamp ?? 0;
  const estimateTokens = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.ceil(trimmed.length / 4));
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  useEffect(() => {
    const prevCount = prevMessagesCountRef.current;
    const nextCount = messages.length;
    prevMessagesCountRef.current = nextCount;

    // When chat resets (new project / clear), avoid smooth scrolling artifacts.
    if (nextCount < prevCount) {
      const el = messagesContainerRef.current;
      if (el) {
        el.scrollTo({ top: 0, behavior: "auto" });
      }
      isAtBottomRef.current = true;
      return;
    }

    if (isAtBottomRef.current) scrollToBottom("smooth");
  }, [messages.length]);

  const onMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const thresholdPx = 64;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx;
  };

  const formatMessagesForPreview = useCallback((previewMessages: Message[]) => {
    if (previewMessages.length === 0) return "(no messages)";
    return previewMessages
      .map((message) => {
        const roleLabel = message.role.toUpperCase();
        const content = message.content.trim() || "(empty)";
        return `[${roleLabel}] ${content}`;
      })
      .join("\n\n");
  }, []);

  const {
    summaryText,
    chatMessages,
    isStatusMessage,
    getStatusStyle,
    chatSummaryMessage,
    inlineLogsByMessageId,
    unanchoredLogs,
    summarizeBuildLog,
  } = useChatColumnViewModel({
    messages,
    intentText,
    isNotebookChatMode,
    operationLogs,
  });
  const isSmartZeroState =
    chatMessages.length === 0 &&
    unanchoredLogs.length === 0 &&
    !isProcessing &&
    !isNotebookChatMode;

  const formatRequestPreview = useCallback(
    (preview: LLMRequestPreview, options: { redactDocs: boolean }) => {
      const redactedSystemPrompt = preview.systemPromptRedacted?.trim()
        ? preview.systemPromptRedacted
        : preview.docsContext &&
            preview.systemPrompt.includes(preview.docsContext)
          ? preview.systemPrompt.replace(
              preview.docsContext,
              "Documentation context redacted.",
            )
          : preview.systemPrompt;
      const systemPromptValue = options.redactDocs
        ? redactedSystemPrompt
        : preview.systemPrompt;
      const metaLines =
        preview.mode === "build"
          ? [
              `Mode: ${preview.mode}`,
              `Diagram type: ${preview.diagramType}`,
              `Language: ${preview.language}`,
            ]
          : [];
      const lines = [
        preview.error ? `Error: ${preview.error}` : "",
        ...metaLines,
        "",
        "--- System Prompt ---",
        systemPromptValue.trim() || "(empty)",
        "",
        "--- Messages ---",
        formatMessagesForPreview(preview.messages),
      ].filter((line) => line !== "");
      return lines.join("\n");
    },
    [formatMessagesForPreview],
  );

  const handleSubmit = (mode: "chat" | "build", e?: React.FormEvent) => {
    e?.preventDefault();
    if (isProcessing) return;

    onClearProjectPreview();

    if (mode === "chat") {
      if (!input.trim()) return;
      onChat(input);
      setInput("");
      return;
    }

    const prompt = input.trim();
    if (prompt) {
      onBuild(prompt);
      setInput("");
      return;
    }

    if (!hasIntent) return;
    onBuild(undefined);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit("build");
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit("chat");
    }
  };

  const updatePromptPreview = useCallback(
    async (mode: PromptPreviewMode, promptInput: string, requestId: number) => {
      const title =
        mode === "chat"
          ? "LLM request (Chat)"
          : mode === "build"
            ? "LLM request (Build)"
            : mode === "plan"
              ? "LLM request (Plan)"
              : mode === "analyze"
                ? "LLM request (Analyze)"
                : "LLM request (Fix)";
      try {
        const preview = await onPreviewPrompt(mode, promptInput);
        if (requestId !== previewRequestRef.current) return;
        const systemTokens = estimateTokens(preview.systemPrompt);
        const messagesTokens = preview.messages.reduce(
          (sum, msg) => sum + estimateTokens(msg.content),
          0,
        );
        const tokenCounts: PromptTokenCounts = {
          system: systemTokens,
          messages: messagesTokens,
          total: systemTokens + messagesTokens,
        };
        const redacted = formatRequestPreview(preview, { redactDocs: true });
        const raw = formatRequestPreview(preview, { redactDocs: false });
        const intentMessage = preview.messages.find((message) =>
          /^Intent:\s*/i.test(message.content.trim()),
        );
        const resolvedIntent =
          mode === "plan"
            ? preview.messages
                .map((message) => message.content)
                .join("\n\n")
                .trim()
            : intentMessage
              ? intentMessage.content.replace(/^Intent:\s*/i, "").trim()
              : intentText?.trim();
        onSetPromptPreview(
          mode,
          title,
          redacted,
          raw,
          tokenCounts,
          preview.systemPrompt,
          preview.systemPromptRedacted,
          preview.language,
          resolvedIntent,
        );
      } catch (error: unknown) {
        if (requestId !== previewRequestRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        const errorText = `Error: ${message}`;
        onSetPromptPreview(mode, title, errorText, errorText);
      }
    },
    [formatRequestPreview, intentText, onPreviewPrompt, onSetPromptPreview],
  );

  useEffect(() => {
    const requestId = ++previewRequestRef.current;
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = window.setTimeout(() => {
      void updatePromptPreview("chat", input, requestId);
      void updatePromptPreview("build", input, requestId);
      void updatePromptPreview("plan", input, requestId);
      void updatePromptPreview("analyze", input, requestId);
      void updatePromptPreview("fix", input, requestId);
    }, 250);

    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, [
    buildDocsSelectionKey,
    diagramType,
    hasIntent,
    input,
    lastMessageTimestamp,
    messages.length,
    onPreviewPrompt,
    promptPreviewKey,
    updatePromptPreview,
  ]);

  const { size: composerHeight, onResizeStart } = useResizablePane({
    initialSize: 200,
    minSize: 140,
    maxOffset: 200,
    containerRef: columnRef,
  });

  return (
    <div
      ref={columnRef}
      className="flex flex-col h-full bg-transparent"
      style={{ backgroundColor: "var(--panel-bg, #f3f4f6)" }}
    >
      <ChatProjects
        mode="panel"
        simpleMode={simpleMode}
        chatStatus={isProcessing ? "running" : "idle"}
        projects={projects}
        activeProjectId={activeProjectId}
        onNewProject={onNewProject}
        onOpenProject={onOpenProject}
        onRenameProject={onRenameProject}
        onDeleteProject={onDeleteProject}
        onUndoDeleteProject={onUndoDeleteProject}
        onPreviewProjectSnapshot={onPreviewProjectSnapshot}
        onClearProjectPreview={onClearProjectPreview}
        onExportProject={onExportProject}
        onImportProject={onImportProject}
        byoConfig={byoConfig}
        onByoConfigChange={onByoConfigChange}
        onTestByoConfig={onTestByoConfig}
        deleteUndoMs={deleteUndoMs}
        diagramType={diagramType}
        onDiagramTypeChange={onDiagramTypeChange}
        mainDiagramTypes={mainDiagramTypes}
        onMainDiagramTypesChange={onMainDiagramTypesChange}
        detectedDiagramType={detectedDiagramType}
        notebookBuildCount={notebookBuildCount}
        onNotebookBuildCountChange={onNotebookBuildCountChange}
        thinkingStyle={thinkingStyle}
        onThinkingStyleChange={onThinkingStyleChange}
      />
      {headerAddon}
      {simpleMode && !isAIReady && (
        <div role="status" className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          AI is not connected. Choose a provider in the AI menu above for Chat and Build. Manual code editing and export remain available in Studio.
        </div>
      )}

      {isNotebookChatMode && onBackToNotebookMainChat && (
        <div
          className="px-4 py-2 border-t bg-transparent text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between"
          style={{ borderColor: "var(--panel-border, #e5e7eb)" }}
        >
          <span>Чат диаграммы</span>
          <Button
            type="button"
            variant="ghost"
            onClick={onBackToNotebookMainChat}
            className="h-auto px-1 py-0 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <ArrowLeft size={12} />
            Назад в основной чат
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 px-3 pt-3 pb-0 flex flex-col gap-2">
        {(!simpleMode || Boolean(summaryText?.trim())) && <ChatSummaryCard summaryText={summaryText} />}

        <section className="rounded-md border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 flex flex-col min-h-0 flex-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200/60 dark:border-slate-800/60">
            Chat
          </div>
          <ChatMessageList
            messages={messages}
            chatMessages={chatMessages}
            inlineLogsByMessageId={inlineLogsByMessageId}
            unanchoredLogs={unanchoredLogs}
            llmTimeoutMs={llmTimeoutMs}
            appLanguage={appLanguage}
            isZeroState={isSmartZeroState}
            onZeroStatePrompt={(prompt) => {
              if (isProcessing) return;
              setInput(prompt);
              if (isAIReady) {
                onBuild(prompt);
                setInput("");
              }
            }}
            onOpenNotebookBlock={onOpenNotebookBlock}
            onOpenBuildDocsFile={onOpenBuildDocsFile}
            isProcessing={isProcessing}
            isStatusMessage={isStatusMessage}
            getStatusStyle={getStatusStyle}
            summarizeBuildLog={summarizeBuildLog}
            chatSummaryMessage={chatSummaryMessage}
            messagesContainerRef={messagesContainerRef}
            messagesEndRef={messagesEndRef}
            onMessagesScroll={onMessagesScroll}
          />
        </section>
      </div>

      <div
        className="group relative h-4 cursor-row-resize flex items-center justify-center bg-transparent"
        onMouseDown={onResizeStart}
        title="Resize input"
      >
        <div className="h-px w-full bg-slate-200 dark:bg-slate-800" />
        <div className="absolute h-1 w-12 rounded-full bg-slate-300/70 dark:bg-slate-600/70 group-hover:bg-slate-400/80 dark:group-hover:bg-slate-500/80" />
      </div>

      {/* Composer */}
      <div
        className="flex flex-col p-3 bg-transparent"
        style={{ height: composerHeight }}
      >
        <div className="relative flex-1 min-h-0">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={simpleMode ? "Describe what your diagram should show…" : "Type specification…"}
            className="w-full h-full resize-none rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {!simpleMode && <Button
                onClick={onNewProject}
                variant="ghost"
                className="h-auto px-1 py-0 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 transition-colors"
                title="Create a fresh local project"
                type="button"
              >
                <Plus size={12} /> New project
              </Button>}
              <Button
                onClick={onClear}
                variant="ghost"
                className="h-auto px-1 py-0 text-xs text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1 transition-colors"
                title="Clear chat history"
                type="button"
              >
                <Trash2 size={12} /> Clear spec
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                {"Enter: Chat • Ctrl/Cmd+Enter: Build"}
              </span>
              {isProcessing && onStop && (
                <Button
                  onClick={onStop}
                  className="px-2.5 py-1.5 text-xs rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap bg-red-500 text-white hover:bg-red-600 border border-red-500"
                  title="Stop current operation"
                  type="button"
                >
                  <Square size={14} /> Stop
                </Button>
              )}
              <Button
                onClick={() => handleSubmit("chat")}
                disabled={!input.trim() || isProcessing || !isAIReady}
                className={`px-2.5 py-1.5 text-xs rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  !input.trim() || isProcessing || !isAIReady
                    ? MODE_BUTTON_DISABLED
                    : MODE_UI.chat.button
                }`}
                title="Chat (text only)"
              >
                {activeOperationKind === "chat" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <MessageSquare size={14} />
                )}{" "}
                Chat
              </Button>
              <Button
                onClick={() => handleSubmit("build")}
                disabled={(!input.trim() && !hasIntent) || isProcessing || !isAIReady}
                className={`px-2.5 py-1.5 text-xs rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  (!input.trim() && !hasIntent) || isProcessing || !isAIReady
                    ? MODE_BUTTON_DISABLED
                    : MODE_UI.build.button
                }`}
                title={
                  input.trim()
                    ? "Build a diagram or notebook from this description"
                    : "Build a diagram or notebook from intent"
                }
              >
                {activeOperationKind === "build" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}{" "}
                Build
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatColumn;
