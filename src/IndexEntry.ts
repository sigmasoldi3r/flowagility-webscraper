import { die, getText } from "./utils.ts";
import { ElementHandle } from "https://deno.land/x/puppeteer@16.2.0/mod.ts";

export class IndexEntry {
  constructor(
    readonly id: string,
    readonly shortDate: string,
    readonly issuer: string | null,
    readonly title: string,
    readonly hostClub: string,
    readonly location: string,
    readonly flag: string,
    readonly participantsUrl: string | null,
    readonly runsUrl: string | null,
    readonly infoUrl: string | null,
    readonly isCancelled: boolean,
    readonly unknownUrls: string[],
  ) {}
  static async fromElement(id: string, e: ElementHandle) {
    const inner = await e.$(":scope > div") ??
      die("Inner index entry was null!");
    const dataRow = await inner.$(":scope > :nth-child(1)") ??
      die("Index data row was null!");
    const linkRow = await inner.$(":scope > :nth-child(2)") ??
      die("Index link row was null!");
    const shortDate = await dataRow.$(":scope > :nth-child(1) > :nth-child(1)");
    const issuer = await dataRow.$(":scope > :nth-child(1) > :nth-child(2)");
    const title = await dataRow.$(":scope > :nth-child(2) > :nth-child(1)");
    const hostClub = await dataRow.$(":scope > :nth-child(2) > :nth-child(2)");
    const location = await dataRow.$(
      ":scope > :nth-child(2) > :nth-child(3) > :nth-child(1)",
    );
    const flag = await dataRow.$(
      ":scope > :nth-child(2) > :nth-child(3) > :nth-child(2)",
    );
    const isCancelled = await linkRow.$(":scope > :nth-child(1) > *");
    const links = await linkRow.$$(":scope > :nth-child(2) a");
    let participantsUrl: string | null = null;
    let runsUrl: string | null = null;
    let infoUrl: string | null = null;
    const unknownUrls = [] as string[];
    for (const link of links) {
      const href = await link.evaluate((el) => el.href) as string;
      if (href.match(/events\/info/)) {
        infoUrl = href;
      } else if (href.match(/\/runs/)) {
        runsUrl = href;
      } else if (href.match(/\/participants_list/)) {
        participantsUrl = href;
      } else {
        unknownUrls.push(href);
      }
    }
    try {
      return new this(
        id,
        await getText(shortDate),
        issuer != null ? await getText(issuer) : null,
        await getText(title),
        await getText(hostClub),
        await getText(location),
        await getText(flag),
        participantsUrl,
        runsUrl,
        infoUrl,
        isCancelled != null,
        unknownUrls,
      );
    } catch {
      const obj = {
        shortDate,
        issuer,
        title,
        hostClub,
        location,
        flag,
        participantsUrl,
        runsUrl,
        infoUrl,
        isCancelled,
      };
      console.error(obj);
      throw new Error("Error validating entry");
    }
  }
  static fromObject(object: IndexEntry) {
    return new this(
      object.id,
      object.shortDate,
      object.issuer,
      object.title,
      object.hostClub,
      object.location,
      object.flag,
      object.participantsUrl,
      object.runsUrl,
      object.infoUrl,
      object.isCancelled,
      object.unknownUrls,
    );
  }
}

export type Participant = Record<string, Record<string, string>>;

export interface EntryInfo {
  dataTable: Record<string, Record<string, string>>;
  messages: Record<string, string[]>;
}

export interface Run {
  title: string;
  type: string;
  status: string;
  results: Record<string, Record<string, string>>[];
}

export interface FullEntry extends IndexEntry {
  participants: Participant[] | null;
  info: EntryInfo | null;
  runs: Run[] | null;
}
