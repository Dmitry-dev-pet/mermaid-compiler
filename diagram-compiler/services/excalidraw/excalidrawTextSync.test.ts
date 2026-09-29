import { describe, expect, it } from 'vitest';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { applyContainerTextMap, buildContainerTextMap } from './excalidrawTextSync';

describe('excalidrawTextSync', () => {
  it('builds container text map and applies updates', () => {
    const source: OrderedExcalidrawElement[] = [
      { id: 'rect1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 } as unknown as OrderedExcalidrawElement,
      { id: 't1', type: 'text', containerId: 'rect1', text: 'A', originalText: 'A', version: 1, versionNonce: 10 } as unknown as OrderedExcalidrawElement,
      { id: 't2', type: 'text', containerId: 'edge1', text: 'old', originalText: 'old', version: 2, versionNonce: 20 } as unknown as OrderedExcalidrawElement,
      { id: 'freeText', type: 'text', text: 'x', originalText: 'x', version: 1, versionNonce: 30 } as unknown as OrderedExcalidrawElement,
    ];

    const nextGenerated: OrderedExcalidrawElement[] = [
      { id: 'rect1', type: 'rectangle', x: 100, y: 100, width: 10, height: 10 } as unknown as OrderedExcalidrawElement,
      { id: 't9', type: 'text', containerId: 'rect1', text: 'B', originalText: 'B' } as unknown as OrderedExcalidrawElement,
      { id: 't10', type: 'text', containerId: 'edge1', text: 'new', originalText: 'new' } as unknown as OrderedExcalidrawElement,
      { id: 'freeText', type: 'text', text: 'y', originalText: 'y' } as unknown as OrderedExcalidrawElement,
    ];

    const map = buildContainerTextMap(nextGenerated);
    expect(map.get('rect1')?.text).toBe('B');
    expect(map.get('edge1')?.text).toBe('new');

    const { elements: patched, changed } = applyContainerTextMap(source, map);
    expect(changed).toBe(true);

    const t1 = patched.find((e) => e.id === 't1');
    const t2 = patched.find((e) => e.id === 't2');
    const free = patched.find((e) => e.id === 'freeText');
    if (!t1 || !t2 || !free) throw new Error('Elements not found');
    if (t1.type !== 'text' || t2.type !== 'text' || free.type !== 'text') {
      throw new Error('Expected text elements');
    }
    expect(t1.text).toBe('B');
    expect(t2.text).toBe('new');
    expect(free.text).toBe('y');
    expect(t1.version).toBe(2);
    expect(t2.version).toBe(3);
  });

  it('does not mark changed if texts are identical', () => {
    const elements: OrderedExcalidrawElement[] = [
      { id: 'rect1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 } as unknown as OrderedExcalidrawElement,
      { id: 't1', type: 'text', containerId: 'rect1', text: 'A', originalText: 'A', version: 1, versionNonce: 10 } as unknown as OrderedExcalidrawElement,
    ];
    const map = buildContainerTextMap(elements);
    const result = applyContainerTextMap(elements, map);
    expect(result.changed).toBe(false);
  });
});
