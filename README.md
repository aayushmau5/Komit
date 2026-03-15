# Komit

A sleek desktop app for reviewing GitHub pull requests locally.

Paste a PR URL, and Komit fetches the diff via Git over SSH, renders it with syntax highlighting, and keeps a local history so you can revisit PRs instantly.

<img width="2624" height="1824" alt="image" src="https://github.com/user-attachments/assets/d7dad7cc-7c1d-40bf-8210-9ddd4ff4e15b" />
<img width="2624" height="1824" alt="image" src="https://github.com/user-attachments/assets/3e589c67-e9db-47c4-8b5a-a30a443774db" />

## Features

- **Syntax-highlighted diffs** powered by [Shiki](https://shiki.matsu.io/) via web workers for smooth rendering
- **Parallel PR loading** — open multiple PRs concurrently, each with its own progress indicator
- **File tree navigation** — sidebar file tree with directory collapsing, change-type badges (A/D/M/R), and click-to-scroll
- **PR metadata** — pulls in title and description from GitHub via `gh` CLI
- **Local history & caching** — diffs are cached on disk; previously fetched PRs load instantly
- **Collapsible file diffs** — expand/collapse individual files; large files auto-collapse
- **Split & unified views** — toggle between side-by-side and unified diff modes

## Tech Stack

| Layer    | Tech                                                    |
| -------- | ------------------------------------------------------- |
| Shell    | [Tauri 2](https://v2.tauri.app/) (Rust)                 |
| Frontend | React 19 + TypeScript + Vite                            |
| Diffs    | [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs) (virtualized, worker-based) |
| Icons    | [Lucide React](https://lucide.dev/)                     |

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Bun](https://bun.sh/) (or Node.js)
- [gh CLI](https://cli.github.com/) — authenticated, for fetching PR metadata
- SSH key configured for GitHub — Git operations use SSH

## Getting Started

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri dev

# Build for production
bun run tauri build
```

The packaged `.dmg` / `.app` will be in `src-tauri/target/release/bundle/`.

## License

MIT
