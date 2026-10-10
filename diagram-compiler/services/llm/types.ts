import type { DiagramType, ThinkingStyle } from "../../types";

export type LLMRequestContext = {
  /** Stable project/conversation identity for transports that require it. */
  sessionId?: string;
  diagramType?: DiagramType;
  allowedDiagramTypes?: DiagramType[] | null;
  docsContext: string;
  language: string;
  thinkingStyle?: ThinkingStyle;
};
