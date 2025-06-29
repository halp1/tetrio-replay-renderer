import { renderer } from "../src/renderer";
import path from "node:path";
import fs from "node:fs/promises";

const config = JSON.parse(
  await fs.readFile(path.join(__dirname, "./config.ttc"), "utf-8")
);

await renderer.ready;

renderer.configure({
  token: process.env.TOKEN,
  config,
});

const outputPaths = await renderer.render(
  JSON.parse(await fs.readFile(path.join(__dirname, "./replay.ttrm"), "utf-8")),
  [
    {
      round: 0,
      start: 100,
      end: 1000,
    },
  ]
);

console.log(
  "Render complete. Output files:",
  outputPaths.map((p) => renderer.STORAGE_FOLDER + "/" + p).join("\n")
);

renderer.terminate();
