import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Check,
  X,
  Wifi,
  WifiOff,
  Loader2,
  Filter,
  LogOut,
  Timer,
} from 'lucide-react';
import { AIConfig, CliproxyFilters, ConnectionState, ModelParams, OpenRouterFilters } from '../../types';
import { DEFAULT_AI_CONFIG } from '../../constants';
import { useCliproxyQuotas } from '../../hooks/core/useCliproxyQuotas';
import { useCliproxyManagementInfo } from '../../hooks/core/useCliproxyManagementInfo';
import { useAgentCodexQuota } from '../../hooks/core/useAgentCodexQuota';
import { useAgentGeminiQuota } from '../../hooks/core/useAgentGeminiQuota';
import { useChatGptAccount } from '../../hooks/core/useChatGptAccount';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { RadioGroup, RadioOption } from '../ui/Radio';
import { Select } from '../ui/Select';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { SecretInput } from '../ui/SecretInput';
import { CliproxyAuthFile } from '../../utils/cliproxyAuthFileStatus';
import { buildCliproxySubscriptionsViewModel, CliproxySubscriptionsGroupBy } from '../../utils/cliproxySubscriptionsViewModel';
import { CliproxyQuotasPanel } from './CliproxyQuotasPanel';
import { getAntigravityBucketLabel } from '../../services/cliproxy/quotas/parsers';
import { AiStatusLine } from './AiStatusLine';
import { ChatGptAccountPanel } from './ChatGptAccountPanel';
import { getModelFamilyKey, getModelFamilyLabel } from '../../utils/aiModelUtils';
import { getModelDisplayName } from '../../utils/aiModelDisplayName';
import { getConnectionStatusLabel } from '../../utils/aiStatusPresentation';
import { clearOpenCodeGoApiKey, getOpenCodeGoApiKey, setOpenCodeGoApiKey } from '../../services/openCodeGoCredentials';

type AiControlPlaneMenuProps = {
  aiConfig: AIConfig;
  modelParams: ModelParams | null;
  onModelParamsChange: React.Dispatch<React.SetStateAction<ModelParams | null>>;
  connectionState: ConnectionState;
  onConfigChange: React.Dispatch<React.SetStateAction<AIConfig>>;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  llmTimeoutMs: number;
  onLLMTimeoutMsChange: (timeoutMs: number) => void;
  isProcessing?: boolean;
};

const normalizeCliproxyBase = (endpoint: string) => endpoint.trim().replace(/\/v1\/?$/, '').replace(/\/$/, '');

const formatMonthDayTime = (date: Date) => date.toLocaleString(void 0, {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});


