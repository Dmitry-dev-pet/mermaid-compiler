import type { AIConfig, AppState, ModelParams } from '../types';
import { DEFAULT_APP_STATE } from '../constants';
import type { SessionSettings } from '../services/history/types';
import { normalizeAiConfig } from '../services/aiConfigNormalization';

type SetAiConfig = (value: AIConfig | ((prev: AIConfig) => AIConfig)) => void;

const coerceThinkingStyle = (value: unknown): AppState['thinkingStyle'] => {
  if (value === 'simple' || value === 'engineering' || value === 'strict_c4') {
    return value;
  }
  return DEFAULT_APP_STATE.thinkingStyle;
};

export const buildSessionSettings = (
  appState: AppState,
  aiConfig: AIConfig,
  modelParams?: SessionSettings['modelParams']
): SessionSettings => ({
  appState,
  aiConfig: normalizeAiConfig(aiConfig),
  modelParams,
});

export const applySessionSettings = (
  settings: SessionSettings,
  setAppState: (value: AppState) => void,
  setAiConfig: SetAiConfig,
  setModelParams?: (value: ModelParams | null) => void
) => {
  const nextAppState = { ...DEFAULT_APP_STATE, ...settings.appState };
  nextAppState.thinkingStyle = coerceThinkingStyle(settings.appState?.thinkingStyle);
  setAppState(nextAppState);
  setAiConfig((prev) => {
    const normalized = normalizeAiConfig(settings.aiConfig);
    const raw = settings.aiConfig as Partial<AIConfig> | undefined;

    const rawOpenRouterKey = typeof raw?.openRouterKey === 'string' ? raw.openRouterKey : '';
    const rawAgentToken = typeof raw?.agentToken === 'string' ? raw.agentToken : '';
    const rawProxyKey = typeof raw?.proxyKey === 'string' ? raw.proxyKey : '';
    const rawProxyManagementKey = typeof raw?.proxyManagementKey === 'string' ? raw.proxyManagementKey : '';

    const rawOpenRouterEndpoint = typeof raw?.openRouterEndpoint === 'string' ? raw.openRouterEndpoint : '';
    const rawAgentEndpoint = typeof raw?.agentEndpoint === 'string' ? raw.agentEndpoint : '';
    const rawProxyEndpoint = typeof raw?.proxyEndpoint === 'string' ? raw.proxyEndpoint : '';

    return {
      ...normalized,
      openRouterKey: rawOpenRouterKey || prev.openRouterKey,
      agentToken: rawAgentToken || prev.agentToken,
      proxyKey: rawProxyKey || prev.proxyKey,
      proxyManagementKey: rawProxyManagementKey || prev.proxyManagementKey,
      openRouterEndpoint: rawOpenRouterEndpoint || prev.openRouterEndpoint,
      agentEndpoint: rawAgentEndpoint || prev.agentEndpoint,
      proxyEndpoint: rawProxyEndpoint || prev.proxyEndpoint,
    };
  });
  setModelParams?.(settings.modelParams ?? null);
};
