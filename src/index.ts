import path from "node:path";
import { renderer } from "./renderer";
import fs from "node:fs/promises";

const expirationTime = parseInt(
  process.env.EXPIRATION_TIME ?? (1000 * 60 * 10).toString()
);

const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  routes: {
    "/": async () => {
      return new Response(
        'TETR.IO Replay Renderer. See <a href="https://github.com/halp1/tetrio-replay-renderer">github.com/halp1/tetrio-replay-renderer</a> for more information.',
        { headers: { "Content-Type": "text/html" } }
      );
    },
    "/render": async (req) => {
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const { source, token, config, replay, targets } = await req.json();

      // Validate input
      if (!source || !token || !config || !replay || !targets) {
        return new Response("Invalid request", { status: 400 });
      }

      const tokens = JSON.parse(
        await fs.readFile(path.join(__dirname, "../tokens.json"), "utf-8")
      ) as Record<string, string>;

      if (tokens[source] !== token) {
        return new Response("Invalid token", { status: 403 });
      }

      // Start rendering
      const outputFiles = await renderer.render(replay, targets);

      // Schedule file deletion
      setTimeout(() => {
        for (const file of outputFiles) {
          fs.unlink(path.join(__dirname, "../output", file)).catch(() => {});
        }
      }, expirationTime);

      // send output paths
      return new Response(JSON.stringify(outputFiles), { status: 200 });
    },
    "/files/:filename": async (req) => {
      const { filename } = req.params;
      const filePath = path.join(__dirname, "../output", filename);
      try {
        const file = await fs.readFile(filePath);
        return new Response(file, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      } catch (e) {
        return new Response("File not found", { status: 404 });
      }
    },
  },
  websocket: {
    message() {},
  },
});

console.log(`Listening on http://localhost:${server.port}`);
