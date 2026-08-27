/**
 * Token estimation (chars/4, pi parity — compaction.ts:250-290) and gauge
 * banding on absolute tokens (8k/32k/64k, spec F5.2) plus a compaction guard.
 * Estimates are labeled `~` at the UI layer;
 * IMAGE_CHARS mirrors pi's ESTIMATED_IMAGE_CHARS.
 */

import type { AgentMessage, SessionEntry, Usage, UserContent } from "./types.ts";
import { isMessageEntry } from "./types.ts";

export const CHARS_PER_TOKEN = 4;
export const IMAGE_CHARS = 4800;

function contentChars(content: UserContent): number {
	if (typeof content === "string") return content.length;
	let chars = 0;
	for (const block of content) {
		if (block.type === "text") chars += block.text.length;
		else if (block.type === "image") chars += IMAGE_CHARS;
	}
	return chars;
}

function messageChars(m: AgentMessage): number {
	switch (m.role) {
		case "user":
			return contentChars(m.content);
		case "assistant": {
			let chars = 0;
			for (const block of m.content) {
				if (block.type === "text") chars += block.text.length;
				else if (block.type === "thinking") chars += block.thinking.length;
				else if (block.type === "toolCall") chars += JSON.stringify(block.arguments ?? {}).length;
			}
			return chars;
		}
		case "toolResult":
			return contentChars(m.content);
		case "bashExecution":
			return m.excludeFromContext ? 0 : m.command.length + m.output.length;
		case "custom":
			return contentChars(m.content);
		case "branchSummary":
			return m.summary.length;
		case "compactionSummary":
			return m.summary.length;
		default:
			return 0;
	}
}

/** Characters this entry contributes to LLM context (0 for non-context entries). */
export function entryChars(e: SessionEntry): number {
	if (isMessageEntry(e)) return messageChars(e.message);
	switch (e.type) {
		case "custom_message":
			return contentChars((e as { content: UserContent }).content);
		case "branch_summary":
			return (e as { summary: string }).summary.length;
		case "compaction":
			return (e as { summary: string }).summary.length;
		default:
			return 0;
	}
}

export function estimateEntryTokens(e: SessionEntry): number {
	return Math.ceil(entryChars(e) / CHARS_PER_TOKEN);
}

/** Pure chars/4 sum — the *weight of some entries*, not the size of a context. */
export function estimateContextTokens(slice: readonly SessionEntry[]): number {
	let total = 0;
	for (const e of slice) total += estimateEntryTokens(e);
	return total;
}

/** Tokens pi actually charged for a turn (pi parity — compaction.js:86). */
function turnTokens(u: Usage): number {
	return u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite;
}

/** The turn's real usage, or undefined if it carries none pi would trust. */
function anchorUsage(e: SessionEntry | undefined): number | undefined {
	if (!e || !isMessageEntry(e)) return undefined;
	const m = e.message;
	if (m.role !== "assistant" || !m.usage) return undefined;
	if (m.stopReason === "aborted" || m.stopReason === "error") return undefined;
	const tokens = turnTokens(m.usage);
	return tokens > 0 ? tokens : undefined;
}

/**
 * Size of the context at the end of `slice`. Anchors on the last assistant
 * turn's real usage when there is one and chars/4-estimates only what follows,
 * exactly as pi does (compaction.js:131).
 *
 * The anchor is not a refinement — it is the only way to see the system prompt
 * and tool schemas, which are charged every turn and appear in no session
 * entry. Measured across local sessions that floor is ~2k tokens even on a
 * small toolset, so the pure sum reads 0.01x-0.7x of reality; with absolute
 * bands (8k/32k/64k) that is a whole band low.
 */
export function contextTokens(slice: readonly SessionEntry[]): number {
	let anchor = -1;
	let total = 0;
	for (let i = slice.length - 1; i >= 0; i--) {
		const tokens = anchorUsage(slice[i]);
		if (tokens !== undefined) {
			total = tokens;
			anchor = i;
			break;
		}
	}
	for (let i = anchor + 1; i < slice.length; i++) total += estimateEntryTokens(slice[i] as SessionEntry);
	return total;
}

