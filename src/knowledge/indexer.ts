import * as fs from 'node:fs';
import * as path from 'node:path';
import { TreeSitterParser, Symbol } from './treesitter.js';

export class CodeIndexer {
  private parser: TreeSitterParser;
  private fileIndex: Map<string, Symbol[]> = new Map();

  constructor() {
    this.parser = new TreeSitterParser('typescript');
  }

  indexFile(filePath: string): Symbol[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const symbols = this.parser.parse(content, filePath);
    this.fileIndex.set(filePath, symbols);
    return symbols;
  }

  indexDirectory(dirPath: string) {
    if (!fs.existsSync(dirPath)) return;
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        this.indexDirectory(fullPath);
      } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.js'))) {
        this.indexFile(fullPath);
      }
    }
  }

  getSymbolsForFile(filePath: string): Symbol[] {
    return this.fileIndex.get(filePath) || [];
  }

  getAllSymbols(): Symbol[] {
    const all: Symbol[] = [];
    for (const symbols of this.fileIndex.values()) {
      all.push(...symbols);
    }
    return all;
  }
}
