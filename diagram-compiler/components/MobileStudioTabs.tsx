import React from 'react';
import { Button } from './ui/Button';

export type MobileStudioPane = 'chat' | 'code' | 'preview';

type Props = {
  activePane: MobileStudioPane;
  onSelect: (pane: MobileStudioPane) => void;
};

export default function MobileStudioTabs({ activePane, onSelect }: Props) {
  return (
    <nav aria-label="Mobile Studio panes" className="md:hidden flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-950">
      {(['chat', 'code', 'preview'] as const).map((pane) => (
        <Button
          key={pane}
          type="button"
          size="md"
          variant={activePane === pane ? 'primary' : 'ghost'}
          aria-pressed={activePane === pane}
          onClick={() => onSelect(pane)}
          className="flex-1"
        >
          {pane === 'chat' ? 'Chat' : pane === 'code' ? 'Code' : 'Preview'}
        </Button>
      ))}
    </nav>
  );
}
