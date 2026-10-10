import { DEFAULT_AI_CONFIG } from '../constants';
import type { AIConfig, ProviderFilters } from '../types';

type LegacyFilters = {
  freeOnly?: boolean;
  testedOnly?: boolean;
  experimental?: boolean;
};

export type LegacyAIConfig = Omit<Partial<AIConfig>, 'filtersByProvider' | 'selectedModelIdByProvider'> & {
  filters?: LegacyFilters;
  filtersByProvider?: Partial<ProviderFilters> | null;
  selectedModelIdByProvider?: Partial<Record<AIConfig['provider'], string>> | null;
};

const normalizeProxyFilters = (value: unknown): { family: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { family: '' };
  const obj = value as Record<string, unknown>;
  const family = typeof obj.family === 'string' ? obj.family.trim().toLowerCase() : '';
  const legacyProvider =
    typeof obj.provider === 'string'
      ? obj.provider.trim().toLowerCase()
      : typeof obj.ownedBy === 'string'
        ? obj.ownedBy.trim().toLowerCase()
        : '';

  if (family) return { family };

  // Back-compat: historically "provider" sometimes stored a vendor/backend name.
  // Map only known families; otherwise drop to avoid hiding models with a non-visible filter.
  if (legacyProvider === 'google' || legacyProvider === 'gemini') return { family: 'gemini' };
  if (legacyProvider === 'anthropic' || legacyProvider === 'claude') return { family: 'claude' };
  if (legacyProvider === 'openai' || legacyProvider === 'gpt') return { family: 'gpt' };
  if (legacyProvider === 'other') return { family: 'other' };

  return { family: '' };
};

export const normalizeAiConfig = (config: LegacyAIConfig | null | undefined): AIConfig => {
  const raw = config ?? {};
  const { filters: legacyFilters, filtersByProvider: legacyByProvider, selectedModelIdByProvider: legacyModels } = raw;

  const openRouterDefaults = DEFAULT_AI_CONFIG.filtersByProvider.openrouter;
  const openrouterInput = {
    ...openRouterDefaults,
    ...(legacyByProvider?.openrouter ?? {}),
    ...(legacyFilters ?? {}),
  };
  const openrouterFilters = {
    vendor: typeof openrouterInput.vendor === 'string' ? openrouterInput.vendor : openRouterDefaults.vendor,
    freeOnly: typeof openrouterInput.freeOnly === 'boolean' ? openrouterInput.freeOnly : openRouterDefaults.freeOnly,
    testedOnly: typeof openrouterInput.testedOnly === 'boolean' ? openrouterInput.testedOnly : openRouterDefaults.testedOnly,
    experimental: typeof openrouterInput.experimental === 'boolean' ? openrouterInput.experimental : openRouterDefaults.experimental,
    minContextWindow: typeof openrouterInput.minContextWindow === 'number' && Number.isFinite(openrouterInput.minContextWindow)
      ? openrouterInput.minContextWindow
      : openRouterDefaults.minContextWindow,
  };

  const agentFilters = normalizeProxyFilters(legacyByProvider?.agent ?? null);
  const cliproxyFilters = normalizeProxyFilters(legacyByProvider?.cliproxy ?? null);
  const goFilters = {
    vendor: typeof legacyByProvider?.['opencode-go']?.vendor === 'string'
      ? legacyByProvider['opencode-go'].vendor.trim()
      : '',
  };
  const chatGptFilters = {
    vendor: typeof legacyByProvider?.chatgpt?.vendor === 'string'
      ? legacyByProvider.chatgpt.vendor.trim()
      : '',
  };

  const selectedModelIdByProvider: Record<AIConfig['provider'], string> = {
    openrouter: typeof legacyModels?.openrouter === 'string' ? legacyModels.openrouter : '',
    agent: typeof legacyModels?.agent === 'string' ? legacyModels.agent : '',
    cliproxy: typeof legacyModels?.cliproxy === 'string' ? legacyModels.cliproxy : '',
    'opencode-go': typeof legacyModels?.['opencode-go'] === 'string' ? legacyModels['opencode-go'] : '',
    chatgpt: typeof legacyModels?.chatgpt === 'string' ? legacyModels.chatgpt : '',
  };

  const provider = raw.provider === 'openrouter' || raw.provider === 'agent' || raw.provider === 'cliproxy' || raw.provider === 'opencode-go' || raw.provider === 'chatgpt'
    ? raw.provider
    : DEFAULT_AI_CONFIG.provider;
  if (typeof raw.selectedModelId === 'string' && raw.selectedModelId && !selectedModelIdByProvider[provider]) {
    selectedModelIdByProvider[provider] = raw.selectedModelId;
  }

  const agentToken =
    typeof raw.agentToken === 'string' && raw.agentToken.trim().length > 0
      ? raw.agentToken
      : DEFAULT_AI_CONFIG.agentToken;

  const proxyManagementKey =
    typeof raw.proxyManagementKey === 'string' ? raw.proxyManagementKey : DEFAULT_AI_CONFIG.proxyManagementKey;

  return {
    // Keep an explicit schema here: imported or legacy credential fields must not
    // become part of the config saved to project history or backups.
    provider,
    openRouterKey: typeof raw.openRouterKey === 'string' ? raw.openRouterKey : DEFAULT_AI_CONFIG.openRouterKey,
    openRouterEndpoint: typeof raw.openRouterEndpoint === 'string' ? raw.openRouterEndpoint : DEFAULT_AI_CONFIG.openRouterEndpoint,
    agentToken,
    agentEndpoint: typeof raw.agentEndpoint === 'string' ? raw.agentEndpoint : DEFAULT_AI_CONFIG.agentEndpoint,
    proxyKey: typeof raw.proxyKey === 'string' ? raw.proxyKey : DEFAULT_AI_CONFIG.proxyKey,
    proxyManagementKey,
    proxyEndpoint: typeof raw.proxyEndpoint === 'string' ? raw.proxyEndpoint : DEFAULT_AI_CONFIG.proxyEndpoint,
    selectedModelId: typeof raw.selectedModelId === 'string' ? raw.selectedModelId : selectedModelIdByProvider[provider],
    selectedModelIdByProvider,
    filtersByProvider: {
      openrouter: openrouterFilters,
      agent: agentFilters,
      cliproxy: cliproxyFilters,
      'opencode-go': goFilters,
      chatgpt: chatGptFilters,
    },
  };
};
