import { delay } from "https://deno.land/std@0.220.1/async/delay.ts";
import {
  ElementHandle,
  Page,
} from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import env from "./environment.ts";

export const getText = async (node: ElementHandle | null) => {
  if (node == null) {
    throw new Error(`Can't extract text from a null node!`);
  }
  const text = await node.evaluate((el) => el.textContent);
  if (text == null) {
    throw new Error(`Node ${node} did not contain any content`);
  }
  return (text as string).trim();
};

export async function getLink(node: ElementHandle | null): Promise<string>;
export async function getLink(
  node: ElementHandle | null,
  allowNulls: true,
): Promise<string | null>;
export async function getLink(
  node: ElementHandle | null,
  allowNulls: false,
): Promise<string>;
export async function getLink(
  node: ElementHandle | null,
  allowNulls = false,
) {
  if (node == null) {
    if (allowNulls) return null;
    throw new Error(`Can't extract text from a null node!`);
  }
  const text = await node.evaluate((el) => el.href);
  if (text == null) {
    throw new Error(`Node ${node} did not contain any href`);
  }
  return (text as string).trim();
}

export const serializeMap = <T>(map: Map<string, T>) =>
  JSON.stringify(
    [...map.entries()].reduce((a, [k, v]) => {
      a[k] = v;
      return a;
    }, {} as Record<string, T>),
    null,
    2,
  );

export const gotoWithRetry = async (page: Page, url: string) => {
  for (;;) {
    try {
      return await page.goto(url);
    } catch {
      await delay(500);
    }
  }
};

export const CHEVRON_EXPANSION_DELAY = Number(
  env.CHEVRON_EXPANSION_DELAY ?? 250,
);

// Someone thought it was a good idea to trim the DOM tree constantly
export async function expandChevron(root: ElementHandle) {
  await delay(100);
  const candidates = await root.$$(":scope [phx-click]");
  for (const candidate of candidates) {
    try {
      await candidate.click();
      await delay(CHEVRON_EXPANSION_DELAY);
      return true;
    } catch {
      continue;
    }
  }
  return die(`\n\nFATAL! Could not expand chevron!`);
}

export function die(reason: string): never {
  throw new Error(reason);
}

export async function getTabularData(elements: ElementHandle[]) {
  const data: Record<string, Record<string, string>> = {};
  let section = "";
  let key = "";
  for (const fragment of elements) {
    const classes = await fragment.evaluate((el) => el.className) as string;
    const text = await getText(fragment) as string;
    if (classes.match(/col-span-2/)) {
      section = text;
      data[section] = {};
    } else if (classes.match(/text-gray-500/)) {
      key = text;
    } else {
      data[section][key] = text;
    }
  }
  return data;
}

export const queryTabularDescendants = (elem: ElementHandle) =>
  elem.$$(
    ":scope .text-gray-500.text-sm, :scope .font-bold.text-black, :scope .font-bold.col-span-2",
  );
