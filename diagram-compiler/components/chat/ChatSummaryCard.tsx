import React from 'react';
import ChatMarkdownTabs from './ChatMarkdownTabs';

type ChatSummaryCardProps = {
  summaryText: string | null;
};

const ChatSummaryCard: React.FC<ChatSummaryCardProps> = ({ summaryText }) => {
  return (
    <section className="rounded-md border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 flex flex-col flex-none">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200/60 dark:border-slate-800/60">
        Summary
      </div>
      <div className="max-h-32 overflow-y-auto p-2">
        {summaryText ? (
          <ChatMarkdownTabs rawText={summaryText} isLatest />
        ) : (
          <div className="text-[11px] text-slate-400 dark:text-slate-500">No summary yet.</div>
        )}
      </div>
    </section>
  );
};

export default ChatSummaryCard;
