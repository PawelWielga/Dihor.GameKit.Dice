import { defineConfig } from "vite";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "src/core/**/*.ts",
        "src/events/**/*.ts",
        "src/physics/BackgroundRollPlanner.ts",
        "src/physics/DicePhysicsWorld.ts",
        "src/physics/DiceSpawnLayout.ts",
        "src/physics/DirectRollPlanner.ts",
        "src/physics/RollModels.ts",
        "src/physics/RollPlanner.ts",
        "src/player/DiceRollPlayer.ts",
        "src/three/dice/DiceTextureCache.ts"
      ],
      exclude: [
        "src/**/index.ts"
      ]
    }
  },
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
