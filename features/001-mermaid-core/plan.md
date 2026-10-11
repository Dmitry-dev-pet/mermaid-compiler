# Plan

Статус: выполнено (база) + активный рефакторинг/поддержка.

1. [x] Describe the session data model and persistence in IndexedDB.
2. [x] Add session storage layer (create/list/load/delete) alongside existing history services.
3. [x] Integrate session lifecycle into studio orchestration (load/save on change).
4. [x] Add chat panel UI for sessions (list + actions).
5. [x] Ensure session settings include all per-session parameters (model params optional).
6. [x] Verify resume/delete flows and persistence across reloads.
7. [x] Add Markdown fix mode that sequentially fixes all invalid blocks.
8. [x] Stop on first failed block and record a history step per block.
9. [x] Switch project deletion to no-confirm with Undo.
10. [x] Define `NotebookPlan` JSON schema + planner prompts.
11. [x] Add chat toggle `MD notebook` and optional `N` input.
12. [x] Implement notebook pipeline: planner → markdown skeleton → sequential builds.
13. [x] Per-block docs via diagramType switching (variant B) + await docs load.
14. [x] Retry up to 3 attempts per diagram; continue on failure.
15. [x] Record progress + history meta per block.
16. [x] Ensure notebook plan fixes the constraint: no styling directives/colors in blocks.
17. [x] Add per-block notebook chat (chat.md from Build Docs; raw shows plan intent) and persist per diagram.
18. [x] Split Build Docs panel into two panes (docs + intent) with resizer and placeholders.

---

Maintenance:
19. [x] Unify UI controls (Button/Tab/Input/Select/Radio) and align header toggles across columns.

---

Refactor / maintenance (после 2026-01-22):
20. [x] Split Mermaid helpers into `services/mermaid/*` (markdown/validate/llm) with stable `mermaidService` exports.
21. [x] Refactor Preview rendering into surfaces + hooks (content mode, header model, markdown meta, scroll sync, SVG render/panzoom).
22. [x] Restructure operation logs view models + anchored inline logs in chat, add/expand tests.
23. [x] Extract Studio orchestration into dedicated hooks (tabs/hydration/chat flow/chat context/whiteboard/project preview).
24. [x] Improve Excalidraw canvas background/theme controls and persist behavior for notebook.
25. [x] Refactor chat/project UI: extract projects menu + diagram type picker + message list/summary components.
26. [x] Support whiteboard bundle per markdown block (resolve/update by active block index).
27. [x] Expand unit tests for build pipeline/autofix/operation runner/log context and docs context.

---

Storage Providers — reconciled 2026-09-29:
28. [x] Define storage provider interface + capabilities (local/hosted/byo).
29. [x] Add project bundle export/import (session + steps + revisions) and wire into studio.
30. [x] Add UI for backup/export/import in Projects menu.
31. [x] Implement hosted Supabase provider (projects table + optimistic versioning).
32. [ ] Finish BYO Supabase: provider/config/schema exist, but add BYO-specific auth/session flow and verify end-to-end sync.
33. [ ] Wire E2EE into active cloud storage: crypto + encrypted provider exist, but hosted/BYO runtime paths still advertise/use `e2ee: false`.
34. [ ] Finish sharing: route/API/viewer exist; add editor UI, propagate permission, and implement E2EE key handling via URL fragment.
35. [ ] Add cloud conflict-resolution UX (overwrite / open cloud / save copy), not only conflict detection/error text.

---

SaaS / Hybrid Storage — reconciled 2026-09-29:
36. [x] Add hosted `AuthContext` (Supabase OAuth + reactive session).
37. [ ] Replace local-primary + cloud-control-plane split with a true dynamic storage factory (local/hosted/byo) used by project orchestration.
38. [x] Implement basic migration flow local → cloud (upload/link/import path via `useCloudControlPlane`).
39. [x] Add share deep-link entry (`/share/:token`) as read-only mode without autosave.
40. [ ] Finish Fork flow so shared projects copy into the user's active storage; current implementation forks to local IndexedDB only.
41. [x] Add application CI on pull requests and `main`: typecheck, lint, tests, build.

