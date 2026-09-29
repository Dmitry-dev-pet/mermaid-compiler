import React from "react";
import { ArrowUpRight } from "lucide-react";
import type { Message, OperationLog } from "../../types";
import ChatOperationLog from "./ChatOperationLog";
import { Button } from "../ui/Button";
import { parseNotebookBuildMessage } from "./chatMessageUtils";
import { detectLanguage } from "../../utils";
import SmartZeroState from "./SmartZeroState";
import { DEFAULT_ZERO_STATE_PRESETS } from "../../services/zeroStatePresets";

type ChatMessageListProps = {
  messages: Message[];
  chatMessages: Message[];
  inlineLogsByMessageId: Map<string, OperationLog[]>;
  unanchoredLogs: OperationLog[];
  llmTimeoutMs: number;
  appLanguage: string;
  onOpenNotebookBlock?: (index: number) => void;
  onOpenBuildDocsFile?: (
    fileName: string,
    mode: import("../../types").DocsMode,
    options?: { blockIndex?: number | null },
  ) => void;
  isProcessing: boolean;
  isStatusMessage: (message: Message) => boolean;
  getStatusStyle: (mode?: Message["mode"]) => string;
  summarizeBuildLog: (log: OperationLog) => string;
  chatSummaryMessage: string | null;
  isZeroState?: boolean;
  onZeroStatePrompt?: (prompt: string) => void;
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onMessagesScroll: () => void;
};