// ---------------------------------------------------------------------------
// Gauge bands (F5.2) and the compaction guard.
//
// Two DIFFERENT failures, deliberately kept as two signals rather than one
// color:
//
//   quality   — attention degrades as context grows. Absolute, and roughly
//               independent of how big the window happens to be.
//   container — the window fills and pi compacts, replacing source material
//               with a lossy summary. Absolute headroom, set by pi.
//
// Share-of-window is a poor proxy for either. It drifts as windows grow (10%
// of 1M is 100k tokens, deep into degradation; 10% of 32k is 3.2k, fine — same
// reading, opposite realities), and it mistimes compaction badly (40% of 200k
// warns 100k tokens early). So percent decides nothing here; it stays a label
// the UI prints.
//
// Every number below is sourced. The band ceilings come from LOCA-bench
// (arXiv 2602.07962, Feb 2026), which measures *agent* success as environment
// context grows — the workload this tool actually serves, unlike needle
// retrieval. Claude-4.5-Opus scores 96% at 8K, 84% at 32K, 34% at 128K and
// 14.7% at 256K; the spread between models opens at 32K and the paper puts the
// sharp drop at 64K-96K. So: 8K is peak, 32K is where it starts costing, 64K is
// the last point before the cliff. The reserve is pi's documented default
// (compaction.js:76 / settings-manager.js:560).
//
// Superseded here: NoLiMa (ICML 2025) put effective lengths at <=8k and the
// half-baseline point at 32k. Those are retrieval-without-literal-match numbers
// from early 2025 and are markedly stricter than what 2026 agentic models
// actually do; spec Part 0 still cites it for the direction, not the figures.
//
// Which failure counts as "act now" is still this tool's opinion (spec Part 0);
// the thresholds themselves are not invented.
// ---------------------------------------------------------------------------

export type Band = "low" | "healthy" | "filling" | "red";

/** Absolute context tokens at which each band begins (LOCA-bench 2026). */
export const BAND_TOKENS = { healthy: 8_000, filling: 32_000, red: 64_000 } as const;

/** Ascending severity. */
const BAND_STEPS = [
	{ band: "healthy", tokens: BAND_TOKENS.healthy },
	{ band: "filling", tokens: BAND_TOKENS.filling },
	{ band: "red", tokens: BAND_TOKENS.red },
] as const;

/** Context-quality band for an absolute token count. */
export function band(tokens: number): Band {
	let out: Band = "low";
	for (const step of BAND_STEPS) {
		if (tokens >= step.tokens) out = step.band;
	}
	return out;
}

/**
 * Where each band begins for `window`, as a percent of it — gauge ticks read
 * this so the marks land where the color actually changes. Naturally ordered
 * (8k < 32k < 64k); entries past the end of the window exceed 100 and the caller
 * clamps them to the bar.
 */
export function bandStartPercents(window: number): Record<"healthy" | "filling" | "red", number> {
	const out = {} as Record<"healthy" | "filling" | "red", number>;
	for (const step of BAND_STEPS) out[step.band] = window > 0 ? (step.tokens / window) * 100 : 0;
	return out;
}

/**
 * Tokens pi keeps in hand before it auto-compacts — its default
 * `compaction.reserveTokens`. pi does not expose the live value to extensions
 * (ContextUsage is only tokens/contextWindow/percent), so a user who overrides
 * it in pi's settings will see this guard fire at a slightly different point.
 */
export const COMPACTION_RESERVE = 16_384;

/**
 * True once pi's auto-compaction is close enough to be worth acting on.
 * `slack` widens the guard in whole reserves — callers use `slack: 2` to ask
 * "are we clear of it", so a one-time warning re-arms only after real headroom
 * comes back rather than on every wobble across the line.
 */
export function compactionImminent(tokens: number, window: number | undefined, slack = 1): boolean {
	return !!window && window > 0 && tokens > window - COMPACTION_RESERVE * slack;
}

/** 950 → "950" · 19400 → "19.4k" · 200000 → "200k" */
export function fmtTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
