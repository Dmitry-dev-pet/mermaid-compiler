import { useCallback } from "react";
import type { EditorTab } from "../../types";
import { isMarkdownLike } from "../../services/mermaidService";

type UseStudioHistoryRecorderArgs<
  TAppendTimeStep extends (args: unknown) => unknown,
> = {
  appendTimeStep: TAppendTimeStep;
  isNotebookChatMode: boolean;
  activeChatContextId: string;
  mermaidCode: string;
  editorTab: EditorTab;
  markdownMermaidBlocksLength: number;
  markdownMermaidActiveIndex: number;
  getNotebookChatIndex: () => number | null;
};

export const useStudioHistoryRecorder = <
  TAppendTimeStep extends (args: unknown) => unknown,
>({
  appendTimeStep,
  isNotebookChatMode,
  activeChatContextId,
  mermaidCode,
  editorTab,
  markdownMermaidBlocksLength,
  markdownMermaidActiveIndex,
  getNotebookChatIndex,
}: UseStudioHistoryRecorderArgs<TAppendTimeStep>) => {
  type AppendArgs = Parameters<TAppendTimeStep>[0];
  type AppendResult = Awaited<ReturnType<TAppendTimeStep>>;

  const safeAppendTimeStep = useCallback(
    (args: AppendArgs): Promise<AppendResult | undefined> => {
      const meta = (args as { meta?: unknown }).meta;
      const metaObj =
        meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
      const nextMeta = { ...metaObj };
      const type = (args as { type?: string }).type;
      const isNotebookScope =
        isNotebookChatMode &&
        (type === "build" || type === "chat" || type === "analyze");

      if (typeof nextMeta.contextId !== "string") {
        if (
          nextMeta.mode === "notebook" &&
          typeof nextMeta.blockIndex === "number"
        ) {
          nextMeta.contextId = `block:${nextMeta.blockIndex}`;
        } else {
          nextMeta.contextId = activeChatContextId;
        }
      }

      if (!("mode" in nextMeta)) {
        nextMeta.mode = isNotebookScope
          ? "notebook"
          : isMarkdownLike(mermaidCode)
            ? "markdown"
            : "mermaid";
      }

      if (
        (isNotebookScope || editorTab === "markdown_mermaid") &&
        typeof nextMeta.blockIndex !== "number" &&
        markdownMermaidBlocksLength > 0
      ) {
        nextMeta.blockIndex = Math.max(
          0,
          Math.min(markdownMermaidActiveIndex, markdownMermaidBlocksLength - 1),
        );
        nextMeta.totalBlocks = markdownMermaidBlocksLength;
      }

      const result = appendTimeStep({
        ...(args as Record<string, unknown>),
        meta: nextMeta,
      } as AppendArgs) as ReturnType<TAppendTimeStep>;
      return Promise.resolve(result).catch((e) => {
        console.error("Failed to record history step", e);
        return undefined;
      });
    },
    [
      activeChatContextId,
      appendTimeStep,
      editorTab,
      markdownMermaidActiveIndex,
      markdownMermaidBlocksLength,
      mermaidCode,
      isNotebookChatMode,
    ],
  );

  const safeRecordTimeStep = useCallback(
    (args: AppendArgs) => {
      const type = (args as { type?: string }).type;
      if (
        (type === "chat" || type === "analyze" || type === "build") &&
        isNotebookChatMode
      ) {
        const blockIndex = getNotebookChatIndex();
        if (blockIndex !== null) {
          const meta = (args as { meta?: unknown }).meta;
          const metaObj =
            meta && typeof meta === "object"
              ? (meta as Record<string, unknown>)
              : {};
          const prevMeta = { ...metaObj };
          return safeAppendTimeStep({
            ...(args as Record<string, unknown>),
            meta: {
              ...prevMeta,
              mode: "notebook",
              blockIndex,
            },
          } as AppendArgs);
        }
      }
      return safeAppendTimeStep(args);
    },
    [getNotebookChatIndex, isNotebookChatMode, safeAppendTimeStep],
  );

  return { safeAppendTimeStep, safeRecordTimeStep };
};
