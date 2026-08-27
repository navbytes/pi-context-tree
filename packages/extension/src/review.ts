/**
 * reviewRecord — the F2.2 confirm gate, reshaped per #33 flow 1: a non-modal
 * overlay preview (enter accept · e edit · r re-draft · esc cancel) hosted via
 * ctx.ui.custom, with the editor one keypress away. Headless/RPC mode (no
 * ui.custom) keeps the original editor gate verbatim, so golden flows are
 * unchanged. Either way nothing lands without explicit confirmation.
 */

import { type ReviewAction, SummaryReview } from "@pi-context-tree/tui";
import type { CtxLike } from "./adapter.ts";

export interface ReviewMeta {
	/** entries the merge will close — shown as the blast radius */
	entryCount: number;
	/** estimated tokens of the branch being summarized */
	estTokens: number;
	/** model that drafted the record */
	model?: string;
	/** re-run the draft; absent for --no-llm templates (r key hidden) */
	regenerate?: () => Promise<string>;
}

// header, two dividers, overflow hint, footer + a blank of margin
const REVIEW_CHROME_ROWS = 7;
// each editor/regenerate round remounts the overlay; a runaway host loop stops here
const MAX_REVIEW_ROUNDS = 25;

export async function reviewRecord(
	ctx: CtxLike,
	branchName: string,
	initial: string,
	meta: ReviewMeta,
): Promise<string | undefined> {
	const editorTitle = `Decision record — review/edit; closing without saving aborts the merge ('${branchName}')`;
	if (!ctx.ui.custom) return ctx.ui.editor(editorTitle, initial);

	let draft = initial;
	for (let round = 0; round < MAX_REVIEW_ROUNDS; round++) {
		let action: ReviewAction | undefined;
		try {
			action = await ctx.ui.custom<ReviewAction>(
				(tui, _theme, _keybindings, done) => {
					const rows = tui?.terminal?.rows;
					const maxBody = Math.max(6, (rows ?? 34) - REVIEW_CHROME_ROWS);
					return new SummaryReview({
						branchName,
						draft,
						entryCount: meta.entryCount,
						estTokens: meta.estTokens,
						model: meta.model,
						regenerable: Boolean(meta.regenerate),
						maxBody,
						onAction: (a) => done(a),
					});
				},
				{ overlay: true, overlayOptions: { anchor: "center", width: "100%" } },
			);
		} catch {
			// overlay host unusable (e.g. RPC exposes ui.custom but can't mount) — legacy gate
			return ctx.ui.editor(editorTitle, draft);
		}
		// ui.custom exists but resolved without an action (RPC/headless hosts do this):
		// fall back to the editor gate rather than treating it as a cancel
		if (action === undefined) return ctx.ui.editor(editorTitle, draft);

		switch (action.type) {
			case "accept":
				return draft;
			case "edit": {
				const edited = await ctx.ui.editor(
					`Decision record — edit; save confirms, closing without saving returns to review ('${branchName}')`,
					draft,
				);
				// save = confirm (unchanged UX); closing without saving returns to the
				// preview with the draft intact instead of aborting the whole merge
				if (edited !== undefined && edited.trim() !== "") return edited;
				break;
			}
			case "regenerate": {
				if (!meta.regenerate) break;
				ctx.ui.notify(`re-drafting decision record with ${meta.model ?? "current model"}…`, "info");
				try {
					draft = await meta.regenerate();
				} catch (err) {
					ctx.ui.notify(`re-draft failed (${(err as Error).message}) — keeping the current draft`, "warning");
				}
				break;
			}
			case "cancel":
				return undefined;
		}
	}
	return undefined;
}
