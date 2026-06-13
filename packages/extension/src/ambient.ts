/**
 * Ambient UI (F5): footer status gauge + terminal title, refreshed on session
 * events; one-time red-band nudge (F5.3); /compact philosophy warning (F5.4).
 * pi's getContextUsage() reports 0 until a fresh assistant turn lands — for a
 * non-empty session the status falls back to the chars/4 estimate (marked ~),
 * mirroring the panel gauge (§11.5).
 */

import { band, contextSlice, estimateContextTokens } from "@pi-context-tree/core";
import { type CtxLike, type PiLike, projectName } from "./adapter.ts";
import { rememberCtx } from "./ctx-cache.ts";
import { type SessionState, deriveState } from "./state.ts";

let warnedRed = false;

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
	let gaugeText = "ctx —";
	if (usage && usage.percent !== null && usage.tokens !== null && usage.tokens > 0) {
		const b = band(usage.percent);
		gaugeText = `ctx ${usage.percent.toFixed(1)}% ${b}`;
		nudgeOnRed(ctx, b);
	} else if (state?.leafId && window && window > 0) {
		const est = estimateContextTokens(contextSlice(state.tree, state.leafId));
		const pct = (est / window) * 100;
		const b = band(pct);
		gaugeText = `ctx ~${pct.toFixed(1)}% ${b}`;
		nudgeOnRed(ctx, b);
	} else if (usage) {
		gaugeText = "ctx est…";
	}

	ctx.ui.setStatus("ctree", `⎇ ${branch} · ${gaugeText}`);
	ctx.ui.setTitle(`${projectName()}${branch !== "trunk" ? ` (${branch})` : ""} (pi)`);
}

export function registerAmbient(pi: PiLike): void {
	pi.on?.("session_start", (_e, ctx) => refreshAmbient(pi, ctx));
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
