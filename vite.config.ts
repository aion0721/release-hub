import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v2": "http://localhost:4174",
    },
  },
});
