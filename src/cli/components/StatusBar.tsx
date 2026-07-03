import React from 'react';
import { Box, Text } from 'ink';
import { getPermissionMode } from '../state.js';

interface StatusBarProps {
  cost?: {
    spent: number;
    limit: number;
  };
}

export function StatusBar({ cost }: StatusBarProps) {
  const mode = getPermissionMode();

  let progressBar = '';
  if (cost) {
    const ratio = Math.min(1, cost.spent / cost.limit);
    const barWidth = 20;
    const filledWidth = Math.round(ratio * barWidth);
    progressBar = '[' + '█'.repeat(filledWidth) + '░'.repeat(barWidth - filledWidth) + ']';
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" borderStyle="single" borderColor="dim">
        <Text color="gray">[Shift+Tab: Mode ({mode})] [Ctrl+S: Sessions] [Ctrl+M: Models] [Ctrl+C/D: Exit]</Text>
        {cost && (
          <Box flexDirection="row">
            <Text color="gray">Budget: </Text>
            <Text color={cost.spent > cost.limit ? 'red' : 'green'}>{progressBar}</Text>
            <Text color="gray">
              {' '}
              {Math.round((cost.spent / cost.limit) * 105) > 100 ? '>100' : Math.round((cost.spent / cost.limit) * 100)}
              %
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
