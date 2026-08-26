import { describe, expect, it } from "vitest";
import { type ReviewAction, SummaryReview, wrapText } from "../src/review.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping is the point
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;
const strip = (s: string) => s.replace(ANSI, "");

const DRAFT = ["## Decision: fix-flaky-test", "", "**Outcome:** fixed tmpdir collision.", "line 4", "line 5"].join(
	"\n",
);

function makeReview(opts: Partial<ConstructorParameters<typeof SummaryReview>[0]> = {}) {
	const actions: ReviewAction[] = [];
	const review = new SummaryReview({
		branchName: "fix-flaky-test",
		draft: DRAFT,
		entryCount: 4,
		estTokens: 2100,
		model: "haiku-4.5",
		regenerable: true,
		maxBody: 3,
		onAction: (a) => actions.push(a),
		...opts,
	});
	return { review, actions };
}

describe("SummaryReview", () => {
	it("renders header stats, the draft, and the key footer within width", () => {
		const { review } = makeReview();
		const lines = review.render(100).map(strip);
		expect(lines[0]).toContain("⎇ fix-flaky-test");
		expect(lines[0]).toContain("closes 4 entries");
		expect(lines[0]).toContain("drafted by haiku-4.5");
		expect(lines.some((l) => l.includes("## Decision: fix-flaky-test"))).toBe(true);
		expect(lines.at(-1)).toContain("enter accept");
		expect(lines.at(-1)).toContain("r re-draft");
		for (const l of review.render(40)) expect(strip(l).length).toBeLessThanOrEqual(40);
	});

	it("maps keys to actions: enter/e/r/esc", () => {
		const { review, actions } = makeReview();
		review.handleInput("\r");
		review.handleInput("e");
		review.handleInput("r");
		review.handleInput("\x1b");
		expect(actions.map((a) => a.type)).toEqual(["accept", "edit", "regenerate", "cancel"]);
	});

	it("ignores r when not regenerable and hides it from the footer", () => {
		const { review, actions } = makeReview({ regenerable: false });
		review.handleInput("r");
		expect(actions).toHaveLength(0);
		expect(strip(review.render(100).at(-1) ?? "")).not.toContain("re-draft");
	});

	it("scrolls with j/k without emitting actions", () => {
		const { review, actions } = makeReview();
		const before = review.render(100).map(strip);
		review.handleInput("j");
		const after = review.render(100).map(strip);
		expect(actions).toHaveLength(0);
		expect(before).not.toEqual(after);
		expect(after.some((l) => l.includes("line 4"))).toBe(true);
		review.handleInput("k");
		expect(review.render(100).map(strip)).toEqual(before);
	});

	it("wrapText wraps on words and hard-splits unbroken runs", () => {
		expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
		expect(wrapText("x".repeat(9), 4)).toEqual(["xxxx", "xxxx", "x"]);
		expect(wrapText("keep\nlines", 40)).toEqual(["keep", "lines"]);
	});
});
