import React from 'react';
import { useFloatingTooltip } from '../../hooks/useFloatingTooltip';
import type { AIConfig, ConnectionState } from '../../types';
import type { CliproxyManagementInfo } from '../../hooks/core/useCliproxyManagementInfo';
import type { CliproxyQuotasState } from '../../services/cliproxy/quotas/types';
import type { AgentCodexQuotaState } from '../../hooks/core/useAgentCodexQuota';
import type { AgentGeminiQuotaState } from '../../hooks/core/useAgentGeminiQuota';
import type { CliproxyAuthFile } from '../../services/cliproxy/types';
import { buildModelTooltip, getModelFamilyKey, type ModelFamilyKey } from '../../utils/aiModelUtils';
import { buildQuotaBadges, type QuotaBadge } from '../../utils/aiQuotaBadges';
import { AiAvatar, getAvatarForKey, type AvatarKey, type AvatarTooltipHandlers } from '../ai/AiAvatar';
import { getModelDisplayName } from '../../utils/aiModelDisplayName';
import { getCliproxyViaProviders, getProviderBadges } from '../../utils/aiStatusPresentation';


const renderQuotaBadge = (badge: QuotaBadge, tooltipHandlers: AvatarTooltipHandlers) => {
  if (badge.percent === null) return null;
  const clamped = Math.max(0, Math.min(100, badge.percent));
  const tone = clamped >= 60 ? '#10b981' : clamped >= 20 ? '#f59e0b' : '#ef4444';
  return (
    <span className="inline-flex items-center gap-1" {...tooltipHandlers}>
      <span
        className="inline-flex h-3.5 w-3.5 rounded-full"
        style={{ background: `conic-gradient(${tone} ${clamped}%, rgba(148, 163, 184, 0.3) 0)` }}
      >
        <span className="m-[2px] flex-1 rounded-full bg-white dark:bg-slate-900" />
      </span>
      <span className="text-[9px] font-mono tabular-nums text-slate-400">{Math.round(clamped)}%</span>
    </span>
  );
};

const formatContextLength = (value?: number) => {
  if (!value || value <= 0) return '';
  if (value >= 1_000_000) {
    const rounded = Math.round(value / 1_000_000);
    return `${rounded}m`;
  }
  const rounded = Math.round(value / 1000);
  return `${rounded}k`;
};

export type AiStatusLineProps = {
  aiConfig: AIConfig;
  connectionState: ConnectionState;
  cliproxyInfo: CliproxyManagementInfo;
  cliproxyQuotas: CliproxyQuotasState;
  agentCodexQuota: AgentCodexQuotaState;
  agentGeminiQuota: AgentGeminiQuotaState;
};

export const AiStatusLine: React.FC<AiStatusLineProps> = ({
  aiConfig,
  connectionState,
  cliproxyInfo,
  cliproxyQuotas,
  agentCodexQuota,
  agentGeminiQuota,
}) => {
  const { showTooltip, hideTooltip, portal: tooltipPortal } = useFloatingTooltip();

  if (connectionState.status === 'disconnected') {
    return <>AI: Not connected{tooltipPortal}</>;
  }
  if (connectionState.status === 'connecting') {
    return <>AI: Connecting...{tooltipPortal}</>;
  }
  if (connectionState.status === 'failed') {
    return <>AI: Connection Failed{tooltipPortal}</>;
  }
  if (!aiConfig.selectedModelId) {
    return <>AI: Connected · Select model{tooltipPortal}</>;
  }

  const model = connectionState.availableModels.find((m) => m?.id === aiConfig.selectedModelId);
  const modelName = model ? getModelDisplayName(model) : aiConfig.selectedModelId;
  const contextLabel = model?.contextLength ? ` (${formatContextLength(model.contextLength)})` : '';

  const family = getModelFamilyKey({
    id: aiConfig.selectedModelId,
    vendor: model?.vendor ?? null,
    name: model?.name ?? null,
  });
  const modelAvatar = getAvatarForKey(family);
  const viaProviders = aiConfig.provider === 'cliproxy'
    ? getCliproxyViaProviders({
      selectedModelId: aiConfig.selectedModelId,
      modelVendor: model?.vendor ?? null,
      modelName: model?.name ?? null,
      modelOwnedBy: model?.ownedBy ?? null,
      cliproxyAuthFiles: (cliproxyInfo.cliproxyAuthFiles ?? []) as CliproxyAuthFile[],
    })
    : [];
  const viaProvidersLabel = viaProviders.join('+');
  const providerKeys = getProviderBadges({
    aiProvider: aiConfig.provider,
    family,
    model: model ?? null,
    cliproxyAuthFiles: (cliproxyInfo.cliproxyAuthFiles ?? []) as CliproxyAuthFile[],
  }) as AvatarKey[];
  const providerAvatars = providerKeys.map((key) => getAvatarForKey(key));
  const tooltipHandlers = (label: string): AvatarTooltipHandlers => ({
    onMouseEnter: (event) => showTooltip(event, label),
    onMouseMove: (event) => showTooltip(event, label),
    onMouseLeave: hideTooltip,
  });
  const ownerOverride = model?.ownedBy === 'antigravity' && viaProviders.length > 1
    ? `via ${viaProviders.join(' + ')}`
    : (model?.ownedBy ?? null);
  const modelTooltip = buildModelTooltip({
    modelName,
    vendor: model?.vendor ?? null,
    owner: ownerOverride,
  });
  const providerList = providerAvatars.map((avatar) => avatar.label).join(' + ') || '-';
  const quotaBadges = buildQuotaBadges({
    provider: aiConfig.provider,
    selectedModelId: aiConfig.selectedModelId,
    modelName: model?.name ?? null,
    family,
    viaProviders: viaProvidersLabel,
    cliproxyAuthFiles: (cliproxyInfo.cliproxyAuthFiles ?? []) as CliproxyAuthFile[],
    cliproxyQuotas,
    agentCodexQuota,
    agentGeminiQuota,
  });
  const quotasText = quotaBadges.length
    ? quotaBadges
        .map((badge) => `${badge.label}: ${badge.percent === null ? '-' : `${Math.round(badge.percent)}%`} avg`)
        .join('\n')
    : 'none';
  const fullTooltip = `${modelTooltip}\nProviders: ${providerList}\nQuotas:\n${quotasText}`;
  const fullHandlers: AvatarTooltipHandlers = {
    onMouseEnter: (event) => showTooltip(event, fullTooltip),
    onMouseMove: (event) => showTooltip(event, fullTooltip),
    onMouseLeave: hideTooltip,
  };

  return (
    <>
      {tooltipPortal}
      <span className="inline-flex items-center gap-1 min-w-0 whitespace-nowrap" {...fullHandlers}>
        {providerAvatars.map((avatar, index) => (
          <React.Fragment key={`${avatar.label}-${index}`}>
            <AiAvatar avatar={avatar} tooltipHandlers={fullHandlers} />
          </React.Fragment>
        ))}
        <AiAvatar avatar={modelAvatar} tooltipHandlers={fullHandlers} />
        <span className="truncate">
          {modelName}{contextLabel}
        </span>
        {quotaBadges.length > 0 ? (
          <span className="ml-1 inline-flex items-center gap-1">
            {quotaBadges.map((badge) => renderQuotaBadge(badge, fullHandlers))}
          </span>
        ) : null}
      </span>
    </>
  );
};
