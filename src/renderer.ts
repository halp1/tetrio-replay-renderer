import { launch, getStream, wss } from "puppeteer-stream";
import { executablePath } from "puppeteer";
import { Utils } from "@haelp/teto";
import path from "node:path";
import type { VersusReplay } from "./replay";
import fs from "node:fs";
import { exec, execSync } from "node:child_process";

export namespace renderer {
	export const STORAGE_FOLDER = process.env.STORAGE_FOLDER ?? "/tmp/tetrio-renderer";
	/** mp4 doesn't handle audio correctly */
	export const FORMAT: "webm" | "mp4" = "webm";

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch (err) {
    throw new Error(
      "ffmpeg is not installed or not found in PATH. tetrio-replay-renderer requires ffmpeg to function."
    );
  }

  let browser: Awaited<ReturnType<typeof launch>>;

  export const ready = launch({
    headless: "new",
    defaultViewport: { width: 1920, height: 1080 },
    args: ["--window-size=1920,1150"],
    executablePath: executablePath(),
  }).then((b) => (browser = b));

  const config = {
    token: "",
    config: {} as object,
  };

  export const configure = (cfg: Partial<typeof config>) => {
    Object.assign(config, cfg);
  };

  /**
   * Drops a Node.js Blob onto a DOM element on the page.
   *
   * @param page - Puppeteer page instance
   * @param selector - CSS selector for the drop zone
   * @param blob - A Node.js Blob object
   * @param filename - Desired filename to appear in the drop
   * @param mimeType - MIME type of the blob (will override the Blob's own type if provided)
   */
  export const dropBlobObject = async (
    page: Awaited<ReturnType<typeof browser.newPage>>,
    selector: string,
    blob: Blob,
    filename: string,
    mimeType?: string
  ): Promise<void> => {
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const effectiveMime = mimeType ?? blob.type ?? "application/octet-stream";

    await page.evaluate(
      async (selector, filename, mimeType, base64Data) => {
        const dropTarget = document.querySelector(selector);
        if (!dropTarget) throw new Error(`Selector "${selector}" not found`);

        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        const file = new File([bytes], filename, { type: mimeType });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        for (const type of ["dragenter", "dragover", "drop"]) {
          const event = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          });
          dropTarget.dispatchEvent(event);
        }
      },
      selector,
      filename,
      effectiveMime,
      base64
    );
  };

  export const blockAds = async (page: Awaited<ReturnType<typeof browser.newPage>>) => {
    await page.setRequestInterception(true);

    const rejectRequestPattern = [
      "googlesyndication.com",
      "/*.doubleclick.net",
      "/*.amazon-adsystem.com",
      "/*.adnxs.com",
      "matomo.js",
      "sentry-cdn.com",
      "cdn.intergient.com",
      "googletagmanager.com",
    ];
    const blockList = [];

    page.on("request", (request) => {
      if (rejectRequestPattern.find((pattern) => request.url().match(pattern))) {
        blockList.push(request.url());
        request.abort();
      } else request.continue();
    });
  };

  export interface Target {
    round: number;
    start: number;
    end: number;
  }

  export const render = async (replay: VersusReplay, targets: Target[] = []) => {
    const api = new Utils.API({
      token: config.token,
    });

    const userData = await api.users.me();

    const patchNotes = await fetch("https://tetr.io/about/patchnotes/notes.json").then(
      (r) => r.json()
    );
    const lastPatch = Object.keys(patchNotes)[0]!;

    const page = await browser.newPage();

    await blockAds(page);

    page.setUserAgent(
      "'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'"
    );

    await page.goto("https://tetr.io/");

    await page.evaluate(
      (config, userData, lastPatch) => {
        localStorage.setItem("tetrio_userToken", config.token);
        localStorage.setItem("feecofScore", "100000000");
        // block the version popup
        localStorage.setItem("lastPatch", lastPatch);
        localStorage.setItem("moonKagariUsername", userData.username);
        localStorage.setItem("tetrio_lastUsername", userData.username);
        localStorage.setItem("tetrio_username", userData.username);
        localStorage.setItem("tetrio_userID", userData._id);
        localStorage.setItem("userConfig", JSON.stringify(config.config));
      },
      config,
      userData,
      lastPatch
    );

    await page.reload();

    await page.waitForSelector("#return_button");
    page.click("#return_button");

    await page.waitForFunction(() => {
      const el = document.getElementById("menus");
      return el && !el.classList.contains("hidden");
    });

    await dropBlobObject(
      page,
      "#menus",
      new Blob([JSON.stringify(replay)], { type: "application/json" }),
      "replay.ttrm",
      "application/json"
    );

    await page.waitForFunction(() => {
      const el = document.querySelector(".noreplay");
      return el && !el.classList.contains("hidden");
    });

    const currentStatus = await page.evaluate(() =>
      (document.querySelector("#social_status img")! as HTMLImageElement).src
        .replaceAll("https://tetr.io/res/status/", "")
        .replaceAll(".png", "")
    );

    await page.evaluate(() => {
      (document.querySelector("#social_status") as HTMLDivElement).click();
      (document.querySelector('[data-id="busy"]') as HTMLDivElement).click();
    });

    await page.waitForFunction(() => {
      const el = document.getElementById("notifications");
      return el && el.offsetHeight === 0;
    });

    const results: string[] = [];

    if (!(await fs.promises.exists(STORAGE_FOLDER))) {
      await fs.promises.mkdir(STORAGE_FOLDER, { recursive: true });
    }

    await page.evaluate(() => {
      const replaytools = document.getElementById("replaytools");
      if (replaytools) replaytools.style.opacity = "0";
    });

    for (const target of targets) {
      const targetId = Date.now().toString();
      const out = path.join(STORAGE_FOLDER, `${targetId}.${FORMAT}`);
      const file = fs.createWriteStream(out);

      const rounds = await page.$$(".multilog_result_self");

      if (!rounds[target.round]) {
        throw new Error(`Round ${target.round} not found in the replay`);
      }
      rounds[target.round]?.click();

      await page.waitForFunction(() => {
        const el = document.getElementById("replaytools");
        return el && !el.classList.contains("disabled");
      });

      await page.evaluate(() => {
        const pauseButton = document.querySelector("#replaytools_button_playpause");
        if (pauseButton) (pauseButton as HTMLDivElement).click();
        const stopButton = document.querySelector("#replaytools_button_stop");
        if (stopButton) (stopButton as HTMLDivElement).click();
      });

      const frames = replay.replay.rounds[target.round][0].replay.events.find(
        (e) => e.type === "end"
      ).frame as number | undefined;
      if (frames === undefined) {
        throw new Error(
          `Invalid replay data: no end frame found for round ${target.round}`
        );
      }

      const startX =
        16 +
        ((target.start ?? 0 + 0.5) / frames) *
          ((await page.evaluate(() => window.innerWidth)) - 32);

      await page.evaluate((startX) => {
        document.querySelector("#replaytools_seekbar")?.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: startX,
            clientY: 0,
          })
        );

        document.querySelector("#replaytools_seekbar")?.dispatchEvent(
          new MouseEvent("mouseup", {
            clientX: startX,
            clientY: 0,
          })
        );
      }, startX);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stream = await getStream(page, {
        audio: true,
        video: true,
        mimeType: `video/${FORMAT}`,
      });

      stream.pipe(file);

      await page.evaluate(() => {
        const pauseButton = document.querySelector("#replaytools_button_playpause");
        if (pauseButton) (pauseButton as HTMLDivElement).click();
      });

      await page.evaluate(async (end) => {
        while (
          parseInt(
            document
              .querySelector("#replaytools_timestamp span")
              ?.textContent?.replaceAll("frame", "")
              ?.trim() ?? "0"
          ) < end
        ) {
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
      }, target.end);

      await new Promise((resolve) => setTimeout(resolve, 150));

      stream.destroy();
      file.close();
      await new Promise((res, rej) =>
        exec(
          `ffmpeg -i ${out} -c copy ${out.replace(".", "-final.")}`,
          (error, stdout) => {
            if (error) {
              rej(error);
              return;
            }
            res(stdout);
          }
        )
      );
      await fs.promises.unlink(out);
      await fs.promises.rename(out.replace(".", "-final."), out);

      await page.evaluate(() => {
        const exitButton = document.querySelector("#exit_replay");
        if (exitButton) (exitButton as HTMLDivElement).click();
      });

      results.push(`${targetId}.${FORMAT}`);
    }

    await page.evaluate((currentStatus) => {
      (document.querySelector("#social_status") as HTMLDivElement).click();
      (document.querySelector(`[data-id="${currentStatus}"]`) as HTMLDivElement).click();
    }, currentStatus);

    return results;
  };

  export const terminate = async () => {
    if (browser) {
      await browser.close();
    }
    (await wss).close();
  };
}
