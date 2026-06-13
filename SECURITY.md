# Security policy

`pi-context-tree` is a local [pi](https://github.com/earendil-works/pi) extension. It reads and **appends to your own pi session files** and never sends your data anywhere — it has no server, no network endpoint, and no credentials of its own (model API keys belong to pi).

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's [private vulnerability reporting](https://github.com/navbytes/pi-context-tree/security/advisories/new) instead — you'll get an acknowledgement within a few days.

## What's most in scope

The load-bearing safety guarantee is the **append-only invariant**: the extension never edits or deletes your session JSONL. Every `/merge`, `/crop`, and `/undo` only appends `ctree/*` markers, so your original context is always recoverable. Reports that demonstrate a path which **mutates or destroys session history** — or that exfiltrates session contents off-machine — are especially welcome.

## Supported versions

This project tracks the latest release against a pinned pi version (`@earendil-works/*@0.79.1`). Fixes land on `main` and ship in the next tagged release; there are no long-term support branches yet.
