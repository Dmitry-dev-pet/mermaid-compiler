import type { AIConfig, Message, Model, ModelParams } from "../types";
import type { LLMRequestContext } from "./llm/types";
import { LLMProviderStrategy } from "./llm/LLMProviderStrategy";
import { OpenRouterStrategy } from "./llm/OpenRouterStrategy";
import { CliproxyStrategy } from "./llm/CliproxyStrategy";
import { OpenCodeGoStrategy } from "./llm/OpenCodeGoStrategy";
import { ChatGptStrategy } from "./llm/ChatGptStrategy";

// Instantiate strategies
const openRouterStrategy = new OpenRouterStrategy();
const cliproxyStrategy = new CliproxyStrategy();
const openCodeGoStrategy = new OpenCodeGoStrategy();
const chatGptStrategy = new ChatGptStrategy();

/**
 * Selects the appropriate LLM strategy based on the AIConfig provider.
 * @param config The AI configuration.
 * @returns The selected LLM provider strategy.
 * @throws Error if an unsupported provider is specified.
 */
const getStrategy = (config: AIConfig): LLMProviderStrategy => {
  switch (config.provider) {
    case "openrouter":
      return openRouterStrategy;
    case "agent":
    case "cliproxy":
      return cliproxyStrategy;
    case "opencode-go":
      return openCodeGoStrategy;
    case "chatgpt":
      return chatGptStrategy;
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
};

export const fetchModels = async (config: AIConfig): Promise<Model[]> => {
  const strategy = getStrategy(config);
  return strategy.fetchModels(config);
};

export const generateDiagram = async (
  messages: Message[],
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.generateDiagram(
    messages,
    config,
    context,
    modelParams,
    signal,
  );
};

export const fixDiagram = async (
  code: string,
  error: string,
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.fixDiagram(
    code,
    error,
    config,
    context,
    modelParams,
    signal,
  );
};

export const chat = async (
  messages: Message[],
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.chat(
    messages,
    config,
    context,
    modelParams,
    signal,
  );
};

export const chatDiagram = async (
  messages: Message[],
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.chatDiagram(
    messages,
    config,
    context,
    modelParams,
    signal,
  );
};

export const analyzeDiagram = async (
  code: string,
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.analyzeDiagram(
    code,
    config,
    context,
    modelParams,
    signal,
  );
};

export const planNotebook = async (
  messages: Message[],
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.planNotebook(
    messages,
    config,
    context,
    modelParams,
    signal,
  );
};

export const summarizeBuild = async (
  messages: Message[],
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.summarizeBuild(
    messages,
    config,
    context,
    modelParams,
    signal,
  );
};

export const chatNotebook = async (
  messages: Message[],
  config: AIConfig,
  context: LLMRequestContext,
  modelParams?: ModelParams | null,
  signal?: AbortSignal | null,
): Promise<string> => {
  const strategy = getStrategy(config);
  return strategy.chatNotebook(
    messages,
    config,
    context,
    modelParams,
    signal,
  );
};
