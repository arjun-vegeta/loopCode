export interface Location {
  uri: string;
  line: number;
  character: number;
}

export class LSPClient {
  async initialize(projectRoot: string): Promise<void> {
    // In a real implementation, this spawns a language server and handles JSON-RPC
    // Mock for now
    return Promise.resolve();
  }

  async goToDefinition(file: string, line: number, char: number): Promise<Location[]> {
    return [];
  }

  async findReferences(file: string, line: number, char: number): Promise<Location[]> {
    return [];
  }

  async getTypeInfo(file: string, line: number, char: number): Promise<string> {
    return 'any';
  }
}
