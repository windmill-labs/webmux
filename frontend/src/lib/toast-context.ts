import { getContext, setContext } from "svelte";
import type { ToastInput } from "./types";

export interface ToastController {
  show: (toast: ToastInput) => void;
  info: (message: string, detail?: string) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
}

const TOAST_CONTROLLER = Symbol("toast-controller");

export function setToastController(controller: ToastController): void {
  setContext(TOAST_CONTROLLER, controller);
}

export function getToastController(): ToastController {
  const controller = getContext<ToastController | undefined>(TOAST_CONTROLLER);
  if (controller) return controller;

  return {
    show: () => {},
    info: () => {},
    success: () => {},
    error: () => {},
  };
}
