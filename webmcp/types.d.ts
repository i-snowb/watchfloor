interface WebMcpExecutionContext {
  signal?: AbortSignal;
}

interface WebMcpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    context?: WebMcpExecutionContext,
  ) => Promise<unknown>;
}

interface DocumentModelContext {
  registerTool(
    definition: WebMcpToolDefinition,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

interface Document {
  modelContext?: DocumentModelContext;
}
