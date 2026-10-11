# Mermaid Core Spec

## Scope

- Maintain the Diagram Compiler SPA functionality for Mermaid editing, markdown previews, and diagram navigation.

## Current task

Статус: активная поддержка / рефакторинг.

Фича: менеджер проектов (сессий) в панели чата.

Реализовано:

- Проект = сессия пользователя, которую можно продолжить.
- Действия: создать новую сессию, продолжить/открыть существующую, удалить, переименовать.
- Хранилище: IndexedDB (данные сессии не в localStorage).
- UI: список проектов в панели чата с основными действиями.
- Персистентность: сохраняются настройки UI и LLM (включая опциональные параметры модели).

Реализовано (предыдущие задачи):

- Preview navigation buttons visible for markdown diagrams in `markdown_mermaid`.
- Inline direction follows Mermaid syntax (`TD` only for flowchart headers, `direction` statements for class/state/ER/requirement).
- Markdown-wide theme selection applies to all Mermaid blocks.
- Markdown-wide look selection applies to all Mermaid blocks (dir hidden in markdown preview).
- Theme/look uses YAML frontmatter (`config:`) instead of deprecated directives.
- Column headers (Chat, Editor, Preview) are kept at equal height.
- Scroll sync toggle links Editor and Preview in markdown mode.
- Active markdown block uses solid left bar only on preview hover.
- Scroll sync uses proportional height mapping for smooth movement.

Фича: режим фиксации Markdown (последовательное исправление всех невалидных блоков).

Требования:

- Одна кнопка Fix запускает режим.
- В режиме Fix для Markdown блоки исправляются по очереди.
- Остановка на первом неуспешном блоке.
- История фиксируется шагом на каждый блок.

Следующие шаги: только косметика/maintenance.

Обновление (текущее состояние кода):

- Большой рефакторинг Preview: монолитный рендер разбит на поверхности (`PreviewSurface`) и хуки.
  - Режимы превью: `svg`, `markdown`, `buildDocs`, `whiteboard`, `notebookTiles`, `empty`.
  - Выделены хуки для хедера/режима превью/рендера SVG/scroll-sync.
- Поверхности превью выделены в отдельные компоненты:
  - `diagram-compiler/components/preview/PreviewSurface.tsx`.
  - `diagram-compiler/components/preview/surfaces/*` (SVG/Markdown/BuildDocs/Whiteboard/NotebookTiles/Empty).
- Рефакторинг Studio orchestration:
  - Вынесены студийные подсистемы в отдельные хуки (`useStudioTabs`, `useStudioHydration`, `useStudioChatContext`, `useStudioChatFlow`, `useStudioWhiteboard`).
  - Контекстные чаты (main vs блоки) и автоматическая прокладка `contextId/mode/blockIndex` в history meta.
- Whiteboard/Excalidraw сохранение теперь учитывает markdown notebook:
  - Whiteboard хранится как bundle, где сцены раздельны по блокам.
  - Активная сцена выбирается по текущему `markdownMermaidActiveIndex`.
- Рефакторинг Chat UI:
  - Логика вью-модели вынесена в `useChatColumnViewModel`.
  - Введены выделенные компоненты списка сообщений/summary.
  - Статус-сообщения и operation logs корректно отделяются/привязываются (anchored) к сообщениям.
- Проекты (сессии) и управление ими вынесены в отдельные UI-части:
  - Меню проектов (sort/rename/delete/continue/preview) и управление открытием.
  - Пикер типа диаграммы стал самостоятельным компонентом, с наборами типов и пресетами N для notebook-build.
- Header/UI декомпозирован на более мелкие компоненты:
  - Верхняя панель использует отдельные меню для AI и темы.
- Mermaid services: разбиение сервиса на модули (`services/mermaid/markdown|validate|llm`) с реэкспортом через `services/mermaidService`.
- Excalidraw/whiteboard: улучшения темы/фона canvas и их персистентности (в т.ч. для notebook-режима).
- Укреплены тесты на критические пайплайны (autofix/build/notebook/operation logs/контекст) и утилиты.

Поддержка (последние изменения):

- Операционные логи (Plan/Diagrams) и тултипы контекста (messages/docs).
- Таймаут LLM и его настройка в панели чата.
- Ресайз панели ввода в чате.
- Унификация UI-контролов (Button/Tab/Input/Select/Radio) и визуальное выравнивание хедеров/переключателей.

