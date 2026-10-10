export type Provider = 'openrouter' | 'agent' | 'cliproxy' | 'opencode-go' | 'chatgpt';

export type DiagramType =
  'auto'
  | 'architecture'
  | 'block'
  | 'c4'
  | 'class'
  | 'er'
  | 'flowchart'
  | 'gantt'
  | 'gitGraph'
  | 'kanban'
  | 'mindmap'
  | 'packet'
  | 'pie'
  | 'quadrantChart'
  | 'radar'
  | 'requirementDiagram'
  | 'sequence'
  | 'sankey'
  | 'state'
  | 'timeline'
  | 'treemap'
  | 'userJourney'
  | 'xychart'
  | 'zenuml';

export type ThinkingStyle = 'simple' | 'engineering' | 'strict_c4';

export interface Model {
  id: string;
  name: string;
  contextLength?: number;
  isFree?: boolean;
  vendor?: string;
  ownedBy?: string;
}

export interface OpenRouterFilters {
  vendor: string;
  freeOnly: boolean;
  testedOnly: boolean;
  experimental: boolean;
  minContextWindow: number;
}

export interface CliproxyFilters {
  family: string;
}

export interface OpenCodeGoFilters {
  vendor: string;
}

export interface ChatGptFilters {
  vendor: string;
}

export type ProviderFilters = {
  openrouter: OpenRouterFilters;
  agent: CliproxyFilters;
  cliproxy: CliproxyFilters;
  'opencode-go': OpenCodeGoFilters;
  chatgpt: ChatGptFilters;
};

export interface AIConfig {
  provider: Provider;
  openRouterKey: string;
  openRouterEndpoint: string;
  agentToken: string;
  agentEndpoint: string;
  proxyKey: string;
  proxyManagementKey: string;
  proxyEndpoint: string;
  selectedModelId: string;
  selectedModelIdByProvider: Record<Provider, string>;
  filtersByProvider: ProviderFilters;
}

export type ModelParams = Record<string, number | string | boolean | null>;

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'failed';
  error?: string;
  availableModels: Model[];
  /** Account metadata for the active local connection, never persisted in AIConfig. */
  chatGptAccountId?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  mode?: 'chat' | 'build' | 'fix' | 'analyze' | 'system';
}

export type OperationPhase =
  | 'chat'
  | 'analyze'
  | 'planning'
  | 'build'
  | 'validate'
  | 'fix'
  | 'compile'
  | 'done'
  | 'error';

export type OperationLevel = 'info' | 'warn' | 'error';

export type OperationEvent = {
  id: string;
  opId: string;
  createdAt: number;
  phase: OperationPhase;
  level: OperationLevel;
  title: string;
  detail?: string;
  diagramType?: DiagramType;
  tooltip?: string;
  tooltipMessages?: string;
  tooltipDocs?: string;
  contextMeta?: {
    selectionLine?: string;
    inputsLine?: string;
    docsFiles?: string[];
    messageTokens?: number;
    docsTokens?: Array<{ file: string; tokens: number }>;
  };
  kind?: 'context' | 'planner' | 'block' | 'attempt' | 'status';
  contextScope?: 'planner' | 'build' | 'block' | 'chat' | 'analyze' | 'fix' | 'summary';
  blockIndex?: number;
  attempt?: { current: number; max: number };
  metrics?: { autoFix?: number; tokens?: number; durationMs?: number };
  error?: { code: string; message: string };
};

export type OperationKind = 'chat' | 'build' | 'analyze' | 'fix' | 'compile';

export type OperationLog = {
  id: string;
  contextId?: string;
  kind?: OperationKind;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  lastLLMStartedAt?: number;
  events: OperationEvent[];
};

export interface DiagramIntent {
  content: string;
  source: 'chat' | 'build' | 'fallback';
  updatedAt: number;
}

export type NotebookPlanGlossaryTerm = {
  term: string;
  meaning?: string;
  aliases?: string[];
};

export type NotebookPlanDiagram = {
  id?: string;
  order?: number;
  title: string;
  diagramType: DiagramType | 'other';
  goal?: string;
  description: string;
  buildPrompt: string;
  acceptance?: string[];
};

export type NotebookPlan = {
  schemaVersion: string;
  mode?: string;
  userRequest?: string;
  requestedN?: number | null;
  resolvedN: number;
  title?: string;
  glossary?: NotebookPlanGlossaryTerm[];
  diagrams: NotebookPlanDiagram[];
  notes?: string[];
};

export type DocsMode = 'chat' | 'build' | 'analyze' | 'fix' | 'plan';

export type SystemPromptRawByMode = Record<DocsMode, boolean>;
export type BuildDocsSystemPrompts = Record<DocsMode, { raw: string; redacted: string }>;

export type PromptPreviewMode = 'chat' | 'build' | 'analyze' | 'fix' | 'plan';
export type EditorTab =
  | 'code'
  | 'markdown_mermaid'
  | 'build_docs';

export interface LLMRequestPreview {
  mode: PromptPreviewMode;
  diagramType: DiagramType;
  language: string;
  systemPrompt: string;
  systemPromptRedacted?: string;
  docsContext: string;
  messages: Message[];
  error?: string;
}

export interface PromptPreviewTab {
  title: string;
  content: string;
  redactedContent?: string;
  rawContent?: string;
  systemPrompt?: string;
  systemPromptRedacted?: string;
  language?: string;
  updatedAt: number;
  tokenCounts?: PromptTokenCounts;
  intentText?: string;
}

export interface PromptTokenCounts {
  system: number;
  messages: number;
  total: number;
}

export interface MermaidState {
  code: string;
  isValid: boolean;
  lastValidCode: string; // For rendering prev state if broken
  errorLine?: number;
  errorMessage?: string;
  source: 'user' | 'compiled' | 'user-override';
  status: 'empty' | 'valid' | 'invalid' | 'edited';
}

export interface AppState {
  diagramType: DiagramType;
  mainDiagramTypes: DiagramType[];
  columnWidths: [number, number, number]; // percentages
  isResizing: number | null;
  isPreviewFullScreen: boolean;
  isScrollSyncEnabled: boolean;
  theme: ThemePresetId;
  language: string;
  analyzeLanguage: string;
  notebookBuildCount: number | string | null;
  llmTimeoutMs: number;
  thinkingStyle: ThinkingStyle;
}

export type ColorScheme = 'light' | 'dark';

export type ThemePresetId = 'lightPlus' | 'darkPlus' | 'abyss';