---

Обновлено: 2026-09-29.


## OpenCode Go — 2026-10-10

42. [x] Add the personal OpenCode Go provider and isolated browser credential setting.
43. [x] Add a fixed-destination, non-persistent Go request handler with client/session identification.
44. [x] Wire Go model discovery and stable conversation IDs through all studio operations.
45. [x] Verify provider/handler behavior with mocked upstream requests and run application quality checks.
46. [x] Keep real subscription verification explicit and separate from catalogue discovery.

Validation: typecheck, lint, all 307 tests and production build passed in [CI run 38090010331](https://github.com/Dmitry-dev-pet/mermaid-compiler/actions/runs/38090010331) for code commit `0362730f6b5519b35cb46ecab25efc6f8b6e0099`. Real subscription generation still requires a user-supplied key and an explicit prompt in the application.

## Direct ChatGPT subscription — 2026-10-11

47. [x] Add the local SIWC registration/session store and validated browser OAuth flow.
48. [x] Add account model discovery and completed-only Responses streaming with cancellation.
49. [x] Serve the local editor through a protected same-origin Mermaid Agent API.
50. [x] Integrate the ChatGPT provider, login/account controls and honest subscription status into the SPA.
51. [x] Verify security/lifecycle boundaries and existing application behavior, then package the local Agent and built editor.
52. [ ] Verify the user's real browser sign-in and first diagram after local launch.


Validation: Node 22 typecheck, lint, all 395 editor tests, all 102 Agent tests, production build and packaged local startup passed in [CI run 38096085339](https://github.com/Dmitry-dev-pet/mermaid-compiler/actions/runs/38096085339) for code commit `95bd8acc19520c2e75730cf35c0dfa60a96ba56d`. The [local workspace package](https://github.com/Dmitry-dev-pet/mermaid-compiler/actions/runs/38096085339/artifacts/11686050219) includes the Mac launcher, built editor, dependency-free Node Agent, source archive and checksum. Real browser sign-in and the first completed response on the user's subscription remain a separate acceptance step; tests used synthetic session data.


## Cloud-alpha usability pass — 2026-10-11

53. [ ] Add safe persisted Simple/Studio workspace mode; default Simple; preserve three-column Studio and notebook/manual rendering.
54. [ ] Reduce duplicated setup chrome in Simple; explain local browser storage and absent AI access without disabling offline editing.
55. [ ] Clarify Fix/History labels and empty Summary; avoid calling an unconfigured provider connected.
56. [ ] Test persisted mode, editor toggle, existing operations, typecheck, lint and production build.
57. [ ] Verify exact-head CI and authoritative production deployment SHA. Legacy Vercel project lifecycle cleanup is separate and requires reviewed authority.

Out of scope for this pass: live subscription inference, API keys, dynamic cloud storage provider, E2EE, sharing and streaming protocol changes.


## Mobile workspace verification — 2026-10-11

58. [ ] Add small-screen Studio Chat/Code/Preview tab navigation, one visible pane at a time, without changing desktop behavior.
59. [ ] Make header, projects and AI settings fit 320–430px without horizontal overflow; preserve existing controls and safe area.
60. [ ] Add headless browser viewport tests (mobile 320/390px, desktop), capture screenshot/evidence in CI and verify actual live production after merge.


## Safe cloud conflicts — 2026-10-11

61. [ ] Detect a conflict with structured local project / remote project context and present two recovery actions in the gated Cloud section.
62. [ ] Save the local bundle to a **new** cloud project, keeping the previous conflicting remote intact.
63. [ ] Import the latest cloud bundle as a **new** local project while keeping the user's original local state intact.
64. [ ] Stop Sync All on the first failed upload/conflict and preserve the relevant status.
65. [ ] Mock-test conflict resolution and provider failure/cancellation, run normal project CI. Do not activate hidden cloud or create/mutate unrelated Supabase backend.
