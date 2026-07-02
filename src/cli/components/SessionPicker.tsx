import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionRecord } from '../../memory.js';

interface SessionPickerProps {
  sessions: SessionRecord[];
  onSelect: (session: SessionRecord) => void;
  onCancel: () => void;
  onRename: (session: SessionRecord, newName: string) => void;
  onDelete: (session: SessionRecord) => void;
}

export function SessionPicker({ sessions, onSelect, onCancel, onRename, onDelete }: SessionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [renameMode, setRenameMode] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const filtered = sessions.filter((s) => {
    const nameMatch = s.name ? s.name.toLowerCase().includes(search.toLowerCase()) : false;
    const goalMatch = s.goal_id ? s.goal_id.toLowerCase().includes(search.toLowerCase()) : false;
    return nameMatch || goalMatch || search === '';
  });

  useInput((input, key) => {
    // 1. Rename mode input handling
    if (renameMode) {
      if (key.return) {
        if (renameValue.trim() && filtered[selectedIndex]) {
          onRename(filtered[selectedIndex], renameValue.trim());
          setRenameMode(false);
          setRenameValue('');
        }
        return;
      }
      if (key.escape) {
        setRenameMode(false);
        setRenameValue('');
        return;
      }
      if (key.backspace) {
        setRenameValue((prev) => prev.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        setRenameValue((prev) => prev + input);
      }
      return;
    }

    // 2. Search mode input handling
    if (searchMode) {
      if (key.return || key.escape) {
        setSearchMode(false);
        return;
      }
      if (key.backspace) {
        setSearch((prev) => prev.slice(0, -1));
        setSelectedIndex(0);
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        setSearch((prev) => prev + input);
        setSelectedIndex(0);
      }
      return;
    }

    // 3. Normal list navigation
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
      return;
    }
    if (key.return) {
      if (filtered[selectedIndex]) {
        onSelect(filtered[selectedIndex]);
      }
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }

    // Search activation
    if (input === '/') {
      setSearchMode(true);
      return;
    }

    // Rename shortcut
    if (key.ctrl && input === 'r') {
      const active = filtered[selectedIndex];
      if (active) {
        setRenameMode(true);
        setRenameValue(active.name || '');
      }
      return;
    }

    // Delete shortcut
    if (key.ctrl && input === 'd') {
      const active = filtered[selectedIndex];
      if (active) {
        onDelete(active);
        setSelectedIndex(0);
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" padding={1} width={60}>
      <Text bold color="yellow">
        📂 Session Picker (Ctrl+S)
      </Text>
      {renameMode ? (
        <Box flexDirection="column" marginY={1}>
          <Text color="cyan">Rename Session: {filtered[selectedIndex]?.name || 'Untitled'}</Text>
          <Box flexDirection="row">
            <Text>New Name: </Text>
            <Text>{renameValue}</Text>
            <Text color="cyan" inverse>
              _
            </Text>
          </Box>
          <Text dimColor>Press Enter to save, Esc to cancel</Text>
        </Box>
      ) : searchMode ? (
        <Box flexDirection="row" marginY={1}>
          <Text color="cyan">Search: </Text>
          <Text>{search}</Text>
          <Text color="cyan" inverse>
            _
          </Text>
        </Box>
      ) : (
        <Text dimColor>Type / to search, Ctrl+R to rename, Ctrl+D to delete, Esc to exit</Text>
      )}

      <Box flexDirection="column" marginY={1}>
        {filtered.length === 0 ? (
          <Text color="red">No sessions found.</Text>
        ) : (
          filtered.map((session, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <Box key={session.id}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '▶ ' : '  '}
                  {session.name || 'Untitled'}
                  <Text dimColor> {session.goal_id.substring(0, 30)}...</Text>
                  <Text dimColor> ({session.status})</Text>
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
