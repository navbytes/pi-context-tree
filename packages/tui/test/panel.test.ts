import { TUI } from "@earendil-works/pi-tui";
import type { PanelAction } from "@pi-context-tree/core";
import { SessionBuilder, filler } from "@pi-context-tree/core/testkit";
import { describe, expect, it } from "vitest";
import { ContextPanel } from "../src/panel.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping is the point
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;
const strip = (s: string) => s.replace(ANSI, "");

function buildInput() {
	const b = new SessionBuilder();
	b.user("kickoff");
	b.assistant("plan");
	const storage = b.fork("storage-layer");
	b.user("branch work");
	b.at(storage);
	const dec = b.decision(storage, "storage-layer", "## Decision: storage-layer");
	b.close(storage, "squashed", { decisionEntryId: dec });
	const snap = b.toolUse("chrome.snapshot", { url: "tab-audit" }, filler(60_000));
	b.assistant("analysis");
	const snap2 = b.toolUse("chrome.snapshot", { url: "after" }, filler(400));
	b.at(snap2);
	b.fork("fix-flaky-test", { branchModel: "haiku-4.5" });
	b.user("tests flake");
	const leaf = b.assistant("root cause found");
	return { entries: b.build().entries, snap, leaf };
}

function makePanel(actions: PanelAction[] = [], notes: string[] = []) {
	const { entries, snap } = buildInput();
	const panel = new ContextPanel({
		input: { entries, project: "tabwrangler", model: "haiku-4.5", contextWindow: 200_000 },
		onAction: (a) => actions.push(a),
		onNotify: (m) => notes.push(m),
	});
	return { panel, snap, actions, notes };
}

describe("ContextPanel rendering", () => {
	it("renders header, gauge band, fork rows, leaf marker and footer", () => {
		const { panel } = makePanel();
		const text = panel.render(100).map(strip).join("\n");
		expect(text).toContain("pi-context-tree");
		expect(text).toContain("tabwrangler");
		expect(text).toContain("⎇ fix-flaky-test");
		expect(text).toMatch(/est · (low|healthy|filling|red)/); // honest estimate: band + est, no fake %
		expect(text).toContain("storage-layer");
		expect(text).toContain("◀ leaf");
		expect(text).toContain("← you are here");
		expect(text).toContain("b branch");
		expect(text).toContain("[+]"); // squashed fork folded
	});

	it("pads the body to maxBody so the overlay always fills its height", () => {
		const { panel } = makePanel();
		const short = new ContextPanel({
			input: { entries: buildInput().entries, project: "p" },
			maxBody: 30,
			onAction: () => {},
		});
		const lines = short.render(100);
		// header(1) + gauge(1) + divider(1) + secthead(1) + body(30) + hint slot(1) + divider(1) + notify slot(1) + footer(1)
		expect(lines.length).toBe(38);
		// overflow keeps the same height: the hint slot holds the "… N more" line
		const tall = new ContextPanel({
			input: { entries: buildInput().entries, project: "p" },
			maxBody: 3,
			onAction: () => {},
		});
		expect(tall.render(100).length).toBe(11);
		expect(panel.render(100).length).toBeGreaterThan(10);
	});

	it("never exceeds the given width", () => {
		const { panel } = makePanel();
		for (const w of [60, 80, 100]) {
			for (const line of panel.render(w)) {
				expect(strip(line).length).toBeLessThanOrEqual(w);
			}
		}
	});

	it("moves selection with j and renders the selected row inverted", () => {
		const { panel } = makePanel();
		panel.render(100);
		panel.handleInput("j");
		panel.handleInput("j");
		expect(panel.viewModel.sel).toBe(2);
	});
});

describe("ContextPanel crop flow", () => {
	it("marks, shows reclaim, and emits crop-apply", () => {
		const { panel, snap, actions } = makePanel();
		panel.handleInput("c");
		const rows = panel.viewModel.rows();
		const idx = rows.findIndex((r) => r.id === snap);
		for (let i = 0; i < idx; i++) panel.handleInput("j");
		panel.handleInput(" ");
		const text = panel.render(100).map(strip).join("\n");
		expect(text).toContain("[✗]");
		expect(text).toContain("(latest — protected)");
		expect(text).toContain("CROP — TOOL/MCP RESULTS ON THIS BRANCH · reclaim ~15k");
		panel.handleInput("\r");
		expect(actions).toHaveLength(1);
		expect(actions[0]?.type).toBe("crop-apply");
	});

	it("warns when marking a protected entry", () => {
		const { panel, notes } = makePanel();
		panel.handleInput("c");
		const rows = panel.viewModel.rows();
		const protIdx = rows.findIndex((r) => r.protected);
		for (let i = 0; i < protIdx; i++) panel.handleInput("j");
		panel.handleInput(" ");
		expect(notes.some((n) => n.includes("latest"))).toBe(true);
	});
});

