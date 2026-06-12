/**
 * `pitree ui` — standalone READ-ONLY panel host (F4.6, v1): a session picker
 * over the forest, opening each session in the ContextPanel with readOnly so
 * every mutating action is denied. Mutation outside pi is out of scope (v2).
 */

import { ProcessTerminal, TUI, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	type Forest,
	type PanelInput,
	type SessionSummary,
	fmtTokens,
	parseSessionFile,
	scanForest,
} from "@pi-context-tree/core";
import { ContextPanel, defaultTheme } from "@pi-context-tree/tui";
import chalk from "chalk";

export async function loadPanelInputFromFile(path: string): Promise<PanelInput> {
	const parsed = await parseSessionFile(path);
	const cwd = parsed.header?.cwd ?? path;
	return {
		entries: parsed.entries,
		project: cwd.split("/").pop() ?? cwd,
		readOnly: true,
	};
}

interface PickerItem {
	summary: SessionSummary;
	label: string;
}

function pickerItems(forest: Forest): PickerItem[] {
	const items: PickerItem[] = [];
	for (const p of forest.projects) {
		for (const s of p.sessions) {
			const proj = s.header?.cwd?.split("/").pop() ?? p.dir;
			const file = s.path.split("/").pop() ?? s.path;
			const dangling = s.dangling.length > 0 ? ` ⚠ ${s.dangling.join(",")}` : "";
			items.push({
				summary: s,
				label: `${proj} · ${s.name ?? file} · ${s.entryCount} entries · ~${fmtTokens(s.leafTokens)}${dangling}`,
			});
		}
	}
	items.sort((a, b) => (b.summary.lastTimestamp ?? "").localeCompare(a.summary.lastTimestamp ?? ""));
	return items;
}

class SessionPicker {
	focused = false;
	sel = 0;
	constructor(
		private readonly items: PickerItem[],
		private readonly onPick: (item: PickerItem) => void,
		private readonly onQuit: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "down") || data === "j") this.sel = Math.min(this.items.length - 1, this.sel + 1);
		else if (matchesKey(data, "up") || data === "k") this.sel = Math.max(0, this.sel - 1);
		else if (matchesKey(data, "enter")) {
			const item = this.items[this.sel];
			if (item) this.onPick(item);
		} else if (matchesKey(data, "escape") || data === "q") this.onQuit();
	}

	render(width: number): string[] {
		const lines = [
			` ${chalk.magenta.bold("pitree")} ${chalk.gray("· forest (read-only) · ⏎ open tree · q quit")}`,
			chalk.gray("─".repeat(width)),
		];
		this.items.forEach((item, i) => {
			const line = ` ${item.label}`;
			lines.push(i === this.sel ? chalk.inverse(line) : line);
		});
		if (this.items.length === 0) lines.push(chalk.gray(" (no sessions found)"));
		return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width, "…") : l));
	}
}

export async function runUi(root: string): Promise<void> {
	const forest = await scanForest(root);
	const items = pickerItems(forest);

	const tui = new TUI(new ProcessTerminal());
	let current: { dispose?: () => void } | null = null;

	const showPicker = (): void => {
		const picker = new SessionPicker(
			items,
			(item) => {
				void openSession(item);
			},
			() => {
				tui.stop();
				process.exit(0);
			},
		);
		swap(picker);
	};

	const openSession = async (item: PickerItem): Promise<void> => {
		const input = await loadPanelInputFromFile(item.summary.path);
		const panel = new ContextPanel({
			input,
			theme: defaultTheme,
			onAction: (action) => {
				if (action.type === "close") showPicker();
				// every other action is already denied by the read-only VM
			},
		});
		swap(panel);
	};

	const swap = (component: any): void => {
		if (current) tui.removeChild?.(current as never);
		current = component;
		tui.addChild(component);
		tui.setFocus?.(component);
		tui.requestRender?.();
	};

	showPicker();
	tui.start();
}
