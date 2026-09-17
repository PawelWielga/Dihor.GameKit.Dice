import { defineConfig } from "vite";

export default defineConfig({
  root: "demo",
  base: "/PartyBeam.DiceKit/",
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
    sourcemap: true
  }
});
