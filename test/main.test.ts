import { renderer } from "../src/renderer";
import path from "node:path";
import fs from "node:fs/promises";

import { test, expect } from "bun:test";

test("renderer", async () => {
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

  await renderer.terminate();
	expect(outputPaths).toHaveLength(1);
}, {
	timeout: 120_000,
});
