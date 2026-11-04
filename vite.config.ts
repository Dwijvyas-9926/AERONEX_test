import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "three", test: /node_modules\/(three|@react-three)/ },
            { name: "react", test: /node_modules\/(react|react-dom|react-router|scheduler)/ },
          ],
        },
      },
    },
  },
});
