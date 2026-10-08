/** A directory a multica-file daemon publishes into knowledge. */
export interface FileShare {
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
