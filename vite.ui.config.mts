import {fileURLToPath, URL} from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import {defineConfig} from "vite"

// A separate developer entry; no catalog code enters the embedded application.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {alias: {"@": fileURLToPath(new URL("./frontend", import.meta.url))}},
  server: {host: "127.0.0.1", port: 5174, open: "/frontend/dev/"},
  build: {
    outDir: "dist/ui-catalog",
    rollupOptions: {input: "frontend/dev/index.html"},
  },
})
