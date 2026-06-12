/**
 * Panel view-model (F4) — pure state + reducers, no terminal code. The TUI
 * component and the standalone pitree host render `rows()` and feed
 * `handleKey()`; mutations leave as PanelActions for the host to execute
 * (and re-validate) via pi. Read-only mode (pitree, F4.6) blocks them all.
 */

import { aggregateConsumers } from "../consumers.ts";
import { type CropCandidate, type CropPlan, autoSelect, cropCandidates, planCrop } from "../crop.ts";
import { type ForkInfo, type ForkPresentation, decisionsOnPath, extractForks, nearestOpenFork } from "../ctree.ts";
import { type Band, band, estimateContextTokens, estimateEntryTokens } from "../estimate.ts";
import { serializeEntry, textOfContent } from "../serialize.ts";
import { SessionTree, contextSlice } from "../tree.ts";
import type { CtreeCropData, CtreeDecisionDetails, SessionEntry, UserContent } from "../types.ts";
import {
	CTREE_CLOSE,
	CTREE_CROP,
	CTREE_CROP_TAIL,
	CTREE_DECISION,
	ctreeCloseData,
	ctreeForkData,
	isCustomMessageEntry,
	isMessageEntry,
} from "../types.ts";

export type PanelView = "tree" | "crop" | "consumers" | "decisions" | "inspect";

export interface PanelInput {
	entries: SessionEntry[];
	/** defaults to the last entry in file order (pi load semantics) */
	leafId?: string | null;
	project: string;
	sessionName?: string;
	model?: string;
	contextWindow?: number;
	/** real token count from pi's getContextUsage(); null = unknown (post-compaction) */
	usageTokens?: number | null;
	readOnly?: boolean;
	dryRun?: boolean;
	initialView?: PanelView;
	premark?: string[];
}

export type PanelAction =
	| { type: "close" }
	| { type: "jump"; entryId: string }
	| { type: "branch"; entryId: string }
	| { type: "merge" }
	| { type: "crop-apply"; plan: CropPlan; dryRun: boolean };

export interface VmEffect {
	action?: PanelAction;
	notify?: string;
}

export interface PanelRow {
	kind: "entry" | "fork" | "crop" | "consumer" | "decision" | "inspect-line";
	id?: string;
	depth: number;
	glyph: string;
	text: string;
	tokens?: number;
	warn?: boolean;
	current?: boolean;
	onPath?: boolean;
	dim?: boolean;
	// fork rows
	forkName?: string;
	presentation?: ForkPresentation;
	foldable?: boolean;
	folded?: boolean;
	// crop rows
	marked?: boolean;
	protected?: boolean;
	armed?: boolean;
	age?: number;
}

export interface PanelHeader {
	project: string;
	sessionName?: string;
	branchName: string;
	model?: string;
	view: PanelView;
	tokens: number;
	window?: number;
	pct?: number;
	band?: Band;
	estimated: boolean;
	readOnly: boolean;
}

const FIRST_LINE_MAX = 88;

