import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeGoStrategy } from './OpenCodeGoStrategy';
import { DEFAULT_AI_CONFIG } from '../../constants';
import type { AIConfig, Message } from '../../types';
import type { LLMRequestContext } from './types';

vi.mock('./prompts', () => ({ buildSystemPrompt: (mode: string) => `Mermaid ${mode} instructions` }));

describe('OpenCode Go strategy', () => {
  const strategy = new OpenCodeGoStrategy();
  const fetchMock = vi.fn();
  const config: AIConfig = { ...DEFAULT_AI_CONFIG, provider: 'opencode-go', selectedModelId: 'glm-5.3' };
  const context: LLMRequestContext = { sessionId: 'mermaid:project-123:main', docsContext: 'docs', language: 'en' };
  const messages: Message[] = [{ id: 'user-1', role: 'user', timestamp: 1, content: 'Draw A to B' }];

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => 'private-go-test-key' });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only lists models returned by the server catalogue', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 'glm-5.3', name: 'GLM 5.3' }, { id: 'kimi-k3' }] }));
    const models = await strategy.fetchModels();
    expect(models.map((model) => model.id)).toEqual(['glm-5.3', 'kimi-k3']);
    expect(models.every((model) => model.ownedBy === 'opencode-go')).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ operation: 'models' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses one stable conversation for every studio operation and never changes the selected model', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ choices: [{ message: { content: 'flowchart TD\nA-->B' } }] })));
    await strategy.chat(messages, config, context);
    await strategy.generateDiagram(messages, config, context, { stream: true, temperature: 0.3 });
    await strategy.fixDiagram('bad code', 'syntax error', config, context);
    await strategy.analyzeDiagram('flowchart TD\nA-->B', config, context);
    await strategy.chatDiagram(messages, config, context);
    await strategy.chatNotebook(messages, config, context);
    await strategy.planNotebook(messages, config, context);
    await strategy.summarizeBuild(messages, config, context);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      const body = JSON.parse(String(init.body));
      expect(url).toBe('/api/opencode-go');
      expect(new Headers(init.headers).get('x-opencode-session')).toBe(context.sessionId);
      expect(body.operation).toBe('chat');
      expect(body.request.model).toBe('glm-5.3');
      expect(body.request.stream).toBe(false);
      expect(body.request.messages[0].role).toBe('system');
      expect(String(init.body)).not.toContain('private-go-test-key');
    }
  });

  it('does not make inference requests without a project conversation', async () => {
    await expect(strategy.chat(messages, config, { ...context, sessionId: undefined })).rejects.toThrow('Open a project');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing response text and does not silently switch providers', async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: '' } }] }));
    await expect(strategy.chat(messages, config, context)).rejects.toThrow('returned no text');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
