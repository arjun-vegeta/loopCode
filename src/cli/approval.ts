import { select } from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { renderDiff } from './diff.js';
import { getPermissionMode } from './state.js';

export function isCommandDestructive(command: string): boolean {
  const destructiveKeywords = [
    'rm ',
    'rmdir',
    'mkfs',
    'dd ',
    'git push --force',
    'git push -f',
    'git reset --hard',
    'git clean -f',
    'git clean -fd',
  ];
  const normalized = command.toLowerCase().trim();
  return destructiveKeywords.some((keyword) => normalized.includes(keyword));
}

export async function approveShellCommand(
  command: string,
  isDestructive: boolean = false,
): Promise<'yes' | 'always' | 'no'> {
  const actualDestructive = isDestructive || isCommandDestructive(command);

  // If not destructive and mode is auto, automatically approve
  if (!actualDestructive && getPermissionMode() === 'auto') {
    return 'yes';
  }

  // If in acceptEdits mode, non-destructive is approved, but destructive requires prompt
  if (getPermissionMode() === 'acceptEdits' && !actualDestructive) {
    return 'yes';
  }

  console.log(`\n⚠️  Shell Command Approval Needed:`);
  console.log(`   $ ${command}`);

  const choice = await select({
    message: 'Approve this shell command?',
    options: [
      { value: 'yes', label: 'Yes, run this time' },
      { value: 'always', label: 'Yes, always allow this command in this session' },
      { value: 'no', label: 'No, skip / reject' },
    ],
  });

  if (typeof choice === 'symbol' || choice === 'no') {
    return 'no';
  }

  return choice as 'yes' | 'always';
}

export async function approveFileEdit(filePath: string, diff: string): Promise<boolean> {
  if (getPermissionMode() === 'auto' || getPermissionMode() === 'acceptEdits') {
    console.log(`✅ Auto-accepted edit for: ${filePath}`);
    return true;
  }

  while (true) {
    console.log(`\n📝 Proposed Edit for: ${filePath}`);
    console.log(renderDiff(diff));

    const choice = await select({
      message: 'Accept this proposed file edit?',
      options: [
        { value: 'accept', label: 'Accept this edit' },
        { value: 'reject', label: 'Reject this edit' },
        { value: 'edit', label: '[E] Edit file in $EDITOR' },
      ],
    });

    if (typeof choice === 'symbol' || choice === 'reject') {
      return false;
    }

    if (choice === 'accept') {
      return true;
    }

    if (choice === 'edit') {
      const editor = process.env.EDITOR || 'nano';
      console.log(`Launching ${editor} to edit ${filePath}...`);
      spawnSync(editor, [filePath], { stdio: 'inherit' });
    }
  }
}