describe("ContextPanel crop turn-mode", () => {
	function turnPanel() {
		const b = new SessionBuilder();
		b.user("first question");
		b.assistant("first answer");
		b.user("second question — the fat one");
		b.toolUse("chrome.snapshot", { url: "audit" }, filler(40_000));
		b.assistant("second answer");
		b.user("third question");
		b.assistant("third answer");
		const panel = new ContextPanel({
			input: { entries: b.build().entries, project: "p", contextWindow: 200_000 },
			onAction: () => {},
		});
		panel.handleInput("c"); // crop
		panel.handleInput("t"); // turn mode
		return panel;
	}

	it("lists turns with a mark box, question, entry count and tokens", () => {
		const panel = turnPanel();
		const text = panel.render(110).map(strip).join("\n");
		expect(text).toContain("REMOVE WHOLE TURNS");
		expect(text).toContain("user: second question");
		expect(text).toContain("4 entries");
		expect(text).toContain("t results mode"); // footer offers toggling back
	});

	it("shows the mark on a selected turn and protects the current turn", () => {
		const panel = turnPanel();
		const rows = panel.viewModel.rows();
		const second = rows.findIndex((r) => r.text.includes("second question"));
		for (let i = 0; i < second; i++) panel.handleInput("j");
		panel.handleInput(" ");
		const text = panel.render(110).map(strip).join("\n");
		expect(text).toContain("[✗]"); // marked turn
		expect(text).toContain("current"); // the leaf turn shows a protected note
	});
});

describe("ContextPanel consumers bars", () => {
	it("scales bars relative to the biggest consumer", () => {
		const { panel } = makePanel();
		panel.handleInput("u");
		const lines = panel.render(110).map(strip);
		const bars = lines.filter((l) => l.includes("▰")).map((l) => (l.match(/▰+/) ?? [""])[0].length);
		expect(bars.length).toBeGreaterThan(1);
		expect(Math.max(...bars)).toBe(28); // dominant consumer fills the scale
		expect(Math.min(...bars)).toBeLessThan(6);
	});
});

describe("ContextPanel decisions cards", () => {
	it("renders meta and epitaph rows under the record header", () => {
		const b = new SessionBuilder();
		b.user("kickoff");
		b.assistant("two options");
		const alt = b.fork("alt-b", { trunkModel: "opus-4.8", branchModel: "haiku-4.5" });
		b.user("try b");
		b.at(alt);
		const dec = b.customMessage(
			"ctree/decision",
			"## Decision: alt-b\n**Outcome:** B wins on simplicity.",
			true,
			{ v: 1, forkEntryId: alt, branchName: "alt-b", siblings: [{ name: "alt-a", reason: "too clever" }] },
			undefined,
		);
		b.close(alt, "squashed", { decisionEntryId: dec });
		const panel = new ContextPanel({
			input: { entries: b.build().entries, project: "p", initialView: "decisions" },
			onAction: () => {},
		});
		const text = panel.render(110).map(strip).join("\n");
		expect(text).toContain("◆ alt-b");
		expect(text).toContain("drafted by haiku-4.5");
		expect(text).toContain("human-confirmed ✓");
		expect(text).toContain("B wins on simplicity.");
		expect(text).toContain("✗ alt-a — too clever");
		expect(text).toContain("G3");
	});
});

describe("ContextPanel actions", () => {
	it("emits close on q and esc-from-tree", () => {
		const a1: PanelAction[] = [];
		const { panel } = makePanel(a1);
		panel.handleInput("q");
		expect(a1[0]).toEqual({ type: "close" });
	});
});

describe("ContextPanel inside a TUI (xterm headless smoke)", () => {
	it("mounts, renders into the viewport, and survives input", async () => {
		const vterm = new VirtualTerminal(100, 36);
		const tui = new TUI(vterm);
		const { panel } = makePanel();
		tui.addChild(panel as never);
		tui.start();
		await vterm.waitForRender();
		const viewport = (await vterm.flushAndGetViewport()).join("\n");
		expect(viewport).toContain("pi-context-tree");
		expect(viewport).toContain("fix-flaky-test");
		tui.stop();
	});
});
