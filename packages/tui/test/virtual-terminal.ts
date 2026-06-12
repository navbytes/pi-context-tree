/**
 * Virtual terminal for tests, using xterm.js headless for accurate emulation.
 * Adapted from pi-mono packages/tui/test/virtual-terminal.ts (not exported by
 * the published package), with the Terminal type imported from the package.
 */

import type { Terminal } from "@earendil-works/pi-tui";
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import xterm from "@xterm/headless";

const XtermTerminal = xterm.Terminal;

export class VirtualTerminal implements Terminal {
	private xterm: XtermTerminalType;
	private inputHandler?: (data: string) => void;
	private resizeHandler?: () => void;
	private _columns: number;
	private _rows: number;

	constructor(columns = 80, rows = 24) {
		this._columns = columns;
		this._rows = rows;
		this.xterm = new XtermTerminal({
			cols: columns,
			rows: rows,
			disableStdin: true,
			allowProposedApi: true,
		});
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inputHandler = onInput;
		this.resizeHandler = onResize;
		this.xterm.write("\x1b[?2004h");
	}

	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

	stop(): void {
		this.xterm.write("\x1b[?2004l");
		this.inputHandler = undefined;
		this.resizeHandler = undefined;
	}

	write(data: string): void {
		this.xterm.write(data);
	}

	get columns(): number {
		return this._columns;
	}

	get rows(): number {
		return this._rows;
	}

	get kittyProtocolActive(): boolean {
		return true;
	}

	moveBy(lines: number): void {
		if (lines > 0) this.xterm.write(`\x1b[${lines}B`);
		else if (lines < 0) this.xterm.write(`\x1b[${-lines}A`);
	}

	hideCursor(): void {
		this.xterm.write("\x1b[?25l");
	}

	showCursor(): void {
		this.xterm.write("\x1b[?25h");
	}

	clearLine(): void {
		this.xterm.write("\x1b[K");
	}

	clearFromCursor(): void {
		this.xterm.write("\x1b[J");
	}

	clearScreen(): void {
		this.xterm.write("\x1b[2J\x1b[H");
	}

	setTitle(title: string): void {
		this.xterm.write(`\x1b]0;${title}\x07`);
	}

	setProgress(_active: boolean): void {}

	sendInput(data: string): void {
		this.inputHandler?.(data);
	}

	resize(columns: number, rows: number): void {
		this._columns = columns;
		this._rows = rows;
		this.xterm.resize(columns, rows);
		this.resizeHandler?.();
	}

	async flush(): Promise<void> {
		return new Promise<void>((resolve) => {
			this.xterm.write("", () => resolve());
		});
	}

	async flushAndGetViewport(): Promise<string[]> {
		await this.flush();
		return this.getViewport();
	}

	getViewport(): string[] {
		const lines: string[] = [];
		const buffer = this.xterm.buffer.active;
		for (let i = 0; i < this.xterm.rows; i++) {
			const line = buffer.getLine(buffer.viewportY + i);
			lines.push(line ? line.translateToString(true) : "");
		}
		return lines;
	}

	getScrollBuffer(): string[] {
		const lines: string[] = [];
		const buffer = this.xterm.buffer.active;
		for (let i = 0; i < buffer.length; i++) {
			const line = buffer.getLine(i);
			lines.push(line ? line.translateToString(true) : "");
		}
		return lines;
	}

	async waitForRender(): Promise<void> {
		await new Promise<void>((resolve) => process.nextTick(resolve));
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
		await this.flush();
	}
}
