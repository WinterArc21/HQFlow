// Test fixture route for POST /api/generate.

import { validateGenerateRequest, hasRemainingQuota, type GenerateRequestBody } from "../../../lib/validation";
import { scrapeWebsite } from "../../../lib/scraper";
import { buildProductContext } from "../../../lib/product-model";
import { generateStoryPlan } from "../../../lib/story";
import { saveGeneration } from "../../../lib/persistence";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Handles `POST /api/generate`: validate, scrape, understand, plan, persist, respond. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as GenerateRequestBody;

  const validated = validateGenerateRequest(body);
  if (!validated.ok) {
    return jsonResponse({ error: validated.reason }, 400);
  }

  const generationsThisMonth = 0; // Looked up per-account in the real deployment.
  if (!hasRemainingQuota(generationsThisMonth)) {
    return jsonResponse({ error: "Monthly generation quota exceeded." }, 429);
  }

  let scraped;
  try {
    scraped = await scrapeWebsite(validated.value.url);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Failed to scrape website." }, 502);
  }

  const product = buildProductContext(scraped);
  const story = generateStoryPlan(product, validated.value.tone);
  const generation = await saveGeneration({ url: validated.value.url, product, story });

  return jsonResponse({ generation }, 201);
}
