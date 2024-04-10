import puppeteer, { Page } from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import env from "./environment.ts";
import { join } from "https://deno.land/std@0.93.0/path/mod.ts";
import { MultiProgressBar } from "https://deno.land/x/progress@v1.4.9/mod.ts";
import {
  EntryInfo,
  FullEntry,
  IndexEntry,
  Participant,
  Run,
} from "./IndexEntry.ts";
import { nextTick } from "https://esm.sh/v135/process-nextick-args@2.0.1/denonext/process-nextick-args.mjs";
import {
  expandChevron,
  getTabularData,
  getText,
  gotoWithRetry,
  queryTabularDescendants,
} from "./utils.ts";
import { bgBrightBlack, bgCyan } from "jsr:@std/fmt@0.221.0/colors";

const MAX_PARALLEL_JOBS = Number(env.MAX_PARALLEL_JOBS ?? 4);

const browser = await puppeteer.launch();
const page = await browser.newPage();
const url = (...parts: string[]) => `${env.ROOT_SITE}${join(...parts)}`;
const nav = async (...parts: string[]) =>
  await gotoWithRetry(page, url(...parts));
const log = (...args: unknown[]) => console.log(...args);
const getOrDie = async (selector: string) => {
  const element = await page.$(selector);
  if (element == null) {
    throw new Error(
      `FATAL! Selector ${selector} did not match anything, this signals a bug in the application.`,
    );
  }
  return element;
};

{
  const bar = new MultiProgressBar({
    title: "Acquiring login",
    display: ":bar :completed/:total",
    complete: bgCyan(" "),
    incomplete: bgBrightBlack(" "),
  });
  await bar.render([{ completed: 0, total: 5 }]);
  await nav("user", "login");
  await bar.render([{ completed: 1, total: 5 }]);
  const email = await getOrDie("#user_email");
  await email.type(env.USER_EMAIL);
  await bar.render([{ completed: 2, total: 5 }]);
  const passw = await getOrDie("#user_password");
  await passw.type(env.USER_PASSWORD);
  await bar.render([{ completed: 3, total: 5 }]);
  const signin = await getOrDie("#signin");
  await signin.click();
  await bar.render([{ completed: 4, total: 5 }]);
  await page.waitForNavigation();
  await bar.render([{ completed: 5, total: 5 }]);
  // This accepts the cookies which interfere tons with UI manipulation
  // bruh
  const candidates = await page.$$("button");
  for (const candidate of candidates) {
    const raw: string = await candidate.evaluate((e) => e.innerText);
    if (raw.match(/I agree/img)) {
      await candidate.click();
      await bar.console("Cookies accepted!");
    }
  }
  await bar.end();
}

let index: IndexEntry[] = [];
const tryFillIndexFromFile = async () => {
  try {
    index = JSON.parse(await Deno.readTextFile("index.json"));
    return true;
  } catch {
    return false;
  }
};
if (!await tryFillIndexFromFile()) {
  log("Index is not present, acquiring it from remote...");
  const bar = new MultiProgressBar({
    title: "Indexing events",
    display: ":bar :percent :time :completed/:total - :text",
  });
  await nav("zone", "events", "past_all");
  await page.waitForNetworkIdle();
  const events = await page.$$("#events > *");
  const total = events.length;
  await bar.render([{
    text: "Waiting for server dataframe...",
    completed: 0,
    total,
  }]);
  let completed = 0;
  for await (const child of events) {
    const id: string = await (await child.getProperty("id")).jsonValue();
    const entry = await IndexEntry.fromElement(id, child);
    await bar.render([{
      text: `${entry.title} (${id})`,
      completed: ++completed,
      total,
    }]);
    index.push(entry);
    await new Promise((r) => nextTick(r));
  }
  await Deno.writeTextFile("index.json", JSON.stringify(index, null, 2));
  log("Index is now stored in index.json");
  await bar.end();
} else {
  log("Index is cached, reading from disk");
}
const PARALLEL_JOB_COUNT = Math.min(index.length, MAX_PARALLEL_JOBS);
const EXTRA_JOBS = index.length % MAX_PARALLEL_JOBS;

const bar = new MultiProgressBar({
  title: "Fetching data",
  display: ":bar :percent :time :completed/:total - :text",
});

const renderInfo: Parameters<MultiProgressBar["render"]>[0] = [];
const update = async (message?: string) => {
  if (message) {
    await bar.console(message);
  }
  await bar.render(renderInfo);
};
let i = 0;
const splitTotal = Math.floor(index.length / PARALLEL_JOB_COUNT);

let pendingJobs = 0;

