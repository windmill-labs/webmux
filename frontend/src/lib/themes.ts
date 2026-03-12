import type { ThemeKey } from "./types";
import type { ITheme } from "@xterm/xterm";

export interface ThemeDefinition {
  key: ThemeKey;
  label: string;
  colors: {
    surface: string;
    sidebar: string;
    topbar: string;
    hover: string;
    active: string;
    edge: string;
    primary: string;
    muted: string;
    accent: string;
    danger: string;
    success: string;
    warning: string;
  };
  terminal: ITheme;
}

export const THEMES: ThemeDefinition[] = [
  {
    key: "github-dark",
    label: "GitHub Dark",
    colors: {
      surface: "#0d1117",
      sidebar: "#161b22",
      topbar: "#1c2128",
      hover: "#21262d",
      active: "#1f6feb33",
      edge: "#30363d",
      primary: "#e6edf3",
      muted: "#8b949e",
      accent: "#58a6ff",
      danger: "#f85149",
      success: "#3fb950",
      warning: "#d29922",
    },
    terminal: {
      background: "#0d1117",
      foreground: "#e6edf3",
      cursor: "#58a6ff",
      selectionBackground: "#264f78",
    },
  },
  {
    key: "dracula",
    label: "Dracula",
    colors: {
      surface: "#282a36",
      sidebar: "#21222c",
      topbar: "#2d2f3f",
      hover: "#343746",
      active: "#bd93f933",
      edge: "#44475a",
      primary: "#f8f8f2",
      muted: "#6272a4",
      accent: "#bd93f9",
      danger: "#ff5555",
      success: "#50fa7b",
      warning: "#f1fa8c",
    },
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#bd93f9",
      selectionBackground: "#44475a",
    },
  },
  {
    key: "nord",
    label: "Nord",
    colors: {
      surface: "#2e3440",
      sidebar: "#272c36",
      topbar: "#353b49",
      hover: "#3b4252",
      active: "#88c0d033",
      edge: "#4c566a",
      primary: "#eceff4",
      muted: "#81a1c1",
      accent: "#88c0d0",
      danger: "#bf616a",
      success: "#a3be8c",
      warning: "#ebcb8b",
    },
    terminal: {
      background: "#2e3440",
      foreground: "#eceff4",
      cursor: "#88c0d0",
      selectionBackground: "#434c5e",
    },
  },
  {
    key: "solarized-dark",
    label: "Solarized Dark",
    colors: {
      surface: "#002b36",
      sidebar: "#00222b",
      topbar: "#073642",
      hover: "#0a4050",
      active: "#268bd233",
      edge: "#2e5e6a",
      primary: "#fdf6e3",
      muted: "#839496",
      accent: "#268bd2",
      danger: "#dc322f",
      success: "#859900",
      warning: "#b58900",
    },
    terminal: {
      background: "#002b36",
      foreground: "#fdf6e3",
      cursor: "#268bd2",
      selectionBackground: "#073642",
    },
  },
  {
    key: "one-dark",
    label: "One Dark",
    colors: {
      surface: "#282c34",
      sidebar: "#21252b",
      topbar: "#2c323c",
      hover: "#333842",
      active: "#61afef33",
      edge: "#3e4452",
      primary: "#abb2bf",
      muted: "#636d83",
      accent: "#61afef",
      danger: "#e06c75",
      success: "#98c379",
      warning: "#e5c07b",
    },
    terminal: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#61afef",
      selectionBackground: "#3e4452",
    },
  },
];

export function getTheme(key: string): ThemeDefinition {
  return THEMES.find((t) => t.key === key) ?? THEMES[0];
}
