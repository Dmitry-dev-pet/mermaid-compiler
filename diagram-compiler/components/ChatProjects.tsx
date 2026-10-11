import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Plus, Trash2 } from 'lucide-react';
import type { DiagramType, ThinkingStyle } from '../types';
import type { HistorySession } from '../services/history/types';
import type { StorageMode } from '../hooks/core/useStorageMode';
import type {
  CloudMigrationItem,
  CloudMigrationStatus,
  CloudProjectsStatus,
  CloudSyncStatus,
} from '../hooks/studio/useCloudControlPlane';
import type { ProjectMeta } from '../services/storage';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import DiagramTypePicker from './chat/DiagramTypePicker';
import ProjectsMenu from './chat/ProjectsMenu';

type ChatProjectsProps = {
  projects: HistorySession[];
  activeProjectId: string | null;
  onNewProject: () => void;
  onOpenProject: (sessionId: string) => void | Promise<void>;
  onRenameProject: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteProject: (sessionId: string) => void | Promise<void>;
  onUndoDeleteProject: (sessionId: string) => void;
  onPreviewProjectSnapshot: (sessionId: string) => Promise<void>;
  onClearProjectPreview: () => void;
  onExportProject: (sessionId: string) => Promise<void>;
  onImportProject: (file: File, action?: 'copy' | 'overwrite' | 'open') => Promise<void>;
  byoConfig: { url: string; anonKey: string };
  onByoConfigChange: (updates: { url?: string; anonKey?: string }) => void;
  onTestByoConfig: () => Promise<{ ok: boolean; error?: string }>;
  deleteUndoMs: number;
  diagramType: DiagramType;
  onDiagramTypeChange: (type: DiagramType) => void;
  mainDiagramTypes: DiagramType[];
  onMainDiagramTypesChange: (types: DiagramType[]) => void;
  detectedDiagramType: DiagramType | null;
  notebookBuildCount: number | string | null;
  onNotebookBuildCountChange: (count: number | string | null) => void;
  thinkingStyle: ThinkingStyle;
  onThinkingStyleChange: (style: ThinkingStyle) => void;
  storageMode?: StorageMode;
  onStorageModeChange?: (mode: StorageMode) => void;
  cloudSync?: { status: CloudSyncStatus; syncActive: () => Promise<void>; syncAll: () => Promise<void> };
  cloudProjects?: {
    status: CloudProjectsStatus;
    projects: ProjectMeta[];
    refresh: () => Promise<void>;
    importFromCloud: (projectId: string) => Promise<void>;
  };
  cloudMigration?: {
    status: CloudMigrationStatus;
    items: CloudMigrationItem[];
    unlinkedCount: number;
    migrateAll: () => Promise<void>;
    migrateActive: () => Promise<void>;
    cancel: () => void;
    reset: () => void;
  };
  mode?: 'header' | 'panel';
  simpleMode?: boolean;
  chatStatus?: 'idle' | 'running';
};

