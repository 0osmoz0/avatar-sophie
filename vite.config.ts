import { defineConfig } from "vite";

// Le pipeline d'assets ecrit dans build/frames ; on l'expose tel quel comme
// racine statique pour eviter de recopier ~1200 frames dans public/.
export default defineConfig({
  clearScreen: false,
  publicDir: "build",
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/asset/**"] },
  },
  build: {
    target: "safari15",
    emptyOutDir: true,
  },
});
