import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const backendPort = process.env.PORT || "5111";
const backendUrl = `http://localhost:${backendPort}`;
const backendWs = `ws://localhost:${backendPort}`;
const port = parseInt(process.env.AGENTS_FRONTEND_PORT || "5183", 10);

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port,
    proxy: {
      "/api/agents": backendUrl,
      "/ws/agents": {
        target: backendWs,
        ws: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4183,
    proxy: {
      "/api/agents": backendUrl,
      "/ws/agents": {
        target: backendWs,
        ws: true,
      },
    },
  },
});
