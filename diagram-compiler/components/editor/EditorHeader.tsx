import React from "react";
import {
  Bookmark,
  Check,
  Copy,
  Loader2,
  PenTool,
  RefreshCw,
} from "lucide-react";
import { AUTO_FIX_MAX_ATTEMPTS } from "../../constants";
import { EditorTab, MermaidState } from "../../types";
import type { DiagramMarker } from "../../hooks/core/useHistory";
import { HEADER_CONTROL_BUTTON } from "../../utils/uiControlStyles";
import { MODE_BUTTON_DISABLED, MODE_UI } from "../../utils/uiModes";
import {
  buildHistoryChipModels,
  HISTORY_CHIP_INACTIVE_CLASS_BY_MODE,
} from "../../utils/historyChipUtils";
import PanelHeader from "../ui/PanelHeader";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import HeaderRow from "../ui/HeaderRow";
import HeaderSection from "../ui/HeaderSection";
import ModeToggle from "../ui/ModeToggle";

interface EditorHeaderProps {
  mermaidState: MermaidState;
  isMarkdown: boolean;
  isProcessing: boolean;
  activeOperationKind?: "chat" | "build" | "analyze" | "fix" | "compile" | null;
  isAIReady: boolean;
  isReadOnly: boolean;
  canAnalyze: boolean;
  analyzeLanguage: string;
  onAnalyzeLanguageChange: (lang: string) => void;
  onAnalyze: () => void;
  onFixSyntax: () => void;
  canFix: boolean;
  onSnapshot: () => void;
  canSnapshot: boolean;
  onCopy: () => void;
  copied: boolean;
  activeTab: EditorTab;
  onActiveTabChange: (tab: EditorTab) => void;
  isMarkdownMermaidTab: boolean;
  isBuildDocsTab: boolean;
  diagramMarkers?: DiagramMarker[];
  selectedStepId?: string | null;
  onSelectDiagramStep?: (step: DiagramMarker) => void | Promise<void>;
}

