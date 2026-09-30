/**
 * Shared HTTP helpers. Every outbound call in this project is best-effort
 * enrichment of a lead: a failure means "no data for this field", never a
 * failed pipeline, so these return empty/null instead of throwing.
 */

/** Public APIs (Wikipedia) ask for a descriptive, contactable user agent. */
export const API_USER_AGENT = "marketing-agency-demo/1.0 (lead research)";

/** Company sites routinely block non-browser agents, so scraping uses this one. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type FetchOptions = {
  timeoutMs?: number;
  userAgent?: string;
  method?: "GET" | "HEAD";
  accept?: string;
};

/**
 * fetch() with an abort timeout. Resolves to null on any failure - non-2xx,
 * network error or timeout - so callers can treat every failure the same way.
 */
export const fetchWithTimeout = async (
  url: string,
  { timeoutMs = 10_000, userAgent = BROWSER_USER_AGENT, method = "GET", accept }: FetchOptions = {}
): Promise<Response | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": userAgent, ...(accept ? { Accept: accept } : {}) },
    });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Fetch an HTML page as text. Returns "" for failures and non-text responses. */
export const fetchText = async (
  url: string,
  options: FetchOptions = {},
  maxChars = 400_000
): Promise<string> => {
  const response = await fetchWithTimeout(url, { accept: "text/html,*/*", ...options });
  if (!response) return "";

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("html") && !contentType.includes("text")) return "";

  try {
    return (await response.text()).slice(0, maxChars);
  } catch {
    return "";
  }
};

/** Fetch and parse JSON. Returns null on any failure, including malformed bodies. */
export const fetchJson = async <T>(url: string, options: FetchOptions = {}): Promise<T | null> => {
  const response = await fetchWithTimeout(url, options);
  if (!response) return null;

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

/** True when the URL answers a HEAD request. Used to pick a working asset URL. */
export const resolves = async (url: string, timeoutMs = 6_000): Promise<boolean> =>
  (await fetchWithTimeout(url, { method: "HEAD", timeoutMs })) !== null;