const ChatProjects: React.FC<ChatProjectsProps> = ({
  projects,
  activeProjectId,
  onNewProject,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onUndoDeleteProject,
  onPreviewProjectSnapshot,
  onClearProjectPreview,
  onExportProject,
  onImportProject,
  byoConfig,
  onByoConfigChange,
  onTestByoConfig,
  deleteUndoMs,
  diagramType,
  onDiagramTypeChange,
  mainDiagramTypes,
  onMainDiagramTypesChange,
  notebookBuildCount,
  onNotebookBuildCountChange,
  thinkingStyle,
  onThinkingStyleChange,
  storageMode,
  onStorageModeChange,
  cloudSync,
  cloudProjects,
  cloudMigration,
  mode = 'panel',
  simpleMode = false,
  chatStatus = 'idle',
}) => {
  const isHeaderMode = mode === 'header';
  const [isExpanded, setIsExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<'updated' | 'created' | 'name'>('updated');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectTitle, setEditingProjectTitle] = useState('');
  const [undoProjectId, setUndoProjectId] = useState<string | null>(null);
  const [undoProjectTitle, setUndoProjectTitle] = useState('');
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [isDiagramTypePickerOpen, setIsDiagramTypePickerOpen] = useState(false);
  const [diagramTypePickerPlacement, setDiagramTypePickerPlacement] = useState<'expanded' | 'active'>('expanded');
  const undoTimerRef = React.useRef<number | null>(null);
  const projectsMenuRef = useRef<HTMLDivElement | null>(null);
  const projectsMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const diagramTypePickerRootRef = useRef<HTMLDivElement | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects]
  );

  const openDiagramTypePicker = (placement: 'expanded' | 'active') => {
    setDiagramTypePickerPlacement(placement);
    setIsDiagramTypePickerOpen((prev) => (placement === diagramTypePickerPlacement ? !prev : true));
  };

  const startEditingProject = (project: HistorySession) => {
    setEditingProjectId(project.id);
    setEditingProjectTitle(project.title ?? '');
  };

  const cancelEditingProject = () => {
    setEditingProjectId(null);
    setEditingProjectTitle('');
  };

  const commitProjectRename = async (project: HistorySession) => {
    const nextTitle = editingProjectTitle.trim();
    if (nextTitle && nextTitle !== project.title) {
      await onRenameProject(project.id, nextTitle);
    }
    cancelEditingProject();
  };

  const clearUndo = () => {
    setUndoProjectId(null);
    setUndoProjectTitle('');
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };

  const handleDelete = async (project: HistorySession) => {
    await onDeleteProject(project.id);
    setUndoProjectId(project.id);
    setUndoProjectTitle(project.title ?? 'Project');
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      clearUndo();
    }, deleteUndoMs);
  };

  const handleUndo = () => {
    if (!undoProjectId) return;
    onUndoDeleteProject(undoProjectId);
    clearUndo();
  };

  const handleOpenProject = async (projectId: string) => {
    await onOpenProject(projectId);
    setIsExpanded(false);
    onClearProjectPreview();
  };

  const handleCreateProject = () => {
    onNewProject();
    setIsExpanded(false);
    onClearProjectPreview();
  };

  const requestImport = async (file: File) => {
    if (activeProjectId) {
      setPendingImportFile(file);
      return;
    }
    await onImportProject(file, 'copy');
  };

  const resolveImport = async (action: 'copy' | 'overwrite' | 'open') => {
    if (!pendingImportFile) return;
    await onImportProject(pendingImportFile, action);
    setPendingImportFile(null);
  };

  useEffect(() => {
    if (isExpanded) return;
    onClearProjectPreview();
  }, [isExpanded, onClearProjectPreview]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDiagramTypePickerOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (diagramTypePickerRootRef.current?.contains(target)) return;
      setIsDiagramTypePickerOpen(false);
    };
    window.document.addEventListener('mousedown', onPointerDown, true);
    window.document.addEventListener('touchstart', onPointerDown, true);
    return () => {
      window.document.removeEventListener('mousedown', onPointerDown, true);
      window.document.removeEventListener('touchstart', onPointerDown, true);
    };
  }, [isDiagramTypePickerOpen]);

  useEffect(() => {
    if (!isExpanded) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (projectsMenuRef.current?.contains(target)) return;
      if (projectsMenuButtonRef.current?.contains(target)) return;
      if (diagramTypePickerRootRef.current?.contains(target)) return;
      setIsExpanded(false);
      cancelEditingProject();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsExpanded(false);
      cancelEditingProject();
    };

    window.document.addEventListener('mousedown', onPointerDown, true);
    window.document.addEventListener('touchstart', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.document.removeEventListener('mousedown', onPointerDown, true);
      window.document.removeEventListener('touchstart', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isExpanded]);

  const registerDiagramTypePickerRoot = (placement: 'expanded' | 'active') => (node: HTMLDivElement | null) => {
    if (diagramTypePickerPlacement !== placement) return;
    diagramTypePickerRootRef.current = node;
  };

  return (
    <div
      className={
        isHeaderMode
          ? 'relative flex items-center gap-3 min-w-0 w-full'
          : `relative px-4 py-2 border-b bg-transparent flex flex-col gap-2 ${simpleMode ? 'h-16' : 'h-24'}`
      }
      style={
        isHeaderMode
          ? undefined
          : { borderColor: 'var(--panel-border, #e5e7eb)', backgroundColor: 'var(--panel-alt-bg, #ffffff)' }
      }
    >
      {isHeaderMode ? (
        <div className="flex items-center justify-between gap-3 min-w-0 min-h-7 w-full">
          <div className="flex items-center gap-2 min-w-0 min-h-7">
            <Button
              ref={projectsMenuButtonRef}
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="flex items-center gap-2 min-w-0"
              title={isExpanded ? 'Close projects' : 'Open projects'}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="flex items-center gap-2 shrink-0">
                <Folder size={12} /> Projects
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">({projects.length})</span>
            </Button>
          </div>

          <div className="flex items-center gap-2 shrink-0 min-h-7">
            {undoProjectId && (
              <Button
                type="button"
                onClick={handleUndo}
                className="border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                title={`Undo delete: ${undoProjectTitle}`}
              >
                Undo
              </Button>
            )}
            <Button
              onClick={handleCreateProject}
              type="button"
            >
              <Plus size={12} /> New
            </Button>
            <Button
              onClick={() => activeProject && handleDelete(activeProject)}
              disabled={!activeProjectId}
              className="text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 max-md:hidden"
              type="button"
              title="Delete current project"
            >
              <Trash2 size={12} /> Delete
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 min-h-7 text-[10px] font-medium text-slate-500 dark:text-slate-400 normal-case tracking-normal">
            <div className="min-w-0">
              {activeProject ? (
                editingProjectId === activeProject.id ? (
                  <Input
                    value={editingProjectTitle}
                    onChange={(e) => setEditingProjectTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitProjectRename(activeProject);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEditingProject();
                      }
                    }}
                    onBlur={() => void commitProjectRename(activeProject)}
                    size="sm"
                    autoFocus
                    className="h-7 text-xs"
                  />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => startEditingProject(activeProject)}
                    className="h-auto px-0 py-0 text-xs font-medium text-slate-700 dark:text-slate-200 truncate hover:text-blue-600 dark:hover:text-blue-400"
                    title={activeProject.title}
                  >
                    {activeProject.title}
                  </Button>
                )
              ) : (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">No project</span>
              )}
            </div>
            <span className="inline-flex items-center gap-1 text-[10px]">
              <span
                className={`inline-flex h-2 w-2 rounded-full ${
                  chatStatus === 'running'
                    ? 'bg-amber-500 dark:bg-amber-300'
                    : 'bg-emerald-500/70 dark:bg-emerald-300/70'
                }`}
                aria-hidden
              />
              {chatStatus === 'running' ? 'Running' : 'Idle'}
            </span>
          </div>
          {!simpleMode ? <div className="flex items-center justify-end gap-3 text-[11px] text-slate-500 dark:text-slate-400 min-h-7">
            <div className="flex items-center gap-2">
              <span>Style</span>
              <Select
                value={thinkingStyle}
                onChange={(e) => onThinkingStyleChange(e.target.value as ThinkingStyle)}
                size="xs"
                className="w-[140px] h-7 text-[10px]"
                aria-label="Thinking style"
                title="Thinking style"
              >
                <option value="simple">Simple / Business</option>
                <option value="engineering">Engineering / Technical</option>
                <option value="strict_c4">Strict C4</option>
              </Select>
            </div>
            <DiagramTypePicker
              placement="active"
              isOpen={isDiagramTypePickerOpen && diagramTypePickerPlacement === 'active'}
              diagramType={diagramType}
              mainDiagramTypes={mainDiagramTypes}
              onDiagramTypeChange={onDiagramTypeChange}
              onMainDiagramTypesChange={onMainDiagramTypesChange}
              notebookBuildCount={notebookBuildCount}
              onNotebookBuildCountChange={onNotebookBuildCountChange}
              onToggleOpen={openDiagramTypePicker}
              onRootRef={registerDiagramTypePickerRoot('active')}
            />
          </div> : <span className="text-[10px] text-slate-500 dark:text-slate-400">Auto-saved in this browser · not synced across devices</span>}
        </>
      )}

      {isHeaderMode && isExpanded && (
        <ProjectsMenu
          menuRef={projectsMenuRef}
          projects={projects}
          activeProjectId={activeProjectId}
          editingProjectId={editingProjectId}
          editingProjectTitle={editingProjectTitle}
          sortKey={sortKey}
          onSortChange={setSortKey}
          onPreviewProjectSnapshot={onPreviewProjectSnapshot}
          onClearProjectPreview={onClearProjectPreview}
          onStartEditingProject={startEditingProject}
          onEditingProjectTitleChange={setEditingProjectTitle}
          onCommitProjectRename={commitProjectRename}
          onCancelEditingProject={cancelEditingProject}
          onOpenProject={handleOpenProject}
          onDeleteProject={handleDelete}
          onExportProject={onExportProject}
          onImportProject={requestImport}
          byoConfig={byoConfig}
          onByoConfigChange={onByoConfigChange}
          onTestByoConfig={onTestByoConfig}
          storageMode={storageMode}
          onStorageModeChange={onStorageModeChange}
          cloudSync={cloudSync}
          cloudProjects={cloudProjects}
          cloudMigration={cloudMigration}
        />
      )}

      {pendingImportFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="w-[360px] rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-xl">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Import конфликт</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              В активном проекте есть изменения. Что сделать с импортом?
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPendingImportFile(null)}>
                Cancel
              </Button>
              <Button type="button" variant="outline" onClick={() => resolveImport('open')}>
                Open current
              </Button>
              <Button type="button" variant="outline" onClick={() => resolveImport('copy')}>
                Save as copy
              </Button>
              <Button type="button" variant="danger" onClick={() => resolveImport('overwrite')}>
                Overwrite
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatProjects;
