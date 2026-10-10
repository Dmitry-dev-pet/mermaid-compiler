import React, { useCallback, useMemo, useRef, useState } from "react"; // No need for useCallback anymore directly here
import Header from "./components/Header";
import ChatProjects from "./components/ChatProjects";
import ChatColumn from "./components/ChatColumn";
import EditorColumn from "./components/EditorColumn";
import PreviewColumn from "./components/PreviewColumn";
import NotebookTabs from "./components/NotebookTabs";
import { useDiagramStudio } from "./hooks/studio/useDiagramStudio";
import {
  ScrollSyncMeasure,
  ScrollSyncPayload,
} from "./hooks/studio/useScrollSync";
import type { MermaidThemePresetId } from "./utils/mermaidThemePreset";
import { setMermaidThemePreset } from "./utils/mermaidThemePreset";
import {
  MermaidDirection,
  setInlineDirectionCommand,
} from "./utils/inlineDirectionCommand";
import { MermaidLook, setInlineLookCommand } from "./utils/inlineLookCommand";
import type { FlowchartEdgeStyleUpdate } from "./utils/flowchartArrowStyle";
import { setFlowchartEdgeStyle } from "./utils/flowchartArrowStyle";
import type { FlowchartLinkStylePresetId } from "./utils/flowchartLinkStyle";
import { setFlowchartLinkStylePreset } from "./utils/flowchartLinkStyle";
import type { FlowchartCurve } from "./utils/flowchartCurveConfig";
import { setFlowchartCurve } from "./utils/flowchartCurveConfig";
import { DIAGRAM_TYPES } from "./utils/diagramTypes";
import {
  PROMPTS_VIRTUAL_INTENT_PATH,
  PROMPTS_VIRTUAL_NOTEBOOK_PLAN_PATH,
  PROMPTS_VIRTUAL_SYSTEM_PATH,
} from "./utils/promptsVirtualPaths";
import {
  getDiagramSyntaxPath,
  getDocsPaths,
} from "./services/docsContextService";
import type { DiagramType } from "./types";
import { getThemeColorScheme } from "./utils/appTheme";
import {
  isMarkdownLike,
  replaceMermaidBlockInMarkdown,
  setFlowchartEdgeStyleForMarkdownMermaidBlocks,
  setFlowchartLinkStylePresetForMarkdownMermaidBlocks,
  setFlowchartCurveForMarkdownMermaidBlocks,
  setLookForMarkdownMermaidBlocks,
  setThemePresetForMarkdownMermaidBlocks,
} from "./services/mermaidService";