function firstLine(text: string): string {
	const line = text.split("\n", 1)[0] ?? "";
	return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX)}…` : line;
}

export class PanelVm {
	readonly input: PanelInput;
	readonly tree: SessionTree;
	readonly leafId: string;
	readonly forks: ForkInfo[];
	private readonly forkById: Map<string, ForkInfo>;
	private readonly slice: SessionEntry[];
	private candidates: CropCandidate[] | null = null;

	view: PanelView;
	sel = 0;
	private readonly folds = new Map<string, boolean>();
	private readonly marks = new Set<string>();
	private armedId: string | null = null;
	private inspectId: string | null = null;

	constructor(input: PanelInput) {
		this.input = input;
		this.tree = SessionTree.fromEntries(input.entries);
		this.leafId = input.leafId ?? this.tree.fileLeafId() ?? "";
		this.forks = this.leafId ? extractForks(this.tree, this.leafId) : [];
		this.forkById = new Map(this.forks.map((f) => [f.entryId, f]));
		this.slice = this.leafId ? contextSlice(this.tree, this.leafId) : [];
		this.view = input.initialView ?? "tree";
		for (const id of input.premark ?? []) this.marks.add(id);
		for (const f of this.forks) if (f.status !== "open") this.folds.set(f.entryId, true);
	}

	header(): PanelHeader {
		const open = this.leafId ? nearestOpenFork(this.tree, this.leafId, this.forks) : undefined;
		const estimated = typeof this.input.usageTokens !== "number";
		const tokens =
			typeof this.input.usageTokens === "number" ? this.input.usageTokens : estimateContextTokens(this.slice);
		const window = this.input.contextWindow;
		const pct = window && window > 0 ? (tokens / window) * 100 : undefined;
		return {
			project: this.input.project,
			sessionName: this.input.sessionName,
			branchName: open?.data.name ?? "trunk",
			model: this.input.model,
			view: this.view,
			tokens,
			window,
			pct,
			band: pct === undefined ? undefined : band(pct),
			estimated,
			readOnly: this.input.readOnly ?? false,
		};
	}

	// -- rows -----------------------------------------------------------------

	rows(): PanelRow[] {
		switch (this.view) {
			case "tree":
				return this.treeRows();
			case "crop":
				return this.cropRows();
			case "consumers":
				return this.consumerRows();
			case "decisions":
				return this.decisionRows();
			case "inspect":
				return this.inspectRows();
		}
	}

	private effectiveFold(forkId: string): boolean {
		const f = this.forkById.get(forkId);
		const def = f ? f.status !== "open" : false;
		return this.folds.get(forkId) ?? def;
	}

	private treeRows(): PanelRow[] {
		const rows: PanelRow[] = [];
		const visit = (e: SessionEntry, depth: number): void => {
			const fork = this.forkById.get(e.id);
			if (fork) {
				const folded = this.effectiveFold(e.id);
				rows.push({
					kind: "fork",
					id: e.id,
					depth,
					glyph: "⎇",
					text: `${fork.data.name} · ${fork.status}${fork.data.branchModel ? ` · ${fork.data.branchModel}` : ""}`,
					forkName: fork.data.name,
					presentation: fork.presentation,
					foldable: true,
					folded,
					onPath: fork.onCurrentPath,
				});
				for (const child of this.tree.children(e.id)) {
					if (folded && !this.tree.isAncestorOrSelf(child.id, this.leafId)) continue;
					visit(child, depth + 1);
				}
				return;
			}
			rows.push(this.entryRow(e, depth));
			for (const child of this.tree.children(e.id)) visit(child, depth);
		};
		for (const root of this.tree.roots()) visit(root, 0);
		return rows;
	}

	private entryRow(e: SessionEntry, depth: number): PanelRow {
		const tokens = estimateEntryTokens(e);
		const row: PanelRow = {
			kind: "entry",
			id: e.id,
			depth,
			glyph: "·",
			text: e.type,
			tokens: tokens > 0 ? tokens : undefined,
			warn: tokens >= 10_000,
			current: e.id === this.leafId,
			onPath: this.tree.isAncestorOrSelf(e.id, this.leafId),
		};
		if (isMessageEntry(e)) {
			const m = e.message;
			if (m.role === "user") {
				row.glyph = "●";
				row.text = `user: ${firstLine(textOfContent(m.content))}`;
			} else if (m.role === "assistant") {
				row.glyph = "○";
				const texts = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
				const calls = m.content.filter((b) => b.type === "toolCall").map((b) => (b as { name: string }).name);
				row.text = texts.length ? `assistant: ${firstLine(texts.join(" "))}` : `assistant → ${calls.join(", ") || "…"}`;
			} else if (m.role === "toolResult") {
				row.glyph = "⚙";
				row.text = `[${m.toolName}]${m.isError ? " ✗" : ""}`;
			} else if (m.role === "bashExecution") {
				row.glyph = "⚙";
				row.text = `[bash $ ${firstLine(m.command)}]`;
			} else {
				row.glyph = "▪";
				row.text = `[${m.role}]`;
			}
			return row;
		}
		switch (e.type) {
			case "custom_message": {
				const t = (e as { customType: string }).customType;
				if (t === CTREE_DECISION) {
					const d = (e as { details?: CtreeDecisionDetails }).details;
					row.glyph = "◆";
					row.text = `Decision: ${d?.branchName ?? firstLine(textOfContent((e as { content: UserContent }).content))}`;
				} else if (t === CTREE_CROP_TAIL) {
					row.glyph = "✂";
					row.text = "[crop tail — rebuilt context]";
				} else {
					row.glyph = "▪";
					row.text = `[${t}]`;
				}
				return row;
			}
			case "custom": {
				const ct = (e as { customType: string }).customType;
				const close = ctreeCloseData(e);
				if (close) {
					const fork = this.forkById.get(close.forkEntryId);
					row.text = `closed ⎇ ${fork?.data.name ?? close.forkEntryId} · ${close.status}${close.note ? ` · "${close.note}"` : ""}`;
				} else if (ct === CTREE_CROP) {
					const d = (e as { data?: CtreeCropData }).data;
					row.glyph = "✂";
					row.text = `crop marker · ${d?.stubbed.length ?? 0} stubbed`;
				} else {
					row.text = `[${ct}]`;
				}
				row.dim = true;
				return row;
			}
			case "branch_summary":
				row.glyph = "≣";
				row.text = `branch summary: ${firstLine((e as { summary: string }).summary)}`;
				return row;
			case "compaction":
				row.glyph = "≣";
				row.text = `compaction: ${firstLine((e as { summary: string }).summary)}`;
				return row;
			case "model_change":
				row.text = `model → ${(e as { modelId: string }).modelId}`;
				row.dim = true;
				return row;
			case "label":
				row.text = `label: ${(e as { label?: string }).label ?? "(cleared)"}`;
				row.dim = true;
				return row;
			case "session_info":
				row.text = `session: ${(e as { name?: string }).name ?? ""}`;
				row.dim = true;
				return row;
			default:
				row.dim = true;
				return row;
		}
	}

	private getCandidates(): CropCandidate[] {
		if (!this.candidates) this.candidates = this.leafId ? cropCandidates(this.tree, this.leafId) : [];
		return this.candidates;
	}

	private cropRows(): PanelRow[] {
		return this.getCandidates().map((c) => ({
			kind: "crop" as const,
			id: c.entryId,
			depth: 0,
			glyph: "⚙",
			text: `[${c.tool}${c.arg ? ` ${c.arg}` : ""}]`,
			tokens: c.estTokens,
			warn: c.estTokens >= 10_000,
			marked: this.marks.has(c.entryId),
			protected: c.protected,
			armed: this.armedId === c.entryId,
			age: c.ageTurns,
		}));
	}

	private consumerRows(): PanelRow[] {
		return aggregateConsumers(this.slice).map((r) => ({
			kind: "consumer" as const,
			depth: 0,
			glyph: " ",
			text: `${r.key} · ${r.entries} ${r.entries === 1 ? "entry" : "entries"} · ${(r.share * 100).toFixed(0)}%`,
			tokens: r.tokens,
		}));
	}

	/** mockup card: ◆ name / meta (date · model · branch · confirmed) / outcome / ✗ epitaphs */
	private decisionRows(): PanelRow[] {
		const decs = this.leafId ? decisionsOnPath(this.tree, this.leafId) : [];
		if (decs.length === 0) {
			return [
				{
					kind: "decision",
					depth: 0,
					glyph: " ",
					text: "(no decision records on this trunk yet — /merge → squash creates them)",
					dim: true,
				},
			];
		}
		const rows: PanelRow[] = [];
		for (const d of [...decs].reverse()) {
			const det = d.details as CtreeDecisionDetails | undefined;
			const fork = det ? this.forkById.get(det.forkEntryId) : undefined;
			const model = fork?.data.branchModel ?? fork?.data.trunkModel ?? "—";
			const date = (d.timestamp ?? "").slice(0, 10);
			const text = textOfContent(d.content);
			const outcomeLine = text.split("\n").find((l) => l.startsWith("**Outcome:**"));
			const outcome = outcomeLine ? outcomeLine.replace("**Outcome:**", "").trim() : firstLine(text);
			rows.push({
				kind: "decision",
				id: d.id,
				depth: 0,
				glyph: "◆",
				text: det?.branchName ?? "decision",
				tokens: estimateEntryTokens(d),
			});
			rows.push({
				kind: "decision",
				id: d.id,
				depth: 1,
				glyph: " ",
				dim: true,
				text: `${date} · drafted by ${model} · branch ${det?.forkEntryId ?? "—"} · human-confirmed ✓`,
			});
			rows.push({ kind: "decision", id: d.id, depth: 1, glyph: " ", text: outcome });
			for (const s of det?.siblings ?? []) {
				rows.push({ kind: "decision", id: d.id, depth: 1, glyph: "✗", text: `${s.name} — ${s.reason}` });
			}
		}
		rows.push({
			kind: "decision",
			depth: 0,
			glyph: " ",
			dim: true,
			text: "(epitaphs keep the trunk model from re-proposing rejected approaches — G3)",
		});
		return rows;
	}

	private inspectRows(): PanelRow[] {
		const e = this.inspectId ? this.tree.get(this.inspectId) : undefined;
		if (!e) return [{ kind: "inspect-line", depth: 0, glyph: " ", text: "(nothing selected)", dim: true }];
		const meta = `id ${e.id} · type ${e.type} · ~${estimateEntryTokens(e)} tokens · parent ${e.parentId ?? "—"}`;
		const body = serializeEntry(e) ?? "(no content)";
		const lines = body.split("\n").slice(0, 400);
		return [
			{ kind: "inspect-line", depth: 0, glyph: " ", text: meta, dim: true },
			...lines.map((l) => ({ kind: "inspect-line" as const, depth: 0, glyph: " ", text: l })),
		];
	}

	// -- input ----------------------------------------------------------------

	private selectedRow(): PanelRow | undefined {
		return this.rows()[this.sel];
	}

	private setView(v: PanelView): void {
		this.view = v;
		this.sel = 0;
		this.armedId = null;
	}

	private deny(): VmEffect {
		return { notify: "read-only (standalone pitree) — open the panel inside pi to act" };
	}

	handleKey(key: string): VmEffect {
		const rows = this.rows();
		const max = Math.max(0, rows.length - 1);
		const readOnly = this.input.readOnly ?? false;

		switch (key) {
			case "j":
			case "down":
				this.sel = Math.min(max, this.sel + 1);
				return {};
			case "k":
			case "up":
				this.sel = Math.max(0, this.sel - 1);
				return {};
			case "g":
				this.sel = 0;
				return {};
			case "G":
				this.sel = max;
				return {};
			case "q":
				return { action: { type: "close" } };
			case "esc":
				if (this.view === "tree") return { action: { type: "close" } };
				this.setView("tree");
				return {};
		}

		if (this.view === "tree") {
			const row = this.selectedRow();
			switch (key) {
				case "enter":
				case "right":
				case "left": {
					if (row?.kind === "fork" && row.id) {
						if (key === "enter" || (key === "right") === Boolean(row.folded)) {
							this.folds.set(row.id, !this.effectiveFold(row.id));
						}
						return {};
					}
					if (key !== "enter") return {};
					if (!row?.id) return {};
					if (readOnly) return this.deny();
					return { action: { type: "jump", entryId: row.id } };
				}
				case "b":
					if (!row?.id) return {};
					if (readOnly) return this.deny();
					return { action: { type: "branch", entryId: row.id } };
				case "m":
					if (readOnly) return this.deny();
					return { action: { type: "merge" } };
				case "c":
					this.setView("crop");
					return {};
				case "i":
					if (row?.id) {
						this.inspectId = row.id;
						this.setView("inspect");
					}
					return {};
				case "D":
					this.setView("decisions");
					return {};
				case "u":
					this.setView("consumers");
					return {};
			}
			return {};
		}

		if (this.view === "crop") {
			const cands = this.getCandidates();
			const cand = cands[this.sel];
			switch (key) {
				case "space": {
					if (readOnly) return this.deny();
					if (!cand) return {};
					if (this.marks.has(cand.entryId)) {
						this.marks.delete(cand.entryId);
						this.armedId = null;
						return {};
					}
					if (cand.protected && this.armedId !== cand.entryId) {
						this.armedId = cand.entryId;
						return { notify: `${cand.tool} is the latest result of its tool — space again to crop it anyway (F3.3)` };
					}
					this.marks.add(cand.entryId);
					this.armedId = null;
					return {};
				}
				case "a": {
					if (readOnly) return this.deny();
					const ids = autoSelect(cands, {});
					for (const id of ids) this.marks.add(id);
					return { notify: `--auto marked ${ids.length} (protected skipped) — review, then ⏎ to apply` };
				}
				case "enter": {
					if (readOnly) return this.deny();
					if (this.marks.size === 0) return { notify: "nothing marked — space to mark entries" };
					const plan = planCrop(this.tree, this.leafId, [...this.marks]);
					return { action: { type: "crop-apply", plan, dryRun: this.input.dryRun ?? false } };
				}
				case "c":
					this.setView("tree");
					return {};
			}
			return {};
		}

		if (this.view === "decisions") {
			if (key === "enter") {
				const row = this.selectedRow();
				if (!row?.id) return {};
				if (readOnly) return this.deny();
				return { action: { type: "jump", entryId: row.id } };
			}
			return {};
		}

		if (this.view === "consumers") {
			if (key === "c") {
				this.setView("crop");
				return {};
			}
			return {};
		}

		if (this.view === "inspect") {
			if (key === "c") {
				if (readOnly) return this.deny();
				const id = this.inspectId;
				if (id && this.getCandidates().some((c) => c.entryId === id)) {
					this.marks.add(id);
					this.setView("crop");
					return { notify: "pre-marked from inspector — review, then ⏎ to apply" };
				}
				return { notify: "only tool/MCP results are croppable (F3.3)" };
			}
			return {};
		}

		return {};
	}

	footerHelp(): string {
		switch (this.view) {
			case "tree":
				return "↑↓/jk move · ⏎ jump/fold · b branch · m merge · c crop · i inspect · D decisions · u consumers · q close";
			case "crop":
				return "space mark · a auto · ⏎ apply → new branch point · esc back · q close";
			case "consumers":
				return "c crop the big ones · esc back · q close";
			case "decisions":
				return "⏎ jump to record · esc back · q close";
			case "inspect":
				return "c crop this entry · esc back · q close";
		}
	}
}