const EditorHeader: React.FC<EditorHeaderProps> = ({
  mermaidState,
  isMarkdown,
  isProcessing,
  activeOperationKind = null,
  isAIReady,
  isReadOnly,
  canAnalyze,
  analyzeLanguage,
  onAnalyzeLanguageChange,
  onAnalyze,
  onFixSyntax,
  canFix,
  onSnapshot,
  canSnapshot,
  onCopy,
  copied,
  activeTab,
  onActiveTabChange,
  isMarkdownMermaidTab,
  isBuildDocsTab,
  diagramMarkers = [],
  selectedStepId = null,
  onSelectDiagramStep,
}) => {
  const isAnalyzing = isProcessing && activeOperationKind === "analyze";
  const isFixing = isProcessing && activeOperationKind === "fix";
  const isCodeActive = activeTab === "code" || activeTab === "markdown_mermaid";

  const historyChips = React.useMemo(() => {
    if (!onSelectDiagramStep) return [];
    if (isBuildDocsTab) return [];
    if (!diagramMarkers.length) return [];

    const chipModels = buildHistoryChipModels(diagramMarkers, selectedStepId);
    return chipModels.map((chip) => {
      const modeStyles = MODE_UI[chip.uiMode];
      const activeClass = modeStyles.button ?? MODE_BUTTON_DISABLED;
      const inactiveClass =
        HISTORY_CHIP_INACTIVE_CLASS_BY_MODE[chip.uiMode] ??
        MODE_BUTTON_DISABLED;
      return {
        marker: chip.marker,
        tooltip: chip.tooltip,
        label: chip.label,
        className: `rounded-full ${HEADER_CONTROL_BUTTON} ${chip.isSelected ? activeClass : inactiveClass}`,
      };
    });
  }, [diagramMarkers, isBuildDocsTab, onSelectDiagramStep, selectedStepId]);

  return (
    <PanelHeader className="h-24 flex flex-col gap-2 max-md:px-2">
      <HeaderSection tone="primary" className="uppercase">
        <HeaderRow
          left={
            <ModeToggle
              options={[
                {
                  id: "code",
                  label: "Code",
                  title: "Code",
                  active: isCodeActive,
                  onClick: () => onActiveTabChange("code"),
                },
                {
                  id: "prompts",
                  label: "Prompts",
                  title: "Prompts",
                  active: !isCodeActive,
                  onClick: () => onActiveTabChange("build_docs"),
                },
              ]}
            />
          }
          center={
            <div className="flex items-center gap-2 min-w-0 text-xs font-mono">
              {!isMarkdown && mermaidState.status === "invalid" && (
                <span
                  className="inline-flex h-3 w-3 rounded-full bg-red-500 ring-1 ring-red-700"
                  title={`Invalid diagram${mermaidState.errorLine ? ` (Line ${mermaidState.errorLine})` : ""}`}
                />
              )}
              {mermaidState.status === "empty" && (
                <span className="text-slate-400">Empty</span>
              )}
              {!isMarkdown && mermaidState.status === "edited" && (
                <span className="text-amber-600 dark:text-amber-400">
                  ⚠ Edited
                </span>
              )}
            </div>
          }
          right={
            <>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 mx-1" />

              <Button
                onClick={onCopy}
                variant="default"
                size="icon"
                title={
                  isMarkdownMermaidTab
                    ? "Copy mermaid block"
                    : isBuildDocsTab
                      ? "Copy docs"
                      : "Copy code"
                }
              >
                {copied ? (
                  <Check size={12} className="text-green-500" />
                ) : (
                  <Copy size={12} />
                )}
              </Button>
            </>
          }
        />
      </HeaderSection>

      <HeaderSection tone="secondary" className="max-md:overflow-x-auto">
        <HeaderRow
          left={
            <>
              <Button
                onClick={onAnalyze}
                disabled={!canAnalyze}
                className={`${canAnalyze ? MODE_UI.analyze.button : MODE_BUTTON_DISABLED} normal-case tracking-normal`}
                title="Explain this diagram in chat"
              >
                {isAnalyzing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <PenTool size={12} />
                )}{" "}
                Analyze
              </Button>

              <Select
                value={analyzeLanguage}
                onChange={(e) => onAnalyzeLanguageChange(e.target.value)}
                size="xs"
                className="shrink-0 font-medium text-center"
                style={{ width: 64, minWidth: 64 }}
                title="Analyze language"
                disabled={isProcessing || isReadOnly}
              >
                <option value="auto">Auto</option>
                <option value="English">EN</option>
                <option value="Russian">RU</option>
              </Select>

              <Button
                onClick={onFixSyntax}
                disabled={!isAIReady || isProcessing || !canFix}
                className={`${canFix ? MODE_UI.fix.button : MODE_BUTTON_DISABLED} normal-case tracking-normal`}
                title={`Fix syntax using AI (up to ${AUTO_FIX_MAX_ATTEMPTS} attempts, not an error count)`}
              >
                <RefreshCw
                  size={12}
                  className={isFixing ? "animate-spin" : ""}
                />{" "}
                Fix syntax
              </Button>

              <Button
                onClick={onSnapshot}
                disabled={!canSnapshot}
                className={`${
                  canSnapshot
                    ? "text-white bg-slate-700 hover:bg-slate-800 border border-slate-700"
                    : "text-slate-400 bg-slate-200 dark:bg-slate-800 dark:text-slate-500 border border-slate-300/60 dark:border-slate-500/60"
                } normal-case tracking-normal`}
                title="Save a checkpoint in local project history"
              >
                <Bookmark size={12} /> Checkpoint
              </Button>
              {!!historyChips.length && (
                <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
                  {historyChips.map((chip) => (
                    <Button
                      key={chip.marker.stepId}
                      type="button"
                      onClick={() =>
                        void Promise.resolve(
                          onSelectDiagramStep?.(chip.marker),
                        ).catch(() => {})
                      }
                      className={chip.className}
                      title={chip.tooltip}
                    >
                      {chip.label}
                    </Button>
                  ))}
                </div>
              )}
            </>
          }
          right={
            <div className="text-[10px] text-[var(--control-muted-text)]">
              <span>
                Source:{" "}
                {mermaidState.source === "user"
                  ? "User"
                  : mermaidState.source === "compiled"
                    ? "Compiled"
                    : "User (Override)"}
              </span>
            </div>
          }
        />
      </HeaderSection>
    </PanelHeader>
  );
};

export default EditorHeader;
