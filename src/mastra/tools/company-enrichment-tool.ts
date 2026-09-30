import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchText, resolves } from "./http";

const emptySocialMedia = { linkedin: "", twitter: "", facebook: "", instagram: "" };

export const contactInfoSchema = z.object({
  emails: z.array(z.string()).default([]),
  phones: z.array(z.string()).default([]),
  website: z.string().default(""),
  socialMedia: z
    .object({
      linkedin: z.string().default(""),
      twitter: z.string().default(""),
      facebook: z.string().default(""),
      instagram: z.string().default(""),
    })
    .default(emptySocialMedia),
  address: z.string().default(""),
});

export type ContactInfo = z.infer<typeof contactInfoSchema>;

const emptyContact = (): ContactInfo => ({
  emails: [],
  phones: [],
  website: "",
  socialMedia: { ...emptySocialMedia },
  address: "",
});

/** Google's favicon service answers for essentially any domain. */
const googleFavicon = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

/** Logo providers in preference order, best image quality first. */
const logoCandidates = (domain: string) => [
  `https://logo.clearbit.com/${domain}`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  googleFavicon(domain),
  `https://${domain}/favicon.ico`,
];

/**
 * Probe the providers concurrently but accept them in preference order, so a
 * fast low-priority hit never beats a better one and a dead provider only costs
 * its timeout when nothing above it answered. Clearbit is frequently dead,
 * which makes probing these one at a time slow.
 */
export const resolveLogo = async (domain: string): Promise<string> => {
  const candidates = logoCandidates(domain);
  const probes = candidates.map((url) => resolves(url));

  for (const [index, probe] of probes.entries()) {
    if (await probe) return candidates[index];
  }
  return googleFavicon(domain);
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAILTO_RE = /mailto:([^"'?>\s]+)/gi;
const TEL_RE = /tel:([+0-9()\s.-]{7,25})/gi;

/**
 * Phone numbers must carry real formatting - a separator or parentheses.
 * Matching bare digit runs pulls in timestamps and asset ids from inline JSON,
 * which is worse than reporting no phone at all. The lookarounds stop the match
 * from starting or ending inside a longer run of digits.
 */
const PHONE_RE =
  /(?<![\d.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d.])/g;

const ADDRESS_RE =
  /\d{1,5}\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Suite|Ste)\b[^|<>]{0,60}/;

/** Emails that are almost always tracking pixels, asset hashes or CDN noise. */
const isJunkEmail = (email: string) =>
  /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(email) ||
  /^[0-9a-f]{16,}@/i.test(email) ||
  /(example|sentry|wixpress|godaddy|cloudflare|schema\.org|w3\.org)/i.test(email);

/** Capture group 1 of every match, e.g. the address out of `mailto:`. */
const collect = (html: string, re: RegExp) =>
  Array.from(html.matchAll(re), (match) => match[1]).filter(Boolean);

/** Profile URLs to look for, keyed by the field they populate. */
const SOCIAL_HOSTS = {
  linkedin: ["linkedin\\.com"],
  twitter: ["twitter\\.com", "x\\.com"],
  facebook: ["facebook\\.com"],
  instagram: ["instagram\\.com"],
} as const;

const findSocial = (html: string, hosts: readonly string[]) => {
  for (const host of hosts) {
    const match = html.match(
      new RegExp(`https?://(?:[a-z]{2,3}\\.)?${host}/[A-Za-z0-9_./-]+`, "i")
    );
    if (match) return match[0].replace(/["'<>]/g, "");
  }
  return "";
};

const uniq = (values: string[], max: number) =>
  Array.from(new Set(values.map((value) => value.trim())))
    .filter(Boolean)
    .slice(0, max);

/** Strip scripts, styles and tags so text patterns cannot match markup or JSON. */
const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

/** The usual places a company publishes contact details. */
const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/privacy-policy"];

/**
 * Scrape the homepage plus the usual contact pages for emails, phones,
 * social links and a postal address. Every fetch is best-effort.
 */
export const enrichFromWebsite = async (domain: string): Promise<ContactInfo> => {
  // Fetched together rather than in sequence - most of these 404 and the whole
  // set costs one round trip instead of six.
  const pages = await Promise.all(
    CONTACT_PATHS.map((path) => fetchText(`https://${domain}${path}`))
  );
  const html = pages.filter(Boolean).join("\n");

  if (!html) return emptyContact();

  // mailto:/tel: links are explicit contact details, so trust them ahead of
  // anything matched loosely out of the page text.
  const mailto = collect(html, MAILTO_RE).map((email) => decodeURIComponent(email).trim());
  const text = visibleText(html);
  const tel = collect(html, TEL_RE).map((phone) => phone.replace(/\s+/g, " ").trim());

  return {
    emails: uniq([...mailto, ...(html.match(EMAIL_RE) ?? [])].filter((e) => !isJunkEmail(e)), 5),
    phones: uniq([...tel, ...(text.match(PHONE_RE) ?? [])], 3),
    website: `https://${domain}`,
    socialMedia: {
      linkedin: findSocial(html, SOCIAL_HOSTS.linkedin),
      twitter: findSocial(html, SOCIAL_HOSTS.twitter),
      facebook: findSocial(html, SOCIAL_HOSTS.facebook),
      instagram: findSocial(html, SOCIAL_HOSTS.instagram),
    },
    address: text.match(ADDRESS_RE)?.[0].replace(/\s+/g, " ").trim() ?? "",
  };
};

/** How much of a contact record we managed to fill in. */
export const enrichmentStatusOf = (contact: ContactInfo) => {
  if (!contact.website) return "unreachable";
  return contact.emails.length + contact.phones.length > 0 ? "enriched" : "partial";
};

export const companyEnrichmentTool = createTool({
  id: "company-enrichment",
  description:
    "Enrich a company with a logo URL plus contact details (emails, phones, social links, address) scraped from its website.",
  inputSchema: z.object({ domain: z.string() }),
  outputSchema: z.object({
    logoUrl: z.string(),
    contactInfo: contactInfoSchema,
    enrichmentStatus: z.string(),
  }),
  execute: async ({ context }) => {
    const [logoUrl, contactInfo] = await Promise.all([
      resolveLogo(context.domain),
      enrichFromWebsite(context.domain),
    ]);
    return { logoUrl, contactInfo, enrichmentStatus: enrichmentStatusOf(contactInfo) };
  },
});
