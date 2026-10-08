/** A directory a multica-file daemon publishes into knowledge. Each machine has at most one per user. */
export interface FileShare {
  /** The multica daemon id of the machine; matches `AgentRuntime.daemon_id`. */
  daemon_id: string;
  /** Knowledge path prefix for this share. */
  machine: string;
  /** Absolute path on the machine. The runtime page shows it and cannot change it. */
  dir: string;
  visibility: "private" | "workspace";
  enabled: boolean;
  online: boolean;
  workspace_id: string;
}

export interface UpdateFileShareRequest {
  visibility?: "private" | "workspace";
  enabled?: boolean;
}
