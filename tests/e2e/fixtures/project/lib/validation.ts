// Request validation for the test project's endpoints.

export interface GenerateRequestBody {
  url: string;
  referenceImageUrls?: string[];
  tone?: "cinematic" | "documentary" | "playful";
}

export interface ValidatedGenerateRequest {
  url: string;
  referenceImageUrls: string[];
  tone: "cinematic" | "documentary" | "playful";
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const MAX_REFERENCE_IMAGES = 6;
const MONTHLY_FREE_TIER_QUOTA = 20;

function isLikelyUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Validates a raw generate request body: URL shape, reference image count, and tone. */
export function validateGenerateRequest(body: GenerateRequestBody): ValidationResult<ValidatedGenerateRequest> {
  if (typeof body.url !== "string" || !isLikelyUrl(body.url)) {
    return { ok: false, reason: "url must be a valid http(s) URL." };
  }

  const referenceImageUrls = body.referenceImageUrls ?? [];
  if (referenceImageUrls.length > MAX_REFERENCE_IMAGES) {
    return { ok: false, reason: `At most ${MAX_REFERENCE_IMAGES} reference images are allowed.` };
  }
  if (referenceImageUrls.some((url) => !isLikelyUrl(url))) {
    return { ok: false, reason: "Every reference image must be a valid http(s) URL." };
  }

  return {
    ok: true,
    value: { url: body.url, referenceImageUrls, tone: body.tone ?? "cinematic" },
  };
}

/** Checks a free-tier account's remaining monthly generation quota. */
export function hasRemainingQuota(generationsThisMonth: number): boolean {
  return generationsThisMonth < MONTHLY_FREE_TIER_QUOTA;
}
