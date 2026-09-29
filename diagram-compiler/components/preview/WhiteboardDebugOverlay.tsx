import React, { useCallback, useState } from 'react';
import { Button } from '../ui/Button';
import { exportToBlob } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

import type { WhiteboardDebugRuntime } from './useWhiteboardViewLock';

export type WhiteboardDebugOverlayData = {
  status?: 'idle' | 'building' | 'ready' | 'failed';
  error?: string | null;
  generator?: string;
  mermaidToExcalidrawError?: string | null;
  builtCounts?: Record<string, number> | null;
  bounds?: Record<string, number> | null;
  sampleRect?: Record<string, unknown> | null;
  sampleText?: Record<string, unknown> | null;
  diagramTypeHint?: string | null;
  svgChars?: number;
  sceneKey?: number;
  pendingFitKey?: number | null;
};

export type WhiteboardFitCalc = {
  bounds: { minX: number; minY: number; width: number; height: number };
  centerX: number;
  desiredZoom: number;
  scrollX: number;
  scrollY: number;
  viewport: { w: number; h: number };
};

type WhiteboardDebugOverlayProps = {
  enabled: boolean;
  debugOverlay: WhiteboardDebugOverlayData | null;
  debugRuntime: WhiteboardDebugRuntime | null;
  lastFitCalc: WhiteboardFitCalc | null;
  sceneKey: number;
  diagramTypeHint: string;
  lastGenerator: string;
  fitMode: 'content' | 'width';
  scrollMode: 'none' | 'vertical';
  zoomMode: 'controlled' | 'auto';
  isViewMode: boolean;
  pendingFitSceneKey: number | null;
  lockedScrollX: number | null;
  apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>;
  effectiveBackgroundColor: string | null;
};

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const resolveZoomValue = (zoom: AppState['zoom']): number | null => {
  if (typeof zoom === 'number') return zoom;
  const value = (zoom as { value?: unknown } | null)?.value;
  return typeof value === 'number' ? value : null;
};

