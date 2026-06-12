/**
 * Ambient UI (F5): footer status gauge + terminal title, refreshed on session
 * events; one-time red-band nudge (F5.3); /compact philosophy warning (F5.4).
 */

import { band } from "@pi-context-tree/core";
import { type CtxLike, type PiLike, projectName } from "./adapter.ts";
import { deriveState } from "./state.ts";

let warnedRed = false;

export function refreshAmbient(pi: PiLike, ctx: CtxLike): void {
	let branch = "trunk";
	try {
		branch = deriveState(ctx).currentFork?.data.name ?? "trunk";
	} catch {
		// session not ready — keep defaults
	}

	const usage = ctx.getContextUsage?.();
	let gaugeText = "ctx —";
	if (usage) {
		if (usage.percent === null || usage.tokens === null) {
			gaugeText = "ctx est…";
		} else {
			const b = band(usage.percent);
			gaugeText = `ctx ${usage.percent.toFixed(1)}% ${b}`;
			if (b === "red" && !warnedRed) {
				warnedRed = true;
				ctx.ui.notify("context crossed 40% of the window — consider /merge, /crop or /branch (F5.3)", "warning");
			}
			if (b !== "red") warnedRed = false;
		}
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
