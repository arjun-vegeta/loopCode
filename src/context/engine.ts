import * as fs from 'node:fs';
import * as path from 'node:path';

export class ContextEngine {
  /**
   * Compression: remove comments and excess whitespace to minimize token usage.
   */
  compressCode(code: string): string {
    // Remove single line comments
    let clean = code.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    clean = clean.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove excess blank lines
    clean = clean.replace(/^\s*[\r\n]/gm, '');
    return clean.trim();
  }

  /**
   * Hierarchical Summarization Levels:
   * Level 0: Full original file content
   * Level 1: Compressed file content (no comments)
   * Level 2: Skeleton structure (class/interface declarations, method signatures)
   * Level 3: Symbol names only
   * Level 4: File path/basename only
   */
  getSummarization(filePath: string, level: number): string {
    if (!fs.existsSync(filePath)) {
      return `File not found: ${filePath}`;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    if (level === 0) {
      return content;
    }
    if (level === 1) {
      return this.compressCode(content);
    }
    if (level === 2) {
      // Basic skeleton regex extractor for TS/JS files
      const lines = content.split('\n');
      const skeleton = lines.filter((line) => {
        const trimmed = line.trim();
        return (
          trimmed.startsWith('export ') ||
          trimmed.startsWith('class ') ||
          trimmed.startsWith('interface ') ||
          trimmed.startsWith('function ') ||
          trimmed.startsWith('const ') ||
          trimmed.startsWith('let ')
        );
      });
      return skeleton.join('\n');
    }
    if (level === 3) {
      // Symbols extractor
      const symbols: string[] = [];
      const regex = /(?:class|interface|function|const|let)\s+([a-zA-Z0-9_]+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        symbols.push(match[1]);
      }
      return `Symbols in ${path.basename(filePath)}: ${symbols.join(', ')}`;
    }
    return `File: ${path.basename(filePath)}`;
  }

  /**
   * Assemble context with proper compression and level selection based on file size.
   */
  assembleContext(filePaths: string[]): string {
    const sections: string[] = [];
    for (const file of filePaths) {
      if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        // If file is larger than 10KB, use Level 1 (compressed), otherwise full Level 0
        const level = stats.size > 10000 ? 1 : 0;
        sections.push(`--- File: ${file} (Summarization Level ${level}) ---\n${this.getSummarization(file, level)}`);
      }
    }
    return sections.join('\n\n');
  }
}
