import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("la version GitHub Pages est entièrement statique", async () => {
  const html = await readFile(new URL("index.html", projectRoot), "utf8");
  assert.match(html, /<title>Le Tournoi des Douzes/);
  assert.match(html, /\.\/game\.css/);
  assert.match(html, /\.\/game\.js/);
  assert.doesNotMatch(html, /_next|vinext|localhost/);
  await access(new URL("game.js", projectRoot));
  await access(new URL("game.css", projectRoot));
  await access(new URL("cards\/david.webp", projectRoot));
});

test("les ressources utilisent des chemins relatifs compatibles avec un sous-dossier", async () => {
  const [engine, page] = await Promise.all([
    readFile(new URL("app/game.ts", projectRoot), "utf8"),
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
  ]);
  assert.doesNotMatch(engine, /image:\s*["']\/cards\//);
  assert.doesNotMatch(page, /["']\/cards\//);
  assert.match(engine, /image:\s*["']\.\/cards\//);
});

test("le multijoueur reste un canal WebRTC direct", async () => {
  const page = await readFile(new URL("app/page.tsx", projectRoot), "utf8");
  assert.match(page, /new RTCPeerConnection/);
  assert.match(page, /createDataChannel/);
  assert.match(page, /Aucune IA ne complétera les places libres/);
});
