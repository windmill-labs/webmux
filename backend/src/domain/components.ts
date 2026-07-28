export type ComponentProtocol = "http" | "https" | "tcp";

export interface ComponentTcpHealthCheck {
  type: "tcp";
}

export interface ComponentPortDefinition {
  name: string;
  processEnv: string;
  protocol: ComponentProtocol;
  health: ComponentTcpHealthCheck | null;
}

export interface ComponentDefinition {
  id: string;
  label: string;
  kind: string;
  workingDir: string;
  command: string;
  environment: Record<string, string>;
  ports: ComponentPortDefinition[];
}

export interface ComponentCatalogConfig {
  command: string;
}

export type ComponentCatalogState =
  | {
      status: "disabled";
      components: ComponentDefinition[];
      error: null;
    }
  | {
      status: "ready";
      components: ComponentDefinition[];
      error: null;
    }
  | {
      status: "error";
      components: ComponentDefinition[];
      error: string;
    };

export type ComponentProcessStatus = "running" | "exited" | "stopped";
export type ComponentHealthStatus = "starting" | "ready" | "unhealthy" | "unavailable";

export interface ComponentRuntimeState {
  id: string;
  label: string;
  kind: string;
  paneIndex: number | null;
  processStatus: ComponentProcessStatus;
  healthStatus: ComponentHealthStatus;
  ports: Record<string, number>;
  urls: Record<string, string>;
  exitCode: number | null;
}
