import { describe, expect, it, vi } from 'vitest';
import { parseNotebookCountFromIntent, parseNotebookCountFromText, requestNotebookPlan } from './useNotebookBuild';
import { NOTEBOOK_PLAN_SCHEMA_VERSION } from '../../services/notebookPlanSchema';

const buildRawPlan = (count: number) => {
  const diagrams = Array.from({ length: count }, (_, index) => ({
    title: `Diagram ${index + 1}`,
    diagramType: 'flowchart',
    description: `Description ${index + 1}`,
    buildPrompt: `build ${index + 1}`,
  }));
  return JSON.stringify({
    schemaVersion: NOTEBOOK_PLAN_SCHEMA_VERSION,
    resolvedN: count,
    diagrams,
  });
};

describe('requestNotebookPlan', () => {
  it('retries when planner returns wrong count and succeeds on next attempt', async () => {
    const runPlanner = vi
      .fn()
      .mockResolvedValueOnce(buildRawPlan(3))
      .mockResolvedValueOnce(buildRawPlan(14));

    const plan = await requestNotebookPlan({
      aiConfig: {
        provider: 'openrouter',
        openRouterKey: '',
        openRouterEndpoint: '',
        agentToken: '',
        agentEndpoint: '',
        proxyKey: '',
        proxyManagementKey: '',
        proxyEndpoint: '',
        selectedModelId: '',
        selectedModelIdByProvider: { openrouter: '', agent: '', cliproxy: '' },
        filtersByProvider: {
          openrouter: {
            vendor: '',
            freeOnly: true,
            testedOnly: true,
            experimental: false,
            minContextWindow: 0,
          },
          agent: {
            family: '',
          },
          cliproxy: {
            family: '',
          },
        },
      },
      modelParams: null,
      prompt: 'Build 14 diagrams',
      requestedN: 14,
      docs: '',
      language: 'English',
      addMessage: () => ({
        id: 'msg',
        role: 'assistant',
        content: 'ok',
        timestamp: Date.now(),
        mode: 'build',
      }),
      runPlanner,
    });

    expect(runPlanner).toHaveBeenCalledTimes(2);
    expect(plan.diagrams).toHaveLength(14);
  });

  it('throws after retries when planner keeps returning wrong count', async () => {
    const runPlanner = vi.fn().mockResolvedValue(buildRawPlan(2));

    await expect(requestNotebookPlan({
      aiConfig: {
        provider: 'openrouter',
        openRouterKey: '',
        openRouterEndpoint: '',
        agentToken: '',
        agentEndpoint: '',
        proxyKey: '',
        proxyManagementKey: '',
        proxyEndpoint: '',
        selectedModelId: '',
        selectedModelIdByProvider: { openrouter: '', agent: '', cliproxy: '' },
        filtersByProvider: {
          openrouter: {
            vendor: '',
            freeOnly: true,
            testedOnly: true,
            experimental: false,
            minContextWindow: 0,
          },
          agent: {
            family: '',
          },
          cliproxy: {
            family: '',
          },
        },
      },
      modelParams: null,
      prompt: 'Build 14 diagrams',
      requestedN: 14,
      docs: '',
      language: 'English',
      addMessage: () => ({
        id: 'msg',
        role: 'assistant',
        content: 'ok',
        timestamp: Date.now(),
        mode: 'build',
      }),
      runPlanner,
    })).rejects.toThrow(/expected 14/i);
  });

  it('retries when planner returns invalid JSON and succeeds on next attempt', async () => {
    const runPlanner = vi
      .fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(buildRawPlan(2));

    const plan = await requestNotebookPlan({
      aiConfig: {
        provider: 'openrouter',
        openRouterKey: '',
        openRouterEndpoint: '',
        agentToken: '',
        agentEndpoint: '',
        proxyKey: '',
        proxyManagementKey: '',
        proxyEndpoint: '',
        selectedModelId: '',
        selectedModelIdByProvider: { openrouter: '', agent: '', cliproxy: '' },
        filtersByProvider: {
          openrouter: {
            vendor: '',
            freeOnly: true,
            testedOnly: true,
            experimental: false,
            minContextWindow: 0,
          },
          agent: {
            family: '',
          },
          cliproxy: {
            family: '',
          },
        },
      },
      modelParams: null,
      prompt: 'Build two diagrams',
      requestedN: null,
      docs: '',
      language: 'English',
      addMessage: () => ({
        id: 'msg',
        role: 'assistant',
        content: 'ok',
        timestamp: Date.now(),
        mode: 'build',
      }),
      runPlanner,
    });

    expect(runPlanner).toHaveBeenCalledTimes(2);
    expect(plan.diagrams).toHaveLength(2);
  });
});

describe('parseNotebookCountFromText', () => {
  it('extracts count from english phrasing', () => {
    expect(parseNotebookCountFromText('Need 14 diagrams for this')).toBe(14);
    expect(parseNotebookCountFromText('diagram count: 7')).toBe(7);
    expect(parseNotebookCountFromText('N=5')).toBe(5);
  });

  it('extracts count from russian phrasing', () => {
    expect(parseNotebookCountFromText('нужно 12 диаграмм')).toBe(12);
    expect(parseNotebookCountFromText('кол-во: 3')).toBe(3);
  });

  it('returns null when no count is present', () => {
    expect(parseNotebookCountFromText('build some diagrams')).toBeNull();
  });
});

describe('parseNotebookCountFromIntent', () => {
  it('extracts count from diagrams section', () => {
    const sample = [
      '## Summary',
      '- text',
      '',
      '## Diagrams',
      '1. One — flowchart — goal',
      '2. Two — er — goal',
      '3. Three — sequence — goal',
      '',
      '## Glossary',
    ].join('\n');
    expect(parseNotebookCountFromIntent(sample)).toBe(3);
  });

  it('extracts count from russian diagrams section', () => {
    const sample = [
      '## Диаграммы',
      '- Первая — flowchart',
      '- Вторая — er',
      '',
      '## Ограничения',
    ].join('\n');
    expect(parseNotebookCountFromIntent(sample)).toBe(2);
  });

  it('returns null when diagrams section missing', () => {
    expect(parseNotebookCountFromIntent('No sections here')).toBeNull();
  });
});
