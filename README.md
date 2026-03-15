# Komit

A sleek desktop app for reviewing GitHub pull requests locally.

Paste a PR URL, and Komit fetches the diff via Git over SSH, renders it with syntax highlighting, and keeps a local history so you can revisit PRs instantly.

<img width="1312" height="912" alt="Screen 1" src="https://github.com/user-attachments/assets/1a5788af-2c3c-4c83-a46d-575626b06111" />
<img width="1312" height="912" alt="Screen 2" src="https://github.com/user-attachments/assets/b21f8341-8940-4b3a-8a46-47d459a697f7" />

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
