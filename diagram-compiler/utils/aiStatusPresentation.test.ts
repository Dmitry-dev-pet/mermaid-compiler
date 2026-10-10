import { describe, expect, it } from 'vitest';
import { getCliproxyViaProviders, getConnectionStatusLabel, getProviderBadges } from './aiStatusPresentation';
import type { CliproxyAuthFile } from './cliproxyAuthFileStatus';
import type { Model } from '../types';

const readyFile = (provider: string): CliproxyAuthFile => ({
  id: provider,
  provider,
  status: 'ready',
});

describe('aiStatusPresentation', () => {
  it('labels catalogue discovery without claiming Go authentication or generation succeeded', () => {
    expect(getConnectionStatusLabel('opencode-go', 'connected')).toBe('Models loaded; generation not verified');
    expect(getConnectionStatusLabel('opencode-go', 'connecting')).toBe('Loading models…');
    expect(getConnectionStatusLabel('opencode-go', 'failed')).toBe('Model discovery failed');
    expect(getConnectionStatusLabel('openrouter', 'connected')).toBe('connected');
  });

  it('uses the Go provider badge even when unrelated proxy subscriptions are present', () => {
    expect(getProviderBadges({
      aiProvider: 'opencode-go',
      family: 'gpt',
      model: { id: 'model-from-go', name: 'Go model', vendor: 'openai' },
      cliproxyAuthFiles: [readyFile('codex'), readyFile('antigravity')],
    })).toEqual(['opencode-go']);
  });

  it('returns openrouter provider badge', () => {
    expect(getProviderBadges({
      aiProvider: 'openrouter',
      family: 'gpt',
      model: null,
      cliproxyAuthFiles: [],
    })).toEqual(['openrouter']);
  });

  it('returns agent badge by family', () => {
    expect(getProviderBadges({
      aiProvider: 'agent',
      family: 'gemini',
      model: null,
      cliproxyAuthFiles: [],
    })).toEqual(['gemini-cli']);
    expect(getProviderBadges({
      aiProvider: 'agent',
      family: 'gpt',
      model: null,
      cliproxyAuthFiles: [],
    })).toEqual(['codex']);
  });

  it('derives cliproxy via providers', () => {
    const model: Model = {
      id: 'gemini-3-pro-preview',
      name: 'Gemini 3 Pro',
      vendor: 'google',
      ownedBy: 'antigravity',
    };
    const via = getCliproxyViaProviders({
      selectedModelId: model.id,
      modelVendor: model.vendor,
      modelName: model.name,
      modelOwnedBy: model.ownedBy,
      cliproxyAuthFiles: [readyFile('gemini-cli'), readyFile('antigravity')],
    });
    expect(via).toContain('gemini-cli');
    expect(via).toContain('antigravity');
  });
});
