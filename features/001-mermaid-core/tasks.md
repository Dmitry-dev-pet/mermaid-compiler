# Tasks

- [x] Define session (project) data model and persistence rules in IndexedDB.
- [x] Implement session storage service (create/list/load/delete/rename).
- [x] Add session orchestration in `useDiagramStudio`/`useProjects` (load, autosave).
- [x] Add chat panel UI for session list and actions (continue/delete/new/rename).
- [x] Persist session settings and optional model parameters.
- [x] Validate resume/delete flows with existing history and settings.
- [x] Add Markdown fix mode to sequentially fix all invalid blocks via the existing Fix button.
- [x] Stop on first failure and record a history step per block.
- [x] Remove delete confirmation and add Undo for project deletion.
- [x] Add chat toggle `MD notebook` and optional `N` input (user-provided `N` has priority over planner).
- [x] Add planner step that returns structured `NotebookPlan` (with `glossary` + independent `buildPrompt` per diagram).
- [x] Create markdown notebook skeleton with `N` Mermaid blocks and set markdown notebook mode on Build.
- [x] Sequentially build each block with relevant docs via diagramType switching (variant B) + await docs load.
- [x] For each diagram: up to 3 attempts (build + validate + auto-fix); on 3 failures continue to next block.
- [x] Restore original `diagramType` after notebook pipeline completes.
- [x] Record progress messages and history meta per block (notebook mode, block index, diagram type).
- [x] Зафиксировать в плане/интенте ограничение: без theme/look директив и разноцветных оформлений.
- [x] Добавить per-block чат для notebook: `chat.md` из Build Docs и raw intent из плана; сохранять и восстанавливать из IndexedDB; retries как отдельные сообщения.
- [x] Разделить Build Docs на две панели (docs + intent) с ресайзером и плейсхолдером.
- [x] Унифицировать UI-контролы (Button/Tab/Input/Select/Radio) и выровнять хедеры.

---

Поддержка/рефакторинг (актуализация):

- [x] Вынести Mermaid-логику в `diagram-compiler/services/mermaid/*` (markdown/validate/llm) и сохранить совместимый `diagram-compiler/services/mermaidService.ts`.
- [x] Разбить превью на поверхности и модели:
  - `diagram-compiler/components/preview/PreviewSurface.tsx` + `diagram-compiler/components/preview/surfaces/*`.
  - `diagram-compiler/hooks/preview/usePreviewContentMode.ts` + `diagram-compiler/hooks/preview/usePreviewHeaderModel.ts`.
- [x] Вынести ChatColumn view model в `diagram-compiler/components/chat/useChatColumnViewModel.ts` и добавить компоненты сообщений/summary.
- [x] Обновить работу operation logs: структурированные метаданные, inline/anchored отображение, тесты.
- [x] Декомпозировать `useDiagramStudio` на специализированные хуки студии (`useStudioTabs`, `useStudioHydration`, `useStudioChatContext`, `useStudioChatFlow`, `useStudioWhiteboard`, `useProjectPreview`).
- [x] Улучшить Excalidraw whiteboard: управление темой/фоном canvas и персистентность для notebook.
- [x] Вынести UI проектов и выбора типов в отдельные компоненты (projects menu, diagram type picker, message list/summary).
- [x] Поддержать whiteboard bundle по markdown-блокам (выбор/сохранение сцены по активному индексу).
- [x] Расширить покрытие тестами критических пайплайнов (build/autofix/notebook) и утилит (operation logs, log context, docs context).

---

Storage Providers — reconciliation 2026-09-29:

- [x] Определить интерфейс провайдера хранения + capabilities (local/hosted/byo).
- [x] Реализовать bundle проекта (session + steps + revisions) и формат бэкапа.
- [x] Добавить UI Backup (Export/Import) в Projects menu.
- [x] Реализовать hosted Supabase provider (projects table + optimistic version).
- [ ] BYO Supabase: добавить собственный auth/session flow; текущий provider/config/schema требуют authenticated user, но UI использует hosted `AuthContext`.
- [ ] E2EE: подключить `createEncryptedProvider()` к активному hosted/BYO cloud flow; crypto primitives уже есть.
- [ ] Share: довести viewer/editor UX и E2EE key-in-fragment; API и read-only viewer уже есть.
- [ ] Conflicts: добавить реальный UX overwrite / open cloud / save copy для `StorageConflictError`.

---

SaaS / Hybrid Storage — reconciliation 2026-09-29:

- [x] Hosted `AuthContext`: Supabase OAuth + reactive session.
- [ ] Dynamic storage factory: project orchestration всё ещё local-first, cloud работает отдельным `useCloudControlPlane`.
- [x] Базовая миграция local → cloud (upload/link/import).
- [x] Deep link `/share/:token`: read-only viewer без autosave.
- [ ] Fork/copy shared → active storage; сейчас Fork импортирует только в local IndexedDB.
- [x] Добавить GitHub Actions CI: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

---

Обновлено: 2026-09-29.
