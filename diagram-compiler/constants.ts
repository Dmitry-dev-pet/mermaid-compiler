import { AIConfig, AppState, MermaidState } from './types';
import { MAIN_DIAGRAM_TYPES } from './utils/diagramTypes';

export const MERMAID_VERSION = "v11.12.2";

export const AUTO_FIX_MAX_ATTEMPTS = 5;
export const BUILD_MAX_ATTEMPTS = 3;
export const NOTEBOOK_DIAGRAM_MAX_ATTEMPTS = 3;
export const LLM_TIMEOUT_MS = 40_000;
export const LLM_TIMEOUT_RETRIES = 3;

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'openrouter',
  openRouterKey: '',
  openRouterEndpoint: import.meta.env.VITE_OPEN_ROUTER_ENDPOINT ?? 'https://openrouter.ai/api/v1',
  agentToken: 'test',
  agentEndpoint: import.meta.env.VITE_AGENT_ENDPOINT ?? 'http://127.0.0.1:8787',
  proxyKey: '',
  proxyManagementKey: import.meta.env.VITE_PROXY_MANAGEMENT_KEY ?? '',
  proxyEndpoint: import.meta.env.VITE_PROXY_ENDPOINT ?? 'http://localhost:8317',
  selectedModelId: '',
  selectedModelIdByProvider: {
    openrouter: '',
    agent: '',
    cliproxy: '',
    'opencode-go': '',
    chatgpt: '',
  },
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
    'opencode-go': {
      vendor: '',
    },
    chatgpt: {
      vendor: '',
    },
  },
};

export const DEFAULT_APP_STATE: AppState = {
  diagramType: 'auto',
  mainDiagramTypes: [...MAIN_DIAGRAM_TYPES],
  columnWidths: [25, 40, 35],
  isResizing: null,
  isPreviewFullScreen: false,
  isScrollSyncEnabled: false,
  theme: 'lightPlus',
  language: 'auto',
  analyzeLanguage: 'auto',
  notebookBuildCount: null,
  llmTimeoutMs: LLM_TIMEOUT_MS,
  thinkingStyle: 'simple',
};

export const DEFAULT_MERMAID_STATE: MermaidState = {
  code: '',
  isValid: true,
  lastValidCode: '',
  source: 'user',
  status: 'empty',
};

// Simple initial help text for the chat
export const INITIAL_CHAT_MESSAGE = "Describe the diagram you want to build. I'll help you structure it.";

export const MOCK_MODELS = [
  { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (Free)', isFree: true, contextLength: 128000 },
  { id: 'google/gemini-2.0-flash-lite-preview-02-05:free', name: 'Gemini Flash Lite 2.0 (Free)', isFree: true, contextLength: 32000 },
  { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (Free)', isFree: true, contextLength: 32000 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', isFree: false, contextLength: 128000 },
];
