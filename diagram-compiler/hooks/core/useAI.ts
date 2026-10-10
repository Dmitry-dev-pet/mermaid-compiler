import { useState, useCallback, useEffect, useRef } from 'react';
import { AIConfig, ConnectionState } from '../../types';
import { DEFAULT_AI_CONFIG } from '../../constants';
import { fetchModels } from '../../services/llmService';
import { normalizeAiConfig, type LegacyAIConfig } from '../../services/aiConfigNormalization';
import { getOpenCodeGoApiKey } from '../../services/openCodeGoCredentials';
import { safeParse } from '../../utils';


export const useAI = () => {
  const [aiConfig, setAiConfig] = useState<AIConfig>(() =>
    normalizeAiConfig(safeParse<LegacyAIConfig>('dc_ai_config', DEFAULT_AI_CONFIG))
  );
  const previousProviderRef = useRef(aiConfig.provider);
  const connectionAttemptRef = useRef(0);

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
    const attempt = ++connectionAttemptRef.current;
    setConnectionState(prev => ({ ...prev, status: 'connecting', error: undefined }));
    try {
      if (aiConfig.provider === 'opencode-go' && !getOpenCodeGoApiKey()) {
        throw new Error('Enter your personal OpenCode Go API key to load models.');
      }
      const models = await fetchModels(aiConfig);
      if (attempt !== connectionAttemptRef.current) return;
      
      if (models.length === 0) {
        throw new Error(aiConfig.provider === 'opencode-go'
          ? 'No supported Go models are available. Try loading the catalogue again.'
          : 'No models found. Check endpoint/key.');
      }

      setConnectionState({
        status: 'connected',
        availableModels: models
      });
      
      // Auto-select first model if none selected or current not in list
      if (!aiConfig.selectedModelId || !models.find(m => m.id === aiConfig.selectedModelId)) {
        setAiConfig(prev => prev.provider !== aiConfig.provider ? prev : ({
          ...prev,
          selectedModelId: models[0].id,
          selectedModelIdByProvider: {
            ...prev.selectedModelIdByProvider,
            [prev.provider]: models[0].id,
          },
        }));
      }

    } catch (e: unknown) {
      if (attempt !== connectionAttemptRef.current) return;
      const message = e instanceof Error ? e.message : String(e);
      setConnectionState({
        status: 'failed',
        error: message || 'Connection failed',
        availableModels: []
      });
    }
  }, [aiConfig]);

  const disconnectAI = useCallback(() => {
    // Ignore a catalogue response arriving after key edits, clearing or switching.
    connectionAttemptRef.current += 1;
    setConnectionState({ status: 'disconnected', availableModels: [] });
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    const shouldConnect = aiConfig.provider === 'opencode-go'
      ? Boolean(getOpenCodeGoApiKey())
      : Boolean(aiConfig.openRouterKey || aiConfig.agentEndpoint || aiConfig.proxyEndpoint);
    if (shouldConnect) {
        connectAI();
    }
    return () => { connectionAttemptRef.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const previousProvider = previousProviderRef.current;
    if (previousProvider === aiConfig.provider) return;
    previousProviderRef.current = aiConfig.provider;
    disconnectAI();

    const shouldConnect =
      aiConfig.provider === 'openrouter'
        ? Boolean(aiConfig.openRouterKey)
        : aiConfig.provider === 'agent'
          ? Boolean(aiConfig.agentEndpoint)
          : aiConfig.provider === 'opencode-go'
            ? Boolean(getOpenCodeGoApiKey())
            : Boolean(aiConfig.proxyEndpoint);

    if (shouldConnect) {
      connectAI();
    }
  }, [aiConfig.openRouterKey, aiConfig.agentEndpoint, aiConfig.provider, aiConfig.proxyEndpoint, connectAI, disconnectAI]);

  return {
    aiConfig,
    setAiConfig,
    connectionState,
    connectAI,
    disconnectAI
  };
};
