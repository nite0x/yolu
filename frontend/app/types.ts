export interface Worktree {
  path: string; branch?: string; head?: string; bare?: boolean; missing?: boolean;
  prunable?: boolean; locked?: boolean; detached?: boolean; error?: string;
  changes?: {modified: number; added: number; deleted: number};
  dirty?: number; status_updated_at?: string; compare_available?: boolean;
  comparison_ref?: string; ahead?: number; behind?: number;
  upstream?: string; sync_available?: boolean; sync_ahead?: number; sync_behind?: number;
  operation?: string; merge_head?: string; conflicts?: string[];
}
export interface Project {
  id: string; name: string; path: string; folder?: string; error?: string;
  worktrees: Worktree[]; status_updated_at?: string; refreshing?: boolean;
}
export interface GitBranch {
  name: string; ref: string; kind: string; commit: string; upstream?: string; worktrees: string[];
}
export interface GitOverview {
  project: Project; branches: GitBranch[]; current?: string; master_source?: string;
  remotes: { name: string; url: string }[];
  credentials?: { available?: boolean; message?: string };
}
