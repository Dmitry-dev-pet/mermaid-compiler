import React from 'react';
import type { ChatGptAccountControls } from '../../hooks/core/useChatGptAccount';
import { CHATGPT_AGENT_ORIGIN } from '../../services/chatGptClient';
import type { ConnectionState } from '../../types';
import { getChatGptStatusLabel, getConnectionStatusLabel } from '../../utils/aiStatusPresentation';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';

type ChatGptAccountPanelProps = {
  account: ChatGptAccountControls;
  connectionState: ConnectionState;
  selectedModelId: string;
  isProcessing?: boolean;
};

export const ChatGptAccountPanel: React.FC<ChatGptAccountPanelProps> = ({
  account,
  connectionState,
  selectedModelId,
  isProcessing = false,
}) => {
  if (!account.isLocal) {
    return (
      <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
        <p>ChatGPT sign-in is available in the local Mermaid workspace.</p>
        <p>Start the ChatGPT Agent on this device, then open the local editor to continue with your ChatGPT account.</p>
        <a
          href={`${CHATGPT_AGENT_ORIGIN}/?ai=chatgpt`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block font-medium text-blue-600 underline dark:text-blue-400"
        >
          Open local Mermaid workspace
        </a>
      </div>
    );
  }

  const status = account.status;
  const pending = status?.login?.state === 'pending';
  const activeAccount = status?.accounts.find((entry) => entry.id === status.activeAccountId);
  const changingAccount = Boolean(account.action);
  const controlsDisabled = changingAccount || isProcessing || account.loading;
  const usageLabel = getChatGptStatusLabel(status, true, selectedModelId);
  const discoveryLabel = getConnectionStatusLabel('chatgpt', connectionState.status);
  const usageBlocked = status?.usage.state === 'limit_reached' || status?.usage.state === 'unavailable';

  return (
    <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
      <div aria-live="polite" className="space-y-1">
        <p className={usageBlocked ? 'text-amber-600 dark:text-amber-400' : undefined}>
          {account.loading && !status ? 'Checking ChatGPT account…' : usageLabel}
        </p>
        {activeAccount ? <p className="break-all font-medium">{activeAccount.email || 'ChatGPT account'}</p> : null}
        {status?.usage.message ? <p>{status.usage.message}</p> : null}
        {status?.usage.state === 'available' && status.usage.model ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Last verified model: {status.usage.model}</p>
        ) : null}
        {account.notice ? <p>{account.notice}</p> : null}
      </div>

      {status?.accounts.length ? (
        <div>
          <label htmlFor="chatgpt-account" className="mb-1 block text-[11px]">Saved ChatGPT account</label>
          <Select
            id="chatgpt-account"
            value={status.activeAccountId ?? ''}
            disabled={controlsDisabled || pending}
            onChange={(event) => {
              const next = status.accounts.find((entry) => entry.id === event.target.value);
              if (!next) return;
              if (next.connected) void account.selectAccount(next.id);
              else void account.login({ accountId: next.id });
            }}
            size="md"
          >
            <option value="" disabled>Select an account</option>
            {status.accounts.map((entry, index) => (
              <option key={entry.id} value={entry.id}>
                {entry.email || `ChatGPT account ${index + 1}`}{entry.connected ? '' : ' · Sign in again'}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {pending ? (
        <div className="space-y-2">
          <p>Complete sign-in in the browser window opened by the Agent. This panel updates automatically.</p>
          {account.authUrl ? (
            <a href={account.authUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-blue-600 underline dark:text-blue-400">
              Continue on the official ChatGPT sign-in page
            </a>
          ) : null}
          <Button type="button" disabled={changingAccount || isProcessing} onClick={() => void account.cancelLogin()}>
            Cancel sign-in
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status?.connected ? (
            <>
              <Button type="button" disabled={controlsDisabled} onClick={() => void account.login({ accountId: status.activeAccountId ?? undefined })}>
                Reconnect
              </Button>
              <Button type="button" disabled={controlsDisabled} onClick={() => void account.logout(status.activeAccountId ?? undefined)}>
                Sign out locally
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={controlsDisabled || !status}
              isLoading={account.action === 'login'}
              onClick={() => void account.login(status?.activeAccountId ? { accountId: status.activeAccountId } : {})}
            >
              Continue with ChatGPT
            </Button>
          )}
          {status?.accounts.length ? (
            <Button type="button" disabled={controlsDisabled} onClick={() => void account.login({ newAccount: true })}>
              Add account
            </Button>
          ) : null}
        </div>
      )}

      {status?.login?.message ? <p aria-live="polite">{status.login.message}</p> : null}
      {account.error ? <p role="alert" className="text-rose-600 dark:text-rose-400">{account.error}</p> : null}

      {!pending ? (
        <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
          {status?.activeAccountId ? (
            <>
              <p>{status.usage.state === 'unverified' ? discoveryLabel : `Models: ${connectionState.status === 'connected' ? 'loaded' : discoveryLabel}`}</p>
              {!status.connected ? <p>Try Reload status and models to check the saved session before signing in again.</p> : null}
              {connectionState.error ? <p role="alert" className="text-rose-600 dark:text-rose-400">{connectionState.error}</p> : null}
            </>
          ) : null}
          <Button type="button" disabled={controlsDisabled || connectionState.status === 'connecting'} onClick={() => void account.refresh()}>
            {status?.activeAccountId ? 'Reload status and models' : 'Refresh account status'}
          </Button>
        </div>
      ) : null}

      {isProcessing ? <p>Finish or stop the current generation before changing accounts.</p> : null}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Sign-in is stored by the Agent on this device. Local sign-out removes this account’s local session. Manage account-wide app access in ChatGPT settings.
      </p>
    </div>
  );
};
