import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export const buildOptions = {
  absWorkingDir: projectRoot,
  entryPoints: { game: "src/main.tsx" },
  outdir: projectRoot,
  entryNames: "[name]",
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "automatic",
  legalComments: "none",
  logLevel: "info",
};
