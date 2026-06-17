import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";
import { ensureProjectPrefix } from "./lib/api";

async function start(): Promise<void> {
  // Redirect `/` (or an unknown prefix) to a real project before mounting, so
  // the per-project API client is pointed at a valid `/<prefix>` base.
  const ready = await ensureProjectPrefix();
  if (!ready) return;
  mount(App, { target: document.getElementById("app")! });
}

void start();
