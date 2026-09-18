import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "DihorGameKitDice",
      formats: ["es"],
      fileName: "dihor-gamekit-dice"
    },
    rollupOptions: {
      external: [/^three(?:\/.*)?$/, "cannon-es"]
    },
    sourcemap: true,
    emptyOutDir: true
  }
});
