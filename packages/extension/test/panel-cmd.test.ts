import { describe, expect, it } from "vitest";
import { openPanel } from "../src/panel-cmd.ts";
import { makeFake } from "./fake-pi.ts";

interface CapturedMount {
	options?: { overlay?: boolean; overlayOptions?: { width?: string; maxHeight?: string } };
	panel?: { opts?: { maxBody?: number } };
}

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
