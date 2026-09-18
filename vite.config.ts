import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        "dihor-gamekit-dice": "src/index.ts",
        appearance: "src/appearance/index.ts",
        core: "src/core/index.ts",
        events: "src/events/index.ts",
        overlay: "src/overlay/index.ts",
        advanced: "src/advanced.ts"
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: [/^three(?:\/.*)?$/, "cannon-es"]
    },
    sourcemap: true,
    emptyOutDir: true
  }
});
