import React, { PropsWithChildren } from 'react';
import { Box, Text, BoxProps, TextProps } from 'ink';
import { COLORS } from '../theme.js';

interface ThemedTextProps extends PropsWithChildren<TextProps> {
  variant?: keyof typeof COLORS;
}

export function ThemedText({ variant, children, ...props }: ThemedTextProps) {
  const color = variant ? COLORS[variant] : props.color;
  return (
    <Text {...props} color={color}>
      {children}
    </Text>
  );
}

interface ThemedBoxProps extends PropsWithChildren<BoxProps> {
  variant?: keyof typeof COLORS;
}

export function ThemedBox({ variant, children, ...props }: ThemedBoxProps) {
  const borderColor = variant ? COLORS[variant] : props.borderColor;
  return (
    <Box {...props} borderColor={borderColor}>
      {children}
    </Box>
  );
}
