/**
 * /branch <name> [model] (F1) — label the current point and branch off,
 * optionally onto a cheaper model. The fork entry doubles as a named
 * checkpoint (F1.6); the name is mirrored into pi's native labels (F1.2).
 */

import { CTREE_FORK } from "@pi-context-tree/core";
import { type CmdCtxLike, type PiLike, appendAndGetId, leafIdOf, modelKey, resolveModel } from "./adapter.ts";
import { refreshAmbient } from "./ambient.ts";
import { deriveState } from "./state.ts";

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export async function branchHandler(pi: PiLike, ctx: CmdCtxLike, args: string): Promise<void> {
	const [name, modelRef] = args.trim().split(/\s+/).filter(Boolean);
	if (!name) {
		ctx.ui.notify("usage: /branch <name> [model] — e.g. /branch fix-flaky-test haiku-4.5", "warning");
		return;
	}
	if (!NAME_RE.test(name)) {
		ctx.ui.notify(`branch name "${name}" — use letters, digits, dot, dash, underscore`, "error");
		return;
	}

	await ctx.waitForIdle();
	const state = deriveState(ctx);
	if (state.forks.some((f) => f.status === "open" && f.data.name === name)) {
		ctx.ui.notify(`an open branch named "${name}" already exists — /merge it first or pick another name`, "error");
		return;
	}

	let branchModel = undefined as ReturnType<typeof resolveModel>;
	if (modelRef) {
		branchModel = resolveModel(ctx, modelRef);
		if (!branchModel) {
			ctx.ui.notify(`unknown model "${modelRef}" — try provider/id (e.g. anthropic/claude-haiku-4-5)`, "error");
			return;
		}
	}

	const trunkModel = modelKey(ctx.model);
	const forkId = appendAndGetId(pi, ctx, CTREE_FORK, {
		v: 1,
		name,
		parentEntryId: leafIdOf(ctx),
		trunkModel,
		branchModel: modelKey(branchModel),
		createdAt: Date.now(),
		status: "open",
	});
	if (forkId) pi.setLabel(forkId, name);

	if (branchModel) {
		const ok = await pi.setModel(branchModel);
		if (!ok) ctx.ui.notify(`no API key for ${modelKey(branchModel)} — staying on ${trunkModel}`, "warning");
	}

	refreshAmbient(pi, ctx);
	ctx.ui.notify(
		`⎇ branched: ${name}${branchModel ? ` on ${modelKey(branchModel)}` : ""} — /merge squashes it back to this point`,
		"info",
	);
}

export function registerBranch(pi: PiLike): void {
	pi.registerCommand("branch", {
		description: "pi-context-tree: label this point and branch off (optionally onto a cheaper model)",
		handler: (args, ctx) => branchHandler(pi, ctx, args),
		getArgumentCompletions: (prefix) => {
			const parts = prefix.split(/\s+/);
			if (parts.length < 2) return null;
			return null; // model completion needs ctx (registry) — pi only passes prefix; skip in v1
		},
	});
}
