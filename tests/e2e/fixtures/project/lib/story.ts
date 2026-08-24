// Turns a product context into the narrative structure used by the test project.

import type { ProductContext } from "./product-model";

export type Tone = "cinematic" | "documentary" | "playful";

export interface StoryBeat {
  title: string;
  narration: string;
  imagePrompt: string;
  durationSeconds: number;
}

export interface StoryPlan {
  tone: Tone;
  beats: StoryBeat[];
  totalDurationSeconds: number;
}

const BEAT_DURATION_SECONDS = 4;

/** Generates a short, tone-appropriate beat sequence describing `product`. */
export function generateStoryPlan(product: ProductContext, tone: Tone): StoryPlan {
  const beats: StoryBeat[] = [
    {
      title: "Hook",
      narration: `Meet ${product.productName}.`,
      imagePrompt: `${tone} establishing shot of ${product.productName}`,
      durationSeconds: BEAT_DURATION_SECONDS,
    },
    {
      title: "Problem",
      narration: product.tagline || `${product.productName} solves a real problem.`,
      imagePrompt: `${tone} shot illustrating the problem ${product.productName} solves`,
      durationSeconds: BEAT_DURATION_SECONDS,
    },
    {
      title: "Payoff",
      narration: `That's ${product.productName}.`,
      imagePrompt: `${tone} closing shot of ${product.productName}, ${product.keywords.join(", ")}`,
      durationSeconds: BEAT_DURATION_SECONDS,
    },
  ];

  return {
    tone,
    beats,
    totalDurationSeconds: beats.reduce((total, beat) => total + beat.durationSeconds, 0),
  };
}