const WhiteboardDebugOverlay: React.FC<WhiteboardDebugOverlayProps> = ({
  enabled,
  debugOverlay,
  debugRuntime,
  lastFitCalc,
  sceneKey,
  diagramTypeHint,
  lastGenerator,
  fitMode,
  scrollMode,
  zoomMode,
  isViewMode,
  pendingFitSceneKey,
  lockedScrollX,
  apiRef,
  effectiveBackgroundColor,
}) => {
  const [debugCopiedAt, setDebugCopiedAt] = useState<number | null>(null);
  const [debugCopyText, setDebugCopyText] = useState<string>('');
  const [debugCopyOpen, setDebugCopyOpen] = useState(false);

  const copyDebugOverlayToClipboard = useCallback(async () => {
    const api = apiRef.current;
    const appState = api?.getAppState?.() as AppState | undefined;
    const appStateRecord = appState ? (appState as unknown as Record<string, unknown>) : null;
    const zoomValue = appState ? resolveZoomValue(appState.zoom) : null;
    const payload = {
      sceneKey,
      pendingFitSceneKey,
      lockedScrollX,
      scrollMode,
      fitMode,
      zoomMode,
      viewMode: isViewMode,
      appState: appState
        ? {
          width: readNumber(appStateRecord?.width),
          height: readNumber(appStateRecord?.height),
          zoom: zoomValue ?? appState.zoom,
          scrollX: appState.scrollX ?? null,
          scrollY: appState.scrollY ?? null,
          openSidebar: appStateRecord?.openSidebar ?? null,
          openMenu: appStateRecord?.openMenu ?? null,
          openDialog: appStateRecord?.openDialog ?? null,
          openPopup: appStateRecord?.openPopup ?? null,
        }
        : null,
      overlay: debugOverlay,
    };
    const text = JSON.stringify(payload, null, 2);
    setDebugCopyText(text);

    try {
      await navigator.clipboard.writeText(text);
      setDebugCopiedAt(Date.now());
      setDebugCopyOpen(false);
      return;
    } catch {
      // Fallback for browsers without clipboard permission.
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setDebugCopiedAt(Date.now());
        setDebugCopyOpen(false);
      } catch {
        setDebugCopyOpen(true);
      }
    }
  }, [apiRef, debugOverlay, fitMode, isViewMode, lockedScrollX, pendingFitSceneKey, sceneKey, scrollMode, zoomMode]);

  const exportDebugPng = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const elementsAll = api.getSceneElements() as readonly ExcalidrawElement[];
      const elements = elementsAll.filter((el) => !el.isDeleted);
      const appState = api.getAppState() as AppState;
      const files = (api.getFiles?.() ?? {}) as BinaryFiles;
      const background = (effectiveBackgroundColor?.trim() || appState.viewBackgroundColor || '#ffffff') as string;
      const exportState: AppState = {
        ...appState,
        exportBackground: true,
        viewBackgroundColor: background,
      };
      const blob = await exportToBlob({
        elements,
        appState: exportState,
        files,
        mimeType: 'image/png',
        quality: 1,
        exportPadding: 32,
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      // ignore
    }
  }, [apiRef, effectiveBackgroundColor]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-auto absolute top-2 left-2 z-50 select-text rounded border border-slate-300/40 bg-white/80 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-600/50 dark:bg-slate-900/70 dark:text-slate-200">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void copyDebugOverlayToClipboard();
            }}
            className="px-2 py-0.5 text-[11px] text-slate-700 hover:bg-white/90 dark:text-slate-200 dark:hover:bg-slate-800/80"
          >
            Copy
          </Button>
          <Button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void exportDebugPng();
            }}
            className="px-2 py-0.5 text-[11px] text-slate-700 hover:bg-white/90 dark:text-slate-200 dark:hover:bg-slate-800/80"
          >
            PNG
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {debugCopiedAt ? (
            <span className="text-[10px] text-emerald-700 dark:text-emerald-300">
              Copied
            </span>
          ) : null}
          {debugCopyOpen ? (
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDebugCopyOpen(false);
              }}
              className="px-2 py-0.5 text-[11px] text-slate-700 hover:bg-white/90 dark:text-slate-200 dark:hover:bg-slate-800/80"
            >
              Close
            </Button>
          ) : null}
        </div>
      </div>
      <div>Whiteboard: {debugOverlay?.status ?? 'idle'}</div>
      {debugRuntime ? (
        <div className="text-[10px] text-slate-600 dark:text-slate-300">
          zoom={debugRuntime.zoom ?? 'n/a'} scrollX={debugRuntime.scrollX ?? 'n/a'} scrollY={debugRuntime.scrollY ?? 'n/a'} vw={debugRuntime.width ?? 'n/a'} vh={debugRuntime.height ?? 'n/a'} measured={debugRuntime.measuredWidth ?? 'n/a'}×{debugRuntime.measuredHeight ?? 'n/a'} sal={debugRuntime.safeLeft ?? 'n/a'} sar={debugRuntime.safeRight ?? 'n/a'} lockX={debugRuntime.lockedScrollX ?? 'n/a'}
        </div>
      ) : null}
      {lastFitCalc ? (
        <div className="text-[10px] text-slate-600 dark:text-slate-300">
          fit: w={Math.round(lastFitCalc.bounds.width)} centerX={Math.round(lastFitCalc.centerX)} zoom={Number(lastFitCalc.desiredZoom.toFixed(3))} scrollX={Math.round(lastFitCalc.scrollX)} vw={Math.round(lastFitCalc.viewport.w)}
        </div>
      ) : null}
      <div>sceneKey: {debugOverlay?.sceneKey ?? sceneKey} (pendingFit: {debugOverlay?.pendingFitKey ?? 'null'})</div>
      <div>type: {debugOverlay?.diagramTypeHint ?? diagramTypeHint}</div>
      <div>generator: {debugOverlay?.generator ?? lastGenerator}</div>
      <div>svg: {debugOverlay?.svgChars ? `${debugOverlay.svgChars} chars` : 'empty'}</div>
      {debugOverlay?.mermaidToExcalidrawError ? <div>m2e: {debugOverlay.mermaidToExcalidrawError}</div> : null}
      {debugOverlay?.error ? <div>error: {debugOverlay.error}</div> : null}
      {debugOverlay?.builtCounts ? <div>built: {JSON.stringify(debugOverlay.builtCounts)}</div> : null}
      {debugOverlay?.bounds ? <div>bounds: {JSON.stringify(debugOverlay.bounds)}</div> : null}
      {debugOverlay?.sampleRect ? <div>rect: {JSON.stringify(debugOverlay.sampleRect)}</div> : null}
      {debugOverlay?.sampleText ? <div>text: {JSON.stringify(debugOverlay.sampleText)}</div> : null}
      {debugCopyOpen ? (
        <div className="mt-2 max-w-[520px]">
          <div className="mb-1 text-[10px] text-slate-600 dark:text-slate-300">
            Clipboard blocked — copy from the box:
          </div>
          <textarea
            readOnly
            value={debugCopyText}
            onClick={(e) => {
              e.currentTarget.focus();
              e.currentTarget.select();
              e.stopPropagation();
            }}
            className="h-32 w-full resize-none rounded border border-slate-300/60 bg-white/70 p-2 font-mono text-[10px] text-slate-800 dark:border-slate-600/60 dark:bg-slate-950/40 dark:text-slate-100"
          />
        </div>
      ) : null}
    </div>
  );
};

export default WhiteboardDebugOverlay;
