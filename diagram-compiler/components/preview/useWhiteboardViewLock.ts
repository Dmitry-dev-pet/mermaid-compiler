import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { CaptureUpdateAction, getCommonBounds } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

import {
  centerScrollOnLikeExcalidraw,
  clampScrollYToBounds,
  readCssVarInt,
  VIEW_SCROLL_PAD_BOTTOM_PX,
  VIEW_SCROLL_PAD_TOP_PX,
} from '../../utils/excalidrawViewport';

export type WhiteboardDebugRuntime = {
  zoom: number | null;
  scrollX: number | null;
  scrollY: number | null;
  width: number | null;
  height: number | null;
  measuredWidth: number | null;
  measuredHeight: number | null;
  lockedScrollX: number | null;
  safeLeft: number | null;
  safeRight: number | null;
};

type FitBounds = { minX: number; minY: number; width: number; height: number };

type UseWhiteboardViewLockArgs = {
  apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  sceneKey: number;
  isViewMode: boolean;
  isAutoZoom: boolean;
  fitMode: 'content' | 'width';
  scrollMode: 'none' | 'vertical';
  viewModeAppStatePatch: Partial<AppState> | null;
  editableAppState: Partial<AppState>;
  debugEnabled: boolean;
  clampZoom: (zoom: number) => number;
  setDebugRuntime?: React.Dispatch<React.SetStateAction<WhiteboardDebugRuntime | null>>;
};

