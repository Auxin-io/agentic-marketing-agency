import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { API_USER_AGENT, fetchJson, fetchText } from "./http";

export const researchSchema = z.object({
  industry: z.string(),
  estimatedSize: z.string(),
  businessModel: z.string(),
  description: z.string(),
});

const WIKI_API = "https://en.wikipedia.org/w/api.php";

type WikiSearchResponse = { query?: { search?: Array<{ title?: string }> } };
type WikiExtractResponse = { query?: { pages?: Record<string, { extract?: string }> } };

const wikiQuery = (params: Record<string, string>) =>
  `${WIKI_API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;

/**
 * Normalize a company or article name for comparison: drop any disambiguator
 * ("Stripe (company)"), corporate suffixes, punctuation and casing.
 */
const normalizeName = (value: string) =>
  value
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|nv|ag)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Wikipedia's search always returns *something*, and for most private companies
 * the top hit is a different entity entirely - searching "Proposify" returns
 * Innovacorp, "Rose Rocket" returns a Dutch cycling team. Feeding that to the
 * research agent is worse than having no context, so require the article title
 * to actually name this company and otherwise report no match.
 */
const titleMatchesCompany = (title: string, companyName: string) =>
  normalizeName(title) === normalizeName(companyName);

/**
 * Look the company up on Wikipedia and return its intro extract.
 * Returns "" whenever there is no confident match - the caller falls back to
 * the Exa summary or the company website rather than inventing detail.
 */
export const wikipediaExtract = async (companyName: string): Promise<string> => {
  const options = { userAgent: API_USER_AGENT };

  // Wikipedia answers 429 when called too often; a null result is treated as
  // "no match" and the caller falls back to another source.
  const search = await fetchJson<WikiSearchResponse>(
    wikiQuery({ action: "query", list: "search", srsearch: companyName, srlimit: "5" }),
    options
  );

  const title = (search?.query?.search ?? []).find(
    (hit) => hit.title && titleMatchesCompany(hit.title, companyName)
  )?.title;
  if (!title) return "";

  const page = await fetchJson<WikiExtractResponse>(
    wikiQuery({ action: "query", prop: "extracts", exintro: "1", explaintext: "1", titles: title }),
    options
  );

  const pages = Object.values(page?.query?.pages ?? {});
  const extract = (pages[0]?.extract ?? "").trim();

  // Disambiguation pages ("Stripe, striped, or stripes may refer to:") carry no
  // facts about the company, so treat them as no match.
  if (/\bmay (also )?refer to\b/i.test(extract.slice(0, 200))) return "";

  return extract.slice(0, 1200);
};

/**
 * Last-resort context: the company's own homepage metadata. Exa does not always
 * return a summary and most companies have no Wikipedia article, which would
 * otherwise leave the research agent with nothing to classify from.
 */
export const websiteDescription = async (domain: string): Promise<string> => {
  const html = await fetchText(`https://${domain}`, {}, 200_000);
  if (!html) return "";

  const meta = (property: string) =>
    html.match(
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${property}["'][^>]+content=["']([^"']+)["']`,
        "i"
      )
    )?.[1] ?? "";

  const parts = [
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "",
    meta("description") || meta("og:description"),
    // The first heading is usually the product positioning line.
    html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "",
  ];

  return parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" - ")
    .slice(0, 800);
};

/**
 * Background for one company, best source first: Wikipedia for the companies
 * that have an article, then whatever Exa summarised, then the company's own
 * homepage. Returns "" only when every source is unavailable.
 */
export const researchContext = async (
  companyName: string,
  domain: string,
  searchSummary = ""
): Promise<string> => {
  const known = [await wikipediaExtract(companyName), searchSummary].filter(Boolean);
  if (known.length > 0) return known.join("\n\n").slice(0, 2000);

  return (await websiteDescription(domain)).slice(0, 2000);
};

export const leadResearchTool = createTool({
  id: "lead-research",
  description:
    "Research a company and return background text for industry and size classification, from Wikipedia or the company website.",
  inputSchema: z.object({
    companyName: z.string(),
    domain: z.string().default(""),
  }),
  outputSchema: z.object({ extract: z.string() }),
  execute: async ({ context }) => ({
    extract: await researchContext(context.companyName, context.domain ?? ""),
  }),
});