Обновление поведения проектов:

- Удаление проекта без предупреждения.
- После удаления доступна кнопка Undo (отмена удаления).

Фича: режим сборки MD notebook из чата (несколько диаграмм по одной кнопке Build).

Идея:

- В чате рядом с Build доступен toggle `MD notebook`.
- Если toggle включен, Build генерирует не одну диаграмму, а Markdown-файл с несколькими Mermaid-блоками.
- Для согласованности терминов используется общий план (planner) и glossary; промпт каждой диаграммы независим.

Требования (UX):

- Toggle `MD notebook` расположен рядом (как switch/toggle) и влияет на поведение Build.
- Рядом с toggle доступно поле `N` (количество диаграмм, optional).
  - Если пользователь задал `N`, planner обязан построить план ровно на `N` диаграмм (приоритет пользователя).
  - Если `N` не задано, planner выбирает `N` по запросу.
- Генерация запускается только по кнопке Build (toggle сам по себе ничего не создает).

Требования (flow):

- По нажатию Build в notebook-режиме выполняется planner-запрос, который возвращает структурированный JSON `NotebookPlan`:
  - итоговое `resolvedN`
  - список диаграмм (каждая: `diagramType`, `title`, `goal`, `buildPrompt`, `acceptance`)
  - `glossary` (общие термины и канонические названия)
- После planner создается markdown-скелет ноутбука с `resolvedN` mermaid-блоками и заголовками, затем запускается последовательная генерация блоков.
- Для каждого блока `i` (1..N):
  - Временно устанавливается `appState.diagramType = plan.diagrams[i].diagramType` (вариант B).
  - Обязательно дождаться обновления docs-entries для выбранного типа (чтобы `getDocsContext('build')` был релевантным).
  - Выполняется до 3 попыток построения диаграммы:
    - попытка = build + validation + auto-fix (в рамках существующих лимитов), затем повторная validation
    - если после попытки код все еще невалиден, выполняется следующая попытка
  - Если после 3 попыток блок невалиден — блок помечается как failed (сообщение в чат) и pipeline продолжает следующий блок.
- Все диаграммы в notebook должны быть без стилевых директив и разноцветных оформлений.
- Planner/чат должны явно фиксировать это ограничение в плане: без theme/look/красок.
- После завершения notebook pipeline возвращается исходный `appState.diagramType` (тот, что был до Build).
- Для каждого блока в notebook создается отдельный чат:
  - При переключении активного блока в markdown-представлении чат переключается на чат этого блока.
  - Основной чат относится к общей markdown-вкладке (MD), а не к отдельным блокам.
  - В `chat.md` отображается system prompt из Build Docs (чат-режим) для этой диаграммы.
  - В raw-режиме вместо `chat.md` отображается intent из плана для этого блока (title/diagramType/goal/buildPrompt/acceptance + glossary + constraints).
  - Попытки (retries) отображаются как отдельные сообщения в чате блока.
  - Чаты блоков сохраняются в истории/сессии (IndexedDB) и восстанавливаются.

UI (Build Docs):

- В режиме `build_docs` окно редактора делится на две панели (вертикально, сверху вниз) 50/50.
- Верхняя панель: текущий документ/системный промпт (как сейчас).
- Нижняя панель: Intent с подсветкой Markdown.
- Между панелями есть ресайзер.
- Если Intent отсутствует — показывается плейсхолдер.
- Все LLM-запросы защищены таймаутом; при таймауте выполняются повторы только для текущего шага (по умолчанию 3 попытки).

Требования (docs):

- Для каждой диаграммы используется релевантный docs context, определяемый текущим `appState.diagramType` (вариант B).
- Planner также использует docs context, но не привязан к одному блоку; его задача — подобрать типы диаграмм и независимые промпты.
- Chat в notebook-режиме возвращает intent для planner (структура с разделами Summary/Diagrams/Glossary/Constraints/Open questions).

## Новая инициатива: Storage Providers + Cloud Sync (опционально)

### Цели
- Добавить провайдеры хранения проектов: `Local (IndexedDB)`, `Cloud (Hosted Supabase)`, `Cloud (BYO Supabase)`.
- Сделать cloud-синк **опциональным** (opt-in), default — локально.
- Поддержать **E2EE** (шифрование на клиенте) для облака.
- Базовый UX: backup/export/import для проектов как единый bundle.
- Шаринг: анонимные share-ссылки `viewer/editor` для cloud провайдеров.

