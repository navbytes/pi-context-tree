/**
 * Ambient UI (F5): footer status gauge + terminal title + a context-health
 * gauge bar pinned above the prompt, refreshed on session events; one-time
 * red-band nudge (F5.3); /compact philosophy warning (F5.4). pi's
 * getContextUsage() reports 0 until a fresh assistant turn lands — for a
 * non-empty session everything falls back to the chars/4 estimate (marked ~),
 * mirroring the panel gauge (§11.5).
 *
 * Prompt health (G1, deck "customise the prompt bar"): the deck colors pi's
 * input *border* green→red. pi owns that border for bash/thinking mode and
 * re-asserts it, so an extension can't color it by health without fighting pi.
 * Instead we pin a colored CONTEXT gauge bar (the panel gauge) directly above
 * the prompt via setWidget — same intent (always-visible, green→red), fully
 * ours, no conflict.
 */

import { aggregateConsumers, band, contextSlice, estimateContextTokens } from "@pi-context-tree/core";
import { defaultTheme, renderGauge } from "@pi-context-tree/tui";
import { type CtxLike, type PiLike, projectName } from "./adapter.ts";
import { rememberCtx } from "./ctx-cache.ts";
import { type SessionState, deriveState } from "./state.ts";

let warnedRed = false;

// Trend/attribution baseline (F5.2+): compared like-for-like turn over turn, reset
// per session so a new session never inherits the previous one's trend.
let lastPct: number | null = null;
let lastEstimated = true;
let lastConsumers = new Map<string, number>();
const TREND_PTS = 3; // ▲ when context rose ≥ this many points since last turn
const ATTRIBUTE_PTS = 5; // …and name the biggest-growth consumer at ≥ this jump

/** Reset the trend baseline — on session_start, and from tests. */
export function resetAmbient(): void {
	lastPct = null;
	lastEstimated = true;
	lastConsumers = new Map();
}

/**
 * ` ▲` / ` ▲ +Δ% (bucket)` — only across same-basis turns (never estimate↔real, whose
 * apparent jump is just calibration). Updates the baseline as a side effect.
 */
function trendMarker(pct: number, estimated: boolean, consumers: Map<string, number>): string {
	let out = "";
	if (lastPct !== null && estimated === lastEstimated) {
		const delta = pct - lastPct;
		if (delta >= ATTRIBUTE_PTS) {
			let topKey = "";
			let topGrowth = 0;
			for (const [key, tokens] of consumers) {
				const growth = tokens - (lastConsumers.get(key) ?? 0);
				if (growth > topGrowth) {
					topGrowth = growth;
					topKey = key;
				}
			}
			out = topKey ? ` ▲ +${Math.round(delta)}% (${topKey})` : ` ▲ +${Math.round(delta)}%`;
		} else if (delta >= TREND_PTS) {
			out = " ▲";
		}
	}
	lastPct = pct;
	lastEstimated = estimated;
	lastConsumers = consumers;
	return out;
}

function nudgeOnRed(ctx: CtxLike, b: string): void {
	if (b === "red" && !warnedRed) {
		warnedRed = true;
		ctx.ui.notify("context crossed 40% of the window — consider /merge, /crop or /branch (F5.3)", "warning");
	}
	if (b !== "red") warnedRed = false;
}

export function refreshAmbient(pi: PiLike, ctx: CtxLike): void {
	rememberCtx(ctx); // feeds argument completions (ctx-cache.ts)
	let state: SessionState | undefined;
	try {
		state = deriveState(ctx);
	} catch {
		// session not ready — keep defaults
	}
	const branch = state?.currentFork?.data.name ?? "trunk";

	const usage = ctx.getContextUsage?.();
	const window = usage?.contextWindow ?? (ctx.model?.contextWindow as number | undefined);

	// One (tokens, pct, estimated) measurement — pi's real count if it has one, else chars/4.
	// The slice feeds both the estimate and the consumer breakdown used for attribution.
	const slice = state?.leafId ? contextSlice(state.tree, state.leafId) : undefined;
	const consumers = slice
		? new Map(aggregateConsumers(slice).map((r) => [r.key, r.tokens] as [string, number]))
		: undefined;
	let gaugeTokens: number | null = null;
	let pct: number | null = null;
	let estimated = true;
	if (usage && usage.percent !== null && usage.tokens !== null && usage.tokens > 0) {
		gaugeTokens = usage.tokens;
		pct = usage.percent;
		estimated = false;
	} else if (slice && window && window > 0) {
		gaugeTokens = estimateContextTokens(slice);
		pct = (gaugeTokens / window) * 100;
	}

	const trend = pct !== null && consumers ? trendMarker(pct, estimated, consumers) : "";

	let gaugeText = "ctx —";
	if (pct !== null) {
		const b = band(pct);
		// honest: no fake-precise percent while estimating — band word + est marker
		gaugeText = estimated ? `ctx ${b} · est${trend}` : `ctx ${pct.toFixed(1)}% ${b}${trend}`;
		nudgeOnRed(ctx, b);
	} else if (usage) {
		gaugeText = "ctx est…";
	}

	ctx.ui.setStatus("ctree", `⎇ ${branch} · ${gaugeText}`);
	ctx.ui.setTitle(`${projectName()}${branch !== "trunk" ? ` (${branch})` : ""} (pi)`);

	// G1: colored context-health gauge bar above the prompt (green→red, band-ticked)
	if (ctx.ui.setWidget && window && window > 0) {
		const bar = renderGauge({ tokens: gaugeTokens, window, estimated, barWidth: 28 }, defaultTheme);
		ctx.ui.setWidget("ctree-gauge", [` ${bar}${trend}`], { placement: "aboveEditor" });
	}
}

export function registerAmbient(pi: PiLike): void {
	pi.on?.("session_start", (_e, ctx) => {
		resetAmbient();
		refreshAmbient(pi, ctx);
	});
	pi.on?.("turn_end", (_e, ctx) => refreshAmbient(pi, ctx));
	pi.on?.("session_tree", (_e, ctx) => refreshAmbient(pi, ctx));
	pi.on?.("session_before_compact", (_e, ctx) => {
		ctx.ui.notify(
			"heads-up: /compact replaces source material with a lossy summary — pi-context-tree prefers /branch + /merge (decision records) or /crop. Continuing anyway (F5.4).",
			"warning",
		);
		return undefined; // never block
	});
}
