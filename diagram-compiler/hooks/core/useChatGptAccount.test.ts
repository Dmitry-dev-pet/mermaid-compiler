// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ChatGptStatus } from '../../services/chatGptClient';
import { useChatGptAccount, type ChatGptAccountControls } from './useChatGptAccount';

const client = vi.hoisted(() => ({
  isLocal: vi.fn(),
  status: vi.fn(),
  login: vi.fn(),
  cancel: vi.fn(),
  logout: vi.fn(),
  account: vi.fn(),
}));

vi.mock('../../services/chatGptClient', () => ({
  CHATGPT_STATUS_CHANGED_EVENT: 'mermaid:chatgpt-status-changed',
  isChatGptAgentOrigin: client.isLocal,
  getChatGptStatus: client.status,
  startChatGptLogin: client.login,
  cancelChatGptLogin: client.cancel,
  logoutChatGptAccount: client.logout,
  selectChatGptAccount: client.account,
}));

const makeStatus = (overrides: Partial<ChatGptStatus> = {}): ChatGptStatus => ({
  agent: 'mermaid-chatgpt',
  protocolVersion: 1,
  connected: false,
  activeAccountId: null,
  accounts: [],
  login: null,
  usage: { state: 'unverified' },
  ...overrides,
});

const signedIn = (accountId = 'account-a'): ChatGptStatus => makeStatus({
  connected: true,
  activeAccountId: accountId,
  accounts: [{ id: accountId, email: `${accountId}@example.com`, connected: true }],
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

describe('useChatGptAccount', () => {
  let root: Root;
  let container: HTMLDivElement;
  let controls: ChatGptAccountControls;
  let onConnect: Mock<() => Promise<void>>;
  let onDisconnect: Mock<() => void>;

  const Harness = ({ enabled = true, isProcessing = false }: { enabled?: boolean; isProcessing?: boolean }) => {
    const current = useChatGptAccount({ enabled, isProcessing, onConnect, onDisconnect });
    useEffect(() => { controls = current; }, [current]);
    return null;
  };

  const render = async (props: { enabled?: boolean; isProcessing?: boolean } = {}) => {
    await act(async () => { root.render(React.createElement(Harness, props)); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.resetAllMocks();
    client.isLocal.mockReturnValue(true);
    client.status.mockResolvedValue(makeStatus());
    client.login.mockResolvedValue({ ok: true, authUrl: 'https://auth.openai.com/authorize?state=fixture' });
    client.cancel.mockResolvedValue({ ok: true });
    client.logout.mockResolvedValue({ ok: true });
    client.account.mockResolvedValue({ ok: true });
    onConnect = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    onDisconnect = vi.fn<() => void>();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not probe or invoke account APIs from the hosted editor', async () => {
    client.isLocal.mockReturnValue(false);
    await render();
    await act(async () => {
      await controls.refresh();
      await controls.login();
      await controls.selectAccount('account-a');
      await controls.logout();
      await controls.cancelLogin();
    });
    expect(controls.isLocal).toBe(false);
    for (const call of [client.status, client.login, client.account, client.logout, client.cancel, onConnect]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('loads models for a connected identity and refreshes usage without rediscovering models', async () => {
    client.status.mockResolvedValue(signedIn());
    await render();
    expect(onConnect).toHaveBeenCalledTimes(1);
    client.status.mockResolvedValue({ ...signedIn(), usage: { state: 'available', model: 'model-a' } });
    await act(async () => { window.dispatchEvent(new Event('mermaid:chatgpt-status-changed')); });
    expect(controls.status?.usage).toEqual({ state: 'available', model: 'model-a' });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('polls only a pending login and loads models after completion', async () => {
    const pending = makeStatus({ login: { id: 'login-a', state: 'pending' } });
    const complete = { ...signedIn(), login: { id: 'login-a', state: 'complete' as const } };
    client.status.mockResolvedValueOnce(makeStatus()).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValue(complete);
    await render();
    await act(async () => { await controls.login(); });
    expect(controls.authUrl).toBe('https://auth.openai.com/authorize?state=fixture');
    expect(onConnect).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(controls.status?.login?.state).toBe('pending');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(controls.status?.login?.state).toBe('complete');
    expect(controls.authUrl).toBeNull();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces usage events during model loading without cancelling the account recheck', async () => {
    const modelLoad = deferred<void>();
    let current = signedIn();
    client.status.mockImplementation(async () => current);
    onConnect.mockReturnValue(modelLoad.promise);
    await render();
    await act(async () => { window.dispatchEvent(new Event('mermaid:chatgpt-status-changed')); });
    expect(client.status).toHaveBeenCalledTimes(1);
    current = { ...signedIn(), usage: { state: 'available', model: 'model-a' } };
    await act(async () => { modelLoad.resolve(undefined); });
    expect(controls.status?.usage.state).toBe('available');
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(client.status).toHaveBeenCalledTimes(3);
  });

  it('aborts an in-flight poll and ignores its late completion after cancelling login', async () => {
    const lateStatus = deferred<ChatGptStatus>();
    const pending = makeStatus({ login: { id: 'login-a', state: 'pending' } });
    client.status.mockResolvedValueOnce(makeStatus()).mockResolvedValueOnce(pending).mockReturnValueOnce(lateStatus.promise)
      .mockResolvedValue(makeStatus({ login: { id: 'login-a', state: 'cancelled' } }));
    await render();
    await act(async () => { await controls.login(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const pollSignal = client.status.mock.calls[2][0] as AbortSignal;
    await act(async () => { await controls.cancelLogin(); });
    expect(pollSignal.aborted).toBe(true);
    await act(async () => { lateStatus.resolve(signedIn()); });
    expect(controls.status?.login?.state).toBe('cancelled');
    expect(controls.status?.connected).toBe(false);
    expect(controls.authUrl).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a valid account after failed login and never stores or prints the raw exception', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    client.status.mockResolvedValue(signedIn());
    client.login.mockRejectedValue(new Error('access_token=synthetic-secret'));
    await render();
    client.status.mockResolvedValue({
      ...signedIn(), login: { id: 'failed-login', state: 'failed', message: 'Sign-in was denied.' },
    });
    await act(async () => { await controls.login({ newAccount: true }); });
    expect(controls.status?.activeAccountId).toBe('account-a');
    expect(controls.status?.connected).toBe(true);
    expect(controls.status?.login?.message).toBe('Sign-in was denied.');
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(controls.error).not.toContain('synthetic-secret');
    expect(controls.error).toContain('could not be completed');
    expect(storage).not.toHaveBeenCalled();
  });

  it('disconnects before switching accounts and exposes the local sign-out result message', async () => {
    const order: string[] = [];
    onConnect.mockImplementation(async () => { order.push('connect'); });
    onDisconnect.mockImplementation(() => { order.push('disconnect'); });
    let current = signedIn();
    client.status.mockImplementation(async () => current);
    client.account.mockImplementation(async () => { order.push('select'); current = signedIn('account-b'); return { ok: true }; });
    client.logout.mockImplementation(async () => {
      current = makeStatus();
      return { ok: true, message: 'Local session removed. Manage app access in ChatGPT settings.' };
    });
    await render();
    order.length = 0;
    await act(async () => { await controls.selectAccount('account-b'); });
    expect(order).toEqual(['disconnect', 'select', 'connect']);
    expect(client.account).toHaveBeenCalledWith('account-b', expect.any(AbortSignal));
    await act(async () => { await controls.logout('account-b'); });
    expect(client.logout).toHaveBeenCalledWith('account-b', expect.any(AbortSignal));
    expect(controls.status?.connected).toBe(false);
    expect(controls.notice).toContain('Local session removed');
  });

  it('disconnects a catalogue if another tab changes the account during model loading', async () => {
    let current = signedIn();
    client.status.mockImplementation(async () => current);
    onConnect.mockImplementation(async () => { current = signedIn('account-b'); });
    await render();
    expect(controls.status?.activeAccountId).toBe('account-b');
    expect(controls.error).toContain('account changed while models were loading');
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('recovers a disconnected saved identity only through explicit model reload without a new login', async () => {
    let current = makeStatus({
      activeAccountId: 'account-a',
      accounts: [{ id: 'account-a', email: 'account-a@example.com', connected: false }],
    });
    client.status.mockImplementation(async () => current);
    onConnect.mockImplementation(async () => { current = signedIn(); });
    await render();
    await act(async () => { window.dispatchEvent(new Event('mermaid:chatgpt-status-changed')); });
    expect(onConnect).not.toHaveBeenCalled();
    await act(async () => { await controls.refresh(); });
    expect(controls.status?.connected).toBe(true);
    expect(controls.status?.activeAccountId).toBe('account-a');
    expect(controls.error).toBeNull();
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(client.login).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('mermaid:chatgpt-status-changed')); });
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed saved-session reload disconnected without automatic recovery retries', async () => {
    let current = makeStatus({
      activeAccountId: 'account-a',
      accounts: [{ id: 'account-a', email: 'account-a@example.com', connected: false }],
    });
    client.status.mockImplementation(async () => current);
    onConnect.mockImplementation(async () => {
      current = { ...current, usage: { state: 'unavailable', message: 'Session verification is still unavailable.' } };
    });
    await render();
    await act(async () => { await controls.refresh(); });
    expect(controls.status?.connected).toBe(false);
    expect(controls.status?.activeAccountId).toBe('account-a');
    await act(async () => { window.dispatchEvent(new Event('mermaid:chatgpt-status-changed')); });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(client.login).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  const unexpectedRecoveryStatuses: Array<[string, ChatGptStatus]> = [
    ['another account', signedIn('account-b')],
    ['a pending login', { ...signedIn(), login: { id: 'other-login', state: 'pending' } }],
    ['a replacement login', { ...signedIn(), login: { id: 'other-login', state: 'complete' } }],
  ];

  it.each(unexpectedRecoveryStatuses)('rejects recovery into %s', async (_label, replacement) => {
    let current = makeStatus({
      activeAccountId: 'account-a',
      accounts: [{ id: 'account-a', email: 'account-a@example.com', connected: false }],
    });
    client.status.mockImplementation(async () => current);
    onConnect.mockImplementation(async () => { current = replacement; });
    await render();
    await act(async () => { await controls.refresh(); });
    expect(controls.error).toContain('account changed while models were loading');
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(client.login).not.toHaveBeenCalled();
  });

  it('does not attempt saved-session recovery automatically after sign-out', async () => {
    let current = signedIn();
    client.status.mockImplementation(async () => current);
    client.logout.mockImplementation(async () => {
      current = makeStatus({
        activeAccountId: 'account-a',
        accounts: [{ id: 'account-a', email: 'account-a@example.com', connected: false }],
      });
      return { ok: true };
    });
    await render();
    await act(async () => { await controls.logout('account-a'); });
    expect(controls.status?.connected).toBe(false);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('blocks account mutations during generation', async () => {
    client.status.mockResolvedValue(signedIn());
    await render({ isProcessing: true });
    await act(async () => {
      await controls.login();
      await controls.selectAccount('account-b');
      await controls.logout();
      await controls.cancelLogin();
    });
    for (const call of [client.login, client.account, client.logout, client.cancel, onDisconnect]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('aborts stale work when the provider is disabled and clears pending UI on re-entry', async () => {
    const lateStatus = deferred<ChatGptStatus>();
    client.status.mockReturnValueOnce(lateStatus.promise).mockResolvedValue(makeStatus());
    await render();
    const signal = client.status.mock.calls[0][0] as AbortSignal;
    await render({ enabled: false });
    expect(signal.aborted).toBe(true);
    await act(async () => { lateStatus.resolve(signedIn()); });
    expect(onConnect).not.toHaveBeenCalled();
    expect(controls.status).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await render();
    expect(controls.action).toBeNull();
    expect(controls.authUrl).toBeNull();
    expect(controls.status?.connected).toBe(false);
  });
});
