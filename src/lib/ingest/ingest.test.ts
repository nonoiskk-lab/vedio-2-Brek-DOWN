import { describe, expect, it } from "vitest";
import { cleanLine, dedupeConsecutive, guessLanguage, removeRollingOverlap } from "./clean";
import { formatTimestamp, parseTimedTranscript, segmentsFromCues, segmentsFromPages, segmentsFromText } from "./segment";
import { buildChunks, renderSegmentsForPrompt } from "./chunk";
import { decodeEntities, parseTimedTextXml, parseYouTubeId } from "./youtube";

describe("cleaning", () => {
  it("removes filler sounds, caption tags and stutters but keeps meaning words", () => {
    expect(cleanLine("[Music] umm so the the brand is uh actually important")).toBe("so the brand is actually important");
    expect(cleanLine("Hmm, positioning matters.")).toBe("positioning matters.");
    expect(cleanLine("I I I think <c>customers</c> matter")).toBe("I think customers matter");
  });
  it("drops consecutive duplicate caption lines", () => {
    expect(dedupeConsecutive(["Hello there", "hello there!", "Next"])).toEqual(["Hello there", "Next"]);
  });
  it("strips rolling caption overlap", () => {
    expect(removeRollingOverlap("we talk about the customer problem", "about the customer problem and competition")).toBe(
      "and competition",
    );
    expect(removeRollingOverlap("a b", "c d e")).toBe("c d e");
  });
  it("guesses Hindi from Devanagari", () => {
    expect(guessLanguage("ब्रांड क्या होता है? ब्रांड एक पहचान है")).toBe("hi");
    expect(guessLanguage("Brand kya hota hai? Brand ek pehchaan hai")).toBe("en");
  });
});

describe("segmentation", () => {
  it("groups timed cues into labelled time ranges", () => {
    const cues = Array.from({ length: 60 }, (_, i) => ({ start: i * 4, duration: 4, text: `sentence number ${i} about marketing.` }));
    const segs = segmentsFromCues(cues);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs[0].ref_label).toMatch(/^00:00–0\d:\d\d$/);
    expect(segs[0].start_sec).toBe(0);
    expect(segs.every((s, i) => s.idx === i + 1)).toBe(true);
    expect(segs.map((s) => s.text).join(" ")).toContain("sentence number 59");
  });
  it("formats hour timestamps", () => {
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(154)).toBe("02:34");
  });
  it("labels PDF pages and splits long pages", () => {
    const long = Array.from({ length: 120 }, () => "This is a sentence with several words.").join(" ");
    const segs = segmentsFromPages(["Short page one.", "", long]);
    expect(segs[0].ref_label).toBe("Page 1");
    expect(segs[1].ref_label).toMatch(/^Page 3 \(1\/\d\)$/);
    expect(segs.every((s) => s.page !== null)).toBe(true);
  });
  it("labels paragraphs and carries markdown headings", () => {
    const md = "# Branding\n\nA brand is a promise.\n\nIt lives in the mind.\n\n## Positioning\n\nPositioning is a place in the mind.";
    const segs = segmentsFromText(md, { markdown: true });
    expect(segs[0].heading).toBe("Branding");
    expect(segs[0].ref_label).toBe("¶ 1–2");
    expect(segs[1].heading).toBe("Positioning");
    expect(segs[1].ref_label).toBe("¶ 3");
  });
});

describe("pasted transcripts", () => {
  it("parses SRT", () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n2\n00:00:04,500 --> 00:00:07,000\nSecond line\n\n3\n00:02:34,000 --> 00:02:40,000\nThird";
    const cues = parseTimedTranscript(srt)!;
    expect(cues).toHaveLength(3);
    expect(cues[2].start).toBe(154);
    expect(cues[0].text).toBe("Hello world");
  });
  it("parses YouTube 'Show transcript' copies with timestamps on their own line", () => {
    const yt = "0:00\nWelcome everyone\n0:05\ntoday we discuss brands\n1:02:03\nand positioning";
    const cues = parseTimedTranscript(yt)!;
    expect(cues.map((c) => c.start)).toEqual([0, 5, 3723]);
    expect(cues[1].text).toBe("today we discuss brands");
  });
  it("returns null for plain prose", () => {
    expect(parseTimedTranscript("Just a normal paragraph.\n\nAnother one at 5:00 pm maybe.")).toBeNull();
  });
});

describe("chunking", () => {
  it("never splits segments and covers all of them", () => {
    const segs = Array.from({ length: 40 }, (_, i) => ({ idx: i + 1, text: "word ".repeat(150) }));
    const chunks = buildChunks(segs, 1800);
    expect(chunks[0].segment_start).toBe(1);
    expect(chunks[chunks.length - 1].segment_end).toBe(40);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].segment_start).toBe(chunks[i - 1].segment_end + 1);
    expect(chunks.every((c) => c.word_count <= 1950)).toBe(true);
  });
  it("folds a tiny tail into the previous chunk", () => {
    const segs = [...Array.from({ length: 12 }, (_, i) => ({ idx: i + 1, text: "w ".repeat(150) })), { idx: 13, text: "tail" }];
    const chunks = buildChunks(segs, 1800);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].segment_end).toBe(13);
  });
  it("renders segment ids for citation", () => {
    const out = renderSegmentsForPrompt([{ idx: 3, ref_label: "02:34–03:30", heading: null, text: "Hello" }]);
    expect(out).toBe("[S3 | 02:34–03:30]\nHello");
  });
});

describe("youtube helpers", () => {
  it("parses many URL shapes", () => {
    const id = "dQw4w9WgXcQ";
    for (const u of [
      `https://www.youtube.com/watch?v=${id}&t=10s`,
      `https://youtu.be/${id}?si=abc`,
      `https://youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/live/${id}`,
      `youtube.com/watch?v=${id}`,
      id,
    ]) {
      expect(parseYouTubeId(u)).toBe(id);
    }
    expect(parseYouTubeId("https://vimeo.com/123")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
  });
  it("parses legacy and srv3 timedtext XML", () => {
    const legacy =
      '<transcript><text start="0.5" dur="2.1">Hello &amp;#39;world&amp;#39;</text><text start="3" dur="1">Next</text></transcript>';
    expect(parseTimedTextXml(legacy)).toEqual([
      { start: 0.5, duration: 2.1, text: "Hello 'world'" },
      { start: 3, duration: 1, text: "Next" },
    ]);
    const srv3 = '<timedtext><body><p t="1000" d="2000"><s>Brand</s><s> matters</s></p></body></timedtext>';
    expect(parseTimedTextXml(srv3)).toEqual([{ start: 1, duration: 2, text: "Brand matters" }]);
  });
  it("decodes entities", () => {
    expect(decodeEntities("a &lt;b&gt; &#x41; &#65; &quot;q&quot;")).toBe('a <b> A A "q"');
  });
});
