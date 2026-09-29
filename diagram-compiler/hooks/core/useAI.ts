import { useState, useCallback, useEffect, useRef } from 'react';
import { AIConfig, ConnectionState } from '../../types';
import { DEFAULT_AI_CONFIG } from '../../constants';
import { fetchModels } from '../../services/llmService';
import { normalizeAiConfig, type LegacyAIConfig } from '../../services/aiConfigNormalization';
import { safeParse } from '../../utils';


export const useAI = () => {
  const [aiConfig, setAiConfig] = useState<AIConfig>(() =>
    normalizeAiConfig(safeParse<LegacyAIConfig>('dc_ai_config', DEFAULT_AI_CONFIG))
  );
  const previousProviderRef = useRef(aiConfig.provider);

  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    availableModels: []
  });

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('dc_ai_config', JSON.stringify(aiConfig));
  }, [aiConfig]);

  // --- Logic ---
  const connectAI = useCallback(async () => {
    setConnectionState(prev => ({ ...prev, status: 'connecting', error: undefined }));
    try {
      const models = await fetchModels(aiConfig);
      
      if (models.length === 0) {
        throw new Error("No models found. Check endpoint/key.");
      }

      setConnectionState({
        status: 'connected',
        availableModels: models
      });
      
      // Auto-select first model if none selected or current not in list
      if (!aiConfig.selectedModelId || !models.find(m => m.id === aiConfig.selectedModelId)) {
        setAiConfig(prev => ({
          ...prev,
          selectedModelId: models[0].id,
          selectedModelIdByProvider: {
            ...prev.selectedModelIdByProvider,
            [prev.provider]: models[0].id,
          },
        }));
      }

    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setConnectionState({
        status: 'failed',
        error: message || 'Connection failed',
        availableModels: []
      });
    }
  }, [aiConfig]);

  const disconnectAI = useCallback(() => {
    setConnectionState({ status: 'disconnected', availableModels: [] });
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (aiConfig.openRouterKey || aiConfig.agentEndpoint || aiConfig.proxyEndpoint) {
        connectAI();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const previousProvider = previousProviderRef.current;
    if (previousProvider === aiConfig.provider) return;
    previousProviderRef.current = aiConfig.provider;

    const shouldConnect =
      aiConfig.provider === 'openrouter'
        ? Boolean(aiConfig.openRouterKey)
        : aiConfig.provider === 'agent'
          ? Boolean(aiConfig.agentEndpoint)
          : Boolean(aiConfig.proxyEndpoint);

    if (shouldConnect) {
      connectAI();
    }
  }, [aiConfig.openRouterKey, aiConfig.agentEndpoint, aiConfig.provider, aiConfig.proxyEndpoint, connectAI]);

  return {
    aiConfig,
    setAiConfig,
    connectionState,
    connectAI,
    disconnectAI
  };
};
