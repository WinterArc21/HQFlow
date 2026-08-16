// Fetches a submitted website and extracts data for the end-to-end test project.

export interface ScrapedWebsite {
  url: string;
  title: string;
  description: string;
  bodyText: string;
  images: string[];
}

interface RawPage {
  html: string;
  finalUrl: string;
}

async function fetchRenderedPage(url: string): Promise<RawPage> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  return { html, finalUrl: response.url || url };
}

/** Pulls `<title>` and `<meta name="description">` out of raw HTML. */
export function extractMetadata(html: string): { title: string; description: string } {
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
  const descriptionMatch = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html);
  return {
    title: titleMatch?.[1]?.trim() ?? "",
    description: descriptionMatch?.[1]?.trim() ?? "",
  };
}

/** Pulls every absolute `<img src>` URL out of raw HTML, in document order. */
export function extractImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];
  const pattern = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const src = match[1];
    if (src === undefined) {
      continue;
    }
    try {
      images.push(new URL(src, baseUrl).toString());
    } catch {
      // Ignore malformed `src` attributes rather than failing the whole scrape.
    }
  }
  return images;
}

function extractBodyText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetches `url` and extracts everything MotionA needs to build a product context. */
export async function scrapeWebsite(url: string): Promise<ScrapedWebsite> {
  const page = await fetchRenderedPage(url);
  const { title, description } = extractMetadata(page.html);
  return {
    url: page.finalUrl,
    title,
    description,
    bodyText: extractBodyText(page.html),
    images: extractImages(page.html, page.finalUrl),
  };
}
