import React from 'react';
import PanelHeader from '../ui/PanelHeader';
import HeaderRow from '../ui/HeaderRow';
import HeaderSection from '../ui/HeaderSection';
import PreviewToolsRow from './PreviewToolsRow';
import PreviewHeaderPinnedMode from './PreviewHeaderPinnedMode';
import PreviewHeaderStyleMenu from './PreviewHeaderStyleMenu';
import PreviewHeaderScrollSyncToggle from './PreviewHeaderScrollSyncToggle';
import type { PreviewHeaderModel } from '../../hooks/preview/usePreviewHeaderModel';

interface PreviewHeaderControlsProps {
  model: PreviewHeaderModel;
}

const PreviewHeaderControls: React.FC<PreviewHeaderControlsProps> = ({
  model,
}) => {
  const { pinned, tools, style, scrollSync } = model;
  const canNotebookExcalidrawToggle = !tools.isBuildDocsMode && tools.isMarkdownMode && tools.canNotebookExcalidrawToggle;

  return (
    <PanelHeader className="relative h-24 flex flex-col gap-2 max-md:px-2">
      <HeaderSection tone="primary" className="uppercase max-md:overflow-x-auto">
        <HeaderRow
          left={
            <PreviewHeaderPinnedMode
              pinnedMode={pinned.pinnedMode}
              pinnedCanEd={pinned.pinnedCanEd}
              pinnedDirty={pinned.pinnedDirty}
              pinnedEdDisabledReason={pinned.pinnedEdDisabledReason}
              onSetPinnedMode={pinned.onSetPinnedMode}
            />
          }
          right={
            <PreviewToolsRow
              {...tools}
              canNotebookExcalidrawToggle={canNotebookExcalidrawToggle}
            />
          }
        />
      </HeaderSection>

      <HeaderSection tone="secondary" className="max-md:overflow-x-auto">
        <HeaderRow
          left={
            <PreviewHeaderStyleMenu
              {...style}
            />
          }
          right={
            <PreviewHeaderScrollSyncToggle
              {...scrollSync}
            />
          }
        />
      </HeaderSection>
    </PanelHeader>
  );
};

export default PreviewHeaderControls;
