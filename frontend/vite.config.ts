import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:9902",
        ws: true
      },
      "/gsi": {
        target: "http://localhost:9902"
      },
      "/assets/video2.webm": {
        target: "http://localhost:9902"
      }
    }
  }
});
