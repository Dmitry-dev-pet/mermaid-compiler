import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHATGPT_STATUS_CHANGED_EVENT,
  cancelChatGptLogin,
  getChatGptStatus,
  isChatGptAgentOrigin,
  logoutChatGptAccount,
  selectChatGptAccount,
  startChatGptLogin,
  type ChatGptStatus,
} from '../../services/chatGptClient';

type AccountAction = 'login' | 'cancel' | 'logout' | 'account';

type AccountState = {
  status: ChatGptStatus | null;
  loading: boolean;
  action: AccountAction | null;
  error: string | null;
  notice: string | null;
  authUrl: string | null;
};

type UseChatGptAccountOptions = {
  enabled: boolean;
  isProcessing?: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
};

const INITIAL_STATE: AccountState = {
  status: null,
  loading: false,
  action: null,
  error: null,
  notice: null,
  authUrl: null,
};

const STATUS_ERROR = 'Could not reach the local ChatGPT Agent. Check that it is running, then try again.';
const ACTION_ERROR = 'The account action could not be completed. Refresh status and try again.';
const ACCOUNT_CHANGED_ERROR = 'The ChatGPT account changed while models were loading. Reload status and models.';
const LOGIN_POLL_MS = 1000;

const getAccountIdentity = (status: ChatGptStatus): string | null => (
  status.activeAccountId && status.login?.state !== 'pending'
    ? JSON.stringify([status.activeAccountId, status.login?.state === 'complete' ? status.login.id : null])
    : null
);

const getConnectedIdentity = (status: ChatGptStatus): string | null => (
  status.connected ? getAccountIdentity(status) : null
);

