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

import { Text } from "@earendil-works/pi-tui";
import {
	aggregateConsumers,
	type Band,
	band,
	compactionImminent,
	contextSlice,
	estimateContextTokens,
	fmtTokens,
} from "@pi-context-tree/core";
import { defaultTheme, type GaugeInput, renderGauge } from "@pi-context-tree/tui";
import { type CtxLike, type PiLike, projectName } from "./adapter.ts";
import { createBorderGaugeFactory, setBorderGauge } from "./border-editor.ts";
import { getGaugeMode } from "./config.ts";
import { rememberCtx } from "./ctx-cache.ts";
import { deriveState, type SessionState } from "./state.ts";

// One-shot notifies (F5.3): `active` fires once, `rearm` clears the latch.
// rearm is deliberately stricter than !active — sitting on a boundary is normal
// work and must not re-fire a nudge the spec calls one-time.
let borderFactory: ReturnType<typeof createBorderGaugeFactory> | undefined;
let borderInstalled = false;

const latched = new Set<string>();
function nudgeOnce(ctx: CtxLike, key: string, active: boolean, rearm: boolean, message: string): void {
	if (active && !latched.has(key)) {
		latched.add(key);
		ctx.ui.notify(message, "warning");
	}
	if (rearm) latched.delete(key);
}

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
	latched.clear();
	borderInstalled = false; // pi re-creates the editor across sessions
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

/**
 * Two nudges for two failures: the red band is a quality signal (the model is
 * degrading), the compaction guard is a container one (pi is about to swap
 * source material for a summary). They fire independently — a small window can
 * hit compaction while still green, a large one can go red with room to spare.
 */
function nudge(ctx: CtxLike, b: Band, tokens: number | null, window: number | undefined): void {
	const size = tokens === null ? "" : ` (~${fmtTokens(tokens)} tokens)`;
	nudgeOnce(
		ctx,
		"red",
		b === "red",
		b === "low" || b === "healthy", // a full band clear of red
		`context entered the red band${size} — consider /merge, /crop or /branch (F5.3)`,
	);
	if (tokens === null) return;
	nudgeOnce(
		ctx,
		"compaction",
		compactionImminent(tokens, window),
		!compactionImminent(tokens, window, 2), // a full reserve clear of it
		"pi will auto-compact soon, replacing source material with a lossy summary — /merge or /crop keeps the source (F5.4)",
	);
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
		const b = band(gaugeTokens ?? 0);
		// honest: no fake-precise percent while estimating — band word + est marker
		// trend/attribution belongs on the gauge surface, which has room for it; the
		// footer is the compact always-visible reading. Rendering `▲ +24% (bucket)`
		// in both places just says it twice.
		gaugeText = estimated ? `ctx ${b} · est` : `ctx ${pct.toFixed(1)}% ${b}`;
		nudge(ctx, b, gaugeTokens, window);
	} else if (usage) {
		gaugeText = "ctx est…";
	}

	ctx.ui.setStatus("ctree", `⎇ ${branch} · ${gaugeText}`);
	ctx.ui.setTitle(`${projectName()}${branch !== "trunk" ? ` (${branch})` : ""} (pi)`);

	// G1: the context-health gauge (green→red). Two display modes, one reading —
	// `bar` pins a widget above the editor, `border` paints the same label and
	// progress into the input box's bottom border (F5.6). The trend rides with the
	// gauge either way; the footer above stays compact.
	const gauge: GaugeInput = { tokens: gaugeTokens, window, estimated, barWidth: 28 };
	if (getGaugeMode() === "border" && ctx.ui.setEditorComponent) {
		setBorderGauge(gauge, trend);
		ctx.ui.setWidget?.("ctree-gauge", undefined);
		borderFactory ??= createBorderGaugeFactory();
		// pi resets custom editors on its own (interactive-mode resetExtensionUI) —
		// trust getEditorComponent where the host has it, fall back to the flag.
		const live = ctx.ui.getEditorComponent ? ctx.ui.getEditorComponent() === borderFactory : borderInstalled;
		if (!live) ctx.ui.setEditorComponent(borderFactory);
		borderInstalled = true;
		return;
	}
	// bar mode — also the fallback where the host has no setEditorComponent (RPC/headless)
	if (borderInstalled || ctx.ui.getEditorComponent?.() === borderFactory) {
		ctx.ui.setEditorComponent?.(undefined);
		borderInstalled = false;
	}
	if (ctx.ui.setWidget) {
		if (window && window > 0) {
			const line = `${renderGauge(gauge, defaultTheme)}${trend}`;
			// Factory form: pi wraps string[] content in Text(line, paddingX=1), indenting the bar
			// off the editor border. Our own Text(paddingX=0) bypasses that (interactive-mode.js).
			ctx.ui.setWidget("ctree-gauge", (_tui, _theme) => new Text(line, 0, 0), {
				placement: "aboveEditor",
			});
		} else {
			// window unknown — the footer says `ctx —`; a stale bar would contradict it
			ctx.ui.setWidget("ctree-gauge", undefined);
		}
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
