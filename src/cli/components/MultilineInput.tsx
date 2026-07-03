import React, { useState } from 'react';
import { useInput, Text, Box } from 'ink';
import { getPermissionMode } from '../state.js';

interface MultilineInputProps {
  onSubmit: (text: string) => void;
  onSessionPicker: () => void;
  onModelPicker: () => void;
  isActive?: boolean;
}

export function MultilineInput({ onSubmit, onSessionPicker, onModelPicker, isActive = true }: MultilineInputProps) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedText, setSavedText] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const mode = getPermissionMode();

  // Find most recent match in history
  const searchMatch = searchQuery
    ? history
        .slice()
        .reverse()
        .find((h) => h.toLowerCase().includes(searchQuery.toLowerCase())) || ''
    : '';

  const isPastingRef = React.useRef(false);

  // Intercept Bracketed Paste Mode (OS clipboard pasting)
  React.useEffect(() => {
    if (!isActive) return;

    let pasteBuffer = '';

    const onData = (data: Buffer) => {
      const str = data.toString('utf-8');

      // Check for start of bracketed paste
      if (str.includes('\x1b[200~')) {
        isPastingRef.current = true;
        const startIndex = str.indexOf('\x1b[200~') + 6;
        const content = str.substring(startIndex);

        // If it also ends in the same chunk
        if (content.includes('\x1b[201~')) {
          const endIndex = content.indexOf('\x1b[201~');
          pasteBuffer += content.substring(0, endIndex);
          setText((prev) => prev + pasteBuffer);
          isPastingRef.current = false;
          pasteBuffer = '';
        } else {
          pasteBuffer += content;
        }
        return;
      }

      // Check for end of bracketed paste
      if (isPastingRef.current && str.includes('\x1b[201~')) {
        const endIndex = str.indexOf('\x1b[201~');
        pasteBuffer += str.substring(0, endIndex);
        setText((prev) => prev + pasteBuffer);
        isPastingRef.current = false;
        pasteBuffer = '';
        return;
      }

      // Collect data during paste
      if (isPastingRef.current) {
        pasteBuffer += str;
      }
    };

    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
    };
  }, [isActive]);

  useInput(
    (input, key) => {
      // 0. Ignore input from useInput if we are processing a bracketed paste
      if (isPastingRef.current) return;

      // 1. Handle reverse search mode input
      if (searchMode) {
        if (key.return) {
          if (searchMatch) {
            setText(searchMatch);
          }
          setSearchMode(false);
          setSearchQuery('');
          return;
        }
        if (key.escape) {
          setSearchMode(false);
          setSearchQuery('');
          return;
        }
        if (key.backspace) {
          setSearchQuery((prev) => prev.slice(0, -1));
          return;
        }
        if (key.ctrl && input === 'r') {
          // cycle to next match in history? For simplicity, we just keep active search
          return;
        }
        if (!key.ctrl && !key.meta && input) {
          setSearchQuery((prev) => prev + input);
        }
        return;
      }

      // 2. Handle submission on simple Enter (no Shift/Ctrl)
      if (key.return && !key.shift && !key.ctrl) {
        if (text.trim()) {
          onSubmit(text);
          setHistory((prev) => [...prev, text]);
          setHistoryIndex(-1);
          setSavedText('');
          setText('');
        }
        return;
      }

      // 3. History navigation (Up/Down Arrow keys)
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIndex === -1) {
          setSavedText(text);
          const nextIdx = history.length - 1;
          setHistoryIndex(nextIdx);
          setText(history[nextIdx]);
        } else if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          setText(history[nextIdx]);
        }
        return;
      }
      if (key.downArrow) {
        if (historyIndex === -1) return;
        if (historyIndex < history.length - 1) {
          const nextIdx = historyIndex + 1;
          setHistoryIndex(nextIdx);
          setText(history[nextIdx]);
        } else {
          setHistoryIndex(-1);
          setText(savedText);
        }
        return;
      }

      // 4. Handle newline insertions
      if (key.shift && key.return) {
        setText((prev) => prev + '\n');
        return;
      }
      if (key.ctrl && input === 'j') {
        setText((prev) => prev + '\n');
        return;
      }

      // 5. Handle Backspace
      if (key.backspace) {
        setText((prev) => prev.slice(0, -1));
        return;
      }

      // 6. Handle global shortcuts
      if (key.ctrl && input === 's') {
        onSessionPicker();
        return;
      }
      if (key.ctrl && input === 'm') {
        onModelPicker();
        return;
      }
      if (key.ctrl && input === 'r') {
        setSearchMode(true);
        setSearchQuery('');
        return;
      }

      // 7. Normal character input
      if (!key.ctrl && !key.meta && input) {
        setText((prev) => prev + input);
      }
    },
    { isActive },
  );

  // Display prompt prefix depending on permission mode
  const modePrefix = {
    auto: '[auto-accept] > ',
    acceptEdits: '[confirm-cmds] > ',
    plan: '[confirm-all] > ',
  }[mode];

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      {searchMode ? (
        <Box flexDirection="column">
          <Text bold color="yellow">
            (reverse-i-search)`{searchQuery}`: {searchMatch || '(no match)'}
          </Text>
          <Text dimColor>Press Enter to accept, Esc to cancel</Text>
        </Box>
      ) : (
        <>
          <Text bold color="cyan">
            {modePrefix}
          </Text>
          <Box flexDirection="row">
            <Text>{text}</Text>
            <Text color="cyan" inverse>
              _
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
