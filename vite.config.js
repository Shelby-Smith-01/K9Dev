import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Always use the browser bundle for mqtt
      mqtt: "mqtt/dist/mqtt.min.js",
    },
  },
});
