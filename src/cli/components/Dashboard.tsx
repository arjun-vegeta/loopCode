import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { TaskCard, TaskUiState } from './TaskCard.js';
import { VerificationLog, VerificationLayers } from './VerificationLog.js';
import { MultilineInput } from './MultilineInput.js';
import { StatusBar } from './StatusBar.js';
import { SessionPicker } from './SessionPicker.js';
import type { SessionRecord } from '../../memory.js';
import { getPermissionMode, setPermissionMode } from '../state.js';

interface CostState {
  spent: number;
  limit: number;
}

interface DashboardProps {
  goalTitle: string;
  phase: 'planning' | 'executing' | 'verifying' | 'done' | 'failed';
  tasks: TaskUiState[];
  cost: CostState;
  verification: VerificationLayers;
  sessions: SessionRecord[];
  onSubmitPrompt: (prompt: string) => void;
  onSessionSelect: (session: SessionRecord) => void;
  onSessionRename: (session: SessionRecord, newName: string) => void;
  onSessionDelete: (session: SessionRecord) => void;
  onModelPickerOpen: () => void;
}

export function Dashboard({
  goalTitle,
  phase,
  tasks,
  cost,
  verification,
  sessions,
  onSubmitPrompt,
  onSessionSelect,
  onSessionRename,
  onSessionDelete,
  onModelPickerOpen,
}: DashboardProps) {
  const { exit } = useApp();
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const permissionMode = getPermissionMode();

  // Handle global key inputs at the dashboard level
  useInput((input, key) => {
    // 1. Shift+Tab cycles permission mode
    if (key.shift && key.tab) {
      const modes: Array<'auto' | 'acceptEdits' | 'plan'> = ['auto', 'acceptEdits', 'plan'];
      const currentIdx = modes.indexOf(permissionMode);
      const nextMode = modes[(currentIdx + 1) % modes.length];
      setPermissionMode(nextMode);
      return;
    }

    // 2. Ctrl+S toggles Session Picker
    if (key.ctrl && input === 's') {
      setShowSessionPicker((prev) => !prev);
      return;
    }

    // 3. Ctrl+M triggers Model Picker (requires exiting Ink first)
    if (key.ctrl && input === 'm') {
      onModelPickerOpen();
      return;
    }

    // 4. Ctrl+C or Ctrl+D exits the application
    if ((key.ctrl && input === 'c') || (key.ctrl && input === 'd')) {
      exit();
      process.exit(0);
    }
  });

  // Render Phase Pipeline
  const renderPhasePipeline = () => {
    const phases = ['planning', 'executing', 'verifying', 'done'];
    return (
      <Box flexDirection="row" marginY={1}>
        {phases.map((p, index) => {
          const isActive = p === phase;
          const isCompleted = phases.indexOf(phase) > index;
          let marker = '○';
          let color = 'gray';

          if (isActive) {
            marker = '▶';
            color = 'cyan';
          } else if (isCompleted) {
            marker = '✓';
            color = 'green';
          }

          return (
            <Box key={p} flexDirection="row" alignItems="center">
              {index > 0 && <Text color="gray"> ──► </Text>}
              <Text bold={isActive} color={color}>
                [{p.toUpperCase()}] {marker}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  };

  // Cost status coloring
  const costRatio = cost.spent / cost.limit;
  let costColor = 'green';
  let costLabel = '';
  let costInverse = false;

  if (cost.spent > cost.limit) {
    costColor = 'red';
    costLabel = ' [EXCEEDED!]';
    costInverse = true;
  } else if (costRatio > 0.8) {
    costColor = 'red';
  } else if (costRatio > 0.5) {
    costColor = 'yellow';
  }

  return (
    <Box flexDirection="column" padding={1} width="100%">
      {/* Header */}
      <Box justifyContent="space-between" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          LoopCode v1.0.0
        </Text>
        <Text dimColor>Goal: {goalTitle || 'None'}</Text>
        <Text color={costColor} bold={costInverse} inverse={costInverse}>
          Cost: ${cost.spent.toFixed(4)} / ${cost.limit.toFixed(2)} ({Math.round(costRatio * 100)}%){costLabel}
        </Text>
      </Box>

      {showSessionPicker ? (
        <Box marginY={1}>
          <SessionPicker
            sessions={sessions}
            onSelect={(session) => {
              onSessionSelect(session);
              setShowSessionPicker(false);
            }}
            onCancel={() => setShowSessionPicker(false)}
            onRename={onSessionRename}
            onDelete={onSessionDelete}
          />
        </Box>
      ) : (
        <>
          {/* Phase Line */}
          {renderPhasePipeline()}

          {/* Active Tasks Grid */}
          <Box flexDirection="column" marginY={1}>
            <Text bold color="yellow">
              Active Tasks
            </Text>
            <Box flexDirection="row" flexWrap="wrap">
              {tasks.length === 0 ? (
                <Text dimColor>No active tasks.</Text>
              ) : (
                tasks.map((task) => <TaskCard key={task.id} task={task} />)
              )}
            </Box>
          </Box>

          {/* Verification Log */}
          <VerificationLog layers={verification} />

          {/* User Input prompt */}
          <MultilineInput
            onSubmit={onSubmitPrompt}
            onSessionPicker={() => setShowSessionPicker(true)}
            onModelPicker={onModelPickerOpen}
          />

          {/* Status Bar info */}
          <StatusBar />
        </>
      )}
    </Box>
  );
}
