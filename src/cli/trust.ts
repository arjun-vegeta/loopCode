import { select } from '@clack/prompts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const LOOPCODE_DIR = join(homedir(), '.loopcode');
const TRUSTED_DIRS_FILE = join(LOOPCODE_DIR, 'trusted_dirs.json');

interface TrustedDir {
  path: string;
  trustedAt: string;
  permanent: boolean;
}

// Temporary in-memory session trust store
const sessionTrustedDirs = new Set<string>();

export function isDangerousDirectory(cwd: string): boolean {
  const dangerous = [
    '/',
    '/usr',
    '/usr/local',
    '/opt',
    '/var',
    '/etc',
    '/bin',
    '/sbin',
    '/System',
    '/Applications',
    'C:\\',
    'C:\\Windows',
  ];

  const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();
  const normalizedHome = homedir().replace(/\\/g, '/').toLowerCase();

  if (normalizedCwd === normalizedHome) {
    return true;
  }

  return dangerous.some((d) => {
    const normalizedD = d.replace(/\\/g, '/').toLowerCase();
    return normalizedCwd === normalizedD || normalizedCwd.startsWith(normalizedD + '/');
  });
}

function loadTrustedDirs(): TrustedDir[] {
  try {
    if (!existsSync(TRUSTED_DIRS_FILE)) {
      return [];
    }
    const content = readFileSync(TRUSTED_DIRS_FILE, 'utf-8');
    return JSON.parse(content) as TrustedDir[];
  } catch {
    return [];
  }
}

function saveTrustedDirs(dirs: TrustedDir[]) {
  try {
    if (!existsSync(LOOPCODE_DIR)) {
      mkdirSync(LOOPCODE_DIR, { recursive: true });
    }
    writeFileSync(TRUSTED_DIRS_FILE, JSON.stringify(dirs, null, 2));
  } catch (err: any) {
    console.error(`Failed to save trusted directories: ${err.message}`);
  }
}

export async function checkTrust(cwd: string): Promise<boolean> {
  if (process.env.VITEST) {
    return true; // Auto-pass for tests
  }

  if (isDangerousDirectory(cwd)) {
    console.error('\n⚠️  WARNING: You are about to run LoopCode in a system or home directory.');
    console.error('Running in system locations is highly restricted to prevent unintended modifications. Aborting.');
    process.exit(1);
  }

  // 1. Check in-memory session trust
  if (sessionTrustedDirs.has(cwd)) {
    return true;
  }

  // 2. Check permanent trust
  const trusted = loadTrustedDirs();
  if (trusted.some((t) => cwd.startsWith(t.path))) {
    return true;
  }

  // 3. Show Clack select dialog
  const choice = await select({
    message: `🔒 LoopCode Trust Prompt\n\nYou are about to run LoopCode in:\n  ${cwd}\n\nLoopCode is an autonomous AI agent that can:\n  • Read, modify, and delete files in this directory\n  • Execute shell commands (npm install, git commit, etc.)\n  • Connect to LLM APIs using your configured keys\n  • Spend money on API calls (up to your configured budget)\n\nOnly proceed if you trust the code in this location.`,
    options: [
      { value: 'session', label: 'Yes, trust for this session only' },
      { value: 'permanent', label: 'Yes, trust and remember for future sessions' },
      { value: 'exit', label: 'No, exit (Esc)' },
    ],
  });

  if (choice === 'exit' || typeof choice === 'symbol') {
    console.log('Aborted by user.');
    process.exit(0);
  }

  if (choice === 'session') {
    sessionTrustedDirs.add(cwd);
    return true;
  }

  if (choice === 'permanent') {
    trusted.push({
      path: cwd,
      trustedAt: new Date().toISOString(),
      permanent: true,
    });
    saveTrustedDirs(trusted);
    return true;
  }

  return false;
}
