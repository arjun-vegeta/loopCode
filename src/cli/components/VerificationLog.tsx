import React from 'react';
import { Box, Text } from 'ink';

export interface VerificationLayerState {
  passed: boolean | null;
  durationMs: number;
  cost: number;
}

export interface VerificationLayers {
  compile: VerificationLayerState;
  lint: VerificationLayerState;
  tests: VerificationLayerState;
  security: VerificationLayerState;
}

interface VerificationLogProps {
  layers: VerificationLayers;
}

export function VerificationLog({ layers }: VerificationLogProps) {
  const renderLayer = (name: string, state: VerificationLayerState) => {
    let statusText = '○ Pending';
    let statusColor = 'gray';

    if (state.passed === true) {
      statusText = '✓ Passed';
      statusColor = 'green';
    } else if (state.passed === false) {
      statusText = '✗ Failed';
      statusColor = 'red';
    } else if (state.durationMs > 0) {
      statusText = '⏳ Verifying';
      statusColor = 'yellow';
    }

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginX={1} width={18}>
        <Text bold>{name}</Text>
        <Text color={statusColor}>{statusText}</Text>
        <Text dimColor>Time: {(state.durationMs / 1000).toFixed(1)}s</Text>
        <Text dimColor>Cost: ${state.cost.toFixed(4)}</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="yellow">
        Verification Log
      </Text>
      <Box flexDirection="row">
        {renderLayer('Compile', layers.compile)}
        {renderLayer('Lint', layers.lint)}
        {renderLayer('Tests', layers.tests)}
        {renderLayer('Security', layers.security)}
      </Box>
    </Box>
  );
}
