/**
 * Panel theme — ANSI-16-first (inherits the user's terminal palette), chalk
 * truecolor only where it degrades cleanly. Hosts may override any function.
 */

import type { Band, ForkPresentation } from "@pi-context-tree/core";
import chalk from "chalk";

export interface CtreeTheme {
	brand: (s: string) => string;
	dim: (s: string) => string;
	text: (s: string) => string;
	sel: (s: string) => string;
	warn: (s: string) => string;
	tokensBig: (s: string) => string;
	leaf: (s: string) => string;
	mark: (s: string) => string;
	decision: (s: string) => string;
	presentation: Record<ForkPresentation, (s: string) => string>;
	band: Record<Band, (s: string) => string>;
}

export const defaultTheme: CtreeTheme = {
	brand: chalk.magenta.bold,
	dim: chalk.gray,
	text: (s) => s,
	sel: chalk.inverse,
	warn: chalk.yellow,
	tokensBig: chalk.yellow,
	leaf: chalk.green,
	mark: chalk.red.bold,
	decision: chalk.magenta,
	presentation: {
		active: chalk.green,
		dangling: chalk.yellow,
		squashed: chalk.blue,
		rejected: chalk.red,
	},
	band: {
		low: chalk.green.dim,
		healthy: chalk.green,
		filling: chalk.yellow,
		red: chalk.red,
	},
};
