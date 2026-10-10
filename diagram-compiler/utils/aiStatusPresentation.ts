import type { AIConfig, ConnectionState, Model } from '../types';
import type { ChatGptStatus } from '../services/chatGptClient';
import type { CliproxyAuthFile } from '../utils/cliproxyAuthFileStatus';
import { isCliproxyAuthFileReady, normalizeCliproxyProviderKey } from '../utils/cliproxyAuthFileStatus';
import { GEMINI_CLI_SUPPORTED_MODEL_IDS, getModelFamilyKey, type ModelFamilyKey } from './aiModelUtils';

export type ViaProviderToken = 'codex' | 'gemini-cli' | 'antigravity';

type ViaProvidersArgs = {
  selectedModelId: string;
  modelVendor?: string | null;
  modelName?: string | null;
  modelOwnedBy?: string | null;
  cliproxyAuthFiles: CliproxyAuthFile[];
};

export const getCliproxyViaProviders = (args: ViaProvidersArgs): ViaProviderToken[] => {
  const files = args.cliproxyAuthFiles ?? [];
  if (!files.length) return [];
  const providers = new Set(
    files
      .filter((f) => !f.runtimeOnly && isCliproxyAuthFileReady(f))
      .map((f) => normalizeCliproxyProviderKey(f.provider ?? null))
  );
  if (providers.size === 0) return [];

  const family = getModelFamilyKey({
    id: args.selectedModelId,
    vendor: args.modelVendor ?? null,
    name: args.modelName ?? null,
  });
  const selectedModelId = args.selectedModelId.trim().toLowerCase();
  const modelOwnedBy = typeof args.modelOwnedBy === 'string' ? args.modelOwnedBy.trim().toLowerCase() : '';
  const present: ViaProviderToken[] = [];

  const hasGeminiCli = providers.has('gemini-cli');
  const hasCodex = providers.has('codex');
  const hasAntigravity = providers.has('antigravity');

  if (family === 'gemini') {
    if (hasGeminiCli && GEMINI_CLI_SUPPORTED_MODEL_IDS.has(selectedModelId)) {
      present.push('gemini-cli');
    }
    if (hasAntigravity && modelOwnedBy === 'antigravity') {
      present.push('antigravity');
    }
  } else if (family === 'gpt') {
    if (hasAntigravity && modelOwnedBy === 'antigravity') {
      present.push('antigravity');
    } else if (hasCodex && !selectedModelId.startsWith('gpt-oss')) {
      present.push('codex');
    }
  } else if (family === 'claude') {
    if (hasAntigravity) present.push('antigravity');
  }

  if (present.length === 0) {
    Array.from(providers.values()).forEach((provider) => {
      if (provider === 'codex' || provider === 'gemini-cli' || provider === 'antigravity') {
        present.push(provider);
      }
    });
  }
  return present;
};

export type ProviderBadgeKey = ModelFamilyKey | 'openrouter' | 'opencode-go' | 'chatgpt' | ViaProviderToken;

export const getConnectionStatusLabel = (provider: AIConfig['provider'], status: ConnectionState['status']): string => {
  if (provider !== 'opencode-go' && provider !== 'chatgpt') return status;
  if (status === 'connected') return 'Models loaded; generation not verified';
  if (status === 'connecting') return 'Loading models…';
  if (status === 'failed') return 'Model discovery failed';
  if (provider === 'chatgpt') return 'Models not loaded';
  return 'Not connected';
};

export const getChatGptStatusLabel = (status: ChatGptStatus | null, isLocal = true, selectedModelId?: string): string => {
  if (!isLocal) return 'Open the local workspace';
  if (!status) return 'Account status unavailable';
  if (status.login?.state === 'pending') return 'Waiting for browser sign-in';
  if (!status.connected) return 'Sign in with ChatGPT';
  if (status.usage.state === 'limit_reached') return 'Subscription limit reached';
  if (status.usage.state === 'unavailable') return 'Subscription usage unavailable';
  if (status.usage.state === 'available') {
    if (selectedModelId && status.usage.model !== selectedModelId) return 'Selected model not verified';
    return 'Generation verified';
  }
  return 'Signed in; generation not verified';
};

type ProviderBadgeArgs = {
  aiProvider: AIConfig['provider'];
  family: ModelFamilyKey;
  model: Model | null;
  cliproxyAuthFiles: CliproxyAuthFile[];
};

export const getProviderBadges = (args: ProviderBadgeArgs): ProviderBadgeKey[] => {
  if (args.aiProvider === 'openrouter') return ['openrouter'];
  if (args.aiProvider === 'opencode-go') return ['opencode-go'];
  if (args.aiProvider === 'chatgpt') return ['chatgpt'];
  if (args.aiProvider === 'agent') {
    if (args.family === 'gemini') return ['gemini-cli'];
    return ['codex'];
  }
  if (args.aiProvider === 'cliproxy') {
    const via = getCliproxyViaProviders({
      selectedModelId: args.model?.id ?? '',
      modelVendor: args.model?.vendor ?? null,
      modelName: args.model?.name ?? null,
      modelOwnedBy: args.model?.ownedBy ?? null,
      cliproxyAuthFiles: args.cliproxyAuthFiles ?? [],
    });
    if (via.length) return Array.from(new Set(via));
  }
  return [args.family];
};