async function startWork(id: number, page: Page, root: IndexEntry) {
  pendingJobs++;
  try {
    const bar = renderInfo[id];
    bar.text = `${root.title} - Indexing...`;
    const output = root as FullEntry;
    await update();
    if (root.participantsUrl != null) {
      bar.text = `${root.title} - Listing participants...`;
      await update();
      await gotoWithRetry(page, root.participantsUrl);
      await page.waitForNetworkIdle();
      const participants: Participant[] = [];
      for (const partElement of await page.$$("#participants_list > *")) {
        await expandChevron(partElement);
        const children = await queryTabularDescendants(partElement);
        const participant: Participant = await getTabularData(children);
        participants.push(participant);
      }
      output.participants = participants;
    }
    if (root.infoUrl != null) {
      bar.text = `${root.title} - Gathering information...`;
      await update();
      await gotoWithRetry(page, root.infoUrl);
      await page.waitForNetworkIdle();
      const info: EntryInfo = {
        dataTable: {},
        messages: {},
      };
      const dataSections = await page.$$(
        "main > div > div > div.grid.grid-cols-2",
      );
      for (const section of dataSections) {
        const tabular = await getTabularData(
          await queryTabularDescendants(section),
        );
        for (const [k, entries] of Object.entries(tabular)) {
          info.dataTable[k] = entries;
        }
      }
      const textSections = await page.$$(
        "div.rules > .rules > *",
      );
      let lastSection = "";
      for (const section of textSections) {
        const text = await getText(section) as string;
        if (await section.evaluate((el) => el.tagName === "H1")) {
          lastSection = text.trim().replace(/:$/, "");
          info.messages[lastSection] = [];
        } else {
          if (info.messages[lastSection] == null) {
            info.messages[lastSection] = [text.trim()];
          } else {
            info.messages[lastSection].push(text.trim());
          }
        }
      }
      output.info = info;
    }
    if (root.runsUrl != null) {
      bar.text = `${root.title} - Runs (indexing)`;
      await update();
      await gotoWithRetry(page, root.runsUrl);
      await page.waitForNetworkIdle();
      const runs: Run[] = [];
      const links: string[] = [];
      const runsIndex = await page.$$("#runs_list > div");
      for (const runIndexElement of runsIndex) {
        const aElements = await runIndexElement.$$(":scope a");
        const linksList = await Promise.all(
          aElements.map((el) => el.evaluate((el) => el.href)),
        ) as string[];
        for (const link of linksList) {
          if (link.match(/\/combined_results/)) {
            links.push(link);
            break;
          }
        }
      }
      bar.text = `${root.title} - Runs (total ${runsIndex.length})`;
      await update();
      // Now go to each page found in the links
      let currentRun = 0;
      for (const url of links) {
        await gotoWithRetry(page, url);
        await page.waitForNetworkIdle();
        bar.text = `${root.title} - Runs (${++currentRun}/${runsIndex.length})`;
        await update();
        const run: Run = {
          results: [],
          title: "",
          status: "",
          type: "",
        };
        const elements = await page.$$("#results_comb_list > div");
        const headerElement = await page.$("#header_component > div > div");
        if (headerElement == null) {
          await update(
            `Warning: ${root.title} run #${currentRun} has no header element, this will result in an empty run!`,
          );
        } else {
          const title = await headerElement.$(
            ":scope > :nth-child(1) > :nth-child(1)",
          );
          if (title != null) {
            run.title = await getText(title);
          }
          const status = await headerElement.$(":scope > :nth-child(3) span");
          if (status != null) {
            run.status = await getText(status);
          }
          const type = await headerElement.$(":scope > :nth-child(2)");
          if (type != null) {
            run.type = await getText(type);
          }
          for (const element of elements) {
            await expandChevron(element);
            const fragments = await queryTabularDescendants(element);
            run.results.push(await getTabularData(fragments));
          }
        }
        runs.push(run);
      }
      output.runs = runs;
    }
    renderInfo[id].completed += 1;
    if (++i < index.length) {
      startWork(id, page, index[i]);
    }
  } finally {
    pendingJobs--;
    if (i >= index.length && pendingJobs <= 0) {
      // All jobs ended
      for (const info of renderInfo) {
        info.completed = info.total ?? 1;
        info.text = "All jobs finished!";
      }
      await update("All jobs finished! see agility-data.json file");
      await browser.close();
      await Deno.writeTextFile(
        "agility-data.json",
        JSON.stringify(index, null, 2),
      );
    }
  }
}

console.log(`Spawning ${PARALLEL_JOB_COUNT} jobs...`);
for (i = 0; i < PARALLEL_JOB_COUNT; i++) {
  const elem = index[i];
  const id = i;
  const page = await browser.newPage();
  renderInfo.push({
    total: splitTotal,
    completed: 0,
    text: "waiting...",
  });
  startWork(id, page, elem);
}
// if (EXTRA_JOBS > 0) {
//   const elem = index[i];
//   const id = i++;
//   const page = await browser.newPage();
//   renderInfo.push({
//     total: splitTotal,
//     completed: 0,
//     text: "waiting...",
//   });
//   startWork(id, page, elem);
// }