const AiControlPlaneMenu: React.FC<AiControlPlaneMenuProps> = ({
  aiConfig,
  modelParams,
  onModelParamsChange,
  connectionState,
  onConfigChange,
  onConnect,
  onDisconnect,
  llmTimeoutMs,
  onLLMTimeoutMsChange,
  isProcessing = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [openCodeGoKey, setOpenCodeGoKey] = useState(() => aiConfig.provider === 'opencode-go' ? getOpenCodeGoApiKey() : '');
  const [openCodeGoKeyError, setOpenCodeGoKeyError] = useState<string | null>(null);
  const [showAgentToken, setShowAgentToken] = useState(false);
  const [showProxyKey, setShowProxyKey] = useState(false);
  const [showProxyManagementKey, setShowProxyManagementKey] = useState(false);
  const [showProxySettings, setShowProxySettings] = useState(connectionState.status !== 'connected');
  const [showAgentSettings, setShowAgentSettings] = useState(connectionState.status !== 'connected');
  const [showCliproxyUsageDetails, setShowCliproxyUsageDetails] = useState(false);
  const [showCliproxySubscriptions, setShowCliproxySubscriptions] = useState(false);
  const [cliproxySubscriptionsGroupBy, setCliproxySubscriptionsGroupBy] = useState<CliproxySubscriptionsGroupBy>('provider');
  const [showCliproxyQuotas, setShowCliproxyQuotas] = useState(false);
  const [showAgentQuotas, setShowAgentQuotas] = useState(false);
  const [showQuotaSums, setShowQuotaSums] = useState(false);
  const [agentStatus, setAgentStatus] = useState<{ state: 'unknown' | 'online' | 'offline'; message?: string }>({ state: 'unknown' });
  const [versionInfo, setVersionInfo] = useState<{
    agentVersion?: string;
    codexDetected?: boolean;
    codexVersion?: string;
    geminiDetected?: boolean;
    geminiVersion?: string;
  }>({});
  const cliproxyInfo = useCliproxyManagementInfo({
    enabled: aiConfig.provider === 'cliproxy' && (isOpen || connectionState.status === 'connected'),
    endpoint: aiConfig.proxyEndpoint || '',
    proxyKey: aiConfig.proxyKey,
    managementKey: aiConfig.proxyManagementKey,
  });
  const { quotas: cliproxyQuotas, refresh: refreshCliproxyQuotas } = useCliproxyQuotas({
    enabled: aiConfig.provider === 'cliproxy' && connectionState.status === 'connected',
    endpoint: aiConfig.proxyEndpoint || '',
    managementKey: aiConfig.proxyManagementKey || '',
    authFiles: cliproxyInfo.cliproxyAuthFiles ?? [],
    showAll: true,
    pageSize: 3,
  });
  const { quota: agentCodexQuota, refresh: refreshAgentCodexQuota } = useAgentCodexQuota({
    enabled: aiConfig.provider === 'agent' && connectionState.status === 'connected',
    endpoint: aiConfig.agentEndpoint || '',
    token: aiConfig.agentToken || '',
  });
  const { quota: agentGeminiQuota, refresh: refreshAgentGeminiQuota } = useAgentGeminiQuota({
    enabled: aiConfig.provider === 'agent' && connectionState.status === 'connected',
    endpoint: aiConfig.agentEndpoint || '',
    token: aiConfig.agentToken || '',
  });
  const chatGptAccount = useChatGptAccount({
    enabled: aiConfig.provider === 'chatgpt',
    isProcessing,
    onConnect,
    onDisconnect,
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getStatusTone = () => {
    if (aiConfig.provider === 'chatgpt') {
      const usage = chatGptAccount.status?.usage;
      if (chatGptAccount.error || usage?.state === 'limit_reached' || usage?.state === 'unavailable') return 'text-rose-500';
      if (chatGptAccount.status?.connected && usage?.state === 'available' && usage.model === aiConfig.selectedModelId) return 'text-emerald-500';
      if (chatGptAccount.loading || chatGptAccount.status?.connected || chatGptAccount.status?.login?.state === 'pending') return 'text-amber-500';
      return 'text-slate-400 dark:text-slate-500';
    }
    if (aiConfig.provider === 'opencode-go' && connectionState.status === 'connected') return 'text-amber-500';
    if (connectionState.status === 'connected') return 'text-emerald-500';
    if (connectionState.status === 'failed') return 'text-rose-500';
    if (connectionState.status === 'connecting') return 'text-amber-500';
    return 'text-slate-400 dark:text-slate-500';
  };

  const updateConfig = useCallback((updates: Partial<AIConfig>) => {
    onConfigChange((prev) => ({ ...prev, ...updates }));
  }, [onConfigChange]);

  const updateOpenCodeGoKey = (value: string) => {
    onDisconnect();
    setOpenCodeGoKey(value);
    try {
      if (value.trim()) setOpenCodeGoApiKey(value);
      else clearOpenCodeGoApiKey();
      setOpenCodeGoKeyError(null);
    } catch {
      setOpenCodeGoKeyError('Could not save the Go key. Check browser storage settings and enter the key again.');
    }
  };

  const clearOpenCodeGoKey = () => {
    onDisconnect();
    try {
      clearOpenCodeGoApiKey();
      setOpenCodeGoKey('');
      setOpenCodeGoKeyError(null);
    } catch {
      setOpenCodeGoKeyError('Could not remove the Go key. Check browser storage settings and try again.');
    }
  };

  const updateSelectedModel = useCallback((modelId: string) => {
    onConfigChange((prev) => ({
      ...prev,
      selectedModelId: modelId,
      selectedModelIdByProvider: {
        ...prev.selectedModelIdByProvider,
        [prev.provider]: modelId,
      },
    }));
  }, [onConfigChange]);

  const formatContextLength = (value?: number) => {
    if (!value || value <= 0) return '';
    if (value >= 1_000_000) {
      const rounded = Math.round(value / 1_000_000);
      return `${rounded}m`;
    }
    const rounded = Math.round(value / 1000);
    return `${rounded}k`;
  };

  const normalizeCliVersion = (value: string | undefined): string | null => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return null;
    const match = trimmed.match(/\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z_.-]+)?\b/);
    if (!match?.[0]) return trimmed;
    const v = match[0];
    return v.startsWith('v') ? v : `v${v}`;
  };

  const formatCliStatus = (label: string, detected: boolean | undefined, version: string | undefined): string => {
    if (detected === false) return `${label} (missing)`;
    const v = normalizeCliVersion(version);
    return `${label} ${v ?? '(unknown)'}`;
  };

  const isOpenRouter = aiConfig.provider === 'openrouter';
  const isAgent = aiConfig.provider === 'agent';
  const isCliproxy = aiConfig.provider === 'cliproxy';
  const isOpenCodeGo = aiConfig.provider === 'opencode-go';
  const isChatGpt = aiConfig.provider === 'chatgpt';
  const cliproxyAuthFiles = useMemo(
    () => (cliproxyInfo.cliproxyAuthFiles ?? []) as CliproxyAuthFile[],
    [cliproxyInfo.cliproxyAuthFiles],
  );
  const cliproxySubscriptionsVm = useMemo(() => {
    if (!isCliproxy || !showCliproxySubscriptions) return null;
    return buildCliproxySubscriptionsViewModel({
      files: cliproxyAuthFiles,
      groupBy: cliproxySubscriptionsGroupBy,
      emailPreviewLimit: 8,
      providerRowLimit: 6,
    });
  }, [cliproxyAuthFiles, cliproxySubscriptionsGroupBy, isCliproxy, showCliproxySubscriptions]);
  const filtersByProvider = aiConfig.filtersByProvider ?? DEFAULT_AI_CONFIG.filtersByProvider;
  const openRouterFilters = filtersByProvider.openrouter;
  const openCodeGoFilters = filtersByProvider['opencode-go'] ?? DEFAULT_AI_CONFIG.filtersByProvider['opencode-go'];
  const chatGptFilters = filtersByProvider.chatgpt ?? DEFAULT_AI_CONFIG.filtersByProvider.chatgpt;
  const proxyFilters = isAgent ? filtersByProvider.agent : isCliproxy ? filtersByProvider.cliproxy : null;
  const activeVendor = isChatGpt ? chatGptFilters.vendor : isOpenCodeGo ? openCodeGoFilters.vendor : openRouterFilters.vendor;
  const timeoutSeconds = Math.max(5, Math.min(300, Math.round(llmTimeoutMs / 1000)));
  const statusToneClass = getStatusTone();
  const reasoningEffort =
    typeof modelParams?.['reasoning_effort'] === 'string'
      ? (modelParams['reasoning_effort'] as string)
      : 'auto';
  const selectedModel = aiConfig.selectedModelId
    ? connectionState.availableModels.find((m) => m?.id === aiConfig.selectedModelId)
    : undefined;
  const matchingNameModels = selectedModel?.name
    ? connectionState.availableModels.filter((m) => m?.name === selectedModel.name && m?.id && m.id !== selectedModel.id)
    : [];
  const isGeminiModel =
    selectedModel?.vendor === 'google' ||
    /^gemini[:/]/i.test(aiConfig.selectedModelId) ||
    /\bgoogle\/gemini\b/i.test(aiConfig.selectedModelId);
  const antigravityBucketLabel = selectedModel && selectedModel.ownedBy === 'antigravity'
    ? getAntigravityBucketLabel({ modelId: selectedModel.id, modelName: selectedModel.name })
    : null;
  const showReasoningControl = isAgent && !isGeminiModel;

  const updateOpenRouterFilters = (updates: Partial<OpenRouterFilters>) => {
    onConfigChange((prev) => {
      return {
        ...prev,
        filtersByProvider: {
          ...prev.filtersByProvider,
          openrouter: {
            ...(prev.filtersByProvider?.openrouter ?? {}),
            ...updates,
          },
        },
      };
    });
  };

  const updateProxyFilters = (updates: Partial<CliproxyFilters>) => {
    onConfigChange((prev) => {
      const provider = prev.provider === 'agent' ? 'agent' : 'cliproxy';
      return {
        ...prev,
        filtersByProvider: {
          ...prev.filtersByProvider,
          [provider]: {
            ...(prev.filtersByProvider?.[provider] ?? {}),
            ...updates,
          },
        },
      };
    });
  };

  const updateOpenCodeGoVendor = (vendor: string) => {
    onConfigChange((prev) => ({
      ...prev,
      filtersByProvider: {
        ...prev.filtersByProvider,
        'opencode-go': { vendor },
      },
    }));
  };

  const updateChatGptVendor = (vendor: string) => {
    onConfigChange((prev) => ({
      ...prev,
      filtersByProvider: {
        ...prev.filtersByProvider,
        chatgpt: { vendor },
      },
    }));
  };

  const switchProvider = (provider: AIConfig['provider']) => {
    if (aiConfig.provider === provider) return;
    onDisconnect();
    if (provider === 'opencode-go') {
      setOpenCodeGoKey(getOpenCodeGoApiKey());
      setOpenCodeGoKeyError(null);
    }
    const storedModelId = aiConfig.selectedModelIdByProvider?.[provider] ?? '';
    updateConfig({ provider, selectedModelId: storedModelId });
  };

  const updateReasoningEffort = useCallback((value: string) => {
    onModelParamsChange((prev) => {
      const next: ModelParams = { ...(prev ?? {}) };
      if (value === 'auto') {
        delete next['reasoning_effort'];
      } else {
        next['reasoning_effort'] = value;
      }
      return Object.keys(next).length === 0 ? null : next;
    });
  }, [onModelParamsChange]);

  useEffect(() => {
    const current = typeof modelParams?.['reasoning_effort'] === 'string'
      ? (modelParams['reasoning_effort'] as string)
      : null;
    if (!current) return;
    if (showReasoningControl) return;
    updateReasoningEffort('auto');
  }, [modelParams, showReasoningControl, updateReasoningEffort]);

  const baseFilteredModels = connectionState.availableModels.filter((m) => {
    if (!m) return false;
    if (isOpenRouter) {
      if (openRouterFilters.freeOnly && !m.isFree) return false;
      if (openRouterFilters.minContextWindow > 0 && (m.contextLength ?? 0) < openRouterFilters.minContextWindow) return false;
    }
    return true;
  });

  const vendorCounts = new Map<string, number>();
  if (isOpenRouter || isOpenCodeGo || isChatGpt) {
    baseFilteredModels.forEach((model) => {
      if (!model || !model.vendor) return;
      vendorCounts.set(model.vendor, (vendorCounts.get(model.vendor) ?? 0) + 1);
    });
  }

  const familyCandidates = new Set<'gpt' | 'claude' | 'gemini' | 'other'>();
  if (isAgent || isCliproxy) {
    baseFilteredModels.forEach((model) => {
      if (!model) return;
      familyCandidates.add(getModelFamilyKey(model));
    });
  }

  const vendorOptions = Array.from(vendorCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([vendor, count]) => ({ vendor, count }));

  if ((isOpenRouter || isOpenCodeGo || isChatGpt) && activeVendor && !vendorCounts.has(activeVendor)) {
    vendorOptions.unshift({ vendor: activeVendor, count: 0 });
  }

  const familyOptions = Array.from(familyCandidates.values())
    .sort((a, b) => getModelFamilyLabel(a).localeCompare(getModelFamilyLabel(b)))
    .map((family) => {
      const count = baseFilteredModels.filter((model) => model && getModelFamilyKey(model) === family).length;
      return { family, label: getModelFamilyLabel(family), count };
    });

  if ((isAgent || isCliproxy) && proxyFilters?.family) {
    const active = proxyFilters.family.trim().toLowerCase() as 'gpt' | 'claude' | 'gemini' | 'other';
    if (active && !familyCandidates.has(active)) {
      familyOptions.unshift({ family: active, label: getModelFamilyLabel(active), count: 0 });
    }
  }

  const familyPills = [...familyOptions].sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));

  const filteredModels = baseFilteredModels.filter((m) => {
    if (!m) return false;
    if (isOpenRouter || isOpenCodeGo || isChatGpt) {
      if (activeVendor && m.vendor !== activeVendor) return false;
      return true;
    }

    const filterFamily = (proxyFilters?.family ?? '').trim().toLowerCase();
    if (filterFamily && getModelFamilyKey(m) !== filterFamily) return false;

    return true;
  });

  useEffect(() => {
    if (!isAgent) return;
    if (!isOpen) return;
    let cancelled = false;

    const endpoint = aiConfig.agentEndpoint?.trim();
    const checkHealth = async (base: string) => {
      try {
        const response = await fetch(`${base}/api/health`);
        if (cancelled) return;
        if (!response.ok) {
          setAgentStatus({ state: 'offline', message: `HTTP ${response.status}` });
          return;
        }
        const json = await response.json().catch(() => null);
        if (json && typeof json === 'object') {
          const data = json as Record<string, unknown>;
          const agentVersion = typeof data.agent_version === 'string' ? data.agent_version : undefined;
          const codexDetected = typeof data.codex_detected === 'boolean' ? data.codex_detected : undefined;
          const codexVersion = typeof data.codex_version === 'string' ? data.codex_version : undefined;
          const geminiDetected = typeof data.gemini_detected === 'boolean' ? data.gemini_detected : undefined;
          const geminiVersion = typeof data.gemini_version === 'string' ? data.gemini_version : undefined;
          setVersionInfo((prev) => ({ ...prev, agentVersion, codexDetected, codexVersion, geminiDetected, geminiVersion }));
        }
        setAgentStatus({ state: 'online' });
      } catch (error: unknown) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unavailable';
        setAgentStatus({ state: 'offline', message });
      }
    };

    const run = async () => {
      if (!endpoint) {
        setAgentStatus({ state: 'unknown' });
        setVersionInfo((prev) => ({ ...prev, agentVersion: undefined, codexVersion: undefined, geminiVersion: undefined }));
        return;
      }
      const base = normalizeCliproxyBase(endpoint);
      await checkHealth(base);
      const interval = window.setInterval(() => void checkHealth(base), 5000);
      return () => {
        window.clearInterval(interval);
      };
    };

    const teardownPromise = run();
    return () => {
      cancelled = true;
      void teardownPromise.then((teardown) => teardown?.());
    };
  }, [aiConfig.agentEndpoint, isAgent, isOpen]);

  const handleToggleMenu = () => {
    const nextOpen = !isOpen;
    if (nextOpen && aiConfig.provider === 'cliproxy' && connectionState.status !== 'connected') {
      setShowProxySettings(true);
    }
    if (nextOpen && isOpenCodeGo && !openCodeGoKeyError) {
      setOpenCodeGoKey(getOpenCodeGoApiKey());
    }
    setIsOpen(nextOpen);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        onClick={handleToggleMenu}
        variant="default"
        className="px-3 max-md:px-2"
      >
        {connectionState.status === 'connected' ? <Wifi size={14} className={statusToneClass} /> : <WifiOff size={14} className={statusToneClass} />}
        <span className="ml-1 text-[10px] max-w-[320px] min-w-0 truncate">
          <AiStatusLine
            aiConfig={aiConfig}
            connectionState={connectionState}
            cliproxyInfo={cliproxyInfo}
            cliproxyQuotas={cliproxyQuotas}
            agentCodexQuota={agentCodexQuota}
            agentGeminiQuota={agentGeminiQuota}
            chatGptStatus={chatGptAccount.status}
            chatGptIsLocal={chatGptAccount.isLocal}
            chatGptLoading={chatGptAccount.loading}
          />
        </span>
        <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-400">
          <Timer size={12} className="opacity-80" />
          {timeoutSeconds}s
        </span>
        <ChevronDown size={14} className={`ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-[400px] max-md:!fixed max-md:!left-2 max-md:!right-2 max-md:!w-[calc(100vw-1rem)] max-md:!top-[var(--app-header-height,3rem)] max-md:mt-0 max-md:max-h-[calc(100dvh-6rem)] bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 p-4 animate-in fade-in slide-in-from-top-2 duration-200 z-50 max-h-[calc(100vh-5rem)] overflow-auto overscroll-contain">
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">Provider</label>
            <RadioGroup className="flex-wrap">
              <RadioOption
                name="provider"
                checked={aiConfig.provider === 'openrouter'}
                onChange={() => switchProvider('openrouter')}
                label="OpenRouter"
              />
              <RadioOption
                name="provider"
                checked={isOpenCodeGo}
                onChange={() => switchProvider('opencode-go')}
                label="OpenCode Go"
              />
              <RadioOption
                name="provider"
                checked={isChatGpt}
                onChange={() => switchProvider('chatgpt')}
                label="ChatGPT"
              />
              <RadioOption
                name="provider"
                checked={aiConfig.provider === 'agent'}
                onChange={() => switchProvider('agent')}
                label="Mermaid Agent"
              />
              <RadioOption
                name="provider"
                checked={aiConfig.provider === 'cliproxy'}
                onChange={() => switchProvider('cliproxy')}
                label="My Proxy"
              />
            </RadioGroup>
          </div>

          <form
            autoComplete="off"
            onSubmit={(event) => event.preventDefault()}
            className="mb-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-100 dark:border-slate-700"
          >
            {isOpenRouter ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">API Key</label>
                  <SecretInput
                    value={aiConfig.openRouterKey}
                    onChange={(value) => updateConfig({ openRouterKey: value })}
                    name="openrouter-secret"
                    placeholder="sk-or-..."
                    revealed={showOpenRouterKey}
                    onRevealedChange={setShowOpenRouterKey}
                    ariaLabelShow="Show API key"
                    ariaLabelHide="Hide API key"
                  />
                </div>
              </div>
            ) : isOpenCodeGo ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="opencode-go-api-key" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">OpenCode Go API key</label>
                  <Input
                    id="opencode-go-api-key"
                    type="password"
                    autoComplete="new-password"
                    name="opencode-go-secret"
                    value={openCodeGoKey}
                    onChange={(event) => updateOpenCodeGoKey(event.target.value)}
                    placeholder="Your personal Go key"
                    aria-describedby={openCodeGoKeyError ? 'opencode-go-key-help opencode-go-key-error' : 'opencode-go-key-help'}
                    aria-invalid={Boolean(openCodeGoKeyError)}
                    data-1p-ignore="true"
                    data-lpignore="true"
                    size="md"
                  />
                </div>
                <p id="opencode-go-key-help" className="text-[11px] text-slate-500 dark:text-slate-400">
                  Loading models does not generate text. Subscription access is checked when you send a prompt.
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  To stay within your subscription, keep Use balance off in{' '}
                  <a href="https://opencode.ai/console" target="_blank" rel="noopener noreferrer" className="underline">OpenCode Console</a>.
                </p>
                {openCodeGoKeyError ? (
                  <p id="opencode-go-key-error" role="alert" className="text-xs text-red-600 dark:text-red-400">{openCodeGoKeyError}</p>
                ) : null}
                <Button type="button" onClick={clearOpenCodeGoKey} variant="ghost" className="text-xs">
                  Clear Go key
                </Button>
              </div>
            ) : isChatGpt ? (
              <ChatGptAccountPanel
                account={chatGptAccount}
                connectionState={connectionState}
                selectedModelId={aiConfig.selectedModelId}
                isProcessing={isProcessing}
              />
            ) : isAgent ? (
              <div className="space-y-3">
                <CollapsibleSection
                  title="Agent settings"
                  open={showAgentSettings}
                  onToggle={() => setShowAgentSettings((prev) => !prev)}
                  summary={(
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Endpoint: <span className="font-mono">{aiConfig.agentEndpoint?.trim() ? aiConfig.agentEndpoint.trim() : '(not set)'}</span>
                    </div>
                  )}
                >
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Endpoint</label>
                      <Input
                        type="text"
                        autoComplete="off"
                        name="agent-endpoint"
                        value={aiConfig.agentEndpoint}
                        onChange={(e) => updateConfig({ agentEndpoint: e.target.value })}
                        placeholder="http://127.0.0.1:8787"
                        size="md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Agent Token</label>
                      <SecretInput
                        value={aiConfig.agentToken || ''}
                        onChange={(value) => updateConfig({ agentToken: value })}
                        name="agent-token"
                        placeholder="••••"
                        revealed={showAgentToken}
                        onRevealedChange={setShowAgentToken}
                        ariaLabelShow="Show agent token"
                        ariaLabelHide="Hide agent token"
                      />
                    </div>
                  </div>
                </CollapsibleSection>
                <div
                  className={`text-[11px] flex items-center gap-1 ${
                    agentStatus.state === 'online'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : agentStatus.state === 'offline'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <span className="inline-block h-2 w-2 rounded-full border border-current" />
                  Agent {agentStatus.state === 'unknown' ? 'unknown' : agentStatus.state}
                  {agentStatus.message ? ` · ${agentStatus.message}` : ''}
                </div>

                <CollapsibleSection
                  title="Quotas"
                  open={showAgentQuotas}
                  onToggle={() => setShowAgentQuotas((prev) => !prev)}
                >
                  <div className="mt-1 flex flex-col gap-2 text-[10px] leading-tight">
                    <div className="flex items-center justify-between gap-2 text-slate-400">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => setShowQuotaSums((prev) => !prev)}
                      >
                        Mode:{' '}
                        <span className={showQuotaSums ? 'font-semibold text-blue-600 dark:text-blue-400' : ''}>
                          Average
                        </span>
                        <span className="mx-1 text-slate-400">/</span>
                        {!showQuotaSums ? (
                          <span className="font-semibold text-blue-600 dark:text-blue-400">All</span>
                        ) : (
                          <span className="text-slate-400">All</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => {
                          refreshAgentCodexQuota();
                          refreshAgentGeminiQuota();
                        }}
                      >
                        Refresh
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-2">
                        <div className="text-slate-500 dark:text-slate-400">Codex CLI Quota</div>
                        <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                          {agentCodexQuota.status === 'loading' ? (
                            <div className="text-slate-400">Loading quota...</div>
                          ) : agentCodexQuota.status === 'error' ? (
                            <div className="text-amber-600 dark:text-amber-400">codex quota {agentCodexQuota.message ?? 'failed'}</div>
                          ) : null}
                          {agentCodexQuota.windows.length ? (
                            <div className="flex flex-col gap-1">
                              {agentCodexQuota.windows
                                .filter((w) => w.id === 'primary' || w.id === 'secondary')
                                .map((w) => {
                                  const percent = typeof w.remainingPercent === 'number' ? Math.max(0, Math.min(100, w.remainingPercent)) : null;
                                  const tone = percent === null
                                    ? 'bg-slate-200 dark:bg-slate-700'
                                    : percent >= 60
                                      ? 'bg-emerald-500'
                                      : percent >= 20
                                        ? 'bg-amber-500'
                                        : 'bg-rose-500';
                                  return (
                                    <div key={w.id} className="flex flex-col gap-0.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="truncate">{w.label}</span>
                                        <span className="font-mono tabular-nums text-slate-400">{percent === null ? '-' : `${Math.round(percent)}%`} · {w.resetLabel}</span>
                                      </div>
                                      <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                        <div
                                          className={`h-full ${tone}`}
                                          style={{ width: `${percent === null ? 0 : percent}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          ) : (
                            <div className="text-slate-400">No quota data</div>
                          )}
                          {agentCodexQuota.planType ? (
                            <div className="mt-1 text-[10px] text-slate-400">plan {agentCodexQuota.planType}</div>
                          ) : null}
                          {agentCodexQuota.creditsBalance ? (
                            <div className="mt-1 text-[10px] text-slate-400">credits {agentCodexQuota.creditsBalance}</div>
                          ) : null}
                          {typeof agentCodexQuota.updatedAt === 'number' && agentCodexQuota.updatedAt > 0 ? (
                            <div className="mt-1 text-[10px] text-slate-400">updated {formatMonthDayTime(new Date(agentCodexQuota.updatedAt * 1000))}</div>
                          ) : null}
                        </div>

                        <div className="text-slate-500 dark:text-slate-400">Gemini CLI Quota</div>
                        <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                          {agentGeminiQuota.status === 'loading' ? (
                            <div className="text-slate-400">Loading quota...</div>
                          ) : agentGeminiQuota.status === 'error' ? (
                            <div className="text-amber-600 dark:text-amber-400">gemini quota {agentGeminiQuota.message ?? 'failed'}</div>
                          ) : null}
                          {agentGeminiQuota.items.length ? (
                            <div className="flex flex-col gap-1">
                              {agentGeminiQuota.items.map((it) => {
                                const percent = typeof it.remainingPercent === 'number' ? Math.max(0, Math.min(100, it.remainingPercent)) : null;
                                const tone = percent === null
                                  ? 'bg-slate-200 dark:bg-slate-700'
                                  : percent >= 60
                                    ? 'bg-emerald-500'
                                    : percent >= 20
                                      ? 'bg-amber-500'
                                      : 'bg-rose-500';
                                return (
                                  <div key={it.id} className="flex flex-col gap-0.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="truncate">{it.label}</span>
                                      <span className="font-mono tabular-nums text-slate-400">{percent === null ? '-' : `${Math.round(percent)}%`} · {it.resetLabel}</span>
                                    </div>
                                    <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                      <div
                                        className={`h-full ${tone}`}
                                        style={{ width: `${percent === null ? 0 : percent}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-slate-400">No quota data</div>
                          )}
                          {agentGeminiQuota.email ? (
                            <div className="mt-1 text-[10px] text-slate-400">account {agentGeminiQuota.email}</div>
                          ) : null}
                          {typeof agentGeminiQuota.updatedAt === 'number' && agentGeminiQuota.updatedAt > 0 ? (
                            <div className="mt-1 text-[10px] text-slate-400">updated {formatMonthDayTime(new Date(agentGeminiQuota.updatedAt * 1000))}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>
              </div>
            ) : (
              <CollapsibleSection
                title="Proxy settings"
                open={showProxySettings}
                onToggle={() => setShowProxySettings((prev) => !prev)}
                summary={(
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Endpoint: <span className="font-mono">{aiConfig.proxyEndpoint?.trim() ? aiConfig.proxyEndpoint.trim() : '(not set)'}</span>
                  </div>
                )}
              >
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Endpoint</label>
                    <Input
                      type="text"
                      autoComplete="off"
                      name="proxy-endpoint"
                      value={aiConfig.proxyEndpoint}
                      onChange={(e) => updateConfig({ proxyEndpoint: e.target.value })}
                      placeholder="http://localhost:8317"
                      size="md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Proxy Key</label>
                    <SecretInput
                      value={aiConfig.proxyKey || ''}
                      onChange={(value) => updateConfig({ proxyKey: value })}
                      name="proxy-secret"
                      placeholder="••••"
                      revealed={showProxyKey}
                      onRevealedChange={setShowProxyKey}
                      ariaLabelShow="Show proxy key"
                      ariaLabelHide="Hide proxy key"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Management Key</label>
                    <SecretInput
                      value={aiConfig.proxyManagementKey || ''}
                      onChange={(value) => updateConfig({ proxyManagementKey: value })}
                      name="proxy-management-secret"
                      placeholder="X-Management-Key"
                      revealed={showProxyManagementKey}
                      onRevealedChange={setShowProxyManagementKey}
                      ariaLabelShow="Show management key"
                      ariaLabelHide="Hide management key"
                    />
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {!isChatGpt && (
              <div className={`mt-3 flex gap-2 ${isOpenCodeGo ? 'flex-col items-start' : 'items-center justify-between'}`}>
                <span
                  className={`text-xs font-medium flex items-center gap-1 ${
                    connectionState.status === 'connected'
                      ? isOpenCodeGo ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'
                      : connectionState.status === 'failed'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {connectionState.status === 'connected' && <Check size={12} />}
                  {connectionState.status === 'failed' && <X size={12} />}
                  Status: {getConnectionStatusLabel(aiConfig.provider, connectionState.status)}
                  {connectionState.error && <span className="ml-1 text-red-500">({connectionState.error})</span>}
                </span>

                {connectionState.status !== 'connected' ? (
                  <Button
                    onClick={onConnect}
                    disabled={connectionState.status === 'connecting' || (isOpenCodeGo && (!openCodeGoKey.trim() || Boolean(openCodeGoKeyError)))}
                    className="bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
                  >
                    {connectionState.status === 'connecting' && <Loader2 size={12} className="animate-spin" />}
                    {isOpenCodeGo ? 'Load models' : 'Test connection'}
                  </Button>
                ) : (
                  <Button
                    onClick={onDisconnect}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <LogOut size={12} /> Disconnect
                  </Button>
                )}
              </div>
            )}

            {(isAgent || isCliproxy) && connectionState.status === 'connected' && (
              <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex flex-col gap-1">
                {isAgent && (
                  <div>
                    Agent {normalizeCliVersion(versionInfo.agentVersion) ?? '(unknown)'} ·{' '}
                    {formatCliStatus('Codex CLI', versionInfo.codexDetected, versionInfo.codexVersion)} ·{' '}
                    {formatCliStatus('Gemini CLI', versionInfo.geminiDetected, versionInfo.geminiVersion)}
                  </div>
                )}
                {isCliproxy && (
                  <div className="space-y-1">
                    <div>
                      cliproxyapi:{' '}
                      {cliproxyInfo.cliproxyapiLatestVersion
                        ? `v${cliproxyInfo.cliproxyapiLatestVersion.replace(/^v/i, '')}`
                        : (cliproxyInfo.cliproxyapiVersion ?? '(unknown)')}
                      {cliproxyInfo.cliproxyUsageSummary ? ` · usage ${cliproxyInfo.cliproxyUsageSummary}` : ''}
                      {cliproxyInfo.cliproxyManagementStatus ? ` · mgmt ${cliproxyInfo.cliproxyManagementStatus}` : ''}
                    </div>
                    {Array.isArray(cliproxyInfo.cliproxyAuthFiles) ? (
                      <CollapsibleSection
                        title="Subscriptions"
                        open={showCliproxySubscriptions}
                        onToggle={() => setShowCliproxySubscriptions((prev) => !prev)}
                      >
                        <div className="mt-1 flex flex-col gap-1">
                            <RadioGroup>
                              <RadioOption
                                name="cliproxy-subscriptions-groupby"
                                checked={cliproxySubscriptionsGroupBy === 'provider'}
                                onChange={() => setCliproxySubscriptionsGroupBy('provider')}
                                label="By provider"
                              />
                              <RadioOption
                                name="cliproxy-subscriptions-groupby"
                                checked={cliproxySubscriptionsGroupBy === 'email'}
                                onChange={() => setCliproxySubscriptionsGroupBy('email')}
                                label="By email"
                              />
                            </RadioGroup>
                            {cliproxyInfo.cliproxyAuthFiles.length === 0 ? (
                              <div className="text-slate-400">No auth files</div>
                            ) : (
                              cliproxySubscriptionsVm?.kind === 'email' ? (
                                <div className="mt-2 flex flex-col gap-1">
                                  {cliproxySubscriptionsVm.rows.map((row) => (
                                    <div key={row.key} className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="font-mono tabular-nums truncate">
                                          {row.primary}{row.count > 1 ? ` ×${row.count}` : ''}
                                        </div>
                                        {row.secondary ? (
                                          <div className="mt-0.5 pl-4 text-[10px] text-slate-400 truncate">{row.secondary}</div>
                                        ) : null}
                                      </div>
                                      <div className={`shrink-0 font-mono tabular-nums ${row.statusTone}`}>{row.statusText}</div>
                                    </div>
                                  ))}
                                  {cliproxySubscriptionsVm.moreCount > 0 ? (
                                    <div className="pl-4 text-slate-400">…and {cliproxySubscriptionsVm.moreCount} more</div>
                                  ) : null}
                                </div>
                              ) : cliproxySubscriptionsVm?.kind === 'provider' ? (
                                <div className="mt-2 flex flex-col gap-2">
                                  {cliproxySubscriptionsVm.groups.map((g) => (
                                    <div key={g.key} className="mt-2">
                                      <div className="flex items-center justify-between gap-2 text-slate-400">
                                        <span className="font-mono tabular-nums">{g.label}</span>
                                        <span className="text-[10px]">{g.meta}</span>
                                      </div>
                                      <div className="mt-1 pl-2 border-l border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1">
                                        {g.rows.map((row) => (
                                          <div key={row.key} className="flex items-center justify-between gap-2 font-mono tabular-nums">
                                            <span className="truncate">
                                              {row.primary}{row.count > 1 ? ` ×${row.count}` : ''}
                                            </span>
                                            <span className={row.statusTone}>{row.statusText}</span>
                                          </div>
                                        ))}
                                        {g.moreCount > 0 ? (
                                          <div className="text-slate-400">…and {g.moreCount} more</div>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null
                            )}
                            {cliproxyInfo.cliproxyAuthStatus ? (
                              <div className="text-amber-600 dark:text-amber-400">auth {cliproxyInfo.cliproxyAuthStatus}</div>
                            ) : null}
                        </div>
                      </CollapsibleSection>
                    ) : null}
                    {cliproxyInfo.cliproxyAuthFiles?.length ? (
                      <CollapsibleSection
                        title="Quotas"
                        open={showCliproxyQuotas}
                        onToggle={() => setShowCliproxyQuotas((prev) => !prev)}
                      >
                        <CliproxyQuotasPanel
                          authFiles={cliproxyInfo.cliproxyAuthFiles ?? []}
                          quotas={cliproxyQuotas}
                          showAverage={showQuotaSums}
                          onToggleMode={() => setShowQuotaSums((prev) => !prev)}
                          onRefresh={refreshCliproxyQuotas}
                          formatMonthDayTime={formatMonthDayTime}
                        />
                      </CollapsibleSection>
                    ) : null}
                    {cliproxyInfo.cliproxyUsage?.requestsByDay?.length ? (
                      <CollapsibleSection
                        title="Usage details"
                        open={showCliproxyUsageDetails}
                        onToggle={() => setShowCliproxyUsageDetails((prev) => !prev)}
                      >
                        <div className="mt-1 flex flex-col gap-1">
                            <div className="font-mono tabular-nums">
                              req/day:{' '}
                              {cliproxyInfo.cliproxyUsage.requestsByDay
                                .map((item) => `${item.day.slice(5)}=${item.requests}`)
                                .join(' ')}
                            </div>
                            {cliproxyInfo.cliproxyUsage.tokensByDay?.length ? (
                              <div className="font-mono tabular-nums">
                                tok/day:{' '}
                                {cliproxyInfo.cliproxyUsage.tokensByDay
                                  .map((item) => `${item.day.slice(5)}=${item.tokens}`)
                                  .join(' ')}
                              </div>
                            ) : null}
                        </div>
                      </CollapsibleSection>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </form>

          {connectionState.status === 'connected' && (!isChatGpt || (chatGptAccount.status?.connected && chatGptAccount.status.login?.state !== 'pending')) && (
            <div className="mb-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Model</label>
                <Button
                  onClick={() => setShowFilters(!showFilters)}
                  variant="ghost"
                  className="h-auto px-1 py-0 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Filter size={10} /> {showFilters ? 'Hide filters' : 'Filters'}
                </Button>
              </div>

              {showFilters && (
                <div className="mb-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded text-xs grid grid-cols-2 gap-2 border border-slate-100 dark:border-slate-700 dark:text-slate-300">
                    {(isAgent || isCliproxy) && familyOptions.length > 0 && (
                      <div className="col-span-2">
                        <label className="block text-[10px] uppercase text-slate-400 mb-1">Family</label>
                        <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => updateProxyFilters({ family: '' })}
                          className={`px-2 py-1 rounded border text-[11px] ${
                            !(proxyFilters?.family ?? '')
                              ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          All ({baseFilteredModels.length})
                        </button>
                        {familyPills.map(({ family, label, count }) => {
                          const selected = (proxyFilters?.family ?? '') === family;
                          return (
                            <button
                              key={family}
                              type="button"
                              onClick={() => updateProxyFilters({ family })}
                              className={`px-2 py-1 rounded border text-[11px] ${
                                selected
                                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              {label} ({count})
                            </button>
                          );
                        })}
                        </div>
                      </div>
                    )}
                    {(isOpenRouter || isOpenCodeGo || isChatGpt) && (
                      <div className="col-span-2">
                        <label className="block text-[10px] uppercase text-slate-400 mb-1">Vendor</label>
                      <Select
                        value={activeVendor}
                        onChange={(e) => {
                          if (isChatGpt) updateChatGptVendor(e.target.value);
                          else if (isOpenCodeGo) updateOpenCodeGoVendor(e.target.value);
                          else updateOpenRouterFilters({ vendor: e.target.value });
                        }}
                        size="sm"
                      >
                        <option value="">
                          All vendors ({baseFilteredModels.length})
                        </option>
                        {vendorOptions.map(({ vendor, count }) => (
                          <option key={vendor} value={vendor}>
                            {vendor} ({count})
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  {isOpenRouter && (
                    <div className="col-span-2">
                      <label className="block text-[10px] uppercase text-slate-400 mb-1">Min Context Window</label>
                      <Select
                        value={openRouterFilters.minContextWindow}
                        onChange={(e) => updateOpenRouterFilters({ minContextWindow: Number(e.target.value) })}
                        size="sm"
                      >
                        <option value="0">Any size</option>
                        <option value="32000">32k+</option>
                        <option value="64000">64k+</option>
                        <option value="128000">128k+</option>
                        <option value="200000">200k+</option>
                        <option value="1000000">1M+</option>
                      </Select>
                    </div>
                  )}
                  {isOpenRouter && (
                    <>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={openRouterFilters.freeOnly}
                          onChange={(e) => updateOpenRouterFilters({ freeOnly: e.target.checked })}
                        />
                        Free only
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={openRouterFilters.testedOnly}
                          onChange={(e) => updateOpenRouterFilters({ testedOnly: e.target.checked })}
                        />
                        Tested only
                      </label>
                    </>
                  )}
                </div>
              )}

              <Select
                value={aiConfig.selectedModelId}
                onChange={(e) => updateSelectedModel(e.target.value)}
                size="md"
                className="p-2"
              >
                <option value="" disabled>Select a model...</option>
                {filteredModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {getModelDisplayName(m)}
                    {m.contextLength ? ` (${formatContextLength(m.contextLength)})` : ''}
                    {m.isFree ? ' (Free)' : ''}
                  </option>
                ))}
              </Select>
              {isCliproxy && selectedModel ? (
                <div className="mt-1 text-[10px] leading-tight text-slate-400 break-all">
                  <div className="font-mono tabular-nums">id: {selectedModel.id}</div>
                  {selectedModel.ownedBy ? (
                    <div className="font-mono tabular-nums">owner: {selectedModel.ownedBy}</div>
                  ) : null}
                  {selectedModel.vendor ? (
                    <div className="font-mono tabular-nums">vendor: {selectedModel.vendor}</div>
                  ) : null}
                  {antigravityBucketLabel ? (
                    <div className="font-mono tabular-nums">bucket: {antigravityBucketLabel}</div>
                  ) : null}
                  {matchingNameModels.length ? (
                    <div className="font-mono tabular-nums">
                      also: {matchingNameModels.map((m) => m.id).join(', ')}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {showReasoningControl && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="text-xs text-slate-500 dark:text-slate-400">Reasoning</label>
              <Select
                value={reasoningEffort}
                onChange={(e) => updateReasoningEffort(e.target.value)}
                size="sm"
                className="w-[160px]"
              >
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">XHigh</option>
              </Select>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="text-xs text-slate-500 dark:text-slate-400">Timeout (s)</label>
            <Input
              type="number"
              min={5}
              max={300}
              value={timeoutSeconds}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (Number.isNaN(parsed)) return;
                const clamped = Math.max(5, Math.min(300, Math.floor(parsed)));
                onLLMTimeoutMsChange(clamped * 1000);
              }}
              size="md"
              className="w-24"
            />
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 text-[10px] text-slate-400 text-center">
            {isChatGpt
              ? 'ChatGPT sign-in is managed by the local Agent. Account credentials stay on this device, outside browser settings and project backups.'
              : isOpenCodeGo
              ? 'Your Go key is stored in this browser, outside project backups. Requests go through this app to OpenCode Go.'
              : 'Your API key is stored locally in your browser. Requests go directly to your provider.'}
          </div>
        </div>
      )}
    </div>
  );
};

export default AiControlPlaneMenu;
