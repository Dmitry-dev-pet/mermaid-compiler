// Located inside diagram-compiler/ so Node resolves the project's existing mermaid dependency.
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

export async function validateWithMermaid(source) {
  const parsed = await mermaid.parse(source, { suppressErrors: true });
  return Boolean(parsed);
}
