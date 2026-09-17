import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "PartyBeamDiceKit",
      formats: ["es"],
      fileName: "partybeam-dice-kit"
    },
    rollupOptions: {
      external: [/^three(?:\/.*)?$/, "cannon-es"]
    },
    sourcemap: true,
    emptyOutDir: true
  }
});
