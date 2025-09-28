import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      mqtt: "mqtt/dist/mqtt.min.js", // use browser bundle
    },
  },
});
