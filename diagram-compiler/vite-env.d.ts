/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_ENDPOINT: string;
  readonly VITE_OPEN_ROUTER_ENDPOINT: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ENABLE_EXPERIMENTAL_CLOUD?: string;
  readonly VITE_DOCS_URL?: string;
  readonly VITE_GITHUB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
