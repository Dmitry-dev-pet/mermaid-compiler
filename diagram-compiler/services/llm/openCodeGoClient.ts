import { getOpenCodeGoApiKey } from '../openCodeGoCredentials';

const ENDPOINT = '/api/opencode-go';

export class OpenCodeGoError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`API Error (${status}): ${message}`);
    this.name = 'OpenCodeGoError';
    this.status = status;
  }
}

export const shouldStopOpenCodeGoOperation = (error: unknown): error is Error =>
  error instanceof Error && (
    error.name === 'AbortError' ||
    (error instanceof OpenCodeGoError && error.status >= 400 && error.status < 500)
  );

const statusMessage = (status: number): string => {
  switch (status) {
    case 400:
    case 404:
    case 422:
      return 'OpenCode Go rejected this model or its parameters. Reload the model list and choose a supported model, or reset model parameters.';
    case 401:
      return 'OpenCode Go did not accept your key. Check the key in AI settings.';
    case 402:
      return 'OpenCode Go subscription access is unavailable. Check your subscription in OpenCode Console.';
    case 403:
      return 'This OpenCode Go key does not have access. Check the key and subscription in OpenCode Console.';
    case 413:
      return 'This conversation is too large for OpenCode Go. Shorten the conversation or reduce the included context.';
    case 408:
    case 504:
      return 'OpenCode Go took too long to respond. Try again when the service is available.';
    case 429:
      return 'OpenCode Go usage limit reached. Wait for your limit to reset or check OpenCode Console.';
    case 499:
      return 'The OpenCode Go request was cancelled.';
    default:
      return 'OpenCode Go is unavailable. Please try again later.';
  }
};

export const getOpenCodeGoSessionId = (
  projectId: string | null | undefined,
  conversationId = 'main',
): string | undefined => {
  if (!projectId?.trim()) return undefined;
  return `mermaid:${projectId}:${conversationId}`.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 128);
};

export const requestOpenCodeGo = async (
  body: { operation: 'models' } | { operation: 'chat'; request: Record<string, unknown> },
  sessionId: string,
  signal?: AbortSignal | null,
): Promise<unknown> => {
  const key = getOpenCodeGoApiKey();
  if (!key) throw new OpenCodeGoError(401, 'Enter your personal OpenCode Go key in AI settings.');

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'x-opencode-session': sessionId,
      },
      body: JSON.stringify(body),
      signal: signal ?? undefined,
    });
  } catch (error: unknown) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new OpenCodeGoError(503, 'Could not reach the OpenCode Go connection. Check your connection and try again.');
  }

  if (!response.ok) throw new OpenCodeGoError(response.status, statusMessage(response.status));
  try {
    return await response.json();
  } catch (error: unknown) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new OpenCodeGoError(502, 'The OpenCode Go handler returned an invalid response. Refresh the app and try again.');
  }
};
