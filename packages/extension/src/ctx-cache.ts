/**
 * Remembered-ctx bridge: pi 0.79.1's getArgumentCompletions(prefix) receives
 * no context, so completions can't reach the model registry directly. Ambient
 * events and every command stash the last-seen ctx here; completions read it.
 * Slightly stale by design — the registry barely changes within a session.
 */

import type { CtxLike } from "./adapter.ts";

let lastCtx: CtxLike | undefined;

export function rememberCtx(ctx: CtxLike): void {
	lastCtx = ctx;
}

/** test seam */
export function forgetCtx(): void {
	lastCtx = undefined;
}

/** Completions for `/branch <name> <model…>` — second argument only. */
export function modelCompletions(argumentPrefix: string): { value: string; label?: string }[] | null {
	const parts = argumentPrefix.split(/\s+/);
	if (parts.length < 2) return null;
	const prefix = (parts[parts.length - 1] ?? "").toLowerCase();
	const models = lastCtx?.modelRegistry.getAll?.() ?? [];
	if (models.length === 0) return null;
	const hits = models
		.map((m) => ({ ref: `${m.provider}/${m.id}`, id: m.id.toLowerCase() }))
		.filter(({ ref, id }) => ref.toLowerCase().startsWith(prefix) || id.startsWith(prefix))
		.map(({ ref }) => ({ value: ref }));
	return hits.length ? hits : null;
}
