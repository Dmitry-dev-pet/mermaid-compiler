import { handleOpenCodeGo } from '../diagram-compiler/server/openCodeGoHandler.js';

// Web Request/Response entrypoint; only this root api directory is deployed by Vercel.
export const POST = handleOpenCodeGo;

// Give direct navigation and preflight attempts a consistent, non-CORS 405 response.
export const GET = handleOpenCodeGo;
export const OPTIONS = handleOpenCodeGo;
