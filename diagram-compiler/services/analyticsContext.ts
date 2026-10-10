import type { AIConfig, AppState } from '../types';
import type { AnalyticsContext, DocsUsageSummary } from './analyticsService';
import { resolveModelParams } from './llm/modelParams';

export const buildAnalyticsContext = (args: {
  aiConfig: AIConfig;
  appState: AppState;
  diagramType: string | null;
  docsUsage?: DocsUsageSummary;
  modelParams?: AnalyticsContext['modelParams'] | null;
}): AnalyticsContext => {
  const modelParams = args.aiConfig.provider === 'chatgpt' ? {} : resolveModelParams(args.modelParams);

  return {
    provider: args.aiConfig.provider,
    model: args.aiConfig.selectedModelId || null,
    modelParams,
    modelFilters: (args.aiConfig.filtersByProvider[args.aiConfig.provider] as unknown as Record<string, unknown>) ?? null,
    diagramType: args.diagramType,
    language: args.appState.language ?? null,
    analyzeLanguage: args.appState.analyzeLanguage ?? null,
    docsUsage: args.docsUsage,
  };
};
