import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar } from './ProgressBar.js';
import { COLORS, STATUS_ICONS } from '../theme.js';

export interface TaskUiState {
  id: string;
  title: string;
  model: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'verifying' | 'retrying';
  stepsCompleted: number;
  stepsTotal: number;
  cost: number;
  budget: number;
}

interface TaskCardProps {
  task: TaskUiState;
}

export function TaskCard({ task }: TaskCardProps) {
  const progress = task.stepsTotal > 0 ? task.stepsCompleted / task.stepsTotal : 0;

  let costColor = 'green';
  let costLabel = '';
  let costInverse = false;

  if (task.cost > task.budget) {
    costColor = COLORS.error;
    costLabel = ' [EXCEEDED!]';
    costInverse = true;
  } else if (task.cost > task.budget * 0.8) {
    costColor = COLORS.error;
  } else if (task.cost > task.budget * 0.5) {
    costColor = COLORS.warning;
  }

  const statusColors = {
    pending: COLORS.dim,
    executing: COLORS.primary,
    completed: COLORS.success,
    failed: COLORS.error,
    verifying: COLORS.warning,
    retrying: COLORS.highlight,
  };

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} width={32} margin={1} flexDirection="column">
      <Text bold>{task.title}</Text>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>Model: {task.model}</Text>
        <Text color={statusColors[task.status]}>
          {STATUS_ICONS[task.status]} {task.status}
        </Text>
      </Box>
      <ProgressBar value={progress} label="Progress" />
      <Box flexDirection="row" justifyContent="space-between">
        <Text>Spent: </Text>
        <Text color={costColor} inverse={costInverse} bold={costInverse}>
          ${task.cost.toFixed(4)} / ${task.budget.toFixed(2)}
          {costLabel}
        </Text>
      </Box>
    </Box>
  );
}
