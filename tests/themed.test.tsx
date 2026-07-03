import { describe, it, expect } from 'bun:test';
import { ThemedText, ThemedBox } from '../src/cli/components/Themed.js';
import { COLORS } from '../src/cli/theme.js';
import React from 'react';

describe('Themed CLI Components', () => {
  it('ThemedText maps variant props to theme colors', () => {
    const textEl = ThemedText({ variant: 'primary', children: 'Hello' }) as React.ReactElement;
    expect(textEl.props.color).toBe(COLORS.primary);
  });

  it('ThemedBox maps variant props to border colors', () => {
    const boxEl = ThemedBox({ variant: 'error', children: 'Error' }) as React.ReactElement;
    expect(boxEl.props.borderColor).toBe(COLORS.error);
  });
});
