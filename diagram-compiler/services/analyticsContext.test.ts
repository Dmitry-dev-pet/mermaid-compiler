import { describe, expect, it } from 'vitest';
import type { AIConfig, AppState } from '../types';
import { buildAnalyticsContext } from './analyticsContext';
import { DEFAULT_MODEL_PARAMS } from './llm/modelParams';
import { LLM_TIMEOUT_MS } from '../constants';

const baseAIConfig: AIConfig = {
  provider: 'openrouter',
  openRouterKey: '',
  openRouterEndpoint: '',
  agentToken: '',
  agentEndpoint: '',
  proxyKey: '',
  proxyManagementKey: '',
  proxyEndpoint: '',
  selectedModelId: 'test-model',
  selectedModelIdByProvider: { openrouter: 'test-model', agent: '', cliproxy: 'proxy-model', 'opencode-go': '' },
  filtersByProvider: {
    openrouter: {
      vendor: 'any',
      freeOnly: false,
      testedOnly: false,
      experimental: false,
      minContextWindow: 0,
    },
    agent: { family: '' },
    cliproxy: { family: '' },
    'opencode-go': { vendor: '' },
  },
};

const baseAppState: AppState = {
  diagramType: 'flowchart',
  mainDiagramTypes: ['flowchart', 'er', 'sequence'],
  columnWidths: [33, 34, 33],
  isResizing: null,
  isPreviewFullScreen: false,
  isScrollSyncEnabled: false,
  theme: 'darkPlus',
  language: 'auto',
  analyzeLanguage: 'auto',
  notebookBuildCount: null,
  llmTimeoutMs: LLM_TIMEOUT_MS,
  thinkingStyle: 'simple',
};

describe('buildAnalyticsContext', () => {
  it('uses DEFAULT_MODEL_PARAMS when modelParams absent', () => {
    const ctx = buildAnalyticsContext({
      aiConfig: baseAIConfig,
      appState: baseAppState,
      diagramType: 'flowchart',
    });

    expect(ctx.modelParams).toEqual(DEFAULT_MODEL_PARAMS);
  });

  it('uses provided modelParams when present', () => {
    const ctx = buildAnalyticsContext({
      aiConfig: baseAIConfig,
      appState: baseAppState,
      diagramType: 'sequence',
      modelParams: { temperature: 0.7, top_p: 0.9 },
    });

    expect(ctx.modelParams).toEqual({ temperature: 0.7, top_p: 0.9 });
    expect(ctx.diagramType).toBe('sequence');
  });

  it('includes docsUsage when provided', () => {
    const ctx = buildAnalyticsContext({
      aiConfig: baseAIConfig,
      appState: baseAppState,
      diagramType: 'flowchart',
      docsUsage: {
        total: 10,
        included: 2,
        excluded: 8,
        includedPaths: ['a.md', 'b.md'],
        excludedPaths: ['c.md'],
      },
    });

    expect(ctx.docsUsage?.included).toBe(2);
    expect(ctx.docsUsage?.includedPaths).toEqual(['a.md', 'b.md']);
  });
});
