import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatGptAccountControls } from '../../hooks/core/useChatGptAccount';
import type { ChatGptStatus } from '../../services/chatGptClient';
import { ChatGptAccountPanel } from './ChatGptAccountPanel';

const connectedStatus: ChatGptStatus = {
  agent: 'mermaid-chatgpt',
  protocolVersion: 1,
  connected: true,
  activeAccountId: 'account-a',
  accounts: [{ id: 'account-a', email: 'test@example.com', connected: true }],
  login: null,
  usage: { state: 'unverified' },
};

const makeAccount = (overrides: Partial<ChatGptAccountControls> = {}): ChatGptAccountControls => ({
  isLocal: true,
  status: connectedStatus,
  loading: false,
  action: null,
  error: null,
  notice: null,
  authUrl: null,
  refresh: vi.fn().mockResolvedValue(undefined),
  login: vi.fn().mockResolvedValue(undefined),
  cancelLogin: vi.fn().mockResolvedValue(undefined),
  selectAccount: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const render = (account: ChatGptAccountControls, isProcessing = false) => renderToStaticMarkup(
  <ChatGptAccountPanel
    account={account}
    connectionState={{ status: 'connected', availableModels: [{ id: 'model-a', name: 'Model A' }] }}
    selectedModelId="model-a"
    isProcessing={isProcessing}
  />,
);

describe('ChatGptAccountPanel', () => {
  it('offers only local workspace instructions on the hosted site', () => {
    const html = render(makeAccount({ isLocal: false, status: null }));
    expect(html).toContain('href="http://127.0.0.1:8788/?ai=chatgpt"');
    expect(html).toContain('Start the ChatGPT Agent on this device');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('auth.openai.com');
  });

  it('shows discovery as unverified and exposes no credential fields', () => {
    const html = render(makeAccount());
    expect(html).toContain('Models loaded; generation not verified');
    expect(html).toContain('Saved ChatGPT account');
    expect(html).toContain('Sign out locally');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Codex');
    expect(html).not.toContain('API key');
  });

  it('does not imply the selected model was verified by a different model’s response', () => {
    const html = render(makeAccount({
      status: { ...connectedStatus, usage: { state: 'available', model: 'another-model' } },
    }));
    expect(html).toContain('Selected model not verified');
    expect(html).toContain('Last verified model: another-model');
  });

  it('shows the pending login fallback and cancel action without exposing credentials', () => {
    const html = render(makeAccount({
      status: { ...connectedStatus, login: { id: 'login-a', state: 'pending', message: 'Complete browser sign-in.' } },
      authUrl: 'https://auth.openai.com/authorize?state=synthetic',
    }));
    expect(html).toContain('Waiting for browser sign-in');
    expect(html).toContain('href="https://auth.openai.com/authorize?state=synthetic"');
    expect(html).toContain('Cancel sign-in');
    expect(html).toContain('Complete browser sign-in.');
    expect(html).not.toContain('<input');
  });

  it('displays local sign-out feedback and blocks account actions during generation', () => {
    const html = render(makeAccount({ notice: 'Local session removed; app access remains in ChatGPT settings.' }), true);
    expect(html).toContain('Local session removed');
    expect(html).toContain('Finish or stop the current generation');
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true);
  });

  it('offers saved-session model recovery before fresh sign-in and shows the failed reload error', () => {
    const account = makeAccount({
      status: {
        ...connectedStatus,
        connected: false,
        accounts: [{ id: 'account-a', email: 'test@example.com', connected: false }],
      },
    });
    const html = renderToStaticMarkup(
      <ChatGptAccountPanel
        account={account}
        connectionState={{ status: 'failed', availableModels: [], error: 'Session verification is still unavailable.' }}
        selectedModelId="model-a"
      />,
    );
    expect(html).toContain('Reload status and models');
    expect(html).toContain('check the saved session before signing in again');
    expect(html).toContain('Session verification is still unavailable.');
    expect(html).toContain('Continue with ChatGPT');
    expect(html).not.toContain('Generation verified');
  });
});
