/**
 * pi-context-tree — pi extension entry point. Load with:
 *   pi -e /path/to/pi-context-tree/packages/extension/src/index.ts
 * or symlink this package into ~/.pi/agent/extensions/ for auto-discovery.
 *
 * Commands: /branch /merge /crop /panel /decisions (+ Ctrl+Q).
 * Pinned against pi 0.79.1 — see pi-context-tree-architecture.md.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CTREE_DECISION, type CtreeDecisionDetails } from "@pi-context-tree/core";
import { decisionCardLines } from "@pi-context-tree/tui";
import type { Deps, PiLike } from "./adapter.ts";
import { registerAmbient } from "./ambient.ts";
import { registerBranch } from "./branch.ts";
import { registerCrop } from "./crop-cmd.ts";
import { realDraft } from "./draft.ts";
import { registerMerge } from "./merge.ts";
import { registerPanel } from "./panel-cmd.ts";
import { registerUndo } from "./undo.ts";

export default function piContextTree(api: ExtensionAPI): void {
	// pi's ExtensionAPI is a structural superset of PiLike (verified 0.79.1).
	const pi = api as unknown as PiLike;
	const deps: Deps = { draft: realDraft };

	registerBranch(pi);
	registerMerge(pi, deps);
	registerCrop(pi);
	registerPanel(pi, deps);
	registerUndo(pi);
	registerAmbient(pi);

	// ◆ decision records render as mockup-style cards in the chat (F7 polish)
	pi.registerMessageRenderer?.<CtreeDecisionDetails>(CTREE_DECISION, (message, options) => ({
		render: (width: number) =>
			decisionCardLines(
				{
					branchName: message.details?.branchName,
					dateIso: message.timestamp ? new Date(message.timestamp).toISOString().slice(0, 10) : undefined,
					content: message.content,
					siblings: message.details?.siblings,
					expanded: options.expanded,
				},
				width,
			),
	}));
}
