import React from 'react';
import { Box, Text } from 'ink';
import { getPermissionMode } from '../state.js';

export function StatusBar() {
  const mode = getPermissionMode();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" borderStyle="single" borderColor="dim">
        <Text color="gray">[Shift+Tab: Mode ({mode})] [Ctrl+S: Sessions] [Ctrl+M: Models] [Ctrl+C/D: Exit]</Text>
      </Box>
    </Box>
  );
}
