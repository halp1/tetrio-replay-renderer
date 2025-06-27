import { renderer } from "./renderer";
import path from "node:path";
import fs from "node:fs/promises";

const config = JSON.parse(
  await fs.readFile(path.join(__dirname, "../test/config.ttc"), "utf-8")
);

await renderer.ready;

renderer.configure({
  token: process.env.TOKEN,
  config,
});

const outputPaths = await renderer.render(
  JSON.parse(await fs.readFile(path.join(__dirname, "../test/replay.ttrm"), "utf-8")),
  [
    {
      round: 0,
      start: 100,
      end: 1000,
    },
  ],
  (step, total) => console.log(`Progress: ${Math.round((step / total) * 100)}%`)
);

console.log("Render complete. Output files:", outputPaths.join("\n"));

// renderer.terminate();
