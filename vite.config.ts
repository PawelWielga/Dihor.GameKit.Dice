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
        "src/**/index.ts",
        "src/core/DiceDefinition.ts",
        "src/core/DiceRollRequest.ts",
        "src/core/DiceRollResult.ts",
        "src/core/DieResult.ts",
        "src/core/RandomProvider.ts",
        "src/physics/RollModels.ts"
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
        "src/core/**/*.ts": {
          statements: 90,
          branches: 75,
          functions: 90,
          lines: 90
        },
        "src/events/**/*.ts": {
          statements: 85,
          branches: 80,
          functions: 95,
          lines: 85
        },
        "src/physics/**/*.ts": {
          statements: 80,
          branches: 70,
          functions: 90,
          lines: 80
        },
        "src/player/DiceRollPlayer.ts": {
          statements: 80,
          branches: 65,
          functions: 80,
          lines: 80
        },
        "src/three/dice/DiceTextureCache.ts": {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80
        }
      }
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
