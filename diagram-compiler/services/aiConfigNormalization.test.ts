import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_CONFIG } from '../constants';
import { normalizeAiConfig, type LegacyAIConfig } from './aiConfigNormalization';

describe('normalizeAiConfig', () => {
  it('adds independent Go state to older saved configurations', () => {
    const normalized = normalizeAiConfig({
      provider: 'cliproxy',
      selectedModelId: 'proxy-model',
      selectedModelIdByProvider: { openrouter: 'openrouter-model', cliproxy: 'proxy-model' },
      filtersByProvider: { cliproxy: { family: 'gpt' } },
      filters: { freeOnly: false, testedOnly: false },
    });
    expect(normalized.selectedModelId).toBe('proxy-model');
    expect(normalized.selectedModelIdByProvider).toEqual({
      openrouter: 'openrouter-model', agent: '', cliproxy: 'proxy-model', 'opencode-go': '', chatgpt: '',
    });
    expect(normalized.filtersByProvider['opencode-go']).toEqual({ vendor: '' });
    expect(normalized.filtersByProvider.chatgpt).toEqual({ vendor: '' });
    expect(normalized.filtersByProvider.cliproxy).toEqual({ family: 'gpt' });
    expect(normalized.filtersByProvider.openrouter.freeOnly).toBe(false);
  });

  it('preserves independent Go and existing-provider preferences', () => {
    const config = normalizeAiConfig({
      ...DEFAULT_AI_CONFIG,
      provider: 'opencode-go',
      selectedModelId: 'go-model',
      selectedModelIdByProvider: {
        openrouter: 'openrouter-model', agent: 'agent-model', cliproxy: 'proxy-model', 'opencode-go': 'go-model', chatgpt: 'chatgpt-model',
      },
      filtersByProvider: {
        ...DEFAULT_AI_CONFIG.filtersByProvider,
        openrouter: { ...DEFAULT_AI_CONFIG.filtersByProvider.openrouter, vendor: 'openai' },
        cliproxy: { family: 'claude' },
        'opencode-go': { vendor: 'moonshotai' },
        chatgpt: { vendor: 'openai' },
      },
    });
    expect(normalizeAiConfig(JSON.parse(JSON.stringify(config)) as LegacyAIConfig)).toEqual(config);
    expect(config.filtersByProvider['opencode-go']).toEqual({ vendor: 'moonshotai' });
    expect(config.filtersByProvider.openrouter.vendor).toBe('openai');
    expect(config.filtersByProvider.cliproxy.family).toBe('claude');
    expect(config.selectedModelIdByProvider.agent).toBe('agent-model');
    expect(config.selectedModelIdByProvider.chatgpt).toBe('chatgpt-model');
    expect(config.filtersByProvider.chatgpt).toEqual({ vendor: 'openai' });
  });

  it('persists ChatGPT model preferences without OAuth or account data', () => {
    const marker = 'synthetic-oauth-never-persist';
    const config = normalizeAiConfig(JSON.parse(JSON.stringify({
      ...DEFAULT_AI_CONFIG,
      provider: 'chatgpt',
      selectedModelId: 'subscription-model',
      chatGptAccountId: marker,
      accessToken: marker,
      refreshToken: marker,
      idToken: marker,
      chatgpt: { accounts: [{ id: marker }], clientSecret: marker },
      filtersByProvider: {
        ...DEFAULT_AI_CONFIG.filtersByProvider,
        chatgpt: { vendor: 'openai', accessToken: marker },
      },
      selectedModelIdByProvider: { ...DEFAULT_AI_CONFIG.selectedModelIdByProvider, chatgpt: 'subscription-model', token: marker },
    })));
    expect(config.provider).toBe('chatgpt');
    expect(config.selectedModelIdByProvider.chatgpt).toBe('subscription-model');
    expect(config.filtersByProvider.chatgpt).toEqual({ vendor: 'openai' });
    expect(JSON.stringify(config)).not.toContain(marker);
    expect(Object.keys(config).sort()).toEqual(Object.keys(DEFAULT_AI_CONFIG).sort());
  });

  it('drops unrecognized credential fields instead of copying them into persisted config', () => {
    // Deliberately fabricated marker; no real account credential is used.
    const marker = 'synthetic-go-credential-for-test';
    const raw = JSON.parse(JSON.stringify({
      ...DEFAULT_AI_CONFIG,
      provider: 'opencode-go',
      goApiKey: marker,
      openCodeGoApiKey: marker,
      selectedModelIdByProvider: { ...DEFAULT_AI_CONFIG.selectedModelIdByProvider, apiKey: marker },
      filtersByProvider: {
        ...DEFAULT_AI_CONFIG.filtersByProvider,
        openrouter: { ...DEFAULT_AI_CONFIG.filtersByProvider.openrouter, goApiKey: marker },
        'opencode-go': { vendor: 'zai', apiKey: marker },
      },
    })) as LegacyAIConfig;
    const normalized = normalizeAiConfig(raw);
    expect(JSON.stringify(normalized)).not.toContain(marker);
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(DEFAULT_AI_CONFIG).sort());
    expect(normalized.filtersByProvider['opencode-go']).toEqual({ vendor: 'zai' });
  });

  it('keeps existing credentials and endpoints while normalizing older filter aliases', () => {
    const config = normalizeAiConfig({
      openRouterKey: 'synthetic-openrouter',
      openRouterEndpoint: 'https://example.test/openrouter',
      agentToken: 'synthetic-agent',
      agentEndpoint: 'http://localhost:8787',
      proxyKey: 'synthetic-proxy',
      proxyManagementKey: 'synthetic-management',
      proxyEndpoint: 'http://localhost:8317',
      filtersByProvider: JSON.parse('{"agent":{"provider":"google"},"cliproxy":{"ownedBy":"anthropic"}}'),
    });
    expect(config.openRouterKey).toBe('synthetic-openrouter');
    expect(config.openRouterEndpoint).toBe('https://example.test/openrouter');
    expect(config.agentToken).toBe('synthetic-agent');
    expect(config.agentEndpoint).toBe('http://localhost:8787');
    expect(config.proxyKey).toBe('synthetic-proxy');
    expect(config.proxyManagementKey).toBe('synthetic-management');
    expect(config.proxyEndpoint).toBe('http://localhost:8317');
    expect(config.filtersByProvider.agent).toEqual({ family: 'gemini' });
    expect(config.filtersByProvider.cliproxy).toEqual({ family: 'claude' });
  });
});
