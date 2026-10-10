import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_CONFIG, DEFAULT_APP_STATE } from '../constants';
import type { AIConfig, ModelParams } from '../types';
import { applySessionSettings, buildSessionSettings } from './sessionSettings';

describe('sessionSettings', () => {
  it('excludes unexpected credential fields from saved settings and exports', () => {
    const importedConfig = { ...DEFAULT_AI_CONFIG, opencodeGoApiKey: 'must-not-export' } as AIConfig;
    const settings = buildSessionSettings(DEFAULT_APP_STATE, importedConfig);
    expect(JSON.stringify(settings)).not.toContain('must-not-export');
    expect(settings.aiConfig).not.toHaveProperty('opencodeGoApiKey');
  });
  it('does not export or restore imported ChatGPT credentials or active-account metadata', () => {
    const marker = 'synthetic-oauth-not-for-projects';
    const importedConfig = {
      ...DEFAULT_AI_CONFIG,
      provider: 'chatgpt',
      accessToken: marker,
      refreshToken: marker,
      idToken: marker,
      chatGptAccountId: marker,
      chatGptSession: { token: marker },
    } as AIConfig;
    const settings = buildSessionSettings(DEFAULT_APP_STATE, importedConfig);
    expect(settings.aiConfig.provider).toBe('chatgpt');
    expect(JSON.stringify(settings)).not.toContain(marker);
    let restored = DEFAULT_AI_CONFIG;
    applySessionSettings(
      { appState: DEFAULT_APP_STATE, aiConfig: importedConfig },
      () => {},
      (next) => { restored = typeof next === 'function' ? next(restored) : next; },
    );
    expect(restored.provider).toBe('chatgpt');
    expect(JSON.stringify(restored)).not.toContain(marker);
  });
  it('buildSessionSettings includes modelParams when provided', () => {
    const modelParams: ModelParams = { temperature: 0.3, top_p: 0.9 };
    const settings = buildSessionSettings(DEFAULT_APP_STATE, DEFAULT_AI_CONFIG, modelParams);
    expect(settings.modelParams).toEqual(modelParams);
  });

  it('applySessionSettings sets modelParams when present', () => {
    const modelParams: ModelParams = { temperature: 0.5 };
    let appliedModelParams: ModelParams | null = null;
    let appliedAppState = DEFAULT_APP_STATE;
    let appliedAiConfig = DEFAULT_AI_CONFIG;

    applySessionSettings(
      { appState: DEFAULT_APP_STATE, aiConfig: DEFAULT_AI_CONFIG, modelParams },
      (value) => { appliedAppState = value; },
      (value) => { appliedAiConfig = typeof value === 'function' ? value(appliedAiConfig) : value; },
      (value) => { appliedModelParams = value; }
    );

    expect(appliedAppState).toEqual(DEFAULT_APP_STATE);
    expect(appliedAiConfig).toEqual(DEFAULT_AI_CONFIG);
    expect(appliedModelParams).toEqual(modelParams);
  });

  it('applySessionSettings clears modelParams when missing', () => {
    let appliedModelParams: ModelParams | null = { temperature: 0.8 };

    applySessionSettings(
      { appState: DEFAULT_APP_STATE, aiConfig: DEFAULT_AI_CONFIG },
      () => {},
      () => {},
      (value) => { appliedModelParams = value; }
    );

    expect(appliedModelParams).toBeNull();
  });

  it('applySessionSettings normalizes legacy aiConfig', () => {
    let appliedAiConfig = DEFAULT_AI_CONFIG;

    const legacyAiConfig = {
      provider: 'cliproxy',
      openRouterKey: '',
      openRouterEndpoint: '',
      proxyKey: 'test',
      proxyEndpoint: 'http://localhost:8317',
      selectedModelId: 'openai/gpt-4o',
      selectedModelIdByProvider: { openrouter: '', cliproxy: 'openai/gpt-4o' },
      filtersByProvider: {
        openrouter: {
          vendor: '',
          freeOnly: true,
          testedOnly: true,
          experimental: false,
          minContextWindow: 0,
        },
        cliproxy: { family: '' },
      },
	    } as unknown as AIConfig;

    applySessionSettings(
      { appState: DEFAULT_APP_STATE, aiConfig: legacyAiConfig },
      () => {},
      (value) => { appliedAiConfig = typeof value === 'function' ? value(appliedAiConfig) : value; },
    );

    expect(appliedAiConfig.selectedModelIdByProvider.agent).toBe('');
    expect(appliedAiConfig.filtersByProvider.agent).toEqual({ family: '' });
    expect(typeof appliedAiConfig.agentEndpoint).toBe('string');
    expect(typeof appliedAiConfig.agentToken).toBe('string');
  });
});
