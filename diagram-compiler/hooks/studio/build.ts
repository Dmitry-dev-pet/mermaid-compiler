import { summarizeBuild } from "../../services/llmService";
import { stripMermaidCode } from "../../utils";
import {
  normalizeIntentText,
  resolveIntentFromInput,
} from "../../utils/intent";
import type { StudioContext } from "./actionsContext";
import { AUTO_FIX_MAX_ATTEMPTS, BUILD_MAX_ATTEMPTS } from "../../constants";
import { runBuildPipeline } from "./buildPipeline";
import {
  normalizeSummaryText,
  sanitizeSummaryText,
} from "../../utils/buildSummary";
import { buildSystemPrompt } from "../../services/llm/prompts";
import { runStudioOperation } from "./runStudioOperation";
import { createStudioOperationRunner } from "./operationRunner";
import { buildOperationLogViewModel } from "../../components/chat/operationLogUtils";
import { buildContextEventForLog } from "./logContextUtils";
import { toRunnerContextEvent } from "./operationTracer";
import { buildSelectionLine } from "./selectionLine";
import { formatSelectionNote } from "./intentSelectionNote";

export const createBuildHandler = (ctx: StudioContext) => {
  return async (text?: string) => {
    const prompt = text?.trim() ?? "";
    const notebookBlockIndex = ctx.isNotebookChatMode
      ? ctx.getNotebookChatIndex?.()
      : null;
    return runStudioOperation(ctx, {
      title: "Сборка",
      stepType: "build",
      notebookBlockIndex,
      run: async ({ opId, stepMessages, logEvent, finalizeStep }) => {
        const runner = createStudioOperationRunner(ctx, { logEvent });

        if (prompt) stepMessages.push(ctx.addMessage("user", prompt, "build"));

        if (ctx.connectionState.status !== "connected") {
          stepMessages.push(
            ctx.addMessage(
              "assistant",
              "Офлайн. Подключите AI для генерации диаграмм.",
              "build",
            ),
          );
          logEvent({
            phase: "build",
            level: "error",
            title: "Сборка",
            detail: "offline",
            error: { code: "offline", message: "AI offline" },
          });
          await ctx.trackAnalyticsWithContext("diagram_build_failed", "build", {
            error: "offline",
          });
          await finalizeStep("error", { meta: { error: "offline" } });
          return;
        }

        const language = ctx.resolveLanguage(prompt);
        const timeoutMs = ctx.appState.llmTimeoutMs;

        ctx.setIsProcessing(true);
        try {
          logEvent({
            phase: "build",
            level: "info",
            title: "Сборка",
            detail: `тип: ${ctx.appState.diagramType}, язык: ${language}`,
          });
          const docs = await ctx.getDocsContext("build");
          const relevantMessages = ctx.getRelevantMessages();

          const intent = resolveIntentFromInput({
            prompt,
            diagramIntent: ctx.getCurrentIntent(),
            messages: relevantMessages,
            allowFallback: true,
            preferAssistant: ctx.isNotebookChatMode,
            assistantMode: "chat",
          });
          if (!intent) {
            stepMessages.push(
              ctx.addMessage(
                "assistant",
                "Нет intent для сборки. Используйте чат, чтобы описать задачу.",
                "build",
              ),
            );
            logEvent({
              phase: "planning",
              level: "error",
              title: "Intent",
              detail: "missing",
              error: { code: "no_intent", message: "Intent missing" },
            });
            await ctx.trackAnalyticsWithContext(
              "diagram_build_failed",
              "build",
              {
                error: "no_intent",
              },
            );
            await finalizeStep("error", { meta: { error: "no_intent" } });
            return;
          }

          const startedAt = Date.now();
          await ctx.trackAnalyticsWithContext(
            "diagram_build_started",
            "build",
            {
              intentSource: intent.source,
              hasPrompt: !!prompt,
            },
          );

          const normalizedIntent = normalizeIntentText(intent.content);
          const intentMessage = ctx.getIntentMessage(normalizedIntent);
          const diagramContext = ctx.getDiagramContextMessage();
          const llmMessages = diagramContext
            ? [intentMessage, diagramContext]
            : [intentMessage];

          const selectionSummary = await ctx.getDocsSelectionSummary?.("build");
          const systemPrompt = buildSystemPrompt(
            "generate",
            ctx.buildLLMRequestContext({
              diagramType: ctx.appState.diagramType,
              docsContext: "Documentation context redacted.",
              language,
            }),
          );
          const buildContextEvent = buildContextEventForLog({
            phase: "planning",
            contextScope: "build",
            diagramType: ctx.appState.diagramType,
            selectionLine:
              buildSelectionLine({
                diagramType: ctx.appState.diagramType,
                allowedDiagramTypes:
                  ctx.appState.diagramType === "auto"
                    ? ctx.appState.mainDiagramTypes
                    : null,
              }) || undefined,
            systemPrompt,
            messages: llmMessages,
            docsContext: docs,
            selectionSummary,
          });

          ctx.setCurrentIntent({
            content: normalizedIntent,
            source: intent.source,
            updatedAt: Date.now(),
          });

          // keep intent details in log only (no chat message)
          logEvent({
            phase: "planning",
            level: "info",
            title: "Intent",
            detail: `источник: ${intent.source}, длина: ${normalizedIntent.length}`,
          });

          const attemptNotes: string[] = [];
          const buildResult = await runBuildPipeline({
            sessionId: ctx.llmSessionId,
            chatGptAccountId: ctx.connectionState.chatGptAccountId,
            aiConfig: ctx.aiConfig,
            modelParams: ctx.modelParams,
            diagramType: ctx.appState.diagramType,
            llmMessages,
            docs,
            language,
            thinkingStyle: ctx.appState.thinkingStyle,
            maxAttempts: BUILD_MAX_ATTEMPTS,
            autoFixMaxAttempts: AUTO_FIX_MAX_ATTEMPTS,
            timeoutMs,
            runner,
            stageContextScope: "build",
            contextEvent: toRunnerContextEvent(buildContextEvent),
            callbacks: {
              onAttempt: (attempt, max) => {
                attemptNotes.push(`попытка ${attempt}/${max}`);
                logEvent({
                  phase: "build",
                  level: "info",
                  title: "Генерация",
                  attempt: { current: attempt, max },
                });
              },
              onEmpty: (attempt, max) => {
                attemptNotes.push(`попытка ${attempt}: пустой ответ`);
                logEvent({
                  phase: "build",
                  level: "warn",
                  title: "Генерация",
                  detail: "empty",
                  attempt: { current: attempt, max },
                });
              },
              onError: (attempt, max, message) => {
                attemptNotes.push(`попытка ${attempt}: ошибка ${message}`);
                logEvent({
                  phase: "build",
                  level: "error",
                  title: "Генерация",
                  detail: message,
                  attempt: { current: attempt, max },
                  error: { code: "build_error", message },
                });
              },
              onJsonStatus: (attempt, status, reason) => {
                attemptNotes.push(
                  `json status: ${status}${reason ? ` (${reason})` : ""}`,
                );
              },
              onTypeMismatch: (attempt, expected, received) => {
                attemptNotes.push(`type mismatch: ${expected} vs ${received}`);
              },
              onAutoFixAttempt: (attempt, max, errorLine) => {
                logEvent({
                  phase: "fix",
                  level: "info",
                  title: "Auto-fix",
                  detail: `attempt ${attempt}/${max}`,
                  attempt: { current: attempt, max },
                });
                if (errorLine) {
                  logEvent({
                    phase: "fix",
                    level: "warn",
                    title: "Auto-fix error",
                    detail: errorLine,
                    attempt: { current: attempt, max },
                    error: { code: "validation", message: errorLine },
                  });
                }
              },
              onAutoFixIteration: (code, nextValidation) => {
                ctx.applyCompiledResult(code, nextValidation);
              },
              onValidation: (isValid, autoFixAttempts) => {
                logEvent({
                  phase: "validate",
                  level: isValid ? "info" : "warn",
                  title: "Валидация",
                  detail: isValid ? "валидна" : "невалидна",
                  metrics: {
                    ...(autoFixAttempts ? { autoFix: autoFixAttempts } : {}),
                    durationMs: Date.now() - startedAt,
                  },
                });
              },
              onValidationError: (errorLine) => {
                logEvent({
                  phase: "validate",
                  level: "error",
                  title: "Ошибка",
                  detail: errorLine || "validation error",
                  error: {
                    code: "validation",
                    message: errorLine || "validation error",
                  },
                });
              },
            },
          });

          if (attemptNotes.length > 0) {
            logEvent({
              phase: "build",
              level: "info",
              title: "Попытки",
              detail: attemptNotes.join("; "),
            });
          }

          if (buildResult.status !== "ok" || !buildResult.code) {
            const reason = buildResult.lastError
              ? "build_attempts_failed"
              : "no_mermaid_code";
            logEvent({
              phase: "build",
              level: "error",
              title: "Сборка",
              detail: reason,
              error: { code: reason, message: buildResult.lastError ?? reason },
            });
            await ctx.trackAnalyticsWithContext(
              "diagram_build_failed",
              "build",
              {
                error: reason,
                attempts: buildResult.attempts,
                emptyResponses: buildResult.emptyResponses,
                durationMs: Date.now() - startedAt,
              },
            );
            stepMessages.push(
              ctx.addMessage(
                "assistant",
                "Итог: сборка завершилась с ошибкой. Проверьте лог.",
                "build",
              ),
            );
            await finalizeStep("error", {
              meta: {
                reason,
                attempts: buildResult.attempts,
                emptyResponses: buildResult.emptyResponses,
                error: buildResult.lastError ?? undefined,
              },
            });
            return;
          }

          if (buildResult.usedFallback) {
            logEvent({
              phase: "build",
              level: "warn",
              title: "Сборка",
              detail: "fallback_template",
            });
          }

          const currentCode = buildResult.code;
          const validation = buildResult.validation;
          const autoFixAttempts = buildResult.autoFixAttempts;

          logEvent({
            phase: "validate",
            level: validation.isValid ? "info" : "warn",
            title: "Валидация",
            detail: validation.isValid ? "валидна" : "невалидна",
            metrics: autoFixAttempts ? { autoFix: autoFixAttempts } : undefined,
          });

          await ctx.trackAnalyticsWithContext(
            "diagram_build_success",
            "build",
            {
              isValid: !!validation.isValid,
              errorLine: validation.errorLine,
              buildAttempts: buildResult.attempts,
              autoFixAttempts,
              emptyResponses: buildResult.emptyResponses,
              durationMs: Date.now() - startedAt,
              codeLength: currentCode.length,
            },
          );
          const fallbackSummary = [
            `Итог: диаграмма ${validation.isValid ? "готова" : "с ошибками"}.`,
            buildResult.usedFallback ? "Использован шаблон." : "",
            autoFixAttempts ? `Auto-fix: ${autoFixAttempts}.` : "",
          ]
            .filter(Boolean)
            .join(" ");
          let resolvedSummary = normalizeSummaryText(fallbackSummary);
          const selectionNote = formatSelectionNote(
            normalizedIntent,
            ctx.appState.diagramType,
            intent.source,
          );
          try {
            const chatTranscript = (() => {
              const filtered = ctx
                .getRelevantMessages()
                .filter(
                  (message) =>
                    (message.mode === undefined || message.mode === "chat") &&
                    (message.role === "user" || message.role === "assistant"),
                );
              if (filtered.length === 0) return "";
              return [
                "Чат:",
                ...filtered.map((m) => `${m.role}: ${m.content}`),
              ].join("\n");
            })();
            const operationLogText = (() => {
              const operationLog = ctx.getOperationLog(opId);
              if (!operationLog?.events?.length) return "";
              const now = Date.now();
              const snapshot = {
                ...operationLog,
                status: "done" as const,
                finishedAt: now,
              };
              const view = buildOperationLogViewModel(snapshot, {
                showSummaryLine: false,
                timeoutMs: ctx.appState.llmTimeoutMs,
                now,
              });
              const lines = view.rows.map((row) => {
                if (!row.timeLabel) return row.text;
                const parts = row.text.split("\n");
                const head = `${row.timeLabel} ${parts[0] ?? ""}`.trimEnd();
                const tail = parts.slice(1).map((line) => `  ${line}`);
                return [head, ...tail].join("\n");
              });
              return `Логи:\n${lines.join("\n")}`.trim();
            })();
            const summaryInput = [
              `Тип: ${ctx.appState.diagramType}`,
              `Валидность: ${validation.isValid ? "ok" : "error"}`,
              `Попытки сборки: ${buildResult.attempts}/${BUILD_MAX_ATTEMPTS}`,
              `Auto-fix: ${autoFixAttempts}`,
              `Fallback: ${buildResult.usedFallback ? "yes" : "no"}`,
              `Intent length: ${normalizedIntent.length}`,
              selectionNote ? `\n${selectionNote}` : "",
              chatTranscript ? `\n${chatTranscript}` : "",
              operationLogText ? `\n${operationLogText}` : "",
            ].join("\n");
            const summaryMessage = {
              id: "build-summary",
              role: "user",
              content: summaryInput,
              timestamp: Date.now(),
            } as const;
            const systemPrompt = buildSystemPrompt(
              "summary",
              ctx.buildLLMRequestContext({
                docsContext: "Documentation context redacted.",
                language,
                diagramType: ctx.appState.diagramType,
              }),
            );
            const summaryContextEvent = buildContextEventForLog({
              phase: "build",
              contextScope: "summary",
              diagramType: ctx.appState.diagramType,
              systemPrompt,
              messages: [summaryMessage],
              docsContext: "",
              selectionSummary: null,
            });
            const summaryText = await runner.runLLM({
              task: "build-summary",
              phase: "build",
              retries: 1,
              timeoutMs,
              stageTitle: "Итог",
              stageContextScope: "summary",
              contextEvent: toRunnerContextEvent(summaryContextEvent),
              run: (signal) =>
                summarizeBuild(
                  [summaryMessage],
                  ctx.aiConfig,
                  ctx.buildLLMRequestContext({
                    diagramType: ctx.appState.diagramType,
                    docsContext: "",
                    language,
                  }),
                  ctx.modelParams,
                  signal,
                ),
            });
            const cleanedSummary = normalizeSummaryText(
              sanitizeSummaryText(stripMermaidCode(summaryText)),
            );
            if (cleanedSummary) {
              const summaryPrefix =
                language === "Russian" ? "Итог:" : "Summary:";
              resolvedSummary = cleanedSummary
                .toLowerCase()
                .startsWith(summaryPrefix.toLowerCase())
                ? cleanedSummary
                : `${summaryPrefix} ${cleanedSummary}`;
            }
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : String(error);
            logEvent({
              phase: "error",
              level: "warn",
              title: "Итог",
              detail: `fallback: ${message}`,
            });
          }
          if (selectionNote && !resolvedSummary.includes(selectionNote)) {
            resolvedSummary = `${resolvedSummary}\n${selectionNote}`.trim();
          }
          stepMessages.push(
            ctx.addMessage("assistant", resolvedSummary, "build"),
          );
          await finalizeStep("done", {
            nextMermaid: ctx.resolveMermaidUpdate(currentCode, validation),
            meta: {
              diagramType: ctx.appState.diagramType,
              isValid: !!validation.isValid,
              autoFixAttempts: autoFixAttempts,
              buildAttempts: buildResult.attempts,
              emptyResponses: buildResult.emptyResponses,
              fallbackUsed: buildResult.usedFallback,
              intent: intent.content,
              intentSource: intent.source,
            },
          });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          stepMessages.push(
            ctx.addMessage(
              "assistant",
              `Сборка: ошибка (${ctx.getCurrentModelName()}): ${message}`,
              "build",
            ),
          );
          logEvent({
            phase: "build",
            level: "error",
            title: "Сборка",
            detail: message,
            error: { code: "exception", message },
          });
          await ctx.trackAnalyticsWithContext("diagram_build_failed", "build", {
            error: "exception",
          });
          stepMessages.push(
            ctx.addMessage(
              "assistant",
              "Итог: сборка завершилась с ошибкой. Проверьте лог.",
              "build",
            ),
          );
          await finalizeStep("error", { meta: { error: message } });
        } finally {
          ctx.setIsProcessing(false);
        }
      },
    });
  };
};
