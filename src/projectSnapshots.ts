/** Optional host-initiated snapshots of the current, possibly unsaved editor. */
export const PROJECT_SNAPSHOT_PROTOCOL = "lumina-workshop-project";
export const PROJECT_SNAPSHOT_VERSION = 1;

export interface WorkshopCurrentProject {
  schemaVersion: string;
  state: unknown;
}
export interface WorkshopProjectSnapshotHandler {
  capture(): WorkshopCurrentProject | Promise<WorkshopCurrentProject>;
  /** Validate and prepare without changing the visible editor. */
  prepare(snapshot: WorkshopCurrentProject): unknown | Promise<unknown>;
  /** Apply a prepared value; resolve only after the editor has adopted it. */
  commit(prepared: unknown): void | Promise<void>;
}
export interface WorkshopProjectSnapshots {
  register(handler: WorkshopProjectSnapshotHandler): () => void;
  changed(): void;
}

export function createProjectSnapshotEndpoint(post: (value: unknown) => void) {
  let handler: WorkshopProjectSnapshotHandler | null = null;
  let pending: { id: string; value: unknown; handler: WorkshopProjectSnapshotHandler } | null = null;
  let closed = false;
  let chain = Promise.resolve();
  const api: WorkshopProjectSnapshots = {
    register(value) {
      handler = value;
      return () => { if (handler === value) { handler = null; pending = null; } };
    },
    changed() { if (!closed) post({ protocol: PROJECT_SNAPSHOT_PROTOCOL, version: 1, kind: "changed" }); },
  };
  async function dispatch(message: Record<string, unknown>) {
    const requestId = message.requestId as string;
    try {
      if (closed || !handler) throw new Error("Current-project snapshots are unavailable in this editor");
      let result: unknown = null;
      if (message.operation === "capture") result = await handler.capture();
      else if (message.operation === "prepare") {
        const snapshot = message.payload as WorkshopCurrentProject;
        if (!snapshot || typeof snapshot !== "object" || typeof snapshot.schemaVersion !== "string" || !snapshot.schemaVersion || snapshot.schemaVersion.length > 128 || !("state" in snapshot)) throw new Error("Invalid project snapshot");
        const owner = handler;
        const value = await owner.prepare(snapshot);
        if (owner !== handler || closed) throw new Error("The editor changed while restoring the project");
        pending = { id: requestId, value, handler: owner };
        result = { token: requestId };
      } else if (message.operation === "commit") {
        if (!pending || pending.id !== (message.payload as { token?: string })?.token || pending.handler !== handler) throw new Error("Prepared project has expired");
        await pending.handler.commit(pending.value);
        pending = null;
      } else if (message.operation === "discard") {
        if (pending?.id === (message.payload as { token?: string })?.token) pending = null;
      } else throw new Error("Unsupported project operation");
      if (!closed) post({ protocol: PROJECT_SNAPSHOT_PROTOCOL, version: 1, kind: "response", requestId, ok: true, result });
    } catch (error) {
      if (!closed) post({ protocol: PROJECT_SNAPSHOT_PROTOCOL, version: 1, kind: "response", requestId, ok: false, error: error instanceof Error ? error.message : "Project operation failed" });
    }
  }
  return {
    api,
    receive(value: unknown): boolean {
      if (!value || typeof value !== "object" || (value as { protocol?: string }).protocol !== PROJECT_SNAPSHOT_PROTOCOL) return false;
      const message = value as Record<string, unknown>;
      if (message.version !== 1 || message.kind !== "request" || typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 128) return true;
      chain = chain.then(() => dispatch(message));
      return true;
    },
    close() { closed = true; handler = null; pending = null; },
  };
}
