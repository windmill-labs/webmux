import "./app.css";
import App from "./App.svelte";
import EmptyProjects from "./lib/EmptyProjects.svelte";
import { mount } from "svelte";
import { ensureProjectPrefix } from "./lib/api";

async function start(): Promise<void> {
  const target = document.getElementById("app")!;
  // Pick a project (or redirect to one) before mounting, so the per-project API
  // client has a valid `/<prefix>` base. With no projects, mount a guided empty
  // state instead of a dashboard whose every /api call would 404.
  const status = await ensureProjectPrefix();
  if (status === "redirecting") return;
  if (status === "no-projects") {
    mount(EmptyProjects, { target });
    return;
  }
  mount(App, { target });
}

void start();
