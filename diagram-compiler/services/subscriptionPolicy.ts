import type { Provider } from '../types';
import { shouldStopChatGptOperation } from './chatGptClient';
import { shouldStopOpenCodeGoOperation } from './llm/openCodeGoClient';

export const isSubscriptionProvider = (provider?: Provider): boolean =>
  provider === 'opencode-go' || provider === 'chatgpt';

export const shouldStopSubscriptionOperation = (provider: Provider, error: unknown): boolean => {
  if (provider === 'chatgpt') return shouldStopChatGptOperation(error);
  if (provider === 'opencode-go') return shouldStopOpenCodeGoOperation(error);
  return false;
};
