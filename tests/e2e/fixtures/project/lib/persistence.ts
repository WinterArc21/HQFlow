// Minimal in-memory persistence for the end-to-end test project.

import type { StoryPlan } from "./story";
import type { ProductContext } from "./product-model";

export interface Generation {
  id: string;
  url: string;
  product: ProductContext;
  story: StoryPlan;
  createdAt: string;
}

export interface UploadedAsset {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storedAt: string;
}

const generations = new Map<string, Generation>();
const assets = new Map<string, UploadedAsset>();

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface SaveGenerationInput {
  url: string;
  product: ProductContext;
  story: StoryPlan;
}

/** Persists a completed generation and returns the stored record. */
export async function saveGeneration(input: SaveGenerationInput): Promise<Generation> {
  const generation: Generation = {
    id: generateId("gen"),
    url: input.url,
    product: input.product,
    story: input.story,
    createdAt: new Date().toISOString(),
  };
  generations.set(generation.id, generation);
  return generation;
}

/** Looks up a previously saved generation by id. */
export async function getGeneration(id: string): Promise<Generation | null> {
  return generations.get(id) ?? null;
}

export interface SaveAssetInput {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/** Records metadata for an uploaded reference asset. */
export async function saveAsset(input: SaveAssetInput): Promise<UploadedAsset> {
  const asset: UploadedAsset = {
    id: generateId("asset"),
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    storedAt: new Date().toISOString(),
  };
  assets.set(asset.id, asset);
  return asset;
}