export const useChatGptAccount = ({
  enabled,
  isProcessing = false,
  onConnect,
  onDisconnect,
}: UseChatGptAccountOptions) => {
  const isLocal = isChatGptAgentOrigin();
  const [state, setState] = useState<AccountState>(INITIAL_STATE);
  const activeRef = useRef(false);
  const actionRef = useRef<AccountAction | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const queuedRefreshRef = useRef<boolean | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<ChatGptStatus | null>(null);
  const connectedIdentityRef = useRef<string | null>(null);
  const requiresReloadRef = useRef(false);
  const callbacksRef = useRef({ onConnect, onDisconnect, isProcessing });

  useEffect(() => {
    callbacksRef.current = { onConnect, onDisconnect, isProcessing };
  }, [onConnect, onDisconnect, isProcessing]);

  const stopWork = useCallback(() => {
    if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
    refreshControllerRef.current = null;
    queuedRefreshRef.current = null;
  }, []);

  const applyStatus = useCallback(async (
    next: ChatGptStatus,
    signal: AbortSignal,
    { forceModels, recoverSavedSession = false }: { forceModels: boolean; recoverSavedSession?: boolean },
  ): Promise<ChatGptStatus | null> => {
    if (signal.aborted || !activeRef.current) return null;
    const pending = next.login?.state === 'pending';
    const identity = getConnectedIdentity(next);
    const canRecover = recoverSavedSession && forceModels && !next.connected && !pending && Boolean(next.activeAccountId);
    const previousIdentity = connectedIdentityRef.current;
    const identityChanged = previousIdentity !== identity;
    if (forceModels) requiresReloadRef.current = false;
    connectedIdentityRef.current = identity;
    statusRef.current = next;
    const accountError = requiresReloadRef.current ? ACCOUNT_CHANGED_ERROR : null;
    setState((prev) => ({ ...prev, status: next, error: accountError, authUrl: pending ? prev.authUrl : null }));

    if (identityChanged && previousIdentity !== null) callbacksRef.current.onDisconnect();
    if (!requiresReloadRef.current && ((identity && (identityChanged || forceModels)) || canRecover)) {
      try {
        await callbacksRef.current.onConnect();
      } catch {
        if (!signal.aborted && activeRef.current) {
          setState((prev) => ({ ...prev, error: 'Models could not be loaded. Try reloading models.' }));
        }
        return next;
      }
      if (signal.aborted || !activeRef.current) return null;
      const current = await getChatGptStatus(signal);
      if (signal.aborted || !activeRef.current) return null;
      statusRef.current = current;
      setState((prev) => ({ ...prev, status: current, authUrl: current.login?.state === 'pending' ? prev.authUrl : null }));
      const currentIdentity = getConnectedIdentity(current);
      const accountReplaced = getAccountIdentity(current) !== getAccountIdentity(next);
      const recovered = canRecover && currentIdentity !== null && !accountReplaced;
      if (recovered) {
        connectedIdentityRef.current = currentIdentity;
      } else if (accountReplaced || currentIdentity !== identity) {
        connectedIdentityRef.current = null;
        requiresReloadRef.current = true;
        callbacksRef.current.onDisconnect();
        setState((prev) => ({ ...prev, error: ACCOUNT_CHANGED_ERROR }));
      }
      return current;
    }
    return next;
  }, []);

  const refreshStatus = useCallback(async function refreshStatusImpl(forceModels = false): Promise<void> {
    if (!activeRef.current || actionRef.current) return;
    if (refreshControllerRef.current) {
      queuedRefreshRef.current = forceModels || queuedRefreshRef.current === true;
      return;
    }
    stopWork();
    const controller = new AbortController();
    controllerRef.current = controller;
    refreshControllerRef.current = controller;
    const previousStatus = statusRef.current;
    setState((prev) => ({
      ...prev,
      status: previousStatus,
      loading: true,
      action: null,
      error: null,
      authUrl: previousStatus?.login?.state === 'pending' ? prev.authUrl : null,
      notice: previousStatus ? prev.notice : null,
    }));
    try {
      const result = await getChatGptStatus(controller.signal);
      const next = await applyStatus(result, controller.signal, { forceModels, recoverSavedSession: forceModels });
      if (!controller.signal.aborted && activeRef.current && next?.login?.state === 'pending') {
        pollTimerRef.current = setTimeout(() => {
          if (!controller.signal.aborted) void refreshStatusImpl();
        }, LOGIN_POLL_MS);
      }
    } catch {
      if (!controller.signal.aborted && activeRef.current) {
        connectedIdentityRef.current = null;
        statusRef.current = null;
        callbacksRef.current.onDisconnect();
        setState((prev) => ({ ...prev, status: null, error: STATUS_ERROR }));
      }
    } finally {
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
      if (!controller.signal.aborted && activeRef.current) {
        setState((prev) => ({ ...prev, loading: false }));
        const queued = queuedRefreshRef.current;
        queuedRefreshRef.current = null;
        if (queued !== null) void refreshStatusImpl(queued);
      }
    }
  }, [applyStatus, stopWork]);

  useEffect(() => {
    if (!enabled || !isLocal) return;
    activeRef.current = true;
    void refreshStatus();
    const handleStatusChanged = () => { void refreshStatus(); };
    window.addEventListener(CHATGPT_STATUS_CHANGED_EVENT, handleStatusChanged);
    return () => {
      activeRef.current = false;
      stopWork();
      actionRef.current = null;
      statusRef.current = null;
      connectedIdentityRef.current = null;
      requiresReloadRef.current = false;
      window.removeEventListener(CHATGPT_STATUS_CHANGED_EVENT, handleStatusChanged);
    };
  }, [enabled, isLocal, refreshStatus, stopWork]);

  const runAction = useCallback(async (
    action: AccountAction,
    operation: (signal: AbortSignal) => Promise<{ authUrl?: string; message?: string } | void>,
  ): Promise<void> => {
    if (!activeRef.current || actionRef.current || callbacksRef.current.isProcessing) return;
    stopWork();
    actionRef.current = action;
    connectedIdentityRef.current = null;
    callbacksRef.current.onDisconnect();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, action, loading: true, error: null, notice: null, authUrl: null }));
    let actionError: string | null = null;
    try {
      try {
        const result = await operation(controller.signal);
        if (controller.signal.aborted || !activeRef.current) return;
        if (result && result.authUrl) setState((prev) => ({ ...prev, authUrl: result.authUrl ?? null }));
        if (result && result.message) setState((prev) => ({ ...prev, notice: result.message ?? null }));
      } catch {
        if (controller.signal.aborted || !activeRef.current) return;
        actionError = ACTION_ERROR;
      }
      // Even a failed login can leave an existing valid account available.
      const result = await getChatGptStatus(controller.signal);
      const next = await applyStatus(result, controller.signal, { forceModels: true });
      if (controller.signal.aborted || !activeRef.current) return;
      if (actionError) setState((prev) => ({ ...prev, error: actionError }));
      if (next?.login?.state === 'pending') {
        pollTimerRef.current = setTimeout(() => {
          if (!controller.signal.aborted) void refreshStatus();
        }, LOGIN_POLL_MS);
      }
    } catch {
      if (!controller.signal.aborted && activeRef.current) {
        connectedIdentityRef.current = null;
        statusRef.current = null;
        callbacksRef.current.onDisconnect();
        setState((prev) => ({ ...prev, status: null, error: STATUS_ERROR }));
      }
    } finally {
      if (!controller.signal.aborted && activeRef.current) {
        actionRef.current = null;
        setState((prev) => ({ ...prev, action: null, loading: false }));
      }
    }
  }, [applyStatus, refreshStatus, stopWork]);

  const login = useCallback((options: { accountId?: string; newAccount?: boolean } = {}) => (
    runAction('login', (signal) => startChatGptLogin(options, signal))
  ), [runAction]);
  const cancelLogin = useCallback(() => (
    runAction('cancel', async (signal) => { await cancelChatGptLogin(signal); })
  ), [runAction]);
  const logout = useCallback((accountId?: string) => (
    runAction('logout', (signal) => logoutChatGptAccount(accountId, signal))
  ), [runAction]);
  const selectAccount = useCallback((accountId: string) => (
    runAction('account', async (signal) => { await selectChatGptAccount(accountId, signal); })
  ), [runAction]);
  const refresh = useCallback(() => refreshStatus(true), [refreshStatus]);

  return {
    ...(enabled && isLocal ? state : INITIAL_STATE),
    isLocal,
    refresh,
    login,
    cancelLogin,
    logout,
    selectAccount,
  };
};

export type ChatGptAccountControls = ReturnType<typeof useChatGptAccount>;