### Базовые допущения
- Проект = `HistorySession` (session + steps + revisions) — текущая модель.
- Для MVP cloud-синка допускается хранить проект **целиком** одним blob’ом (без событий/снапшотов).
- История/логи/чаты включаются в bundle проекта (минимально — для восстановления).
- Вложения/файлы: не входят в MVP (можно добавить позже как отдельный модуль).

### Требования (MVP)
- **Local provider**: экспорт/импорт проекта (JSON bundle).
- **Hosted Supabase provider**:
  - Auth (email/OAuth).
  - Таблица `projects` с полем `blob` (ciphertext или plaintext).
  - Optimistic concurrency через `version`.
  - Share-link viewer/editor через server-side share API.
- **BYO Supabase provider**:
  - Настройка `SUPABASE_URL` + `ANON_KEY`.
  - Собственная auth-сессия пользователя для выбранного BYO instance.
  - Та же схема/контракт хранения, что и для hosted режима.
- **E2EE**:
  - Клиентское шифрование `AES-GCM`.
  - Key management через passphrase (KDF) + wrapped vault key.
  - Активный cloud provider должен реально использовать encrypted wrapper.
  - Share-link содержит секрет ключа в `#fragment` URL (сервер не получает ключ).
- **Конфликты**:
  - `put` с `baseVersion` и 409 при конфликте.
  - UX: overwrite / open cloud / save copy.

### Нефункциональные требования
- Не ломать текущий offline-first флоу.
- Сохранять совместимость с текущими сессиями.
- Строгая типизация, без `any`.
- UI в hooks, компоненты остаются презентационными.

### Reconciliation 2026-09-29

Проверка текущего `main` показала, что документация отставала от реализации. Ниже зафиксирован фактический статус, который нужно использовать как исходную точку дальнейшей разработки.

Реально реализовано:

- интерфейс `StorageProvider`, local provider и hosted/BYO Supabase providers;
- project bundle export/import и backup UI;
- hosted Supabase CRUD + optimistic versioning;
- `AuthContext` с hosted Supabase OAuth и реактивной сессией;
- режимы `local | cloud_hosted | cloud_byo` в UI;
- ручной cloud sync/import и migration local → cloud через `useCloudControlPlane`;
- route `/share/:token`, read-only `ShareViewer` и Fork в новую локальную сессию;
- server-side share API с проверкой `viewer/editor` permission и 409 при конфликте;
- криптографические primitives и `createEncryptedProvider()`.

Не завершено:

- `cloud_byo` имеет собственный Supabase client и требует `client.auth.getUser()`, но отдельный BYO login/session flow не подключён к UI;
- active project/history остаются local-first (IndexedDB), а cloud подключён отдельным control plane. Полноценной dynamic storage factory, которая подменяет основной `StorageProvider`, нет;
- `createEncryptedProvider()` не подключён к активному cloud control plane; реальные hosted/BYO providers объявляют `e2ee: false`;
- share-link не переносит E2EE key через `#fragment`, `wrapped_project_key` при создании ссылки не используется;
- `ShareViewer` не реализует editor UX даже для ссылки с permission=`editor`;
- cloud conflict detection существует, но UI разрешения конфликта (overwrite / open cloud / save copy) отсутствует;
- Fork из share viewer всегда импортирует проект локально, а не в выбранный active storage.

---

## SaaS-трансформация: Hybrid Storage Architecture (в работе)

Цель: приложение перестаёт быть только локальным редактором и становится клиентом платформы с гибридным хранением и шарингом.

### Текущее состояние

Сейчас основным хранилищем проекта остаются `HistorySession`/IndexedDB. Cloud-операции выполняются отдельно через `useCloudControlPlane`:

```text
History / IndexedDB
        ↓
   Studio project
        ↓
useCloudControlPlane
        ↓
Hosted/BYO Supabase
```

Это рабочий промежуточный этап, но он **не равен** целевой Dynamic Storage Factory ниже.

### Целевая архитектура (C4 / component-level)

