import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MobileStudioTabs from './MobileStudioTabs';

describe('mobile Studio navigation', () => {
  it('labels three selectable panes with their active state', () => {
    const html = renderToStaticMarkup(
      <MobileStudioTabs activePane="preview" onSelect={() => {}} />,
    );
    expect(html).toContain('aria-label="Mobile Studio panes"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/>Chat<\/button>/);
    expect(html).toMatch(/>Code<\/button>/);
    expect(html).toMatch(/>Preview<\/button>/);
  });
});
