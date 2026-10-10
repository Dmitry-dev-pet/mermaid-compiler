import type { DiagramType, ThinkingStyle } from "../../types";

export type LLMRequestContext = {
  /** Stable project/conversation identity for transports that require it. */
  sessionId?: string;
  /** In-memory account snapshot keeps a multi-request operation on one account. */
  chatGptAccountId?: string;
  diagramType?: DiagramType;
  allowedDiagramTypes?: DiagramType[] | null;
  docsContext: string;
  language: string;
  thinkingStyle?: ThinkingStyle;
};
