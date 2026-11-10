/** Base Workshop API every host supports; frontend-only modules use it. */
export const WORKSHOP_API_VERSION = "1.0.0" as const;
/** Workshop API that adds host-managed module backends (SDK 1.1.0). */
export const WORKSHOP_BACKEND_API_VERSION = "1.1.0" as const;
export const WORKSHOP_MANIFEST_VERSION = 1 as const;
/** Manifest version for modules that declare a backend. */
export const WORKSHOP_BACKEND_MANIFEST_VERSION = 2 as const;
export const WORKSHOP_RPC_VERSION = 1 as const;
/** Python backend control protocol version (see docs/backend-protocol.md). */
export const WORKSHOP_BACKEND_PROTOCOL_VERSION = 1 as const;

export const WORKSHOP_RPC_EVENT_NAMES = ["ui.stateChanged"] as const;

/** Optional capabilities a module requests in its ready handshake. */
export const WORKSHOP_FEATURE_NAMES = ["backend.tasks"] as const;

export type WorkshopFeatureName = (typeof WORKSHOP_FEATURE_NAMES)[number];

/** Informational backend capabilities shown to users before consent. */
export const WORKSHOP_BACKEND_CAPABILITY_NAMES = [
  "network",
  "subprocess",
  "external-files",
] as const;

export type WorkshopBackendCapabilityName =
  (typeof WORKSHOP_BACKEND_CAPABILITY_NAMES)[number];

export const WORKSHOP_BACKEND_PLATFORMS = [
  "windows-x86_64",
  "linux-x86_64",
  "macos-arm64",
] as const;

export type WorkshopBackendPlatform =
  (typeof WORKSHOP_BACKEND_PLATFORMS)[number];

export type WorkshopRpcEventName =
  (typeof WORKSHOP_RPC_EVENT_NAMES)[number];

export const WORKSHOP_PERMISSION_NAMES = [
  "image.pick",
  "project.storage",
  "color-library.read",
  "handoff.image",
] as const;

export type WorkshopPermissionName =
  (typeof WORKSHOP_PERMISSION_NAMES)[number];

export interface LocalizedText {
  "zh-CN": string;
  "en-US": string;
}

export interface WorkshopManifestV1 {
  manifestVersion: typeof WORKSHOP_MANIFEST_VERSION;
  id: string;
  version: string;
  name: LocalizedText;
  description: LocalizedText;
  publisher: string;
  workshopApi: {
    min: string;
    maxExclusive: string;
  };
  luminaVersion: {
    min: string;
  };
  entrypoints: {
    ui: "ui/index.html";
  };
  permissions: Array<{
    name: WorkshopPermissionName;
    reason: string;
  }>;
}

/**
 * Backend declaration (manifest v2). The host prepares a hash-locked
 * environment from a PEP 751 `pylock.toml` and runs `entry` as a local
 * process with the user's permissions; it is not an OS sandbox.
 */
export interface WorkshopBackendDeclaration {
  /** Python entry under `backend/`, e.g. `backend/main.py`. */
  entry: string;
  /** Supported interpreter minor version; hosts currently offer `3.12`. */
  python: "3.12";
  /** Wheels-only PEP 751 lock, e.g. `backend/pylock.toml`. */
  lock: string;
  platforms: WorkshopBackendPlatform[];
  capabilities?: Array<{ name: WorkshopBackendCapabilityName; reason: string }>;
  models?: Array<{
    id: string;
    fileName: string;
    url: string;
    sha256: string;
    bytes: number;
    license: string;
  }>;
  /** Optional dependency variants such as GPU acceleration. */
  variants?: Array<{
    id: string;
    name: LocalizedText;
    description: LocalizedText;
    lock: string;
    platforms: WorkshopBackendPlatform[];
  }>;
  /** Suggested idle release time, 30–3600 seconds. */
  idleTimeoutSeconds?: number;
}

export interface WorkshopManifestV2
  extends Omit<WorkshopManifestV1, "manifestVersion"> {
  manifestVersion: typeof WORKSHOP_BACKEND_MANIFEST_VERSION;
  /** Backend modules must require `workshopApi.min >= 1.1.0`. */
  backend: WorkshopBackendDeclaration;
}

export type WorkshopBackendTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

