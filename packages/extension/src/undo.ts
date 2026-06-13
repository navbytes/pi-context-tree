/**
 * /undo (v0.2 friction-killers): one-key revert of the last pi-context-tree
 * mutation. Append-only — nothing is deleted. Each mutation records its
 * pre-mutation anchor (fork.parentEntryId / close.prevLeafId / crop.sourceLeafId);
 * /undo navigates the leaf back there, so a squash re-opens its branch, a crop
 * restores the originals, a /branch drops back to where you branched. The markers
 * stay in history, off-path and recoverable. It reverts the last *active* mutation
 * (the most recent one still on the current path) — repeat /undo to peel further.
 */

import {
	CTREE_CLOSE,
	CTREE_CROP,
	CTREE_FORK,
	type CtreeCropData,
	ctreeCloseData,
	ctreeForkData,
} from "@pi-context-tree/core";
import type { CmdCtxLike, PiLike } from "./adapter.ts";
import { refreshAmbient } from "./ambient.ts";
import { type SessionState, deriveState } from "./state.ts";

interface UndoStep {
	target: string;
	describe: string;
}

/** The most recent ctree mutation whose effect is still on the active path. */
function lastUndo(state: SessionState): UndoStep | undefined {
	const { tree, leafId, entries, forks } = state;
	if (!leafId) return undefined;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (!e || !tree.isAncestorOrSelf(e.id, leafId)) continue;
		const customType = (e as { customType?: string }).customType;

		if (customType === CTREE_CLOSE) {
			const d = ctreeCloseData(e);
			if (!d?.prevLeafId) continue; // pre-v0.2 close marker carries no undo anchor
			const name = forks.find((f) => f.entryId === d.forkEntryId)?.data.name ?? "branch";
			const how = d.status === "discarded" ? "re-open discarded" : "re-open";
			return { target: d.prevLeafId, describe: `${how} '${name}' at its leaf — the close marker stays in history` };
		}
		if (customType === CTREE_CROP) {
			const d = (e as { data?: CtreeCropData }).data;
			if (!d?.sourceLeafId) continue;
			const n = (d.stubbed?.length ?? 0) + (d.dropped?.length ?? 0);
			return {
				target: d.sourceLeafId,
				describe: `restore ${n} cropped item${n === 1 ? "" : "s"} — back to before the crop`,
			};
		}
		if (customType === CTREE_FORK) {
			const d = ctreeForkData(e);
			if (!d?.parentEntryId) continue;
			return { target: d.parentEntryId, describe: `undo /branch '${d.name}' — back to where you branched` };
		}
	}
	return undefined;
}

export async function undoHandler(pi: PiLike, ctx: CmdCtxLike): Promise<void> {
	await ctx.waitForIdle();
	const state = deriveState(ctx);
	const step = lastUndo(state);
	if (!step) {
		ctx.ui.notify("nothing to undo — no pi-context-tree mutation on the current branch", "info");
		return;
	}
	const ok = await ctx.ui.confirm("Undo last change", `↩ ${step.describe}? (nothing is deleted — append-only)`);
	if (!ok) {
		ctx.ui.notify("undo cancelled — nothing changed", "info");
		return;
	}
	const nav = await ctx.navigateTree(step.target, { summarize: false });
	if (nav.cancelled) {
		ctx.ui.notify("undo aborted — navigation cancelled, nothing changed", "warning");
		return;
	}
	refreshAmbient(pi, ctx);
	ctx.ui.notify(`↩ undone — ${step.describe}`, "info");
}

export function registerUndo(pi: PiLike): void {
	pi.registerCommand("undo", {
		description: "pi-context-tree: revert the last mutation (re-open a branch / restore a crop) — append-only",
		handler: (_args, ctx) => undoHandler(pi, ctx),
	});
}
