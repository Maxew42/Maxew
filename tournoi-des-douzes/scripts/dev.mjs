import { context } from "esbuild";
import { buildOptions, projectRoot } from "./build-options.mjs";

const buildContext = await context(buildOptions);
await buildContext.watch();
const server = await buildContext.serve({
  servedir: projectRoot,
  host: "127.0.0.1",
  port: 3000,
});

console.log(`Le Tournoi des Douzes : http://127.0.0.1:${server.port}/`);

const close = async () => {
  await buildContext.dispose();
  process.exit(0);
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
await new Promise(() => {});
