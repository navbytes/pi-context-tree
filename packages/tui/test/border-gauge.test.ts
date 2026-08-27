import { describe, expect, it } from "vitest";
import { borderGaugeLine, paintBorderGauge } from "../src/border-gauge.ts";
import { type GaugeInput, gaugeLabel, renderGauge } from "../src/gauge.ts";
import { defaultTheme as T } from "../src/theme.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const STRIP = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const W = 80;
const border = (w = W) => "─".repeat(w);
const editor = (w = W) => [border(w), " some typed text", border(w)];

const real: GaugeInput = { tokens: 46_000, window: 200_000, estimated: false };

describe("borderGaugeLine", () => {
	it("carries the same label the bar does — this is the acceptance bar", () => {
		const inBorder = STRIP(borderGaugeLine(real, T, "", W));
		// every fragment the bar shows must survive into the border
		for (const part of STRIP(gaugeLabel(real, T)).split(" · ")) {
			expect(inBorder).toContain(part);
		}
		expect(inBorder).toContain("23.0% filling");
		expect(inBorder).toContain("46k / 200k");
	});

	it("keeps the honest estimating state rather than collapsing to a bare bar", () => {
		const line = STRIP(borderGaugeLine({ tokens: 46_000, window: 200_000, estimated: true }, T, "", W));
		expect(line).toContain("est");
		expect(line).not.toMatch(/\d\.\d%/); // no fake-precise percent
	});

	it("carries the trend and its attribution", () => {
		const line = STRIP(borderGaugeLine(real, T, " ▲ +24% (chrome.snapshot)", W));
		expect(line).toContain("▲ +24%");
		expect(line).toContain("(chrome.snapshot)");
	});

	it("carries the compaction notice", () => {
		const line = STRIP(borderGaugeLine({ tokens: 190_000, window: 200_000, estimated: false }, T, "", W));
		expect(line).toContain("pi compacts soon");
	});

	it("distinguishes 0%, estimating and unknown-window instead of drawing one blank bar", () => {
		const zero = STRIP(borderGaugeLine({ tokens: 0, window: 200_000, estimated: false }, T, "", W));
		const estimating = STRIP(borderGaugeLine({ tokens: null }, T, "", W));
		const noWindow = STRIP(borderGaugeLine({ tokens: 46_000 }, T, "", W));
		expect(new Set([zero, estimating, noWindow]).size).toBe(3);
		expect(zero).toContain("0.0% low");
		expect(estimating).toContain("estimating");
		expect(noWindow).toContain("window unknown");
	});

	it("fills proportionally and never exceeds the width", () => {
		for (const tokens of [0, 1_000, 46_000, 199_000]) {
			const line = borderGaugeLine({ tokens, window: 200_000, estimated: false }, T, "", W);
			expect(STRIP(line).length).toBeLessThanOrEqual(W);
		}
		const low = STRIP(borderGaugeLine({ tokens: 1_000, window: 200_000, estimated: false }, T, "", W));
		const high = STRIP(borderGaugeLine({ tokens: 190_000, window: 200_000, estimated: false }, T, "", W));
		expect((high.match(/─/g) ?? []).length).toBeGreaterThan((low.match(/─/g) ?? []).length);
	});

	it("drops the label rather than overflow when the terminal is narrow", () => {
		const line = STRIP(borderGaugeLine(real, T, "", 16));
		expect(line.length).toBeLessThanOrEqual(16);
		expect(line).not.toContain("filling"); // bar alone still carries the band color
	});
});

describe("paintBorderGauge", () => {
	it("replaces the bottom border, not the last line (autocomplete sits below it)", () => {
		const lines = [...editor(), "candidate one", "candidate two"];
		const out = paintBorderGauge([...lines], real, T, "", W);
		expect(STRIP(out[2] ?? "")).toContain("23.0% filling");
		expect(out[3]).toBe("candidate one");
		expect(out[4]).toBe("candidate two");
		expect(out[0]).toBe(border()); // top border untouched
	});

	it("keeps pi's scroll indicator and gauges the remainder", () => {
		const lines = [border(), " text", `─── ↓ 3 more ${"─".repeat(W - 13)}`];
		const out = STRIP(paintBorderGauge([...lines], real, T, "", W)[2] ?? "");
		expect(out).toContain("↓ 3 more");
		expect(out.length).toBeLessThanOrEqual(W);
	});

	it("survives an ANSI-colored border, which is what pi actually emits", () => {
		// pi builds the rule as borderColor("─").repeat(width) — escapes per character
		const colored = "\x1b[90m─\x1b[39m".repeat(W);
		const out = paintBorderGauge([colored, " text", colored], real, T, "", W);
		expect(STRIP(out[2] ?? "")).toContain("23.0% filling");
	});

	it("leaves output alone when there is no border line to paint", () => {
		const lines = ["just text", "more text"];
		expect(paintBorderGauge([...lines], real, T, "", W)).toEqual(lines);
	});

	it("agrees with the bar on the band word", () => {
		const bar = STRIP(renderGauge(real, T));
		const line = STRIP(paintBorderGauge(editor(), real, T, "", W)[2] ?? "");
		expect(bar).toContain("filling");
		expect(line).toContain("filling");
	});
});
