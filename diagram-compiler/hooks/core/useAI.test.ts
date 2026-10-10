// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAI } from './useAI';
import { DEFAULT_AI_CONFIG } from '../../constants';
import { getChatGptModelCatalog, isChatGptAgentOrigin } from '../../services/chatGptClient';

vi.mock('../../services/llmService', () => ({ fetchModels: vi.fn(async () => []) }));
vi.mock('../../services/chatGptClient', () => ({
  getChatGptModelCatalog: vi.fn(),
  isChatGptAgentOrigin: vi.fn(() => true),
}));
vi.mock('../../utils', () => ({
  safeParse: (key: string, fallback: unknown) => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  },
}));

describe('useAI ChatGPT connection lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let api: ReturnType<typeof useAI> | null;
  const current = () => {
    if (!api) throw new Error('Hook has not rendered');
    return api;
  };
  const Probe = () => { api = useAI(); return null; };
  const render = async () => { await act(async () => { root.render(createElement(Probe)); }); };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    api = null;
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    localStorage.setItem('dc_ai_config', JSON.stringify({ ...DEFAULT_AI_CONFIG, provider: 'chatgpt' }));
    vi.mocked(isChatGptAgentOrigin).mockReturnValue(true);
    vi.mocked(getChatGptModelCatalog).mockReset().mockResolvedValue({
      accountId: 'account-a',
      models: [{ id: 'subscription-model', name: 'Subscription model' }],
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
  });

  it('waits for the account hook rather than attempting an automatic ChatGPT connection', async () => {
    await render();
    expect(current().connectionState.status).toBe('disconnected');
    expect(getChatGptModelCatalog).not.toHaveBeenCalled();
  });

  it('binds discovered models to an in-memory account without persisting it', async () => {
    await render();
    await act(async () => { await current().connectAI(); });
    expect(current().connectionState).toEqual({
      status: 'connected',
      availableModels: [{ id: 'subscription-model', name: 'Subscription model' }],
      chatGptAccountId: 'account-a',
    });
    expect(current().aiConfig.selectedModelIdByProvider.chatgpt).toBe('subscription-model');
    const saved = localStorage.getItem('dc_ai_config');
    expect(saved).not.toContain('account-a');
    expect(saved).not.toContain('chatGptAccountId');
    await act(async () => { current().disconnectAI(); });
    expect(current().connectionState).toEqual({ status: 'disconnected', availableModels: [] });
  });

  it('ignores a model response that arrives after an account switch or disconnect', async () => {
    let finish: (value: Awaited<ReturnType<typeof getChatGptModelCatalog>>) => void;
    vi.mocked(getChatGptModelCatalog).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    let request: Promise<void>;
    await act(async () => { request = current().connectAI(); });
    await act(async () => { current().disconnectAI(); });
    await act(async () => {
      finish({ accountId: 'stale-account', models: [{ id: 'old-model', name: 'Old model' }] });
      await request;
    });
    expect(current().connectionState).toEqual({ status: 'disconnected', availableModels: [] });
    expect(current().aiConfig.selectedModelId).not.toBe('old-model');
  });

  it('keeps a failed discovery disconnected from generation', async () => {
    vi.mocked(getChatGptModelCatalog).mockRejectedValue(new Error('Reconnect this account'));
    await render();
    await act(async () => { await current().connectAI(); });
    expect(current().connectionState).toEqual({ status: 'failed', error: 'Reconnect this account', availableModels: [] });
    expect(current().connectionState.chatGptAccountId).toBeUndefined();
  });

  it.each([true, false])('applies the ChatGPT launch query only in the local Agent (local=%s)', async (local) => {
    localStorage.setItem('dc_ai_config', JSON.stringify({
      ...DEFAULT_AI_CONFIG,
      provider: 'openrouter',
      selectedModelId: 'router-model',
      selectedModelIdByProvider: { ...DEFAULT_AI_CONFIG.selectedModelIdByProvider, chatgpt: 'saved-subscription-model' },
    }));
    vi.mocked(isChatGptAgentOrigin).mockReturnValue(local);
    window.history.replaceState({}, '', '/?ai=chatgpt');
    await render();
    expect(current().aiConfig.provider).toBe(local ? 'chatgpt' : 'openrouter');
    expect(current().aiConfig.selectedModelId).toBe(local ? 'saved-subscription-model' : 'router-model');
    expect(getChatGptModelCatalog).not.toHaveBeenCalled();
  });
});
