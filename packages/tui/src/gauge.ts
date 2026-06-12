/**
 * Context gauge (F5.2): fill bar with band ticks at 5/15/40% plus a label.
 * `tokens === null` renders the post-compaction "estimating" state.
 */

import { BAND_THRESHOLDS, type Band, band, fmtTokens } from "@pi-context-tree/core";
import type { CtreeTheme } from "./theme.ts";

export interface GaugeInput {
	tokens: number | null;
	window?: number;
	estimated?: boolean;
	barWidth?: number;
}

export function renderGauge(input: GaugeInput, theme: CtreeTheme): string {
	const barWidth = input.barWidth ?? 30;
	if (input.tokens === null || !input.window || input.window <= 0) {
		return `${theme.dim("CONTEXT")} ${theme.dim("░".repeat(barWidth))} ${theme.dim("estimating… (awaiting next turn)")}`;
	}
	const pct = (input.tokens / input.window) * 100;
	const b: Band = band(pct);
	const fill = Math.max(0, Math.min(barWidth, Math.round((pct / 100) * barWidth)));
	const ticks = new Set(
		[BAND_THRESHOLDS.healthy, BAND_THRESHOLDS.filling, BAND_THRESHOLDS.red].map((p) =>
			Math.min(barWidth - 1, Math.round((p / 100) * barWidth)),
		),
	);
	let bar = "";
	for (let i = 0; i < barWidth; i++) {
		const ch = i < fill ? "█" : ticks.has(i) ? "┊" : "░";
		bar += i < fill ? theme.band[b](ch) : theme.dim(ch);
	}
	const approx = input.estimated === false ? "" : "~";
	const label = `${approx}${fmtTokens(input.tokens)} / ${fmtTokens(input.window)} · ${theme.band[b](`${pct.toFixed(1)}% ${b}`)}`;
	return `${theme.dim("CONTEXT")} ${bar} ${label}`;
}