A. **Auth Context (слой идентификации)**
- Hosted режим: глобальный `AuthContext` держит реактивную Supabase-сессию и OAuth login/logout.
- BYO режим: должен иметь auth/session для выбранного BYO client, а не зависеть от hosted client.
- Storage layer использует auth соответствующего активного provider для RLS/прав доступа.

B. **Dynamic Storage Factory (слой данных)**
- Активный `StorageProvider` выбирается динамически и становится единым storage backend для orchestration.
- Режимы:
  - `local` → `createLocalProvider()` (IndexedDB/History).
  - `cloud_hosted` → `createSupabaseHostedProvider()`.
  - `cloud_byo` → `createSupabaseByoProvider()`.
- E2EE включается wrapper-ом над выбранным cloud provider, а не отдельным неиспользуемым utility.
- Переключение provider и migration должны сохранять project IDs/UUID и консистентность ревизий.

C. **Route Guard & Deep Linking (слой входа)**
- Default Mode (`/`): полный редактор, загрузка проекта из активного storage.
- Share Mode (`/share/:token`): read-only viewer по умолчанию, без autosave/локального состояния.
- Editor share: отдельный разрешённый flow для `permission=editor` с optimistic concurrency.
- `Fork / Copy to my account` создаёт копию проекта в активном storage пользователя.

### Потоки (data flow)

1) Login:
- User нажимает Login → OAuth → возврат в приложение → auth state обновляется.
- StorageFactory выбирает provider согласно `storageMode`.
- При переходе local → cloud UI предлагает initial migration/sync.

2) Open by share link:
- `/share/:token` → загрузка через `fetchShared(token)`.
- Viewer permission → read-only.
- Editor permission → редактирование только после явной активации editor flow.
- E2EE share decrypts client-side using key material from URL fragment.
- `Fork` создаёт независимую копию в active storage.

## Constraints

- Keep UI state in hooks; components should remain presentation-focused.
- Use existing React + Tailwind patterns in `diagram-compiler/`.

## Current architecture notes (high-level)

- `diagram-compiler/hooks/studio/useDiagramStudio.ts` остаётся точкой оркестрации, но большая часть логики вынесена в специализированные хуки (tabs/hydration/chat context/chat flow/whiteboard).
- `diagram-compiler/components/PreviewColumn.tsx` собирает модель/props, а рендер превью разнесён по `diagram-compiler/components/preview/PreviewSurface.tsx` и `diagram-compiler/components/preview/surfaces/*`.
- Preview-логика разделена на небольшие хуки:
  - выбор режима отображения (`diagram-compiler/hooks/preview/usePreviewContentMode.ts`)
  - модель хедера (`diagram-compiler/hooks/preview/usePreviewHeaderModel.ts`)
  - scroll-sync (`diagram-compiler/hooks/preview/usePreviewScrollSync.ts`)
  - SVG render/zoom (`diagram-compiler/hooks/preview/useMermaidSvgRender.ts`, `diagram-compiler/hooks/preview/useSvgPanZoom.ts`)
- Chat UI декомпозирован: view-model (`diagram-compiler/components/chat/useChatColumnViewModel.ts`) + отдельные компоненты (`diagram-compiler/components/chat/ChatMessageList.tsx`, `diagram-compiler/components/chat/ChatSummaryCard.tsx`, проекты/пикер типов).
- Mermaid utilities структурированы по назначению:
  - markdown parsing/edit (`diagram-compiler/services/mermaid/markdown.ts`)
  - validate/init (`diagram-compiler/services/mermaid/validate.ts`)
  - LLM response parsing (`diagram-compiler/services/mermaid/llm.ts`)
  - re-export/compat (`diagram-compiler/services/mermaidService.ts`)

---

Обновлено: 2026-09-29.


## OpenCode Go — 2026-10-10

User goal: use a personal OpenCode Go subscription for Mermaid code generation, discussion, validation repair and analysis.

