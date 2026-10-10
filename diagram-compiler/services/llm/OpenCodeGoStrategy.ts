import type { AIConfig, Message, Model, ModelParams } from '../../types';
import type { LLMProviderStrategy } from './LLMProviderStrategy';
import type { LLMRequestContext } from './types';
import { buildSystemPrompt } from './prompts';
import { deriveModelVendor } from './modelVendor';
import { resolveModelParams } from './modelParams';
import { OpenCodeGoError, requestOpenCodeGo } from './openCodeGoClient';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class OpenCodeGoStrategy implements LLMProviderStrategy {
  async fetchModels(): Promise<Model[]> {
    const result = await requestOpenCodeGo({ operation: 'models' }, 'mermaid:model-catalog');
    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new OpenCodeGoError(502, 'OpenCode Go returned an invalid model list.');
    }
    return result.data.filter(isRecord).filter((model) => typeof model.id === 'string').map((model) => {
      const id = model.id as string;
      const name = typeof model.name === 'string' ? model.name : id;
      return {
        id,
        name,
        contextLength: typeof model.context_length === 'number' ? model.context_length : 0,
        vendor: deriveModelVendor(id, name),
        ownedBy: 'opencode-go',
        isFree: false,
      };
    });
  }

  private async complete(
    mode: Parameters<typeof buildSystemPrompt>[0],
    messages: Message[],
    config: AIConfig,
    context: LLMRequestContext,
    modelParams?: ModelParams | null,
    signal?: AbortSignal | null,
  ): Promise<string> {
    if (!config.selectedModelId) throw new OpenCodeGoError(400, 'Choose an OpenCode Go model in AI settings.');
    if (!context.sessionId) throw new OpenCodeGoError(400, 'Open a project before using OpenCode Go.');
    const systemPrompt = buildSystemPrompt(mode, {
      diagramType: context.diagramType ?? 'auto',
      allowedDiagramTypes: context.allowedDiagramTypes,
      docsContext: context.docsContext,
      language: context.language,
      thinkingStyle: context.thinkingStyle,
    });
    const result = await requestOpenCodeGo({
      operation: 'chat',
      request: {
        ...resolveModelParams(modelParams),
        model: config.selectedModelId,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(({ role, content }) => ({ role, content })),
        ],
      },
    }, context.sessionId, signal);
    const choice = isRecord(result) && Array.isArray(result.choices) ? result.choices[0] : null;
    const message = isRecord(choice) ? choice.message : null;
    if (!isRecord(message) || typeof message.content !== 'string' || !message.content.trim()) {
      throw new OpenCodeGoError(502, 'OpenCode Go returned no text. Please retry or choose another supported model.');
    }
    return message.content;
  }

  generateDiagram(messages: Message[], config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('generate', messages, config, context, modelParams, signal);
  }

  fixDiagram(code: string, errorMessage: string, config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('fix', [{ id: 'fix-req', role: 'user', timestamp: Date.now(), content: `Code:\n\n${code}\n\nError: ${errorMessage}\n\nFix it.` }], config, context, modelParams, signal);
  }

  chat(messages: Message[], config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('chat', messages, config, context, modelParams, signal);
  }

  chatDiagram(messages: Message[], config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('chat_diagram', messages, config, context, modelParams, signal);
  }

  chatNotebook(messages: Message[], config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('chat_notebook', messages, config, context, modelParams, signal);
  }

  analyzeDiagram(code: string, config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('analyze', [{ id: 'analyze-req', role: 'user', timestamp: Date.now(), content: `Analyze and explain the following Mermaid code:\n\n\`\`\`mermaid\n${code}\n\`\`\`` }], config, context, modelParams, signal);
  }

  planNotebook(messages: Message[], config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('plan_notebook', messages, config, context, modelParams, signal);
  }

  summarizeBuild(messages: Message[], config: AIConfig, context: LLMRequestContext, modelParams?: ModelParams | null, signal?: AbortSignal | null): Promise<string> {
    return this.complete('summary', messages, config, context, modelParams, signal);
  }
}
