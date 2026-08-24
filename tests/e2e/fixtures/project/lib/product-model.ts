// Converts scraped website material into a structured product model for tests.

import type { ScrapedWebsite } from "./scraper";

export interface ProductContext {
  productName: string;
  tagline: string;
  summary: string;
  heroImage: string | null;
  keywords: string[];
}

const STOPWORDS = new Set(["the", "and", "for", "with", "your", "that", "this", "from", "are", "you"]);

function extractKeywords(bodyText: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const rawWord of bodyText.toLowerCase().split(/[^a-z0-9]+/)) {
    if (rawWord.length < 4 || STOPWORDS.has(rawWord)) {
      continue;
    }
    counts.set(rawWord, (counts.get(rawWord) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

/**
 * Builds a `ProductContext` from a scraped page. The product name falls back to the page
 * title when no more explicit signal is available; the first scraped image (if any) is
 * assumed to be representative of the product.
 */
export function buildProductContext(scraped: ScrapedWebsite): ProductContext {
  return {
    productName: scraped.title || "Untitled product",
    tagline: scraped.description,
    summary: scraped.bodyText.slice(0, 400),
    heroImage: scraped.images[0] ?? null,
    keywords: extractKeywords(scraped.bodyText, 8),
  };
}
