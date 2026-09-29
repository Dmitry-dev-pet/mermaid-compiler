# Mermaid Compiler

**Public alpha · v0.1.0-alpha**

Open-source, local-first workspace for generating, editing, validating, repairing, and exporting technical diagrams with Mermaid and optional AI.

## Why It Is Useful

- Start with plain Mermaid code — no account or AI required.
- Generate diagrams from natural-language prompts when you connect your own AI provider.
- Validate Mermaid syntax and run syntax-aware repair loops.
- Build Markdown notebooks with multiple related Mermaid diagrams.
- Edit code and inspect the live preview side by side.
- Keep projects and history locally in the browser.
- Export diagrams and project backups.
- Inspect prompts, operation logs, and validation feedback instead of hiding model behavior.

The hosted public alpha keeps unfinished cloud features hidden by default. Hosted/BYO Supabase sync, E2EE sharing, and collaborative editor flows remain experimental work.

## Try It

**Live public alpha:** https://mermaid-compiler-hrt94ln5k-dmitrys-projects-60af16a7.vercel.app

No account is required for the local-first editor. AI is optional and uses provider settings you configure in the browser.

## Run Locally

Install both the repository tooling and the application dependencies:

```bash
npm install
npm --prefix diagram-compiler install
```

Start the app:

```bash
npm run dev
```

Vite will print the local URL, usually `http://localhost:5173`.

Quality checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## AI Configuration

AI is optional. Provider settings are configured at runtime in the UI and stored in the browser.

Supported modes include:

- OpenRouter for hosted model access.
- Cliproxy-compatible local/custom endpoints.
- Optional Desktop Agent integrations for local model workflows and quota visibility.

No API keys are committed to this repository.

## Public-Alpha Flow

1. Open the app.
2. Pick one of the example system prompts or write your own.
3. Use **Chat** to clarify the design or **Build** to generate the diagram/notebook.
4. Edit Mermaid code directly.
5. Validate/fix problems and inspect the live preview.
6. Export the result or keep it in local project history.

## Features

- Chat / Build / Fix / Analyze workflows.
- Mermaid live preview with zoom, pan, fit/reset, and fullscreen.
- Markdown notebooks with multiple Mermaid blocks.
- Syntax highlighting and manual editing.
- Automatic Mermaid validation and repair attempts.
- Local project/session history in IndexedDB.
- Excalidraw/whiteboard integration.
- Dark theme and resizable three-column workspace.
- Local Mermaid documentation context for grounded generation.
- Optional OpenRouter, cliproxy, and Desktop Agent integrations.

## Tech Stack

- React 19 + TypeScript + Vite.
- Mermaid 11.
- PrismJS and `react-simple-code-editor`.
- Excalidraw.
- Vitest, strict TypeScript checks, ESLint.
- Optional Supabase and Tauri/Rust integrations.

## Repository Layout

```text
diagram-compiler/          # React + Vite application
diagram-compiler/components/
diagram-compiler/hooks/    # core state and studio orchestration hooks
diagram-compiler/services/ # LLM, Mermaid, history, storage services
agent/                     # optional Tauri desktop agent
docs/                      # project and architecture documentation
mermaid-docs/              # vendored Mermaid docs used as generation context
```

## Documentation

- `docs/project/README.md` — project documentation index.
- `docs/project/architecture.md` — architecture overview.
- `docs/project/ai-overview.md` — AI workflow overview.
- `docs/project/desktop-agent.md` — Desktop Agent notes.
- `docs/project/testing.md` — testing strategy.

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).

## Status

This is a public alpha. The local-first editor/generation workflow is the supported surface; cloud sync/sharing remains experimental until the storage/auth/E2EE work documented in `features/001-mermaid-core/` is completed.
