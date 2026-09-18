import { defineConfig } from "vite";

export default defineConfig({
  root: "demo",
  base: "/Dihor.GameKit.Dice/",
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
    sourcemap: true
  }
});
