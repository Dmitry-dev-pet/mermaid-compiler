import { describe, expect, it, vi } from 'vitest';
import { parseNotebookCountFromIntent, parseNotebookCountFromText, requestNotebookPlan } from './useNotebookBuild';
import { NOTEBOOK_PLAN_SCHEMA_VERSION } from '../../services/notebookPlanSchema';
import { DEFAULT_AI_CONFIG } from '../../constants';
import { TimeoutError } from '../../services/llmTimeout';

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
  it.each(['opencode-go', 'chatgpt'] as const)('aborts a slow %s planner call without timeout or count retries', async (provider) => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const runPlanner = vi.fn((_message: unknown, signal?: AbortSignal | null) => {
        if (!signal) throw new Error('Expected a cancellable planner request');
        signals.push(signal);
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      });
      const request = requestNotebookPlan({
        aiConfig: { ...DEFAULT_AI_CONFIG, provider },
        sessionId: 'mermaid:project-123:main',
        modelParams: null,
        prompt: 'Build one diagram',
        requestedN: 1,
        docs: '',
        language: 'English',
        timeoutMs: 100,
        addMessage: () => ({ id: 'msg', role: 'assistant', content: '', timestamp: 1 }),
        runPlanner,
      });
      const rejection = expect(request).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(runPlanner).toHaveBeenCalledTimes(1);
      expect(signals[0].aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

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
        selectedModelIdByProvider: { openrouter: '', agent: '', cliproxy: '', 'opencode-go': '', chatgpt: '' },
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
          'opencode-go': { vendor: '' },
          chatgpt: { vendor: '' },
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
        selectedModelIdByProvider: { openrouter: '', agent: '', cliproxy: '', 'opencode-go': '', chatgpt: '' },
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
          'opencode-go': { vendor: '' },
          chatgpt: { vendor: '' },
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
        selectedModelIdByProvider: { openrouter: '', agent: '', cliproxy: '', 'opencode-go': '', chatgpt: '' },
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
          'opencode-go': { vendor: '' },
          chatgpt: { vendor: '' },
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
