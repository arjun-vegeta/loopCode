import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isDangerousDirectory, checkTrust } from '../src/cli/trust.js';
import { detectTerminal } from '../src/cli/terminal-setup.js';
import { renderDiff } from '../src/cli/diff.js';
import { Memory } from '../src/memory.js';
import { getPermissionMode, setPermissionMode } from '../src/cli/state.js';
import { StatusBar } from '../src/cli/components/StatusBar.js';
import React from 'react';
import * as fs from 'node:fs';

describe('LoopCode v3 CLI Features', () => {
  const testDb = 'test_loopcode_cli.db';

  beforeEach(() => {
    if (fs.existsSync(testDb)) {
      fs.unlinkSync(testDb);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDb)) {
      fs.unlinkSync(testDb);
    }
  });

  describe('Trust Verification & Dangerous Directories', () => {
    it('should correctly identify dangerous system and home directories', () => {
      expect(isDangerousDirectory('/')).toBe(true);
      expect(isDangerousDirectory('/usr')).toBe(true);
      expect(isDangerousDirectory('/usr/local')).toBe(true);
      expect(isDangerousDirectory('/System')).toBe(true);
      expect(isDangerousDirectory('C:\\')).toBe(true);
      expect(isDangerousDirectory('C:\\Windows')).toBe(true);
    });

    it('should identify safe custom project subdirectories', () => {
      expect(isDangerousDirectory('/Users/arjun/projects/safe-app')).toBe(false);
      expect(isDangerousDirectory('/home/user/workspace')).toBe(false);
    });

    it('should automatically trust in test/vitest environments', async () => {
      process.env.VITEST = '1';
      const trusted = await checkTrust('/untrusted/path');
      expect(trusted).toBe(true);
    });
  });

  describe('IDE Terminal & Environment Detection', () => {
    it('should detect terminal type correctly based on environment variables', () => {
      const originalEnv = { ...process.env };

      process.env.TERM_PROGRAM = 'vscode';
      expect(detectTerminal()).toBe('vscode');

      process.env.TERM_PROGRAM = 'cursor';
      expect(detectTerminal()).toBe('cursor');

      delete process.env.TERM_PROGRAM;
      process.env.ALACRITTY_SOCKET = '/tmp/alacritty.sock';
      expect(detectTerminal()).toBe('alacritty');

      process.env.TERM = 'xterm-ghostty';
      delete process.env.ALACRITTY_SOCKET;
      expect(detectTerminal()).toBe('ghostty');

      // Cleanup env
      process.env = originalEnv;
    });
  });

  describe('Colored Diff Rendering', () => {
    it('should colorize lines correctly using standard ANSI escape sequences', () => {
      const diff = '+ added line\n- removed line\n@@ header @@\nnormal line';
      const rendered = renderDiff(diff);

      const lines = rendered.split('\n');
      expect(lines[0]).toContain('\x1b[32m'); // Green
      expect(lines[1]).toContain('\x1b[31m'); // Red
      expect(lines[2]).toContain('\x1b[36m'); // Cyan
      expect(lines[3]).toBe('normal line');
    });
  });

  describe('State Management (Permission Mode)', () => {
    it('should toggle state correctly', () => {
      setPermissionMode('plan');
      expect(getPermissionMode()).toBe('plan');
      setPermissionMode('auto');
      expect(getPermissionMode()).toBe('auto');
    });
  });

  describe('Session Lifecycle Database Storage', () => {
    it('should store and query sessions correctly in the database', () => {
      const memory = new Memory(testDb);
      const sessionId = 'session-test-id-123';
      const goalId = 'goal-task-id';

      // Setup reference task
      memory.createTask(goalId, 'Original Goal', 'planning');

      // Create Session
      memory.createSession(sessionId, 'Test Session', goalId);

      // Verify Retrieve Session
      const session = memory.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.name).toBe('Test Session');
      expect(session?.status).toBe('active');

      // Update Session Status
      memory.updateSessionStatus(sessionId, 'paused');
      expect(memory.getSession(sessionId)?.status).toBe('paused');

      // Rename Session
      memory.renameSession(sessionId, 'Renamed TUI Session');
      expect(memory.getSession(sessionId)?.name).toBe('Renamed TUI Session');

      // Update Activity Details
      memory.updateSessionActivity(sessionId, 12, 0.45, 1200);
      const updated = memory.getSession(sessionId);
      expect(updated?.message_count).toBe(12);
      expect(updated?.total_cost).toBeCloseTo(0.45);
      expect(updated?.context_usage).toBe(1200);

      // Query Sessions list
      const list = memory.getSessions();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(sessionId);

      // Delete Session
      memory.deleteSession(sessionId);
      expect(memory.getSession(sessionId)).toBeNull();

      memory.close();
    });
  });

  describe('StatusBar Component with Cost Telemetry', () => {
    it('renders budget progress bar correctly based on cost props', () => {
      const cost = { spent: 2.5, limit: 10.0 };
      const element = StatusBar({ cost });
      expect(element).toBeDefined();

      const outerChildren = React.Children.toArray(element.props.children);
      const innerBox = outerChildren[0] as React.ReactElement;
      const innerChildren = React.Children.toArray(innerBox.props.children);
      const rightSideBox = innerChildren[1] as React.ReactElement;
      expect(rightSideBox).toBeDefined();

      const barTextNode = React.Children.toArray(rightSideBox.props.children)[1];
      // 25% budget spent should show a filled block representation
      expect(barTextNode.props.children).toContain('█');
      expect(barTextNode.props.children).toContain('░');
    });
  });
});