- Add a distinct `opencode-go` LLM provider; preserve existing provider behavior and local project storage.
- Use the documented Go API only, initially for models served by its Chat Completions endpoint. Load the available models from the Go model catalogue and exclude models requiring Responses or Messages until those transports are implemented.
- The user enters a personal Go API key in a masked settings field. Store it only in its own browser localStorage entry; never include it in AIConfig, project/session history, backups, operation logs or source code.
- The browser sends that key only to a same-origin Go handler. The handler forwards each request to a fixed official Go endpoint, supplies an honest Mermaid Compiler User-Agent and stable `x-opencode-session`, and does not store credentials or request contents.
- Keep the conversation identifier stable across Chat, Build, Analyze, Fix and retries within one project/conversation.
- The handler accepts only model-list and Chat Completions requests; arbitrary destinations, headers, tool execution and application-controlled billing fallback are out of scope.
- Model-list discovery must not generate text or spend inference quota. A successful catalogue fetch alone must not be presented as proof that a key or subscription is valid.
- Show actionable authentication, subscription/quota, timeout and unsupported-model errors without leaking request bodies or credentials.
- Reaching a Go limit stops the operation. Do not automatically switch to Zen, another provider, another key or another model.
- A Go timeout must abort the in-flight request and stop the operation. Do not let a timed-out inference continue in the background or launch overlapping automatic retries; syntax-validation repair remains a separate bounded request in the same conversation.
- Explain that the provider's Use balance setting can enable paid usage after a Go limit; users who want subscription-only usage must keep it off in OpenCode Console.
- Do not consume or move credentials owned by other applications. An actual paid-model verification remains a separate, explicit user action in Mermaid.
- Provide the same handler for the Vercel production root and local Vite development so the configured route is real in both environments.
- Acceptance: provider selection, key exclusion from project exports, model discovery, stable session forwarding, cancellation/error handling and regression tests for existing flows; typecheck, lint, tests and build.

## Direct ChatGPT subscription — 2026-10-11

Approved user goal: browser sign-in with the user's ChatGPT subscription for the personal local Mermaid workspace, using the official Sign in with ChatGPT (SIWC) and Responses API flow without requiring Codex or an API key.

- Add a distinct `chatgpt` provider and a lightweight local Mermaid Agent mode under `agent/chatgpt/`, using Node 22 or later. It serves the built editor and its own same-origin API on HTTP `127.0.0.1`; it does not replace the existing optional Tauri/Codex agent.
- Use only the official OAuth and Responses endpoints. Dynamically register the client with a persistent opaque host ID, fresh PKCE/state/nonce, and a loopback `/auth/callback`. Reauthorization reuses the issued client ID for the selected verified account and workspace.
- Verify ID-token signatures, issuer, audience, expiration and nonce before activating an account. Require the granted plan-usage scope. A denied or failed login must not replace an existing valid account.
- Store account registrations and rotating OAuth credentials atomically in an app-owned, owner-only local directory. Never expose OAuth credentials to browser JavaScript, AIConfig, project/session storage, exports, history, logs or the hosted website. Serialize refreshes and prevent a late refresh/callback from restoring a signed-out session.
- Provide Continue with ChatGPT, saved-account selection, explicit add-account, cancel, reconnect and local sign-out. Local sign-out removes that account's session; explain that account-wide app access is managed in ChatGPT settings.
- Bind the server only to loopback, validate the Host and Origin for control/inference requests, and require an app-issued HTTP-only same-site browser session. Serve only the built frontend, never source/config/credential files. Public Vercel clients link to the local workspace and do not proxy OAuth or receive ChatGPT credentials.
- Discover account-specific models with the authorized access token; expose only catalogue entries intended for display. Model loading proves discovery only. Mark generation verified only after an explicit request receives `response.completed`.
- Translate existing text prompts/history to Responses input, with developer instructions instead of explicit system message items, `store: false` and `stream: true`. Omit unsupported sampling/output parameters. No arbitrary URLs, caller-defined headers or tool execution.
- Support Chat/Build/Analyze/Fix through the existing strategy interface. Handle SSE framing, completed/failed/incomplete and interrupted streams, quota/auth errors and cancellation. Timeout, cancellation and limits abort the active request and stop automatic retries/fallback; bounded syntax repairs remain separate explicit pipeline requests.
- Browser login and live inference consume the user's own authorization/plan and are verified only when the user completes the real login and requests generation. Automated tests use synthetic credentials and mocked upstream endpoints.
- Acceptance: OAuth security and refresh races, protected persistence, same-origin server boundary, account/model lifecycle, completed-only inference, cancellation, credential-free exports and existing frontend regressions; typecheck, lint, tests and production build; a runnable local package for Mac.

Protocol reference: https://developers.openai.com/siwc/token-sharing-open-source


## Cloud-alpha usability and release stabilization — 2026-10-11

