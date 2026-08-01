import type { AppConfig, StreamCandidate, AdapterRunStatus } from "../types.js";

export interface AdapterResult {
  sourceName: string;
  status: AdapterRunStatus;
  pagesVisited: number;
  candidates: StreamCandidate[];
  browserUsed: boolean;
  durationMs: number;
  warnings: string[];
  errorCategory?: string;
  diagnostics?: Record<string, unknown>;
}

export interface SourceAdapter {
  name: string;
  discover(config: AppConfig): Promise<AdapterResult>;
}
