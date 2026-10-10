import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBuildPipeline } from "./buildPipeline";
import { generateDiagram, fixDiagram } from "../../services/llmService";
import {
  detectMermaidDiagramType,
  extractMermaidCode,
  parseMermaidJsonResponse,
  prepareMermaid,
  validatePreparedMermaid,
} from "../../services/mermaidService";
import { sanitizeMermaidByType } from "../../utils/mermaidSanitizer";
import { runLLMRequest } from "../../services/llmRequestRunner";
import type { AIConfig } from "../../types";
import { OpenCodeGoError } from "../../services/llm/openCodeGoClient";

vi.mock("../../services/llmService", () => ({
  generateDiagram: vi.fn(),
  fixDiagram: vi.fn(),
}));

vi.mock("../../services/mermaidService", () => ({
  detectMermaidDiagramType: vi.fn(),
  extractMermaidCode: vi.fn(),
  parseMermaidJsonResponse: vi.fn(),
  prepareMermaid: vi.fn((code: string, diagramType?: string) => ({
    diagramType: diagramType ?? "auto",
    sanitizedCode: code,
    inlineCode: code,
  })),
  validatePreparedMermaid: vi.fn(),
}));

vi.mock("../../utils/mermaidSanitizer", () => ({
  sanitizeMermaidByType: vi.fn((_type: string, code: string) => code),
  formatMermaidErrorLine: vi.fn((message: string) => message),
}));

vi.mock("../../utils/mermaidAutoFixHints", () => ({
  augmentMermaidErrorForAutoFix: vi.fn(
    (_type: string, message: string) => message,
  ),
}));

vi.mock("../../services/llmRequestRunner", () => ({
  runLLMRequest: vi.fn(async (args: { run: () => Promise<string> }) =>
    args.run(),
  ),
}));

const testAiConfig: AIConfig = {
  provider: "openrouter",
  openRouterKey: "",
  openRouterEndpoint: "",
  agentToken: "",
  agentEndpoint: "",
  proxyKey: "",
  proxyManagementKey: "",
  proxyEndpoint: "",
  selectedModelId: "test",
  selectedModelIdByProvider: { openrouter: "test", agent: "", cliproxy: "test", 'opencode-go': '' },
  filtersByProvider: {
    openrouter: {
      vendor: "",
      freeOnly: false,
      testedOnly: false,
      experimental: false,
      minContextWindow: 0,
    },
    agent: { family: "" },
    cliproxy: { family: "" },
    'opencode-go': { vendor: '' },
  },
};

const baseOptions = {
  aiConfig: testAiConfig,
  diagramType: "flowchart" as const,
  llmMessages: [],
  docs: "docs",
  language: "en",
  maxAttempts: 1,
  autoFixMaxAttempts: 1,
};

describe("runBuildPipeline", () => {
  beforeEach(() => {
    vi.mocked(generateDiagram).mockReset();
    vi.mocked(fixDiagram).mockReset();
    vi.mocked(parseMermaidJsonResponse).mockReset();
    vi.mocked(detectMermaidDiagramType).mockReset();
    vi.mocked(extractMermaidCode).mockReset();
    vi.mocked(prepareMermaid).mockClear();
    vi.mocked(validatePreparedMermaid).mockReset();
    vi.mocked(sanitizeMermaidByType).mockClear();
    vi.mocked(runLLMRequest).mockClear();
  });

  it("returns parsed json mermaid code", async () => {
    vi.mocked(generateDiagram).mockResolvedValue("raw");
    vi.mocked(parseMermaidJsonResponse).mockReturnValue({
      status: "ok",
      diagramType: "flowchart",
      mermaid: "flowchart TD\nA-->B",
      reason: null,
    });
    vi.mocked(validatePreparedMermaid).mockResolvedValue({
      isValid: true,
      status: "valid",
    });

    const onAttempt = vi.fn();
    const result = await runBuildPipeline({
      ...baseOptions,
      callbacks: { onAttempt },
    });

    expect(result.status).toBe("ok");
    expect(result.code).toBe("flowchart TD\nA-->B");
    expect(result.usedFallback).toBe(false);
    expect(onAttempt).toHaveBeenCalledWith(1, 1);
    expect(runLLMRequest).toHaveBeenCalled();
  });

  it("uses fallback when json response mismatches type", async () => {
    vi.mocked(generateDiagram).mockResolvedValue("raw");
    vi.mocked(parseMermaidJsonResponse).mockReturnValue({
      status: "ok",
      diagramType: "sequence",
      mermaid: "sequenceDiagram\nA->>B: Hi",
      reason: null,
    });
    vi.mocked(validatePreparedMermaid).mockResolvedValue({
      isValid: true,
      status: "valid",
    });

    const onTypeMismatch = vi.fn();
    const result = await runBuildPipeline({
      ...baseOptions,
      callbacks: { onTypeMismatch },
    });

    expect(onTypeMismatch).toHaveBeenCalledWith(1, "flowchart", "sequence");
    expect(result.usedFallback).toBe(true);
    expect(result.code).toContain("flowchart TD");
  });

  it("auto-fixes invalid code and reports validation errors", async () => {
    vi.mocked(generateDiagram).mockResolvedValue("bad code");
    vi.mocked(parseMermaidJsonResponse).mockReturnValue(null);
    vi.mocked(extractMermaidCode).mockImplementation((raw) =>
      raw.includes("```mermaid") ? "flowchart TD\nA-->B" : raw,
    );
    vi.mocked(detectMermaidDiagramType).mockReturnValue("flowchart");
    vi.mocked(validatePreparedMermaid)
      .mockResolvedValueOnce({
        isValid: false,
        status: "invalid",
        errorMessage: "line 1",
      })
      .mockResolvedValueOnce({
        isValid: false,
        status: "invalid",
        errorMessage: "line 9",
      });
    vi.mocked(fixDiagram).mockResolvedValue(
      "```mermaid\nflowchart TD\nA-->B\n```",
    );

    const onAutoFixAttempt = vi.fn();
    const onValidationError = vi.fn();
    const result = await runBuildPipeline({
      ...baseOptions,
      sessionId: 'mermaid:project-123:main',
      callbacks: { onAutoFixAttempt, onValidationError },
    });

    expect(result.code).toBe("flowchart TD\nA-->B");
    expect(result.autoFixAttempts).toBe(1);
    expect(onAutoFixAttempt).toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledWith("line 9");
    expect(vi.mocked(generateDiagram).mock.calls[0][2].sessionId).toBe('mermaid:project-123:main');
    expect(vi.mocked(fixDiagram).mock.calls[0][3].sessionId).toBe('mermaid:project-123:main');
  });

  it.each([401, 402, 403, 429])('stops Go HTTP %i before retry, fallback or auto-fix', async (status) => {
    const error = new OpenCodeGoError(status, 'Go access unavailable');
    vi.mocked(generateDiagram).mockRejectedValue(error);
    await expect(runBuildPipeline({
      ...baseOptions,
      aiConfig: { ...testAiConfig, provider: 'opencode-go' },
      sessionId: 'mermaid:project-123:main',
      maxAttempts: 3,
      allowFallback: true,
    })).rejects.toBe(error);
    expect(generateDiagram).toHaveBeenCalledTimes(1);
    expect(fixDiagram).not.toHaveBeenCalled();
    expect(prepareMermaid).not.toHaveBeenCalled();
  });
});
