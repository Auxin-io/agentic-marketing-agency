import { createTool } from "@mastra/core/tools";
import Exa from "exa-js";
import { z } from "zod";

export const rawLeadSchema = z.object({
  companyName: z.string(),
  domain: z.string(),
  url: z.string(),
  summary: z.string().default(""),
});

export type RawLead = z.infer<typeof rawLeadSchema>;

/** Pull the registrable host out of a URL, dropping "www.". */
const domainFromUrl = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Exa returns page titles, not company names ("88 Top B2B SaaS Companies | Built In").
 * Strip the publisher suffix and fall back to the domain when nothing usable is left.
 */
const companyNameFrom = (title: string | null | undefined, domain: string) => {
  const cleaned = (title || "").split(/[|\u2013\u2014-]/)[0].trim();
  if (cleaned.length >= 2 && cleaned.length <= 60) return cleaned;
  const base = domain.split(".")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Unknown Company";
};

/**
 * Aggregators, listicles and job boards. Their pages rank well for prospecting
 * queries but they are articles *about* companies, not leads themselves.
 */
const DIRECTORY_DOMAINS = [
  "builtin.com",
  "wellfound.com",
  "angel.co",
  "crunchbase.com",
  "g2.com",
  "capterra.com",
  "clutch.co",
  "glassdoor.com",
  "indeed.com",
  "linkedin.com",
  "forbes.com",
  "medium.com",
  "reddit.com",
  "wikipedia.org",
  "ycombinator.com",
  "producthunt.com",
  "trustradius.com",
  "gartner.com",
  "owler.com",
  "zoominfo.com",
];

/** Titles like "Top 20 SaaS Companies" are roundups, not a single company. */
const LISTICLE_TITLE = /^\s*(top|best|\d+\s)|\b(companies|startups|vendors|providers|tools|list|guide|directory)\b/i;

const isDirectory = (domain: string) =>
  DIRECTORY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

export const searchLeads = async (searchQuery: string, limit: number): Promise<RawLead[]> => {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY is not set. Add it to .env to run lead generation.");
  }

  const exa = new Exa(apiKey);
  // Over-fetch: de-duplication and directory filtering both discard results.
  const response = await exa.searchAndContents(searchQuery, {
    numResults: Math.min(Math.max(limit * 5, 10), 40),
    // Ask Exa for company homepages rather than articles about companies.
    category: "company",
    type: "auto",
    summary: true,
  });

  const seen = new Set<string>();
  const leads: RawLead[] = [];
  const rejected: RawLead[] = [];

  for (const result of response.results) {
    const domain = domainFromUrl(result.url);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);

    const lead: RawLead = {
      companyName: companyNameFrom(result.title, domain),
      domain,
      url: result.url,
      summary: (result as { summary?: string }).summary?.slice(0, 500) ?? "",
    };

    // Keep roundups aside as filler rather than dropping them outright, so a
    // narrow query still returns the requested number of leads.
    if (isDirectory(domain) || LISTICLE_TITLE.test(result.title || "")) {
      rejected.push(lead);
      continue;
    }

    leads.push(lead);
    if (leads.length >= limit) break;
  }

  return [...leads, ...rejected].slice(0, limit);
};

export const leadGenerationTool = createTool({
  id: "lead-generation",
  description:
    "Find companies matching a search query using Exa neural search. Returns company names, domains and URLs.",
  inputSchema: z.object({
    searchQuery: z.string().describe("What kind of companies to look for"),
    limit: z.number().default(3).describe("How many leads to return"),
  }),
  outputSchema: z.object({ leads: z.array(rawLeadSchema) }),
  execute: async ({ context }) => {
    const leads = await searchLeads(context.searchQuery, context.limit ?? 3);
    return { leads };
  },
});
