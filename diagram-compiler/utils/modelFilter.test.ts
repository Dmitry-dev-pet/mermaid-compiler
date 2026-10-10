import { describe, it, expect } from 'vitest';
import { filterModels } from './modelFilter';
import { AIConfig, Model } from '../types';

describe('modelFilter', () => {
  const mockModels: Model[] = [
    { id: 'openai/gpt-4o', name: 'GPT-4o', contextLength: 128000, isFree: false, vendor: 'openai' },
    { id: 'google/gemini-pro', name: 'Gemini Pro', contextLength: 32000, isFree: true, vendor: 'google' },
    { id: 'meta-llama/llama-3-8b', name: 'Llama 3 8B', contextLength: 8192, isFree: true, vendor: 'meta' },
    { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', contextLength: 200000, isFree: false, vendor: 'anthropic' },
  ];

  const baseConfig: AIConfig = {
    provider: 'openrouter',
    openRouterKey: 'key',
    openRouterEndpoint: 'url',
    agentToken: '',
    agentEndpoint: '',
    proxyKey: '',
    proxyManagementKey: '',
    proxyEndpoint: '',
    selectedModelId: '',
    selectedModelIdByProvider: {
      openrouter: '',
      agent: '',
      cliproxy: '',
      'opencode-go': '',
    },
    filtersByProvider: {
      openrouter: {
        vendor: '',
        freeOnly: false,
        testedOnly: false,
        experimental: false,
        minContextWindow: 0,
      },
      agent: {
        family: '',
      },
      cliproxy: {
        family: '',
      },
      'opencode-go': {
        vendor: '',
      },
    },
  };

  it('should return all models when no filters are active', () => {
    const result = filterModels(mockModels, baseConfig);
    expect(result).toHaveLength(4);
  });

  it('should filter by minContextWindow', () => {
    const config = {
      ...baseConfig,
      filtersByProvider: {
        ...baseConfig.filtersByProvider,
        openrouter: {
          ...baseConfig.filtersByProvider.openrouter,
          minContextWindow: 64000,
        },
      },
    };
    const result = filterModels(mockModels, config);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.id)).toEqual(['openai/gpt-4o', 'anthropic/claude-3-opus']);
  });

  it('should filter by freeOnly', () => {
    const config = {
      ...baseConfig,
      filtersByProvider: {
        ...baseConfig.filtersByProvider,
        openrouter: {
          ...baseConfig.filtersByProvider.openrouter,
          freeOnly: true,
        },
      },
    };
    const result = filterModels(mockModels, config);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.id)).toEqual(['google/gemini-pro', 'meta-llama/llama-3-8b']);
  });

  it('should combine filters (freeOnly + minContextWindow)', () => {
    const config = {
      ...baseConfig,
      filtersByProvider: {
        ...baseConfig.filtersByProvider,
        openrouter: {
          ...baseConfig.filtersByProvider.openrouter,
          freeOnly: true,
          minContextWindow: 10000,
        },
      },
    };
    const result = filterModels(mockModels, config);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('google/gemini-pro');
  });
  
  it('should filter for cliproxy provider', () => {
     const config: AIConfig = {
      ...baseConfig,
      provider: 'cliproxy',
      filtersByProvider: {
        ...baseConfig.filtersByProvider,
        cliproxy: {
          family: '',
        },
      },
    };
    const result = filterModels(mockModels, config);
    expect(result).toHaveLength(4);
  });

  it('does not apply OpenRouter or proxy filters to Go models', () => {
    const models: Model[] = [
      { id: 'kimi-k2.5', name: 'Kimi K2.5', vendor: 'moonshotai' },
      { id: 'glm-5', name: 'GLM-5', vendor: 'zai' },
    ];
    const config: AIConfig = {
      ...baseConfig,
      provider: 'opencode-go',
      filtersByProvider: {
        ...baseConfig.filtersByProvider,
        openrouter: { ...baseConfig.filtersByProvider.openrouter, freeOnly: true, testedOnly: true, vendor: 'openai', minContextWindow: 200000 },
        agent: { family: 'gemini' },
        cliproxy: { family: 'gpt' },
      },
    };
    expect(filterModels(models, config)).toEqual(models);
  });

  it('keeps the Go vendor filter separate when switching providers', () => {
    const config: AIConfig = {
      ...baseConfig,
      provider: 'opencode-go',
      filtersByProvider: {
        ...baseConfig.filtersByProvider,
        openrouter: { ...baseConfig.filtersByProvider.openrouter, vendor: 'openai' },
        'opencode-go': { vendor: 'google' },
      },
    };
    expect(filterModels(mockModels, config).map((model) => model.id)).toEqual(['google/gemini-pro']);
    expect(filterModels(mockModels, { ...config, provider: 'openrouter' }).map((model) => model.id)).toEqual(['openai/gpt-4o']);
  });
});
