export const COLORS = {
  primary: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  dim: 'gray',
  highlight: 'magenta',
} as const;

export const STATUS_ICONS = {
  pending: '○',
  executing: '▶',
  completed: '✓',
  failed: '✗',
  verifying: '⏳',
  retrying: '↻',
} as const;
