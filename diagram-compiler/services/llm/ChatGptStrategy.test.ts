import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptStrategy } from './ChatGptStrategy';
import { DEFAULT_AI_CONFIG } from '../../constants';
import { CHATGPT_AGENT_ORIGIN } from '../chatGptClient';
import { buildSystemPrompt } from './prompts';
import type { AIConfig, Message } from '../../types';
import type { LLMRequestContext } from './types';

vi.mock('./prompts', () => ({ buildSystemPrompt: vi.fn((mode: string) => `Mermaid ${mode} instructions`) }));

describe('ChatGPT strategy', () => {
  const strategy = new ChatGptStrategy();
  const fetchMock = vi.fn();
  const config: AIConfig = {
    ...DEFAULT_AI_CONFIG, provider: 'chatgpt', selectedModelId: 'subscription-model',
    openRouterKey: 'synthetic-other-provider-key', proxyKey: 'synthetic-proxy-key', agentToken: 'synthetic-old-agent-token',
  };
  const context: LLMRequestContext = {
    sessionId: 'mermaid:project-123:main', chatGptAccountId: 'account-a', docsContext: 'docs', language: 'en',
  };
  const messages: Message[] = [{ id: 'user-1', role: 'user', timestamp: 1, content: 'Draw A to B' }];
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(buildSystemPrompt).mockClear();
    vi.stubGlobal('window', { location: { origin: CHATGPT_AGENT_ORIGIN }, dispatchEvent: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/chatgpt/status') return Response.json({
        agent: 'mermaid-chatgpt', protocolVersion: 1, connected: true, activeAccountId: 'account-a',
        accounts: [{ id: 'account-a', email: null, connected: true }], login: null, usage: { state: 'unverified' },
      });
      if (url === '/api/chatgpt/models') return Response.json({ accountId: 'account-a', models: [{ id: 'subscription-model', name: 'Subscription model' }] });
      return Response.json({ text: 'flowchart TD\nA-->B' });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only exposes account catalogue entries without making inference requests', async () => {
    expect((await strategy.fetchModels()).map((model) => model.id)).toEqual(['subscription-model']);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/chatgpt/status', '/api/chatgpt/models']);
  });

  it('uses the existing prompts for every studio operation while keeping account/session outside the prompt', async () => {
    await strategy.chat(messages, config, context);
    await strategy.generateDiagram(messages, config, context, { temperature: 0.3, max_tokens: 1000, stream: false });
    await strategy.fixDiagram('bad code', 'syntax error', config, context);
    await strategy.analyzeDiagram('flowchart TD\nA-->B', config, context);
    await strategy.chatDiagram(messages, config, context);
    await strategy.chatNotebook(messages, config, context);
    await strategy.planNotebook(messages, config, context);
    await strategy.summarizeBuild(messages, config, context);

    expect(vi.mocked(buildSystemPrompt).mock.calls.map(([mode]) => mode)).toEqual([
      'chat', 'generate', 'fix', 'analyze', 'chat_diagram', 'chat_notebook', 'plan_notebook', 'summary',
    ]);
    const requests = fetchMock.mock.calls.filter(([url]) => url === '/api/chatgpt/generate');
    expect(requests).toHaveLength(8);
    for (const [, init] of requests as Array<[string, RequestInit]>) {
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body).sort()).toEqual(['accountId', 'messages', 'model', 'sessionId']);
      expect(body.model).toBe(config.selectedModelId);
      expect(body.accountId).toBe(context.chatGptAccountId);
      expect(body.sessionId).toBe(context.sessionId);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages.every((message: object) => Object.keys(message).sort().join(',') === 'content,role')).toBe(true);
      expect(String(init.body)).not.toContain('synthetic-');
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
    }
    for (const [, promptContext] of vi.mocked(buildSystemPrompt).mock.calls) {
      expect(promptContext).not.toHaveProperty('chatGptAccountId');
      expect(promptContext).not.toHaveProperty('sessionId');
    }
  });

  it('requires the account snapshot created by model discovery before any inference', async () => {
    await expect(strategy.chat(messages, config, { ...context, chatGptAccountId: undefined })).rejects.toThrow('load its models');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the operation AbortSignal to status and generation', async () => {
    const controller = new AbortController();
    await strategy.chat(messages, config, context, null, controller.signal);
    expect(fetchMock.mock.calls.every(([, init]) => init.signal === controller.signal)).toBe(true);
  });
});
