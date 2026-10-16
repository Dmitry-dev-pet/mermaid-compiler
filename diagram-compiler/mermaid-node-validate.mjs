// Mermaid's browser parser requires DOM globals in Node. jsdom is already
// a diagram-compiler devDependency and is loaded before importing Mermaid.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'navigator', 'Element', 'SVGElement', 'HTMLElement',
  'Node', 'DOMParser', 'NodeFilter', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'CSS',
]) {
  if (globalThis[key] === undefined && dom.window[key] !== undefined) {
    globalThis[key] = dom.window[key];
  }
}

// Import after the DOM is installed so DOMPurify binds to a real Window.
const mermaid = (await import('mermaid')).default;
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

export async function validateWithMermaid(source) {
  // Let Mermaid throw its real syntax/DOM error. The deterministic core catches
  // validation failures and rejects edits without changing any source.
  const result = await mermaid.parse(source);
  return Boolean(result);
}
