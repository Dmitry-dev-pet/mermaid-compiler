import type { AIConfig, Message, Model, ModelParams } from '../../types';
import type { LLMProviderStrategy } from './LLMProviderStrategy';
import type { LLMRequestContext } from './types';
import { buildSystemPrompt } from './prompts';
import { ChatGptAgentError, generateChatGpt, getChatGptModelCatalog } from '../chatGptClient';

export class ChatGptStrategy implements LLMProviderStrategy {
  async fetchModels(): Promise<Model[]> {
    return (await getChatGptModelCatalog()).models;
  }

  private async complete(
    mode: Parameters<typeof buildSystemPrompt>[0],
    messages: Message[],
    config: AIConfig,
    context: LLMRequestContext,
    modelParams?: ModelParams | null,
    signal?: AbortSignal | null,
  ): Promise<string> {
    // The subscription Responses preview does not support the editor's sampling/output settings.
    void modelParams;
    if (!config.selectedModelId) throw new ChatGptAgentError('model_required', 'Choose a ChatGPT model in AI settings.', 400);
    if (!context.chatGptAccountId) {
      throw new ChatGptAgentError('login_required', 'Connect your ChatGPT account and load its models in AI settings.', 401);
    }
    const systemPrompt = buildSystemPrompt(mode, {
      diagramType: context.diagramType ?? 'auto',
      allowedDiagramTypes: context.allowedDiagramTypes,
      docsContext: context.docsContext,
      language: context.language,
      thinkingStyle: context.thinkingStyle,
    });
    return generateChatGpt({
      model: config.selectedModelId,
      accountId: context.chatGptAccountId,
      sessionId: context.sessionId,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(({ role, content }) => ({ role, content })),
      ],
    }, signal);
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
