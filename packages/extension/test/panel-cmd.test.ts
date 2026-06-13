import { describe, expect, it } from "vitest";
import { openPanel, registerPanel } from "../src/panel-cmd.ts";
import { makeFake } from "./fake-pi.ts";

interface CapturedMount {
	options?: { overlay?: boolean; overlayOptions?: { width?: string; maxHeight?: string } };
	panel?: { opts?: { maxBody?: number } };
}

describe("panel reopens after an action (mockup: the panel stays up)", () => {
	it("executes a jump, reopens with fresh state, and stops on close", async () => {
		const w = makeFake();
		w.session.user("kickoff");
		const target = w.session.assistant("plan");
		w.session.user("later");
		const queue: unknown[] = [{ type: "jump", entryId: target }, { type: "close" }];
		let opens = 0;
		w.ui.custom = async <T>(): Promise<T> => {
			opens += 1;
			return queue.shift() as T;
		};
		registerPanel(w.pi, { draft: async () => "unused" });

		await w.commands.get("panel")?.("", w.ctx);

		expect(opens).toBe(2); // reopened once after the jump, closed on the second action
		expect(w.calls.navigate).toEqual([{ target, options: { summarize: false } }]);
	});

	it("stops immediately when the panel is dismissed without an action", async () => {
		const w = makeFake();
		w.session.user("kickoff");
		let opens = 0;
		w.ui.custom = async <T>(): Promise<T> => {
			opens += 1;
			return undefined as T;
		};
		registerPanel(w.pi, { draft: async () => "unused" });
		await w.commands.get("panel")?.("", w.ctx);
		expect(opens).toBe(1);
	});
});

describe("openPanel overlay host", () => {
	it("mounts full-screen: width 100% and body rows sized from the terminal", async () => {
		const w = makeFake();
		w.session.user("hello");
		const captured: CapturedMount = {};
		w.ui.custom = async <T>(factory: unknown, options?: unknown): Promise<T> => {
			captured.options = options as CapturedMount["options"];
			const f = factory as (tui: unknown, theme: unknown, kb: unknown, done: (a: unknown) => void) => unknown;
			captured.panel = f({ terminal: { rows: 40, columns: 120 } }, undefined, undefined, () => {}) as {
				opts?: { maxBody?: number };
			};
			return undefined as T;
		};

		await openPanel(w.pi, w.ctx, {});

		expect(captured.options?.overlay).toBe(true);
		expect(captured.options?.overlayOptions?.width).toBe("100%");
		// 40 terminal rows minus panel chrome (header, gauge, dividers, secthead, footer, notify, scroll hint)
		expect(captured.panel?.opts?.maxBody).toBe(31);
	});

	it("lists records as text when the panel host is unavailable (/decisions outside the TUI)", async () => {
		const w = makeFake(); // FakeUi has no ui.custom by default — same as pi RPC/headless
		w.session.user("kickoff");
		const a = w.session.assistant("plan");
		w.session.append({
			type: "custom",
			customType: "ctree/fork",
			data: { v: 1, name: "feat-x", parentEntryId: a, trunkModel: "anthropic/opus-4.8", status: "open" },
		});
		w.session.append({
			type: "custom_message",
			customType: "ctree/decision",
			content: "## Decision: feat-x\n**Outcome:** tmpdir collision fixed.",
			display: true,
			details: { v: 1, forkEntryId: "x003", branchName: "feat-x" },
		});
		registerPanel(w.pi, { draft: async () => "unused" });

		await w.commands.get("decisions")?.("", w.ctx);

		const notes = w.ui.notes().join("\n");
		expect(notes).toContain("◆ feat-x");
		expect(notes).toContain("tmpdir collision fixed");
		expect(notes).not.toContain("needs pi's interactive TUI");
	});

	it("says so when there are no records to list", async () => {
		const w = makeFake();
		w.session.user("kickoff");
		registerPanel(w.pi, { draft: async () => "unused" });
		await w.commands.get("decisions")?.("", w.ctx);
		expect(w.ui.notes().some((n) => n.includes("no decision records"))).toBe(true);
	});

	it("falls back to a sane body size when the host exposes no terminal dims", async () => {
		const w = makeFake();
		w.session.user("hello");
		const captured: CapturedMount = {};
		w.ui.custom = async <T>(factory: unknown): Promise<T> => {
			const f = factory as (tui: unknown, theme: unknown, kb: unknown, done: (a: unknown) => void) => unknown;
			captured.panel = f({}, undefined, undefined, () => {}) as { opts?: { maxBody?: number } };
			return undefined as T;
		};

		await openPanel(w.pi, w.ctx, {});

		expect(captured.panel?.opts?.maxBody).toBeGreaterThanOrEqual(20);
	});
});
