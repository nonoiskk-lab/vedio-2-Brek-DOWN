import { describe, expect, it } from "vitest";
import { rankSegments } from "./retrieval";
import { normalizePlan } from "./pipeline";
import type { Plan } from "./schemas";

describe("retrieval", () => {
  const segs = [
    { idx: 1, ref_label: "a", text: "Welcome to the course about marketing basics." },
    { idx: 2, ref_label: "b", text: "Greek yogurt brands won by positioning themselves as healthy." },
    { idx: 3, ref_label: "c", text: "Competition forces you to find a clear position in the customer's mind." },
    { idx: 4, ref_label: "d", text: "Distribution decides whether customers can even find the product." },
  ];
  it("ranks relevant segments first and returns them in source order", () => {
    const hits = rankSegments(segs, "What did the speaker say about Greek Yogurt?", 2);
    expect(hits.map((h) => h.idx)).toContain(2);
    expect(hits[0].idx).toBeLessThan(hits[hits.length - 1].idx + 1);
  });
  it("handles simple plurals", () => {
    expect(rankSegments(segs, "competitions", 1)[0].idx).toBe(3);
  });
});

describe("normalizePlan", () => {
  const base: Plan = {
    title: "Marketing",
    subtitle: "Basics",
    overview: "o",
    detected_language: "English",
    glossary: [{ term: "Brand", meaning: "m", refs: ["S2", "S999", "see S3"] }],
    concept_tree: [],
    chapters: [
      { key: "Intro!", title: "Introduction", goal: "g", kind: "introduction", concepts: [], chunk_indexes: [] },
      { key: "core", title: "Customer", goal: "g", kind: "core", concepts: [], chunk_indexes: [0, 1, 7] },
      { key: "core", title: "Competition", goal: "g", kind: "core", concepts: [], chunk_indexes: [3] },
    ],
  };
  it("dedupes keys, drops invalid indexes, covers every chunk and cleans refs", () => {
    const plan = normalizePlan(base, 5, 10);
    const keys = plan.chapters.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("intro-");
    const covered = new Set(plan.chapters.flatMap((c) => c.chunk_indexes));
    expect([...covered].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(plan.chapters[0].chunk_indexes).toEqual([0]);
    expect(plan.chapters.flatMap((c) => c.chunk_indexes).every((i) => i < 5)).toBe(true);
    expect(plan.glossary[0].refs).toEqual(["S2", "S3"]);
  });
  it("creates a single chapter when the model returns none", () => {
    const plan = normalizePlan({ ...base, chapters: [] }, 3, 10);
    expect(plan.chapters).toHaveLength(1);
    expect(plan.chapters[0].chunk_indexes).toEqual([0, 1, 2]);
  });
});