function App() {
  const {
    aiConfig,
    setAiConfig,
    modelParams,
    setModelParams,
    connectionState,
    mermaidState,
    messages,
    appState,
    isProcessing,
    connectAI,
    disconnectAI,
    handleMermaidChange,
    handleChatMessage,
    handleBuildFromPrompt,
    handleFixSyntax,
    handleAnalyze,
    stopActiveOperation,
    handleManualSnapshot,
    diagramMarkers,
    editorDiagramMarkers,
    selectedStepId,
    projects,
    activeProjectId,
    diagramIntent,
    promptPreviewByMode,
    editorTab,
	    buildDocsScope,
	    buildDocsEntries,
	    buildDocsSelectionKey,
	    buildDocsActivePath,
	    setBuildDocsActivePath,
	    setBuildDocsActivePathForMode,
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
    setDiagramType,
    setMainDiagramTypes,
    clearMessages,
    startNewProject,
    openProject,
    renameProject,
    removeProject,
    undoRemoveProject,
    exportProject,
    importProject,
    byoConfig,
    updateByoConfig,
    testByoConfig,
    storageMode,
    setStorageMode,
    cloudSync,
    cloudProjects,
    cloudMigration,
    deleteUndoMs,
	    showProjectPreview,
	    clearProjectPreview,
	    previewMermaidState,
	    setThemePreset,
	    setAnalyzeLanguage,
	    setLLMTimeoutMs,
	    togglePreviewFullScreen,
    toggleScrollSync,
    setNotebookBuildCount,
    setThinkingStyle,
    buildDocsIntentText,
    buildPromptPreview,
    setPromptPreview,
    setEditorTab,
    setNextBuildDocsScope,
    loadBuildDocsEntries,
    appendMarkdownMermaidBlock,
    openNotebookBlock,
    backToNotebookMainChat,
	    isNotebookChatMode,
	    operationLogs,
	    activeOperationKind,
	    historySessionCurrentRevisionId,
	    whiteboardSceneJson,
	    whiteboardBundleJson,
    saveWhiteboardForCurrentRevision,
  } = useDiagramStudio();
  const buildDocsSystemPrompts = {
    chat: {
      raw: promptPreviewByMode.chat?.systemPrompt ?? "",
      redacted: promptPreviewByMode.chat?.systemPromptRedacted ?? "",
    },
    build: {
      raw: promptPreviewByMode.build?.systemPrompt ?? "",
      redacted: promptPreviewByMode.build?.systemPromptRedacted ?? "",
    },
    plan: {
      raw: promptPreviewByMode.plan?.systemPrompt ?? "",
      redacted: promptPreviewByMode.plan?.systemPromptRedacted ?? "",
    },
    analyze: {
      raw: promptPreviewByMode.analyze?.systemPrompt ?? "",
      redacted: promptPreviewByMode.analyze?.systemPromptRedacted ?? "",
    },
    fix: {
      raw: promptPreviewByMode.fix?.systemPrompt ?? "",
      redacted: promptPreviewByMode.fix?.systemPromptRedacted ?? "",
    },
  };

  const resolveBuildDocsTypeForFileName = useCallback(
    (fileName: string): DiagramType | null => {
      for (const type of DIAGRAM_TYPES) {
        const syntaxPath = getDiagramSyntaxPath(type);
        const syntaxName = syntaxPath?.split("/").pop();
        if (syntaxName && syntaxName === fileName) return type;
      }

      for (const type of DIAGRAM_TYPES) {
        const paths = getDocsPaths(type);
        for (const { path } of paths) {
          const name = path.split("/").pop();
          if (name && name === fileName) return type;
        }
      }

      return null;
    },
    [],
  );

  const handleOpenBuildDocsFile = useCallback(
    (
      fileLabel: string,
      mode: import("./types").DocsMode,
      options?: { blockIndex?: number | null },
    ) => {
      const cleaned = fileLabel
        .trim()
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim();
      const normalized = cleaned.toLowerCase();
      const virtualPath = (() => {
        if (
          normalized === "system" ||
          normalized === PROMPTS_VIRTUAL_SYSTEM_PATH
        )
          return PROMPTS_VIRTUAL_SYSTEM_PATH;
        if (
          normalized === "intent" ||
          normalized === PROMPTS_VIRTUAL_INTENT_PATH
        )
          return PROMPTS_VIRTUAL_INTENT_PATH;
        if (
          normalized === "notebook plan" ||
          normalized === PROMPTS_VIRTUAL_NOTEBOOK_PLAN_PATH
        )
          return PROMPTS_VIRTUAL_NOTEBOOK_PLAN_PATH;
        return null;
      })();
      const fileName = cleaned.split("/").pop() || cleaned;
      const matchInCurrent =
        buildDocsEntries.find(
          (entry) => (entry.path.split("/").pop() || entry.path) === fileName,
        ) ??
        buildDocsEntries.find((entry) => entry.path.endsWith(`/${fileName}`)) ??
        null;
      const open = async () => {
        setNextBuildDocsScope(null);
        if (typeof options?.blockIndex === "number") {
          setMarkdownMermaidActiveIndex(options.blockIndex);
          setNextBuildDocsScope("diagram");
        }
        setEditorTab("build_docs");
        setDocsMode(mode);

        if (virtualPath) {
          setBuildDocsActivePathForMode(mode, virtualPath);
          return;
        }

        if (matchInCurrent) {
          setBuildDocsActivePathForMode(mode, matchInCurrent.path);
          return;
        }

        const targetType = resolveBuildDocsTypeForFileName(fileName);
        if (!targetType) return;
        const loaded = await loadBuildDocsEntries(targetType);
        const matchInLoaded =
          loaded.entries.find(
            (entry) => (entry.path.split("/").pop() || entry.path) === fileName,
          ) ??
          loaded.entries.find((entry) => entry.path.endsWith(`/${fileName}`)) ??
          null;
        if (!matchInLoaded) return;
        setBuildDocsActivePathForMode(mode, matchInLoaded.path);
      };
      void open();
    },
    [
      buildDocsEntries,
      loadBuildDocsEntries,
      resolveBuildDocsTypeForFileName,
      setBuildDocsActivePathForMode,
      setDocsMode,
      setEditorTab,
      setMarkdownMermaidActiveIndex,
      setNextBuildDocsScope,
    ],
  );
  const scrollSyncSourceRef = useRef<ScrollSyncPayload["source"] | null>(null);
  const [scrollSyncPayload, setScrollSyncPayload] =
    useState<ScrollSyncPayload | null>(null);
  const [hoveredMarkdownIndex, setHoveredMarkdownIndex] = useState<
    number | null
  >(null);
  const isProjectPreview = !!previewMermaidState;
  const mermaidStateForView = previewMermaidState ?? mermaidState;
  const editorTabForView = isProjectPreview ? "code" : editorTab;
  const colorScheme = getThemeColorScheme(appState.theme);
  const markdownMermaidBlocksForView = isProjectPreview
    ? []
    : markdownMermaidBlocks;
  const markdownMermaidDiagnosticsForView = isProjectPreview
    ? []
    : markdownMermaidDiagnostics;
  const markdownMermaidActiveIndexForView = isProjectPreview
    ? 0
    : markdownMermaidActiveIndex;
  const hoveredMarkdownIndexForView = isProjectPreview
    ? null
    : hoveredMarkdownIndex;
  const hasNotebookTabs =
    isMarkdownLike(mermaidStateForView.code) &&
    markdownMermaidBlocksForView.length > 0;
  const editorPreviewTotal =
    appState.columnWidths[1] + appState.columnWidths[2] || 100;
  const editorShare =
    editorPreviewTotal > 0
      ? (appState.columnWidths[1] / editorPreviewTotal) * 100
      : 50;
  const previewShare = 100 - editorShare;
  const headerHeightVar = "var(--app-header-height, 3rem)";
  const promptPreviewKey = `${mermaidStateForView.code}::${mermaidStateForView.errorMessage ?? ""}::${appState.analyzeLanguage}::${appState.language}::${markdownMermaidActiveIndex}::${editorTabForView}::${isNotebookChatMode}::${buildDocsScope}`;
  const buildDocsIntentPreviewText = (
    promptPreviewByMode[docsMode]?.intentText ??
    buildDocsIntentText ??
    ""
  ).trim();
  const buildDocsRequestPreviewText =
    promptPreviewByMode[docsMode]?.content ?? "";
  const buildDocsRequestPreviewRawText =
    promptPreviewByMode[docsMode]?.rawContent ?? "";
  const notebookPlanText = useMemo(() => {
    const extract = (
      marker: (typeof diagramMarkers)[number] | null | undefined,
    ) => {
      const meta = marker?.meta as Record<string, unknown> | undefined;
      if (!meta || meta.mode !== "notebook") return "";
      return typeof meta.notebookPlanIntent === "string"
        ? meta.notebookPlanIntent.trim()
        : "";
    };

    if (selectedStepId) {
      const selected = diagramMarkers.find((m) => m.stepId === selectedStepId);
      const text = extract(selected);
      if (text) return text;
    }

    for (let i = diagramMarkers.length - 1; i >= 0; i -= 1) {
      const text = extract(diagramMarkers[i]);
      if (text) return text;
    }
    return "";
  }, [diagramMarkers, selectedStepId]);
  const notebookTabs = hasNotebookTabs ? (
    <NotebookTabs
      activeTab={editorTabForView}
      buildDocsScope={
        editorTabForView === "build_docs" ? buildDocsScope : undefined
      }
      markdownMermaidBlocks={markdownMermaidBlocksForView}
      markdownMermaidDiagnostics={markdownMermaidDiagnosticsForView}
      markdownMermaidActiveIndex={markdownMermaidActiveIndexForView}
      onMarkdownMermaidActiveIndexChange={
        isProjectPreview ? () => {} : setMarkdownMermaidActiveIndex
      }
      onActiveTabChange={isProjectPreview ? () => {} : setEditorTab}
      onAppendMarkdownMermaidBlock={
        isProjectPreview ? () => {} : appendMarkdownMermaidBlock
      }
      onBuildDocsScopeChange={(scope) => {
        if (isProjectPreview) return;
        if (editorTab === "build_docs" && scope === "notebook") {
          setDocsMode("plan");
          setBuildDocsActivePathForMode("plan", PROMPTS_VIRTUAL_SYSTEM_PATH);
        }
        setNextBuildDocsScope(scope);
      }}
      diagramMarkers={diagramMarkers}
      selectedStepId={selectedStepId}
      onSelectDiagramStep={goToDiagramStep}
    />
  ) : null;
  const applyInlineUpdate = (updateCode: (code: string) => string) => {
    if (isProjectPreview) return;
    if (editorTab === "markdown_mermaid" && markdownMermaidBlocks.length) {
      const activeBlock = markdownMermaidBlocks[markdownMermaidActiveIndex];
      if (activeBlock) {
        const nextBlockCode = updateCode(activeBlock.code);
        const nextMarkdown = replaceMermaidBlockInMarkdown(
          mermaidState.code,
          activeBlock,
          nextBlockCode,
        );
        handleMermaidChange(nextMarkdown);
        return;
      }
    }
    handleMermaidChange(updateCode(mermaidState.code));
  };

  const computeScrollRatio = (
    scrollTop: number,
    scrollHeight: number,
    clientHeight: number,
  ) => {
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    return Math.max(0, Math.min(1, scrollTop / maxScroll));
  };

  const handleEditorScrollSync = useCallback(
    (payload: ScrollSyncMeasure) => {
      if (!appState.isScrollSyncEnabled) return;
      if (scrollSyncSourceRef.current === "preview") {
        scrollSyncSourceRef.current = null;
        return;
      }
      scrollSyncSourceRef.current = "editor";
      const ratio = computeScrollRatio(
        payload.scrollTop,
        payload.scrollHeight,
        payload.clientHeight,
      );
      if (typeof payload.blockIndex === "number") {
        setScrollSyncPayload({
          source: "editor",
          mode: "block",
          blockIndex: payload.blockIndex,
          ratio,
          nonce: Date.now(),
        });
        return;
      }
      setScrollSyncPayload({
        source: "editor",
        mode: "ratio",
        ratio,
        nonce: Date.now(),
      });
    },
    [appState.isScrollSyncEnabled],
  );

  const handlePreviewScrollSync = useCallback(
    (payload: ScrollSyncMeasure) => {
      if (!appState.isScrollSyncEnabled) return;
      if (
        scrollSyncSourceRef.current === "editor" &&
        typeof payload.blockIndex !== "number"
      ) {
        scrollSyncSourceRef.current = null;
        return;
      }
      scrollSyncSourceRef.current = "preview";
      const ratio = computeScrollRatio(
        payload.scrollTop,
        payload.scrollHeight,
        payload.clientHeight,
      );
      if (typeof payload.blockIndex === "number") {
        setScrollSyncPayload({
          source: "preview",
          mode: "block",
          blockIndex: payload.blockIndex,
          ratio,
          nonce: Date.now(),
        });
        return;
      }
      setScrollSyncPayload({
        source: "preview",
        mode: "ratio",
        ratio,
        nonce: Date.now(),
      });
    },
    [appState.isScrollSyncEnabled],
  );

  // Resizing logic is now entirely within useDiagramStudio,
  // so onMouseMove and onMouseUp are not needed directly in App.tsx
  // and their useEffect for event listeners is also gone from here.

  return (
    <div
      className="flex flex-col h-screen text-slate-800 dark:text-slate-100 font-sans transition-colors"
      style={{ backgroundColor: "var(--app-bg, #ffffff)" }}
    >
      <Header
        aiConfig={aiConfig}
        modelParams={modelParams}
        onModelParamsChange={setModelParams}
        connectionState={connectionState}
        onConfigChange={setAiConfig}
        onConnect={connectAI}
        onDisconnect={disconnectAI}
        isProcessing={isProcessing}
        chatColumnWidthPercent={appState.columnWidths[0]}
        theme={appState.theme}
        onThemeChange={setThemePreset}
        llmTimeoutMs={appState.llmTimeoutMs}
        onLLMTimeoutMsChange={setLLMTimeoutMs}
        notebookTabs={notebookTabs}
        projectsHeader={
          <ChatProjects
            mode="header"
            projects={projects}
            activeProjectId={activeProjectId}
            onNewProject={startNewProject}
            onOpenProject={openProject}
            onRenameProject={renameProject}
            onDeleteProject={removeProject}
            onUndoDeleteProject={undoRemoveProject}
            onPreviewProjectSnapshot={showProjectPreview}
            onClearProjectPreview={clearProjectPreview}
            deleteUndoMs={deleteUndoMs}
            onExportProject={exportProject}
            onImportProject={importProject}
            byoConfig={byoConfig}
            onByoConfigChange={updateByoConfig}
            onTestByoConfig={testByoConfig}
            storageMode={storageMode}
            onStorageModeChange={setStorageMode}
            cloudSync={cloudSync}
            cloudProjects={cloudProjects}
            cloudMigration={cloudMigration}
            diagramType={appState.diagramType}
            onDiagramTypeChange={setDiagramType}
            mainDiagramTypes={appState.mainDiagramTypes}
            onMainDiagramTypesChange={setMainDiagramTypes}
            detectedDiagramType={detectedDiagramType}
            notebookBuildCount={appState.notebookBuildCount}
            onNotebookBuildCountChange={setNotebookBuildCount}
            thinkingStyle={appState.thinkingStyle}
            onThinkingStyleChange={setThinkingStyle}
          />
        }
      />

      <div
        className="flex overflow-hidden relative"
        style={{
          marginTop: headerHeightVar,
          height: `calc(100vh - ${headerHeightVar})`,
        }}
      >
        {!appState.isPreviewFullScreen ? (
          <>
            {/* Col 1: Chat */}
            <div
              style={{ width: `${appState.columnWidths[0]}%` }}
              className="flex flex-col min-w-[260px]"
            >
              <ChatColumn
                messages={messages}
                onChat={handleChatMessage}
                onBuild={handleBuildFromPrompt}
                onClear={clearMessages}
                onNewProject={startNewProject}
                isProcessing={isProcessing}
                onStop={stopActiveOperation}
                hasIntent={!!diagramIntent?.content.trim()}
                onSetPromptPreview={setPromptPreview}
                diagramType={appState.diagramType}
                onDiagramTypeChange={setDiagramType}
                mainDiagramTypes={appState.mainDiagramTypes}
                onMainDiagramTypesChange={setMainDiagramTypes}
                detectedDiagramType={detectedDiagramType}
                onPreviewPrompt={buildPromptPreview}
                projects={projects}
                activeProjectId={activeProjectId}
                onOpenProject={openProject}
                onRenameProject={renameProject}
                onDeleteProject={removeProject}
                onUndoDeleteProject={undoRemoveProject}
                onPreviewProjectSnapshot={showProjectPreview}
                onClearProjectPreview={clearProjectPreview}
                onExportProject={exportProject}
                onImportProject={importProject}
                byoConfig={byoConfig}
                onByoConfigChange={updateByoConfig}
                onTestByoConfig={testByoConfig}
                deleteUndoMs={deleteUndoMs}
                buildDocsSelectionKey={buildDocsSelectionKey}
                promptPreviewKey={promptPreviewKey}
                notebookBuildCount={appState.notebookBuildCount}
                onNotebookBuildCountChange={setNotebookBuildCount}
                thinkingStyle={appState.thinkingStyle}
                onThinkingStyleChange={setThinkingStyle}
                llmTimeoutMs={appState.llmTimeoutMs}
                appLanguage={appState.language}
                intentText={buildDocsIntentText}
                onOpenNotebookBlock={openNotebookBlock}
                isNotebookChatMode={isNotebookChatMode}
                onBackToNotebookMainChat={backToNotebookMainChat}
                operationLogs={operationLogs}
                activeOperationKind={activeOperationKind}
                onOpenBuildDocsFile={handleOpenBuildDocsFile}
              />
            </div>

            {/* Resizer 1 */}
            <div
              className="resizer w-1 hover:w-1 bg-slate-200 dark:bg-slate-800 hover:bg-blue-400 cursor-col-resize z-10 transition-colors"
              onMouseDown={() => startResize(0)}
            ></div>

            <div
              style={{ width: `${editorPreviewTotal}%` }}
              className="flex flex-col min-w-0"
            >
              <div className="flex min-h-0 flex-1">
                {/* Col 2: Editor */}
                <div
                  style={{ width: `${editorShare}%` }}
                  className="flex flex-col min-w-[300px]"
                >
                  <EditorColumn
                    mermaidState={mermaidStateForView}
                    onChange={isProjectPreview ? () => {} : handleMermaidChange}
                    onAnalyze={isProjectPreview ? () => {} : handleAnalyze}
                    onFixSyntax={isProjectPreview ? () => {} : handleFixSyntax}
                    onSnapshot={
                      isProjectPreview ? () => {} : handleManualSnapshot
                    }
                    isAIReady={
                      !isProjectPreview &&
                      connectionState.status === "connected" &&
                      !!aiConfig.selectedModelId
                    }
                    isProcessing={isProcessing}
                    activeOperationKind={activeOperationKind}
                    isReadOnly={isProjectPreview}
                    analyzeLanguage={appState.analyzeLanguage}
                    onAnalyzeLanguageChange={setAnalyzeLanguage}
                    appLanguage={appState.language}
                    buildDocsScope={buildDocsScope}
                    promptPreviewByMode={promptPreviewByMode}
                    intentText={buildDocsIntentText}
                    notebookPlanText={notebookPlanText}
                    activeTab={editorTabForView}
                    buildDocsEntries={buildDocsEntries}
                    buildDocsSelectionsByMode={buildDocsSelectionsByMode}
                    onToggleBuildDocForMode={setBuildDocSelectionForMode}
                    onResetBuildDocsSelections={resetDocsSelectionsToDefault}
                    buildDocsActivePath={buildDocsActivePath}
                    onBuildDocsActivePathChange={setBuildDocsActivePath}
                    docsMode={docsMode}
                    onDocsModeChange={setDocsMode}
                    systemPromptRawByMode={systemPromptRawByMode}
                    onSystemPromptRawChange={setSystemPromptRaw}
                    markdownMermaidBlocks={markdownMermaidBlocksForView}
                    markdownMermaidDiagnostics={
                      markdownMermaidDiagnosticsForView
                    }
	                    markdownMermaidActiveIndex={
	                      markdownMermaidActiveIndexForView
	                    }
	                    onActiveTabChange={
	                      isProjectPreview ? () => {} : setEditorTab
	                    }
                    isScrollSyncEnabled={appState.isScrollSyncEnabled}
                    scrollSyncPayload={scrollSyncPayload}
                    onScrollSync={handleEditorScrollSync}
                    hoveredMarkdownIndex={hoveredMarkdownIndexForView}
                    diagramMarkers={hasNotebookTabs ? [] : editorDiagramMarkers}
                    selectedStepId={hasNotebookTabs ? null : selectedStepId}
                    onSelectDiagramStep={
                      hasNotebookTabs ? undefined : goToDiagramStep
                    }
                  />
                </div>

                {/* Resizer 2 */}
                <div
                  className="resizer w-1 hover:w-1 bg-slate-200 dark:bg-slate-800 hover:bg-blue-400 cursor-col-resize z-10 transition-colors"
                  onMouseDown={() => startResize(1)}
                ></div>

                {/* Col 3: Preview */}
                <div
                  style={{ width: `${previewShare}%` }}
                  className="flex flex-col min-w-[300px]"
                >
                  <PreviewColumn
                    mermaidState={mermaidStateForView}
                    theme={colorScheme}
                    appThemePresetId={appState.theme}
                    isFullScreen={appState.isPreviewFullScreen}
                    onToggleFullScreen={togglePreviewFullScreen}
                    isScrollSyncEnabled={appState.isScrollSyncEnabled}
                    onToggleScrollSync={toggleScrollSync}
                    scrollSyncPayload={scrollSyncPayload}
                    onScrollSync={handlePreviewScrollSync}
                    onSetThemePreset={(
                      presetId: MermaidThemePresetId | null,
                    ) => {
                      if (isProjectPreview) return;
                      if (
                        editorTab !== "markdown_mermaid" &&
                        markdownMermaidBlocks.length &&
                        isMarkdownLike(mermaidStateForView.code)
                      ) {
                        const nextMarkdown =
                          setThemePresetForMarkdownMermaidBlocks(
                            mermaidStateForView.code,
                            presetId,
                          );
                        handleMermaidChange(nextMarkdown);
                        return;
                      }
                      applyInlineUpdate((code) =>
                        setMermaidThemePreset(code, presetId),
                      );
                    }}
                    onSetInlineDirection={(
                      nextDirection: MermaidDirection | null,
                    ) => {
                      if (isProjectPreview) return;
                      applyInlineUpdate((code) =>
                        setInlineDirectionCommand(code, nextDirection),
                      );
                    }}
                    onSetInlineLook={(nextLook: MermaidLook | null) => {
                      if (isProjectPreview) return;
                      if (
                        editorTab !== "markdown_mermaid" &&
                        markdownMermaidBlocks.length &&
                        isMarkdownLike(mermaidStateForView.code)
                      ) {
                        const nextMarkdown = setLookForMarkdownMermaidBlocks(
                          mermaidStateForView.code,
                          nextLook,
                        );
                        handleMermaidChange(nextMarkdown);
                        return;
                      }
                      applyInlineUpdate((code) =>
                        setInlineLookCommand(code, nextLook),
                      );
                    }}
                    onSetFlowchartEdgeStyle={(
                      update: FlowchartEdgeStyleUpdate,
                    ) => {
                      if (isProjectPreview) return;
                      if (!update || !Object.keys(update).length) return;
                      if (
                        editorTab !== "markdown_mermaid" &&
                        markdownMermaidBlocks.length &&
                        isMarkdownLike(mermaidStateForView.code)
                      ) {
                        const nextMarkdown =
                          setFlowchartEdgeStyleForMarkdownMermaidBlocks(
                            mermaidStateForView.code,
                            update,
                          );
                        handleMermaidChange(nextMarkdown);
                        return;
                      }
                      applyInlineUpdate((code) =>
                        setFlowchartEdgeStyle(code, update),
                      );
                    }}
                    onSetFlowchartLinkStylePreset={(
                      presetId: FlowchartLinkStylePresetId,
                    ) => {
                      if (isProjectPreview) return;
                      if (
                        editorTab !== "markdown_mermaid" &&
                        markdownMermaidBlocks.length &&
                        isMarkdownLike(mermaidStateForView.code)
                      ) {
                        const nextMarkdown =
                          setFlowchartLinkStylePresetForMarkdownMermaidBlocks(
                            mermaidStateForView.code,
                            presetId,
                          );
                        handleMermaidChange(nextMarkdown);
                        return;
                      }
                      applyInlineUpdate((code) =>
                        setFlowchartLinkStylePreset(code, presetId),
                      );
                    }}
                    onSetFlowchartCurve={(curve: FlowchartCurve | null) => {
                      if (isProjectPreview) return;
                      if (
                        editorTab !== "markdown_mermaid" &&
                        markdownMermaidBlocks.length &&
                        isMarkdownLike(mermaidStateForView.code)
                      ) {
                        const nextMarkdown =
                          setFlowchartCurveForMarkdownMermaidBlocks(
                            mermaidStateForView.code,
                            curve,
                          );
                        handleMermaidChange(nextMarkdown);
                        return;
                      }
                      applyInlineUpdate((code) =>
                        setFlowchartCurve(code, curve),
                      );
                    }}
                    activeEditorTab={editorTabForView}
                    docsMode={docsMode}
                    buildDocsSystemPrompts={buildDocsSystemPrompts}
                    systemPromptRawByMode={systemPromptRawByMode}
                    buildDocsRequestPreviewText={buildDocsRequestPreviewText}
                    buildDocsRequestPreviewRawText={
                      buildDocsRequestPreviewRawText
                    }
                    buildDocsIntentPreviewText={buildDocsIntentPreviewText}
                    buildDocsNotebookPlanText={notebookPlanText}
                    buildDocsEntries={buildDocsEntries}
                    buildDocsActivePath={buildDocsActivePath}
                    markdownMermaidBlocks={markdownMermaidBlocksForView}
                    markdownMermaidDiagnostics={
                      markdownMermaidDiagnosticsForView
                    }
                    markdownMermaidActiveIndex={
                      markdownMermaidActiveIndexForView
                    }
                    onMarkdownMermaidActiveIndexChange={
                      isProjectPreview
                        ? () => {}
                        : setMarkdownMermaidActiveIndex
                    }
	                    onActiveEditorTabChange={
	                      isProjectPreview ? () => {} : setEditorTab
	                    }
	                    hoveredMarkdownIndex={hoveredMarkdownIndexForView}
	                    onHoverMarkdownIndex={
	                      isProjectPreview ? () => {} : setHoveredMarkdownIndex
	                    }
                    historyRevisionId={historySessionCurrentRevisionId}
                    whiteboardSceneJson={whiteboardSceneJson}
                    whiteboardBundleJson={whiteboardBundleJson}
                    onSaveWhiteboardSceneJson={
                      isProjectPreview
                        ? async () => null
                        : saveWhiteboardForCurrentRevision
                    }
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col flex-1 min-w-0">
            <PreviewColumn
              mermaidState={mermaidStateForView}
              theme={colorScheme}
              appThemePresetId={appState.theme}
              isFullScreen={appState.isPreviewFullScreen}
              onToggleFullScreen={togglePreviewFullScreen}
              isScrollSyncEnabled={appState.isScrollSyncEnabled}
              onToggleScrollSync={toggleScrollSync}
              scrollSyncPayload={scrollSyncPayload}
              onScrollSync={handlePreviewScrollSync}
              onSetThemePreset={(presetId: MermaidThemePresetId | null) => {
                if (isProjectPreview) return;
                if (
                  editorTab !== "markdown_mermaid" &&
                  markdownMermaidBlocks.length &&
                  isMarkdownLike(mermaidStateForView.code)
                ) {
                  const nextMarkdown = setThemePresetForMarkdownMermaidBlocks(
                    mermaidStateForView.code,
                    presetId,
                  );
                  handleMermaidChange(nextMarkdown);
                  return;
                }
                applyInlineUpdate((code) =>
                  setMermaidThemePreset(code, presetId),
                );
              }}
              onSetInlineDirection={(
                nextDirection: MermaidDirection | null,
              ) => {
                if (isProjectPreview) return;
                applyInlineUpdate((code) =>
                  setInlineDirectionCommand(code, nextDirection),
                );
              }}
              onSetInlineLook={(nextLook: MermaidLook | null) => {
                if (isProjectPreview) return;
                if (
                  editorTab !== "markdown_mermaid" &&
                  markdownMermaidBlocks.length &&
                  isMarkdownLike(mermaidStateForView.code)
                ) {
                  const nextMarkdown = setLookForMarkdownMermaidBlocks(
                    mermaidStateForView.code,
                    nextLook,
                  );
                  handleMermaidChange(nextMarkdown);
                  return;
                }
                applyInlineUpdate((code) =>
                  setInlineLookCommand(code, nextLook),
                );
              }}
              onSetFlowchartEdgeStyle={(update: FlowchartEdgeStyleUpdate) => {
                if (isProjectPreview) return;
                if (!update || !Object.keys(update).length) return;
                if (
                  editorTab !== "markdown_mermaid" &&
                  markdownMermaidBlocks.length &&
                  isMarkdownLike(mermaidStateForView.code)
                ) {
                  const nextMarkdown =
                    setFlowchartEdgeStyleForMarkdownMermaidBlocks(
                      mermaidStateForView.code,
                      update,
                    );
                  handleMermaidChange(nextMarkdown);
                  return;
                }
                applyInlineUpdate((code) =>
                  setFlowchartEdgeStyle(code, update),
                );
              }}
              onSetFlowchartLinkStylePreset={(
                presetId: FlowchartLinkStylePresetId,
              ) => {
                if (isProjectPreview) return;
                if (
                  editorTab !== "markdown_mermaid" &&
                  markdownMermaidBlocks.length &&
                  isMarkdownLike(mermaidStateForView.code)
                ) {
                  const nextMarkdown =
                    setFlowchartLinkStylePresetForMarkdownMermaidBlocks(
                      mermaidStateForView.code,
                      presetId,
                    );
                  handleMermaidChange(nextMarkdown);
                  return;
                }
                applyInlineUpdate((code) =>
                  setFlowchartLinkStylePreset(code, presetId),
                );
              }}
              onSetFlowchartCurve={(curve: FlowchartCurve | null) => {
                if (isProjectPreview) return;
                if (
                  editorTab !== "markdown_mermaid" &&
                  markdownMermaidBlocks.length &&
                  isMarkdownLike(mermaidStateForView.code)
                ) {
                  const nextMarkdown =
                    setFlowchartCurveForMarkdownMermaidBlocks(
                      mermaidStateForView.code,
                      curve,
                    );
                  handleMermaidChange(nextMarkdown);
                  return;
                }
                applyInlineUpdate((code) => setFlowchartCurve(code, curve));
              }}
              activeEditorTab={editorTabForView}
              docsMode={docsMode}
              buildDocsSystemPrompts={buildDocsSystemPrompts}
              systemPromptRawByMode={systemPromptRawByMode}
              buildDocsRequestPreviewText={buildDocsRequestPreviewText}
              buildDocsRequestPreviewRawText={buildDocsRequestPreviewRawText}
              buildDocsIntentPreviewText={buildDocsIntentPreviewText}
              buildDocsEntries={buildDocsEntries}
              buildDocsActivePath={buildDocsActivePath}
              markdownMermaidBlocks={markdownMermaidBlocksForView}
              markdownMermaidDiagnostics={markdownMermaidDiagnosticsForView}
              markdownMermaidActiveIndex={markdownMermaidActiveIndexForView}
              onMarkdownMermaidActiveIndexChange={
                isProjectPreview ? () => {} : setMarkdownMermaidActiveIndex
              }
	              onActiveEditorTabChange={
	                isProjectPreview ? () => {} : setEditorTab
	              }
	              hoveredMarkdownIndex={hoveredMarkdownIndexForView}
	              onHoverMarkdownIndex={
	                isProjectPreview ? () => {} : setHoveredMarkdownIndex
	              }
              historyRevisionId={historySessionCurrentRevisionId}
              whiteboardSceneJson={whiteboardSceneJson}
              whiteboardBundleJson={whiteboardBundleJson}
              onSaveWhiteboardSceneJson={
                isProjectPreview
                  ? async () => null
                  : saveWhiteboardForCurrentRevision
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
