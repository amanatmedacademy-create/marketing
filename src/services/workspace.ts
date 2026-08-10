export type WorkspaceBlockKind = 'system' | 'metric' | 'table' | 'chart' | 'funnel';

export interface WorkspaceBlock {
  id: string;
  route: string;
  blockKey: string;
  kind: WorkspaceBlockKind;
  title: string;
  dataSource: string | null;
  config: Record<string, unknown>;
  layout: Record<string, unknown>;
  isVisible: boolean;
  isSystem: boolean;
  updatedAt?: string | null;
}

export interface WorkspaceListResponse {
  route: string;
  blocks