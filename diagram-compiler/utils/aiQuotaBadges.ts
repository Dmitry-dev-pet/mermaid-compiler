import type { CliproxyAuthFile } from '../services/cliproxy/types';
import type { CliproxyQuotasState } from '../services/cliproxy/quotas/types';
import type { AgentCodexQuotaState } from '../hooks/core/useAgentCodexQuota';
import type { AgentGeminiQuotaState } from '../hooks/core/useAgentGeminiQuota';
import type { Provider } from '../types';
import { remainingPercentFromUsedPercent } from './percent';
import { getAntigravityBucketLabel } from '../services/cliproxy/quotas/parsers';
import { averagePercent, getGeminiGroupLabelForModel, type ModelFamilyKey } from './aiModelUtils';

export type QuotaBadge = {
  id: string;
  label: string;
  percent: number | null;
  tooltip: string;
};

export const buildQuotaBadges = (args: {
  provider: Provider;
  selectedModelId: string;
  modelName?: string | null;
  family: ModelFamilyKey;
  viaProviders: string;
  cliproxyAuthFiles: CliproxyAuthFile[];
  cliproxyQuotas: CliproxyQuotasState;
  agentCodexQuota: AgentCodexQuotaState;
  agentGeminiQuota: AgentGeminiQuotaState;
}): QuotaBadge[] => {
  const {
    provider,
    selectedModelId,
    modelName,
    family,
    viaProviders,
    cliproxyAuthFiles,
    cliproxyQuotas,
    agentCodexQuota,
    agentGeminiQuota,
  } = args;

  if (!selectedModelId) return [];
  if (provider === 'openrouter' || provider === 'opencode-go') return [];
  if (family === 'other') return [];

  const selectedId = selectedModelId.trim().toLowerCase();
  const badges: QuotaBadge[] = [];
  const providerTokens = new Set(viaProviders.split('+').map((t) => t.trim().toLowerCase()).filter(Boolean));

  if (provider === 'agent') {
    if (family === 'gpt') {
      const windows = agentCodexQuota.windows ?? [];
      windows
        .filter((w) => w.id === 'primary' || w.id === 'secondary')
        .forEach((w) => {
          const percent = typeof w.remainingPercent === 'number' ? w.remainingPercent : remainingPercentFromUsedPercent(w.usedPercent);
          badges.push({
            id: `agent-codex-${w.id}`,
            label: `Codex ${w.label}`,
            percent,
            tooltip: `${w.label}: ${percent === null ? '-' : `${Math.round(percent)}%`} avg`,
          });
        });
    }
    if (family === 'gemini') {
      const groupLabel = getGeminiGroupLabelForModel(selectedId, modelName);
      if (groupLabel) {
        const items = agentGeminiQuota.items ?? [];
        const matches = items.filter((it) => it.label.toLowerCase().includes(groupLabel.toLowerCase()));
        const percent = averagePercent(matches.map((it) => it.remainingPercent));
        if (matches.length) {
          badges.push({
            id: `agent-gemini-${groupLabel}`,
            label: groupLabel,
            percent,
            tooltip: `${groupLabel}: ${percent === null ? '-' : `${Math.round(percent)}%`} avg`,
          });
        }
      }
    }
    return badges;
  }

  if (provider === 'cliproxy' && cliproxyQuotas.status === 'success') {
    if (family === 'gpt' && providerTokens.has('codex')) {
      const codexFiles = cliproxyAuthFiles.filter((f) => f.provider === 'codex' && !f.runtimeOnly);
      const windowsById = new Map<string, { label: string; values: Array<number | null> }>();
      codexFiles.forEach((file) => {
        const quota = cliproxyQuotas.codex?.[file.id];
        const windows = quota?.windows ?? [];
        const weeklyWindow = windows.find((w) => w?.id === 'secondary') ?? null;
        const weeklyRemaining = remainingPercentFromUsedPercent(weeklyWindow?.usedPercent);
        const weeklyExhausted = weeklyRemaining === 0;
        windows.forEach((w) => {
          if (!w?.id) return;
          if (w.id === 'primary' && weeklyExhausted) return;
          const remaining = remainingPercentFromUsedPercent(w.usedPercent);
          const entry = windowsById.get(w.id) ?? { label: w.label, values: [] as Array<number | null> };
          entry.values.push(remaining);
          windowsById.set(w.id, entry);
        });
      });
      ['primary', 'secondary'].forEach((id) => {
        const entry = windowsById.get(id);
        if (!entry) return;
        const percent = averagePercent(entry.values);
        badges.push({
          id: `codex-${id}`,
          label: entry.label,
          percent,
          tooltip: `${entry.label}: ${percent === null ? '-' : `${Math.round(percent)}%`} avg`,
        });
      });
    }

    if (family === 'gemini' && providerTokens.has('gemini-cli')) {
      const groupLabel = getGeminiGroupLabelForModel(selectedId, modelName);
      const geminiFiles = cliproxyAuthFiles.filter((f) => f.provider === 'gemini-cli' && !f.runtimeOnly);
      if (groupLabel) {
        const values: Array<number | null> = [];
        geminiFiles.forEach((file) => {
          const quota = cliproxyQuotas.geminiCli?.[file.id];
          const items = quota?.items ?? [];
          const match = items.find((it) => it.label.toLowerCase().includes(groupLabel.toLowerCase()));
          if (match) values.push(match.remainingPercent);
        });
        const percent = averagePercent(values);
        badges.push({
          id: `gemini-cli-${groupLabel}`,
          label: groupLabel,
          percent,
          tooltip: `${groupLabel}: ${percent === null ? '-' : `${Math.round(percent)}%`} avg`,
        });
      }
    }

    if (providerTokens.has('antigravity')) {
      const bucketLabel = getAntigravityBucketLabel({ modelId: selectedId, modelName });
      const antigravityFiles = cliproxyAuthFiles.filter((f) => f.provider === 'antigravity' && !f.runtimeOnly);
      if (bucketLabel) {
        const values: Array<number | null> = [];
        antigravityFiles.forEach((file) => {
          const quota = cliproxyQuotas.antigravity?.[file.id];
          const items = quota?.items ?? [];
          const match = items.find((it) => it.label.toLowerCase() === bucketLabel.toLowerCase());
          if (match) values.push(match.remainingPercent);
        });
        const percent = averagePercent(values);
        badges.push({
          id: `antigravity-${bucketLabel}`,
          label: bucketLabel,
          percent,
          tooltip: `${bucketLabel}: ${percent === null ? '-' : `${Math.round(percent)}%`} avg`,
        });
      }
    }
  }

  return badges;
};
