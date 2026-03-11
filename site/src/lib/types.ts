export type SitePage = "home" | "docs";

export interface DocsNavItem {
  id: string;
  label: string;
}

export interface DocStep {
  title: string;
  description: string;
  command: string;
  outcome?: string;
}

export interface DocTool {
  name: string;
  purpose: string;
  optional?: boolean;
  installHint?: string;
}

export interface DocCommand {
  title: string;
  usage: string;
  description: string;
  details?: string[];
}

export interface Shortcut {
  keys: string;
  action: string;
}

export interface DocFeature {
  title: string;
  description: string;
}

export interface DocFact {
  label: string;
  value: string;
}

export interface ConfigField {
  key: string;
  type: string;
  required: string;
  defaultValue?: string;
  description: string;
}

export interface ConfigGroup {
  title: string;
  description: string;
  fields: ConfigField[];
}