User-approved scope for this pass: a simpler first-use flow, truthful connection/storage states, and explicit verification of the existing production release path. Do not turn the editor into a one-shot-only generator: Chat, Build, Analyze, Fix, manual source editing, operation logs, Notebook, snapshots and project history remain accessible in Studio.

- Add a **Simple** workspace as the initial/default presentation: chat/specification on the left and rendered result on the right; hide the code/editor pane and its resize handle without deleting project state. An explicit **Studio** switch restores the existing three-column editor and settings. Persist this UI preference locally; invalid/unavailable storage must fall back safely. Do not change saved Mermaid code or project sessions on mode switches.
- In Simple mode, keep Chat and Build separate operations, show whether an AI connection is configured, allow local manual diagrams to render without AI, and explain that project autosave is **in this browser** rather than cloud sync. Notebook/advanced editing remain in Studio; existing notebook projects must still display a meaningful preview in Simple.
- Reduce confusing control labels: the Fix button reports an action, not an error count (5 is a maximum number of attempts); Snapshot means a local history checkpoint. Keep UI language consistent and avoid implying that a model, subscription, cloud or persistent storage is verified when it is not.
- Do not disable manual rendering, SVG/PNG export menus, local history, or explicit AI provider selection. Preserve no-fallback rules on subscription and quota failures. No real OpenCode Go request or credential is part of automated acceptance.
- Test workspace-mode parsing/persistence and mode-switch presentation, run typecheck/lint/unit tests/build and verify the exact PR head. Separately inspect Vercel production, the misconfigured legacy deployment, and the reviewed release route; never assume a green GitHub CI means the public site contains that commit.
- Separate follow-ups, not acceptance requirements of this UI pass: stream Go responses and consumption metrics; full cloud sync/E2EE/collaboration, and personal ChatGPT/Go inference acceptance. Vercel project deletion/unlinking is privileged lifecycle work and requires an appropriate reviewed route.


## Mobile-first workspace navigation — 2026-10-11

User approved continuation after the verified Simple/Studio desktop release. At narrow viewports (320–430 CSS px), the Studio must not expose three squeezed fixed-min-width columns. Present mutually exclusive tabs **Chat**, **Code** and **Preview** while keeping each mounted so project/code/notebook state survives transitions. Simple can remain vertically stacked with chat input and rendered result, but may not cause horizontal page overflow. Header/AI popovers, project menu and action buttons must fit inside the viewport, remain keyboard accessible and preserve their existing semantics. Desktop resizers/three-column Studio must remain unchanged. Do not change AI credentials, inference semantics, Supabase modes or any project data.

Acceptance: browser viewport smoke at 390×844, 320×700 and desktop; assert no page horizontal overflow, all primary navigation reachable, code editable in mobile Studio, switching panes retains code and preview, Simple controls are not clipped, and project/history persists across reload. Run existing quality gate. No paid inference or account sign-in required.


## Non-destructive cloud conflict controls — 2026-10-11

The user approved continuing the cloud backlog, but no dedicated, active Mermaid Supabase backend is configured. Keep hosted/BYO controls behind the existing experimental flag, continue storing projects locally by default, and never enable cloud sync or move user content without an explicit user action and validated authenticated provider. When an optional cloud sync detects a `StorageConflictError` for one locally linked project, never overwrite the remote version implicitly.

Offer two explicit non-destructive recovery actions: **Save local as a NEW cloud copy** (create a separate remote project, then link only this local project to the new remote ID/version) or **Open latest cloud version as a NEW local project** (import remotely fetched bundle as a new local session, link the newly imported session, keep the original local session untouched). The original conflicting cloud document must remain unmodified in both cases. No silent fallback, destructive overwrite or new provider-account credentials. On batch Sync All stop on the first conflict/error rather than overwriting status with a misleading success. Reset stale conflict controls when provider/connection context changes. Handle unavailable provider or failed recovery as an explicit error without discarding the current conflict decision.

Acceptance: deterministic unit tests using a fake `StorageProvider` for both recovery paths and failures; verify no `putProject` or `deleteProject` on conflict recovery, no leaked credentials, and typecheck/lint/full test/build regression. Enabling/creating Supabase schemas, E2EE and sharing remain separate work; confirm active backend and explicit Data API grants/RLS before any production activation.
