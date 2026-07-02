import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function getVSCodeSettingsPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  } else if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Code', 'User', 'settings.json');
  } else {
    return join(homedir(), '.config', 'Code', 'User', 'settings.json');
  }
}

function getCursorSettingsPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
  } else if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'settings.json');
  } else {
    return join(homedir(), '.config', 'Cursor', 'User', 'settings.json');
  }
}

function setupVSCodeLike(settingsPath: string, name: string) {
  try {
    const dir = join(settingsPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    let settings: Record<string, any> = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }
    settings['terminal.integrated.enableKittyKeyboardProtocol'] = true;
    settings['terminal.integrated.gpuAcceleration'] = 'off';
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`✓ ${name}: Configured Shift+Enter support in settings.json`);
  } catch (err: any) {
    console.error(`Failed to configure ${name}: ${err.message}`);
  }
}

function setupAlacritty() {
  const alacrittyToml = join(homedir(), '.config', 'alacritty', 'alacritty.toml');
  try {
    const dir = join(alacrittyToml, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    let content = '';
    if (existsSync(alacrittyToml)) {
      content = readFileSync(alacrittyToml, 'utf-8');
    }
    if (!content.includes('key_bindings')) {
      content += `
[[keyboard.bindings]]
key = "Enter"
mods = "Shift"
action = "ReceiveChar"
chars = "\\n"
`;
      writeFileSync(alacrittyToml, content);
      console.log('✓ Alacritty: Added Shift+Enter to alacritty.toml');
    } else {
      console.log('✓ Alacritty: key_bindings block already exists. Please verify Shift+Enter manually.');
    }
  } catch (err: any) {
    console.error(`Failed to configure Alacritty: ${err.message}`);
  }
}

export function detectTerminal(): string {
  if (process.env.TERM_PROGRAM === 'vscode') return 'vscode';
  if (process.env.TERM_PROGRAM === 'cursor') return 'cursor';
  if (process.env.ALACRITTY_SOCKET) return 'alacritty';
  if (process.env.TERM === 'xterm-ghostty') return 'ghostty';
  if (process.env.TERM === 'xterm-kitty') return 'kitty';
  if (process.env.TERM_PROGRAM === 'iTerm.app') return 'iterm2';
  return 'unknown';
}

export function setupTerminal() {
  const terminal = detectTerminal();
  console.log(`\nConfiguring your terminal (${terminal}) for optimal LoopCode experience...`);

  switch (terminal) {
    case 'vscode':
      setupVSCodeLike(getVSCodeSettingsPath(), 'VS Code');
      break;
    case 'cursor':
      setupVSCodeLike(getCursorSettingsPath(), 'Cursor');
      break;
    case 'alacritty':
      setupAlacritty();
      break;
    case 'iterm2':
    case 'ghostty':
    case 'kitty':
      console.log('✓ Terminal already supports all features natively');
      break;
    default: {
      console.log('⚠️  Terminal not recognized. Attempting to configure both VS Code and Cursor if they exist...');
      const vsPath = getVSCodeSettingsPath();
      if (existsSync(join(vsPath, '..')) || existsSync(vsPath)) {
        setupVSCodeLike(vsPath, 'VS Code');
      }
      const curPath = getCursorSettingsPath();
      if (existsSync(join(curPath, '..')) || existsSync(curPath)) {
        setupVSCodeLike(curPath, 'Cursor');
      }
      console.log('Using fallback keybindings (Ctrl+J or \\ + Enter for newline) if needed.');
      break;
    }
  }
  console.log('Restart your terminal for changes to take effect.\n');
}