/** One host-owned task; it survives page switches and backend restarts. */
export interface WorkshopBackendTask {
  taskId: string;
  moduleVersion: string;
  operation: string;
  status: WorkshopBackendTaskStatus;
  progress: { completed: number; total: number; phase: string } | null;
  error: { code: string; message: string } | null;
  outputs: Array<{ name: string; fileName: string; mimeType: string; bytes: number }>;
  variant: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface WorkshopBackendInput {
  name: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface WorkshopBackendSubmitRequest {
  operation: string;
  params: Record<string, unknown>;
  inputs: WorkshopBackendInput[];
  /** Client-generated key: retrying the same submission returns one task. */
  idempotencyKey?: string;
}

export interface WorkshopBackendOutput {
  name: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface WorkshopBackendStatus {
  prepared: boolean;
  authorized: boolean;
  state: "stopped" | "starting" | "ready" | "busy" | "stopping" | "failed";
  acceleration: string | null;
  variant: string | null;
}

export interface WorkshopRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface WorkshopPickedImage {
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
  raster: WorkshopRaster;
}

export interface WorkshopRecipeSource {
  manifestSchemaVersion: 1;
  moduleId: string;
  moduleVersion: string;
  projectSchemaVersion: string;
  renderSchemaVersion: string;
  payload: Record<string, unknown>;
}

export interface WorkshopSquareGridLayout {
  kind: "square-grid";
  rows: number;
  columns: number;
  pitchMm: number;
}

export interface WorkshopImageHandoff {
  moduleId: string;
  moduleVersion: string;
  projectId: string;
  pngBytes: ArrayBuffer;
  /** Optional native SVG source. PNG remains the compatible fallback. */
  svgBytes?: ArrayBuffer;
  pixelWidth: number;
  pixelHeight: number;
  recommendedWidthMm: number;
  recommendedHeightMm: number;
  /** Optional finished output thickness, including all color layers. */
  recommendedTotalThicknessMm?: number;
  preserveCanvasBounds: true;
  layout?: WorkshopSquareGridLayout;
  colorLibraryId: string | null;
  recipeSource: WorkshopRecipeSource;
}

export interface WorkshopProjectRecord<T = unknown> {
  projectId: string;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  project: T;
}

export interface WorkshopColorEntry {
  id: string;
  label: string;
  hex: string;
  materialId: string | null;
}

export interface WorkshopColorLibrary {
  id: string;
  label: string;
  sourceKind: "lut" | "material-archive" | "native-bundle";
  colors: WorkshopColorEntry[];
}

export interface WorkshopUiState {
  locale: "zh-CN" | "en-US";
  theme: "light" | "dark";
  tokens: Record<string, string>;
}

export type WorkshopRpcMethod =
  | "image.pick"
  | "project.save"
  | "project.load"
  | "project.latest"
  | "project.remove"
  | "colorLibrary.read"
  | "handoff.image"
  | "ui.getState"
  | "status.progress"
  | "status.error"
  | "status.diagnostics"
  | "lifecycle.ready"
  | WorkshopBackendRpcMethod;

/** Backend task methods (Workshop API 1.1.0, feature `backend.tasks`). */
export type WorkshopBackendRpcMethod =
  | "backend.status"
  | "backend.submit"
  | "backend.get"
  | "backend.list"
  | "backend.cancel"
  | "backend.readOutput"
  | "backend.remove";

export interface WorkshopRpcRequest {
  protocol: "lumina-workshop-rpc";
  version: typeof WORKSHOP_RPC_VERSION;
  kind: "request";
  requestId: string;
  method: WorkshopRpcMethod;
  payload: unknown;
}

export interface WorkshopRpcResponse {
  protocol: "lumina-workshop-rpc";
  version: typeof WORKSHOP_RPC_VERSION;
  kind: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface WorkshopRpcEventEnvelope {
  protocol: "lumina-workshop-rpc";
  version: typeof WORKSHOP_RPC_VERSION;
  kind: "event";
  event: "ui.stateChanged";
  payload: WorkshopUiState;
}

export type WorkshopRpcEvent = WorkshopRpcEventEnvelope;

export interface WorkshopReadyMessage {
  projectSnapshotProtocol?: 1;
  type: "lumina.workshop.ready";
  moduleId: string;
  moduleVersion: string;
  /**
   * Minimum API the module actually needs: 1.0.0 unless it requests
   * backend tasks, so frontend-only modules keep working on older hosts.
   */
  apiVersion: typeof WORKSHOP_API_VERSION | typeof WORKSHOP_BACKEND_API_VERSION;
  events?: readonly WorkshopRpcEventName[];
  features?: readonly WorkshopFeatureName[];
}

export function createRequestEnvelope(
  requestId: string,
  method: WorkshopRpcMethod,
  payload: unknown,
): WorkshopRpcRequest {
  return {
    protocol: "lumina-workshop-rpc",
    version: WORKSHOP_RPC_VERSION,
    kind: "request",
    requestId,
    method,
    payload,
  };
}
