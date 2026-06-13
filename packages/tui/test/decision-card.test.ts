import { describe, expect, it } from "vitest";
import { decisionCardLines } from "../src/decision-card.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping is the point
const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

const INPUT = {
	branchName: "storage-layer",
	dateIso: "2026-06-08",
	content: [
		"## Decision: storage-layer",
		"**Outcome:** chrome.storage.session with a write-through cache.",
		"**Why:**",
		"- survives MV3 restarts",
	].join("\n"),
	siblings: [{ name: "storage-a", reason: "sync quota too small" }],
};

describe("decisionCardLines", () => {
	it("renders the mockup card: ◆ title, meta, body, ✗ epitaphs when expanded", () => {
		const lines = decisionCardLines({ ...INPUT, expanded: true }, 100).map(strip);
		expect(lines[0]).toContain("◆ storage-layer");
		expect(lines[0]).toContain("decision record");
		expect(lines[1]).toContain("2026-06-08");
		expect(lines[1]).toContain("human-confirmed ✓");
		expect(lines.some((l) => l.includes("**Why:**"))).toBe(true);
		expect(lines.at(-1)).toContain("✗ storage-a — sync quota too small");
	});

	it("collapses to title, meta and outcome line", () => {
		const lines = decisionCardLines({ ...INPUT, expanded: false }, 100).map(strip);
		expect(lines.some((l) => l.includes("chrome.storage.session"))).toBe(true);
		expect(lines.some((l) => l.includes("**Why:**"))).toBe(false);
		expect(lines.some((l) => l.includes("✗ storage-a"))).toBe(true); // epitaphs always visible (G3)
	});

	it("never exceeds the given width", () => {
		for (const w of [40, 60, 100]) {
			for (const line of decisionCardLines({ ...INPUT, expanded: true }, w)) {
				expect(strip(line).length).toBeLessThanOrEqual(w);
			}
		}
	});
});
