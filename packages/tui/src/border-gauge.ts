/**
 * Gauge mode "border" (F5.6): pi's input box already renders text inside its
 * bottom border — `─── ↓ 3 more ────────` — so the border can carry the full
 * gauge reading, not just a color. This paints it there.
 *
 *   ─ 46k / 200k · 23.2% filling ▲ +24% (chrome.snapshot) ────────··········
 *
 * Label parity with the bar is the point: same tokens, percent, band word,
 * `est` marker and compaction notice, all from `gaugeLabel()`, plus the trend.
 * A border that could only show a color would lose exactly the information the
 * gauge exists to deliver.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type Band, band } from "@pi-context-tree/core";
import { type GaugeInput, gaugeLabel } from "./gauge.ts";
import type { CtreeTheme } from "./theme.ts";

const FILLED = "─"; // continues pi's own border rule
const EMPTY = "·";
/** Below this many columns of runway the label is dropped for a bare bar. */
const MIN_BAR = 10;

/** pi's scrolled bottom border keeps its own indicator; the gauge takes the rest. */
const SCROLL_RE = /^(─── ↓ \d+ more )/;

/** `────·····` sized to `width`, filled to `pct`. pct null → all dotted. */
export function borderBar(pct: number | null, b: Band, width: number, theme: CtreeTheme): string {
	if (width <= 0) return "";
	const fill = pct === null ? 0 : Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
	return theme.band[b](FILLED.repeat(fill)) + theme.dim(EMPTY.repeat(Math.max(0, width - fill)));
}

/**
 * One border line: `─ <label><trend> ` then the bar for whatever width is left.
 * Falls back to a bare bar when the terminal is too narrow to carry both.
 */
export function borderGaugeLine(
	input: GaugeInput,
	theme: CtreeTheme,
	trend: string,
	width: number,
	prefix = "",
): string {
	const pct = input.tokens !== null && input.window && input.window > 0 ? (input.tokens / input.window) * 100 : null;
	const b: Band = band(input.tokens ?? 0);
	const runway = width - visibleWidth(prefix);
	if (runway <= 0) return theme.band[b](prefix);

	const head = `${theme.band[b](FILLED)} ${gaugeLabel(input, theme)}${trend} `;
	const headWidth = visibleWidth(head);
	if (headWidth + MIN_BAR > runway) {
		// too narrow for label + bar: the bar alone still carries the signal
		return theme.band[b](prefix) + borderBar(pct, b, runway, theme);
	}
	return theme.band[b](prefix) + head + borderBar(pct, b, runway - headWidth, theme);
}

/**
 * Replace the editor's bottom border in `lines` with the gauge.
 *
 * Located positionally rather than by index: pi-tui appends autocomplete lines
 * AFTER the bottom border (editor.js render order is top border → content →
 * bottom border → autocomplete), so replacing the last line would clobber open
 * completions. Index 0 is the top border and is never touched. If no border
 * line is found, pi's output is returned untouched.
 */
export function paintBorderGauge(
	lines: string[],
	input: GaugeInput,
	theme: CtreeTheme,
	trend: string,
	width: number,
): string[] {
	if (lines.length < 2) return lines;
	for (let i = lines.length - 1; i >= 1; i--) {
		const plain = stripToPlain(lines[i] ?? "");
		const scroll = plain.match(SCROLL_RE);
		if (scroll) {
			lines[i] = fit(borderGaugeLine(input, theme, trend, width, scroll[0]), width);
			return lines;
		}
		if (/^─+$/.test(plain)) {
			lines[i] = fit(borderGaugeLine(input, theme, trend, width), width);
			return lines;
		}
	}
	return lines;
}

/** Never let a long attribution push the border past the editor width. */
function fit(line: string, width: number): string {
	return visibleWidth(line) > width ? truncateToWidth(line, width, "…") : line;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripToPlain(line: string): string {
	return line.replace(ANSI_RE, "");
}
