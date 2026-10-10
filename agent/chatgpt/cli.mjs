import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startChatGPTAgent } from './server.mjs';

const execFileAsync = promisify(execFile);
const openBrowser = async value => {
  const url = new URL(value);
  if (url.username || url.password || !['https://auth.openai.com', 'http://127.0.0.1:8788'].includes(url.origin)) return false;
  const command = process.platform === 'darwin' ? ['open', [url.href]] :
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url.href]] : ['xdg-open', [url.href]];
  try { await execFileAsync(command[0], command[1], { timeout: 10000 }); return true; } catch { return false; }
};

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('Mermaid ChatGPT Agent requires Node.js 22 or later.');
  process.exitCode = 1;
} else {
  try {
    await access(fileURLToPath(new URL('../../diagram-compiler/dist/index.html', import.meta.url)));
    const { handleOpenCodeGo } = await import('./generated/openCodeGoHandler.mjs');
    const agent = await startChatGPTAgent({ openBrowser, goHandler: handleOpenCodeGo });
    const workspace = `${agent.origin}/?ai=chatgpt`;
    console.log(`Mermaid ChatGPT workspace: ${workspace}`);
    console.log('Keep this window open. Continue with ChatGPT in the editor to connect your subscription.');
    console.log('Press Ctrl+C to stop the local Agent.');
    await openBrowser(workspace);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await agent.close(); };
    process.once('SIGINT', () => { stop().catch(() => { process.exitCode = 1; }); });
    process.once('SIGTERM', () => { stop().catch(() => { process.exitCode = 1; }); });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') console.error('Port 8788 is already in use. Close the other local Agent, or open http://127.0.0.1:8788/?ai=chatgpt if it is already running.');
    else if (error?.code === 'ENOENT' || error?.code === 'ERR_MODULE_NOT_FOUND') console.error('The local workspace has not been built. Run npm run build:chatgpt in the project, or use the complete Mermaid ChatGPT download.');
    else console.error('Mermaid Agent could not start. Check that its local session directory is private, owned by you, and writable.');
    process.exitCode = 1;
  }
}
