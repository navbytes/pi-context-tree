import { describe, expect, it } from "vitest";
import { renderGauge } from "../src/gauge.ts";
import { defaultTheme } from "../src/theme.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping is the point
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;
const strip = (s: string) => s.replace(ANSI, "");

describe("renderGauge", () => {
	it("shows 'estimating' only when tokens are truly unknown", () => {
		expect(strip(renderGauge({ tokens: null }, defaultTheme))).toContain("estimating… (awaiting next turn)");
	});

	it("shows the estimate when the window is unknown (standalone pitree) instead of a permanent 'estimating'", () => {
		const line = strip(renderGauge({ tokens: 123_400 }, defaultTheme));
		expect(line).toContain("~123.4k est");
		expect(line).toContain("window unknown");
		expect(line).not.toContain("estimating");
	});

	it("shows the exact percent when pi reports a real count", () => {
		const line = strip(renderGauge({ tokens: 50_000, window: 200_000, estimated: false }, defaultTheme));
		expect(line).toContain("50k / 200k");
		expect(line).toContain("25.0%");
	});
});