const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  chatMessages,
  inlineLogsByMessageId,
  unanchoredLogs,
  llmTimeoutMs,
  appLanguage,
  onOpenNotebookBlock,
  onOpenBuildDocsFile,
  isProcessing,
  isStatusMessage,
  getStatusStyle,
  summarizeBuildLog,
  chatSummaryMessage,
  isZeroState = false,
  onZeroStatePrompt,
  messagesContainerRef,
  messagesEndRef,
  onMessagesScroll,
}) => {
  const shouldShowZeroState =
    isZeroState && !unanchoredLogs.length && !isProcessing;
  return (
    <div
      ref={messagesContainerRef}
      onScroll={onMessagesScroll}
      className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2"
    >
      {chatMessages.length === 0 ? (
        <>
          {unanchoredLogs.map((log) => (
            <div
              key={log.id}
              className="flex w-full flex-col items-stretch gap-2"
            >
              <ChatOperationLog
                operationLog={log}
                showSummaryLine={log.status === "running"}
                timeoutMs={llmTimeoutMs}
                onOpenBuildDocsFile={onOpenBuildDocsFile}
              />
            </div>
          ))}
          {isProcessing && null}
          {shouldShowZeroState && (
            <SmartZeroState
              title="Public alpha"
              headline="Turn a system idea into diagrams"
              subtitle="Pick an example or describe your own system. Build creates a Mermaid diagram or a multi-diagram notebook."
              hint="Enter — Chat • Cmd/Ctrl+Enter — Build"
              presets={DEFAULT_ZERO_STATE_PRESETS}
              onSelectPreset={onZeroStatePrompt}
            />
          )}
        </>
      ) : (
        <>
          {chatMessages.map((msg) => {
            const isErrorMessage =
              msg.role === "assistant" &&
              /^(Error|Build failed|Analysis failed|Fix failed|Generation failed|Error generating diagram|Error analyzing diagram)(?:\s*\(.*?\))?:/.test(
                msg.content,
              );
            const notebookBuildMeta = parseNotebookBuildMessage(msg);
            const isStatus = isStatusMessage(msg);
            const statusStyle = isStatus ? getStatusStyle(msg.mode) : "";
            const messageText = notebookBuildMeta
              ? notebookBuildMeta.text
              : msg.content;
            const isLatest = msg.id === messages[messages.length - 1]?.id;
            const hintLanguage =
              appLanguage !== "auto"
                ? appLanguage
                : detectLanguage(messageText);
            const buildHint =
              hintLanguage === "Russian"
                ? "Если не хотите продолжать чат, нажмите Build."
                : "If you do not want to continue the chat, click Build.";
            const maxWidthClass = "max-w-full";
            const paddingClass =
              msg.role === "user" ? "px-0 py-0" : "px-0 py-0";
            const attachedLogs = inlineLogsByMessageId.get(msg.id) ?? [];
            const hasChatLog = attachedLogs.some(
              (log) => (log.events[0]?.title ?? "") === "Чат",
            );
            const attachedChatLogs = attachedLogs.filter(
              (log) => (log.events[0]?.title ?? "") === "Чат",
            );
            const attachedNonChatLogs = attachedLogs.filter(
              (log) => (log.events[0]?.title ?? "") !== "Чат",
            );
            const isRefinementChatLog = attachedLogs.some((log) =>
              log.events.some(
                (event) => event.title === "Чат" && event.detail === "refine",
              ),
            );
            const isOperationMessage =
              msg.role === "assistant" &&
              (msg.mode === "build" ||
                msg.mode === "analyze" ||
                msg.mode === "fix");
            const isChatMessage = msg.mode === "chat" || !msg.mode;
            const showBuildHint =
              msg.role === "assistant" &&
              isChatMessage &&
              !isStatus &&
              isLatest &&
              !isProcessing;
            const buildLog =
              attachedLogs.find((log) => {
                const title = log.events[0]?.title ?? "";
                return title === "Notebook build" || title === "Сборка";
              }) ?? null;
            const hasFinishedBuildEvent =
              buildLog?.events.some(
                (event) =>
                  event.phase === "done" ||
                  event.title === "Done" ||
                  event.title === "Failed",
              ) ?? false;
            const hasBuildSummaryMessage = buildLog
              ? chatMessages.some(
                  (candidate) =>
                    candidate.role === "assistant" &&
                    candidate.mode === "build" &&
                    candidate.content.trim().toLowerCase().startsWith("итог") &&
                    (candidate.timestamp ?? 0) >= buildLog.startedAt,
                )
              : false;
            const showBuildSummaryFallback =
              buildLog && hasFinishedBuildEvent && !hasBuildSummaryMessage;
            const logBlock =
              attachedLogs.length > 0 ? (
                <div className="mt-1 flex w-full flex-col gap-2">
                  {attachedLogs.map((log) => (
                    <ChatOperationLog
                      key={log.id}
                      operationLog={log}
                      showSummaryLine={log.status === "running"}
                      timeoutMs={llmTimeoutMs}
                      onOpenBuildDocsFile={onOpenBuildDocsFile}
                    />
                  ))}
                  {showBuildSummaryFallback && buildLog ? (
                    <div className="bg-transparent border-0 shadow-none text-slate-900 dark:text-slate-100 rounded-none text-sm whitespace-pre-wrap break-words">
                      {summarizeBuildLog(buildLog)}
                    </div>
                  ) : null}
                </div>
              ) : null;
            const chatLogBlock =
              attachedChatLogs.length > 0 ? (
                <div className="mt-1 flex w-full flex-col gap-2">
                  {attachedChatLogs.map((log) => (
                    <ChatOperationLog
                      key={log.id}
                      operationLog={log}
                      showSummaryLine={log.status === "running"}
                      timeoutMs={llmTimeoutMs}
                      onOpenBuildDocsFile={onOpenBuildDocsFile}
                    />
                  ))}
                </div>
              ) : null;
            const nonChatLogBlock =
              attachedNonChatLogs.length > 0 ? (
                <div className="mt-1 flex w-full flex-col gap-2">
                  {attachedNonChatLogs.map((log) => (
                    <ChatOperationLog
                      key={log.id}
                      operationLog={log}
                      showSummaryLine={log.status === "running"}
                      timeoutMs={llmTimeoutMs}
                      onOpenBuildDocsFile={onOpenBuildDocsFile}
                    />
                  ))}
                  {showBuildSummaryFallback && buildLog ? (
                    <div className="bg-transparent border-0 shadow-none text-slate-900 dark:text-slate-100 rounded-none text-sm whitespace-pre-wrap break-words">
                      {summarizeBuildLog(buildLog)}
                    </div>
                  ) : null}
                </div>
              ) : null;
            const analyzeLabel =
              msg.role === "assistant" && msg.mode === "analyze" && !isStatus
                ? "Анализ"
                : "";
            const messageBlock = (
              <div
                className={`${maxWidthClass} ${isStatus ? "px-0 py-0" : paddingClass} rounded-md text-sm whitespace-pre-wrap break-words ${
                  msg.role === "user"
                    ? "bg-slate-200/10 dark:bg-slate-100/5 border border-slate-200/10 dark:border-white/5 text-slate-200 dark:text-slate-200 rounded-full shadow-none px-3 py-1"
                    : isErrorMessage
                      ? "bg-transparent text-red-700 dark:text-red-200 rounded-none shadow-none font-mono text-[12px] leading-relaxed"
                      : isStatus
                        ? `${statusStyle} rounded-none`
                        : `bg-transparent border-0 shadow-none text-slate-900 dark:text-slate-100 rounded-none ${isLatest ? "text-slate-950 dark:text-white" : ""}`
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 whitespace-pre-wrap break-words">
                    {analyzeLabel && (
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                        {analyzeLabel}
                      </div>
                    )}
                    {messageText}
                  </div>
                  {notebookBuildMeta &&
                    typeof onOpenNotebookBlock === "function" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          onOpenNotebookBlock?.(notebookBuildMeta.blockIndex)
                        }
                        className="h-6 w-6 shrink-0 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
                        title="Open diagram"
                      >
                        <ArrowUpRight size={12} />
                      </Button>
                    )}
                </div>
              </div>
            );
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                {isOperationMessage ? logBlock : null}
                {messageBlock}
                {showBuildHint ? (
                  <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500 whitespace-pre-wrap">
                    {buildHint}
                  </div>
                ) : null}
                <span className="sr-only">
                  {msg.role === "user" ? "You" : "Assistant"}
                </span>
                {msg.role === "user" ? (
                  <>
                    {chatLogBlock}
                    {hasChatLog &&
                    !isRefinementChatLog &&
                    chatSummaryMessage ? (
                      <div className="mt-1 bg-transparent border-0 shadow-none text-slate-900 dark:text-slate-100 rounded-none text-xs whitespace-pre-wrap break-words">
                        {chatSummaryMessage}
                      </div>
                    ) : null}
                    {nonChatLogBlock}
                  </>
                ) : (
                  <>{!isOperationMessage ? logBlock : null}</>
                )}
              </div>
            );
          })}
          {chatSummaryMessage && !inlineLogsByMessageId.size && (
            <div className="flex flex-col items-start">
              <div className="bg-transparent border-0 shadow-none text-slate-900 dark:text-slate-100 rounded-none text-xs whitespace-pre-wrap break-words">
                {chatSummaryMessage}
              </div>
            </div>
          )}
          {unanchoredLogs.map((log) => (
            <div
              key={log.id}
              className="flex w-full flex-col items-stretch gap-2"
            >
              <ChatOperationLog
                operationLog={log}
                showSummaryLine={log.status === "running"}
                timeoutMs={llmTimeoutMs}
                onOpenBuildDocsFile={onOpenBuildDocsFile}
              />
            </div>
          ))}
          {isProcessing && null}
        </>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatMessageList;
