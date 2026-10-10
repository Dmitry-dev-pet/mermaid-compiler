import { describe, expect, it } from 'vitest';
import type { CliproxyAuthFile } from '../services/cliproxy/types';
import type { CliproxyQuotasState } from '../services/cliproxy/quotas/types';
import type { AgentCodexQuotaState } from '../hooks/core/useAgentCodexQuota';
import type { AgentGeminiQuotaState } from '../hooks/core/useAgentGeminiQuota';
import { buildQuotaBadges } from './aiQuotaBadges';

describe('buildQuotaBadges', () => {
  it.each(['opencode-go', 'chatgpt'] as const)('never shows unrelated CLI quotas for %s', (provider) => {
    expect(buildQuotaBadges({
      provider,
      selectedModelId: 'go-model',
      modelName: 'Go model',
      family: 'gpt',
      viaProviders: 'codex+antigravity',
      cliproxyAuthFiles: [{ id: 'c1', provider: 'codex' }],
      cliproxyQuotas: {
        status: 'success',
        codex: { c1: { windows: [{ id: 'primary', label: '5-hour limit', usedPercent: 10, resetLabel: '-' }] } },
      },
      agentCodexQuota: {
        status: 'success',
        windows: [{ id: 'primary', label: '5-hour limit', usedPercent: 10, remainingPercent: 90, resetLabel: '-' }],
      },
      agentGeminiQuota: { status: 'idle', items: [] },
    })).toEqual([]);
  });

  it('builds cliproxy gemini + antigravity badges', () => {
    const authFiles: CliproxyAuthFile[] = [
      { id: 'g1', provider: 'gemini-cli' },
      { id: 'a1', provider: 'antigravity' },
    ];
    const quotas: CliproxyQuotasState = {
      status: 'success',
      geminiCli: {
        g1: {
          items: [
            { id: 'pro', label: 'Gemini Pro Series (REQUESTS)', remainingPercent: 80, resetLabel: '-' },
          ],
        },
      },
      antigravity: {
        a1: {
          items: [
            { id: 'ag1', label: 'Gemini 3 Pro', remainingPercent: 70, resetLabel: '-' },
          ],
        },
      },
    };

    const badges = buildQuotaBadges({
      provider: 'cliproxy',
      selectedModelId: 'gemini-3-pro-preview',
      modelName: 'Gemini 3 Pro',
      family: 'gemini',
      viaProviders: 'gemini-cli+antigravity',
      cliproxyAuthFiles: authFiles,
      cliproxyQuotas: quotas,
      agentCodexQuota: { status: 'idle', windows: [] },
      agentGeminiQuota: { status: 'idle', items: [] },
    });

    const labels = badges.map((b) => b.label);
    expect(labels).toContain('Gemini Pro Series');
    expect(labels).toContain('Gemini 3 Pro');
    const proBadge = badges.find((b) => b.label === 'Gemini Pro Series');
    const agBadge = badges.find((b) => b.label === 'Gemini 3 Pro');
    expect(proBadge?.percent).toBe(80);
    expect(agBadge?.percent).toBe(70);
  });

  it('builds agent codex badges', () => {
    const agentCodexQuota: AgentCodexQuotaState = {
      status: 'success',
      windows: [
        { id: 'primary', label: '5-hour limit', usedPercent: 40, remainingPercent: null, resetLabel: 'x' },
        { id: 'secondary', label: 'Weekly limit', usedPercent: 10, remainingPercent: null, resetLabel: 'y' },
      ],
    };
    const agentGeminiQuota: AgentGeminiQuotaState = {
      status: 'idle',
      items: [],
    };
    const badges = buildQuotaBadges({
      provider: 'agent',
      selectedModelId: 'gpt-5.2',
      modelName: 'GPT-5.2',
      family: 'gpt',
      viaProviders: '',
      cliproxyAuthFiles: [],
      cliproxyQuotas: { status: 'idle' },
      agentCodexQuota,
      agentGeminiQuota,
    });
    expect(badges.length).toBe(2);
    const primary = badges.find((b) => b.label.includes('5-hour'));
    const weekly = badges.find((b) => b.label.includes('Weekly'));
    expect(primary?.percent).toBe(60);
    expect(weekly?.percent).toBe(90);
  });
});
