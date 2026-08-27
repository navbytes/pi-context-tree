/**
 * Context gauge (F5.2): fill bar with band ticks plus a label. Ticks sit where
 * the band color changes for this window (percent rule vs absolute-token cap).
 * `tokens === null` renders the post-compaction "estimating" state.
 */

import { type Band, band, bandStartPercents, compactionImminent, fmtTokens } from "@pi-context-tree/core";
import type { CtreeTheme } from "./theme.ts";

export interface GaugeInput {
	tokens: number | null;
	window?: number;
	estimated?: boolean;
	barWidth?: number;
}

export function renderGauge(input: GaugeInput, theme: CtreeTheme): string {
	const barWidth = input.barWidth ?? 30;
	if (input.tokens === null) {
		return `${theme.dim("CONTEXT")} ${theme.dim("░".repeat(barWidth))} ${theme.dim("estimating… (awaiting next turn)")}`;
	}
	// tokens known but no window (standalone pitree): show the estimate — there
	// is no "next turn" coming, and "estimating…" would be a permanent lie
	if (!input.window || input.window <= 0) {
		return `${theme.dim("CONTEXT")} ${theme.dim("░".repeat(barWidth))} ~${fmtTokens(input.tokens)} est · ${theme.dim("window unknown")}`;
	}
	const pct = (input.tokens / input.window) * 100;
	const b: Band = band(input.tokens);
	const fill = Math.max(0, Math.min(barWidth, Math.round((pct / 100) * barWidth)));
	const ticks = new Set(
		Object.values(bandStartPercents(input.window)).map((p) => Math.min(barWidth - 1, Math.round((p / 100) * barWidth))),
	);
	let bar = "";
	for (let i = 0; i < barWidth; i++) {
		const ch = i < fill ? "█" : ticks.has(i) ? "┊" : "░";
		bar += i < fill ? theme.band[b](ch) : theme.dim(ch);
	}
	// Honest estimate: while estimating (chars/4, pre-first-turn), show the band word
	// + a coarse ~Nk est — never a fake-precise percent. Exact % only on pi's real count.
	const label =
		input.estimated === false
			? `${fmtTokens(input.tokens)} / ${fmtTokens(input.window)} · ${theme.band[b](`${pct.toFixed(1)}% ${b}`)}`
			: `~${fmtTokens(input.tokens)} est · ${theme.band[b](b)}`;
	// The container failure is separate from the quality band: pi is about to
	// replace source material with a summary, whatever color the bar is.
	const compact = compactionImminent(input.tokens, input.window) ? ` ${theme.band.red("· pi compacts soon")}` : "";
	return `${theme.dim("CONTEXT")} ${bar} ${label}${compact}`;
}
