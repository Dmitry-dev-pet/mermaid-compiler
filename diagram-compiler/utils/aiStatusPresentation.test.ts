import { describe, expect, it } from 'vitest';
import { getChatGptStatusLabel, getCliproxyViaProviders, getConnectionStatusLabel, getProviderBadges } from './aiStatusPresentation';
import type { ChatGptStatus } from '../services/chatGptClient';
import type { CliproxyAuthFile } from './cliproxyAuthFileStatus';
import type { Model } from '../types';

const readyFile = (provider: string): CliproxyAuthFile => ({
  id: provider,
  provider,
  status: 'ready',
});

describe('aiStatusPresentation', () => {
  const chatGptStatus: ChatGptStatus = {
    agent: 'mermaid-chatgpt',
    protocolVersion: 1,
    connected: true,
    activeAccountId: 'account-a',
    accounts: [{ id: 'account-a', email: 'test@example.com', connected: true }],
    login: null,
    usage: { state: 'unverified' },
  };

  it('separates ChatGPT sign-in, discovery, successful generation and subscription limits', () => {
    expect(getConnectionStatusLabel('chatgpt', 'connected')).toBe('Models loaded; generation not verified');
    expect(getChatGptStatusLabel(chatGptStatus)).toBe('Signed in; generation not verified');
    expect(getChatGptStatusLabel({ ...chatGptStatus, usage: { state: 'available', model: 'model-a' } }, true, 'model-a')).toBe('Generation verified');
    expect(getChatGptStatusLabel({ ...chatGptStatus, usage: { state: 'available', model: 'model-a' } }, true, 'model-b')).toBe('Selected model not verified');
    expect(getChatGptStatusLabel({ ...chatGptStatus, usage: { state: 'limit_reached' } })).toBe('Subscription limit reached');
    expect(getChatGptStatusLabel({ ...chatGptStatus, usage: { state: 'unavailable' } })).toBe('Subscription usage unavailable');
    expect(getChatGptStatusLabel({ ...chatGptStatus, connected: false })).toBe('Sign in with ChatGPT');
    expect(getChatGptStatusLabel({ ...chatGptStatus, login: { id: 'login-a', state: 'pending' } })).toBe('Waiting for browser sign-in');
    expect(getChatGptStatusLabel(null, false)).toBe('Open the local workspace');
  });

  it('identifies direct ChatGPT separately from Codex and proxy subscriptions', () => {
    expect(getProviderBadges({
      aiProvider: 'chatgpt',
      family: 'gpt',
      model: { id: 'model-from-chatgpt', name: 'Account model', vendor: 'openai' },
      cliproxyAuthFiles: [readyFile('codex'), readyFile('antigravity')],
    })).toEqual(['chatgpt']);
  });

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