export const useWhiteboardViewLock = (args: UseWhiteboardViewLockArgs) => {
  const pendingFitSceneKeyRef = useRef<number | null>(null);
  const lockedScrollXRef = useRef<number | null>(null);
  const pendingWheelRef = useRef<number | null>(null);
  const pendingWheelDeltaRef = useRef(0);
  const pendingScrollLockRef = useRef<number | null>(null);
  const resizeFitRafRef = useRef<number | null>(null);
  const lastFitCalcRef = useRef<{
    bounds: FitBounds;
    centerX: number;
    desiredZoom: number;
    scrollX: number;
    scrollY: number;
    viewport: { w: number; h: number };
  } | null>(null);

  const setDebugRuntime = args.setDebugRuntime;

  const readAppStateNumber = useCallback((state: AppState, key: 'width' | 'height') => {
    const value = (state as unknown as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }, []);

  const resolveZoomValue = useCallback((zoom: AppState['zoom']): number | null => {
    if (typeof zoom === 'number') return zoom;
    const value = (zoom as { value?: unknown } | null)?.value;
    return typeof value === 'number' ? value : null;
  }, []);

  const updateDebugRuntime = useCallback((override?: {
    scrollX?: number | null;
    scrollY?: number | null;
    zoom?: number | null;
  }) => {
    if (!args.debugEnabled || !setDebugRuntime) return;
    try {
      const api = args.apiRef.current;
      if (!api) return;
      const state = api.getAppState() as AppState;
      const z = resolveZoomValue(state.zoom);
      const measured = args.containerRef.current
        ? { w: args.containerRef.current.clientWidth, h: args.containerRef.current.clientHeight }
        : null;
      const safeLeft = (() => {
        try {
          const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--sal');
          const value = parseInt(raw, 10);
          return Number.isFinite(value) ? value : 0;
        } catch {
          return 0;
        }
      })();
      const safeRight = (() => {
        try {
          const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--sar');
          const value = parseInt(raw, 10);
          return Number.isFinite(value) ? value : 0;
        } catch {
          return 0;
        }
      })();
      setDebugRuntime({
        zoom: typeof (override?.zoom ?? z) === 'number' ? (override?.zoom ?? z) as number : null,
        scrollX: override?.scrollX ?? state.scrollX ?? null,
        scrollY: override?.scrollY ?? state.scrollY ?? null,
        width: readAppStateNumber(state, 'width'),
        height: readAppStateNumber(state, 'height'),
        measuredWidth: measured?.w ?? null,
        measuredHeight: measured?.h ?? null,
        lockedScrollX: lockedScrollXRef.current,
        safeLeft,
        safeRight,
      });
    } catch {
      // ignore
    }
  }, [args.apiRef, args.containerRef, args.debugEnabled, readAppStateNumber, resolveZoomValue, setDebugRuntime]);

  const scheduleFitToContent = useCallback((
    api: ExcalidrawImperativeAPI,
    targetSceneKey: number
  ) => {
    // The Excalidraw API instance is recreated when we bump `sceneKey` (key prop).
    // Fit-to-content must run after the new scene is actually loaded.
    if (pendingFitSceneKeyRef.current !== targetSceneKey) return;

    let attempts = 0;
    const maxAttempts = 600;
    const tick = () => {
      if (pendingFitSceneKeyRef.current !== targetSceneKey) return;
      attempts += 1;
      const elements = api.getSceneElements();
      const appState = api.getAppState() as AppState;
      // `isLoading` is not present in all Excalidraw versions; treat `undefined`
      // as "not loading" to avoid permanently skipping fit-to-content.
      const isLoading = (appState as unknown as { isLoading?: unknown }).isLoading === true;
      const viewportReady =
        typeof (appState as unknown as { width?: unknown }).width === 'number'
        && (appState as unknown as { width: number }).width > 0
        && typeof (appState as unknown as { height?: unknown }).height === 'number'
        && (appState as unknown as { height: number }).height > 0;
      if (elements?.length && !isLoading && viewportReady) {
        try {
          if (args.fitMode === 'width') {
            const common = getCommonBounds(elements);
            const appState = api.getAppState() as AppState;
            const stateWidth = readAppStateNumber(appState, 'width') ?? undefined;
            const stateHeight = readAppStateNumber(appState, 'height') ?? undefined;
            const measured = args.containerRef.current
              ? { w: args.containerRef.current.clientWidth, h: args.containerRef.current.clientHeight }
              : null;
            const vw = measured?.w ?? (typeof stateWidth === 'number' ? stateWidth : 0);
            const vh = measured?.h ?? (typeof stateHeight === 'number' ? stateHeight : 0);
            const safeLeft = (() => {
              try {
                const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--sal');
                const value = parseInt(raw, 10);
                return Number.isFinite(value) ? value : 0;
              } catch {
                return 0;
              }
            })();
            const safeRight = (() => {
              try {
                const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--sar');
                const value = parseInt(raw, 10);
                return Number.isFinite(value) ? value : 0;
              } catch {
                return 0;
              }
            })();
            const availableW = Math.max(0, vw - safeLeft - safeRight);
            const factor = 0.96;
            const bounds = {
              minX: common[0],
              minY: common[1],
              maxX: common[2],
              maxY: common[3],
              width: common[2] - common[0],
              height: common[3] - common[1],
            };
            if (vw > 0 && vh > 0 && bounds.width > 0) {
              const desiredZoom = args.clampZoom(((availableW > 0 ? availableW : vw) * factor) / bounds.width);
              const padPx = 32;
              const centerX = bounds.minX + bounds.width / 2;
              const { scrollX } = centerScrollOnLikeExcalidraw({
                scenePoint: { x: centerX, y: 0 },
                viewportDimensions: { width: vw, height: vh },
                zoom: { value: desiredZoom },
                offsets: { left: safeLeft, right: safeRight, top: 0, bottom: 0 },
              });
              const viewportHeightDiff = vh - vh / desiredZoom;
              const scrollY = -bounds.minY + viewportHeightDiff / 2 + padPx / desiredZoom;
              lockedScrollXRef.current = scrollX;
              lastFitCalcRef.current = {
                bounds: { minX: bounds.minX, minY: bounds.minY, width: bounds.width, height: bounds.height },
                centerX,
                desiredZoom,
                scrollX,
                scrollY,
                viewport: { w: vw, h: vh },
              };
              api.updateScene({
                appState: {
                  ...api.getAppState(),
                  ...args.editableAppState,
                  viewModeEnabled: args.isViewMode,
                  ...(args.viewModeAppStatePatch ?? {}),
                  zoom: { value: desiredZoom } as AppState['zoom'],
                  scrollX,
                  scrollY,
                },
                captureUpdate: CaptureUpdateAction.NEVER,
              });
              api.refresh();
            } else {
              api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.92 });
            }
          } else {
            api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.92 });
          }
          if (args.debugEnabled) {
            updateDebugRuntime();
          }
          pendingFitSceneKeyRef.current = null;
          return;
        } catch (error) {
          // Keep retrying until it succeeds (Excalidraw can throw during early mount).
          if (args.debugEnabled) {
            console.warn('[whiteboard] scrollToContent failed; retrying', error);
          }
        }
      }
      if (attempts >= maxAttempts) return;
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [args, readAppStateNumber, updateDebugRuntime]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (!args.apiRef.current) return;
    if (!args.isViewMode) return;
    if (args.scrollMode !== 'vertical') return;

    // Only vertical navigation; ignore horizontal deltas.
    event.preventDefault();
    event.stopPropagation();

    const api = args.apiRef.current;
    const state = api.getAppState() as AppState;
    const zoomValue = resolveZoomValue(state.zoom);
    const z = typeof zoomValue === 'number' && zoomValue > 0 ? zoomValue : 1;

    pendingWheelDeltaRef.current += event.deltaY;
    if (pendingWheelRef.current) return;

    pendingWheelRef.current = window.requestAnimationFrame(() => {
      pendingWheelRef.current = null;
      const deltaY = pendingWheelDeltaRef.current;
      pendingWheelDeltaRef.current = 0;

      const current = api.getAppState() as AppState;
      const baseScrollX = lockedScrollXRef.current ?? current.scrollX;
      const desiredScrollY = current.scrollY - deltaY / z;

      const measured = args.containerRef.current
        ? { w: args.containerRef.current.clientWidth, h: args.containerRef.current.clientHeight }
        : null;
      const vh = measured?.h ?? readAppStateNumber(current, 'height') ?? 0;
      const safeTop = readCssVarInt('--sat');
      const safeBottom = readCssVarInt('--sab');
      const zoomValue = resolveZoomValue(current.zoom);
      const zVal = typeof zoomValue === 'number' && zoomValue > 0 ? zoomValue : 1;
      const padTopPx = VIEW_SCROLL_PAD_TOP_PX;
      const padBottomPx = VIEW_SCROLL_PAD_BOTTOM_PX;

      const bounds = (() => {
        const cached = lastFitCalcRef.current?.bounds ?? null;
        if (cached) {
          const maxY = cached.minY + cached.height;
          return { minY: cached.minY, maxY };
        }
        try {
          const [, minY, , maxY] = getCommonBounds(api.getSceneElements());
          if (![minY, maxY].every((n) => Number.isFinite(n))) return null;
          return { minY, maxY };
        } catch {
          return null;
        }
      })();

      const nextScrollY = (() => {
        if (!bounds || !(vh > 0)) return desiredScrollY;
        return clampScrollYToBounds({
          desiredScrollY,
          boundsMinY: bounds.minY,
          boundsMaxY: bounds.maxY,
          viewportHeight: vh,
          zoomValue: zVal,
          safeTopPx: safeTop,
          safeBottomPx: safeBottom,
          padTopPx,
          padBottomPx,
        });
      })();
      api.updateScene({
        appState: {
          ...current,
          ...args.editableAppState,
          viewModeEnabled: true,
          ...(args.viewModeAppStatePatch ?? {}),
          scrollX: baseScrollX,
          scrollY: nextScrollY,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      api.refresh();
      if (args.debugEnabled) {
        updateDebugRuntime({ scrollX: baseScrollX, scrollY: nextScrollY });
      }
    });
  }, [args, readAppStateNumber, resolveZoomValue, updateDebugRuntime]);

  const scheduleClampScroll = useCallback((desiredScrollY?: number) => {
    if (!args.apiRef.current) return;
    if (!args.isViewMode) return;
    if (args.scrollMode !== 'vertical') return;
    if (pendingFitSceneKeyRef.current !== null) return;
    const lockX = lockedScrollXRef.current;
    if (lockX === null) return;

    if (pendingScrollLockRef.current) return;
    pendingScrollLockRef.current = window.requestAnimationFrame(() => {
      pendingScrollLockRef.current = null;
      const api = args.apiRef.current;
      if (!api) return;
      const current = api.getAppState() as AppState;
      const measured = args.containerRef.current
        ? { w: args.containerRef.current.clientWidth, h: args.containerRef.current.clientHeight }
        : null;
      const vh = measured?.h ?? readAppStateNumber(current, 'height') ?? 0;
      const safeTop = readCssVarInt('--sat');
      const safeBottom = readCssVarInt('--sab');

      const zoomValue = resolveZoomValue(current.zoom);
      const zVal = typeof zoomValue === 'number' && zoomValue > 0 ? zoomValue : 1;
      const padTopPx = VIEW_SCROLL_PAD_TOP_PX;
      const padBottomPx = VIEW_SCROLL_PAD_BOTTOM_PX;

      const bounds = (() => {
        const cached = lastFitCalcRef.current?.bounds ?? null;
        if (cached) {
          const maxY = cached.minY + cached.height;
          return { minY: cached.minY, maxY };
        }
        try {
          const [, minY, , maxY] = getCommonBounds(api.getSceneElements());
          if (![minY, maxY].every((n) => Number.isFinite(n))) return null;
          return { minY, maxY };
        } catch {
          return null;
        }
      })();

      const nextScrollY = (() => {
        const raw = typeof desiredScrollY === 'number' ? desiredScrollY : current.scrollY;
        if (!bounds || !(vh > 0)) return raw;
        return clampScrollYToBounds({
          desiredScrollY: raw,
          boundsMinY: bounds.minY,
          boundsMaxY: bounds.maxY,
          viewportHeight: vh,
          zoomValue: zVal,
          safeTopPx: safeTop,
          safeBottomPx: safeBottom,
          padTopPx,
          padBottomPx,
        });
      })();

      if (Math.abs(current.scrollX - lockX) < 0.5 && Math.abs(current.scrollY - nextScrollY) < 0.5) return;

      api.updateScene({
        appState: {
          ...current,
          ...args.editableAppState,
          viewModeEnabled: true,
          ...(args.viewModeAppStatePatch ?? {}),
          scrollX: lockX,
          scrollY: nextScrollY,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      api.refresh();
    });
  }, [args, readAppStateNumber, resolveZoomValue]);

  const handleScrollChange = useCallback((scrollX: number, scrollY: number, zoom: AppState['zoom']) => {
    if (!args.apiRef.current) return;
    if (!args.isViewMode) return;
    if (args.scrollMode !== 'vertical') return;
    // Don't lock while we're still fitting the scene (we compute and set the lockX ourselves).
    if (pendingFitSceneKeyRef.current !== null) return;
    if (args.debugEnabled) {
      const zv = resolveZoomValue(zoom);
      updateDebugRuntime({ scrollX, scrollY, zoom: typeof zv === 'number' ? zv : null });
    }
    const lockX = lockedScrollXRef.current;
    if (lockX === null) {
      lockedScrollXRef.current = scrollX;
      return;
    }
    if (Math.abs(scrollX - lockX) < 0.5) return;
    scheduleClampScroll(scrollY);
  }, [args, resolveZoomValue, scheduleClampScroll, updateDebugRuntime]);

  useEffect(() => {
    if (!args.isViewMode) return;
    if (!args.isAutoZoom) return;
    if (args.fitMode !== 'width') return;
    const el = args.containerRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      if (!args.apiRef.current) return;
      if (resizeFitRafRef.current) return;
      resizeFitRafRef.current = window.requestAnimationFrame(() => {
        resizeFitRafRef.current = null;
        pendingFitSceneKeyRef.current = args.sceneKey;
        scheduleFitToContent(args.apiRef.current!, args.sceneKey);
      });
    });
    ro.observe(el);
    return () => {
      if (resizeFitRafRef.current) {
        window.cancelAnimationFrame(resizeFitRafRef.current);
        resizeFitRafRef.current = null;
      }
      ro.disconnect();
    };
  }, [args.apiRef, args.containerRef, args.fitMode, args.isAutoZoom, args.isViewMode, args.sceneKey, scheduleFitToContent]);

  return {
    lockedScrollXRef,
    pendingFitSceneKeyRef,
    lastFitCalcRef,
    scheduleFitToContent,
    scheduleClampScroll,
    handleWheel,
    handleScrollChange,
  };
};
