# PR Reviewer — macOS Desktop App Plan

A lightweight macOS desktop app to quickly review GitHub PRs locally using [@pierre/diffs](https://diffs.com/) for beautiful diff rendering.

**Core idea:** Paste a PR URL → see a gorgeous diff instantly. No GitHub UI needed.

---

## Tech Stack

| Layer            | Choice                      | Why                                                                 |
| ---------------- | --------------------------- | ------------------------------------------------------------------- |
| **App shell**    | Tauri 2                     | Lightweight (~10MB), uses macOS native WebView, Rust backend        |
| **Frontend**     | React + TypeScript + Vite   | Natural fit for `@pierre/diffs/react`                               |
| **Diff render**  | `@pierre/diffs/react`       | Split/unified views, Shiki syntax highlighting, line selection, annotations |
| **Git ops**      | `git` subprocess (via SSH)  | No tokens needed — uses existing SSH keys for auth                  |
| **Storage**      | JSON + bare git repos       | History in JSON, bare repos cached for reuse                        |

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                 macOS Tauri App                   │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  React UI (WebView)                        │  │
│  │  ┌──────────┐  ┌───────────────────────┐   │  │
│  │  │ URL Input│  │ Split/Unified Toggle  │   │  │
│  │  └──────────┘  └───────────────────────┘   │  │
│  │  ┌──────────┐  ┌───────────────────────┐   │  │
│  │  │ Recent   │  │ @pierre/diffs         │   │  │
│  │  │ PRs      │  │ Diff Viewer           │   │  │
│  │  │ Sidebar  │  │                       │   │  │
│  │  └──────────┘  └───────────────────────┘   │  │
│  └────────────────────────────────────────────┘  │
│                      │ invoke                     │
│                      ▼                            │
│  ┌────────────────────────────────────────────┐  │
│  │  Tauri / Rust Backend                      │  │
│  │  - PR URL parser                           │  │
│  │  - Git subprocess manager                  │  │
│  │  - Cache manager (bare repos)              │  │
│  │  - History store (JSON)                    │  │
│  └────────────────────────────────────────────┘  │
│            │                        │             │
│            ▼                        ▼             │
│     git (subprocess)         Local filesystem     │
│     via SSH auth             ~/.cache/pr-reviewer │
│                              ~/Library/App Support│
└──────────────────────────────────────────────────┘
```

---

## Core Workflow

### 1. User pastes a PR URL

```
https://github.com/owner/repo/pull/123
```

### 2. Backend parses URL

Extract `{ owner, repo, number }`. Reject anything that isn't a valid GitHub PR URL.

### 3. Clone or reuse bare repo

```bash
# First time for this repo — bare clone, treeless for speed
git clone --bare --filter=blob:none git@github.com:owner/repo.git \
  ~/.cache/pr-reviewer/owner/repo.git

# Subsequent PRs from the same repo — just fetch
git -C ~/.cache/pr-reviewer/owner/repo.git fetch origin
```

### 4. Fetch PR ref

```bash
git -C ~/.cache/pr-reviewer/owner/repo.git \
  fetch origin pull/123/head:pr-123
```

### 5. Detect base branch & generate diff

```bash
# Option A: if `gh` CLI is available
gh pr view 123 --repo owner/repo --json baseRefName -q .baseRefName
# → "main"

# Option B: fall back to origin/HEAD
git -C ~/.cache/pr-reviewer/owner/repo.git symbolic-ref refs/remotes/origin/HEAD
# → refs/remotes/origin/main

# Generate diff
git -C ~/.cache/pr-reviewer/owner/repo.git \
  diff origin/main...pr-123
```

### 6. Render diff in frontend

```tsx
import { parsePatchFiles } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";

const files = parsePatchFiles(diffText);
// Render each file with <PatchDiff /> or use <MultiFileDiff />
```

### 7. Save to history

Append entry to `~/Library/Application Support/pr-reviewer/history.json`.

---

## Data Storage

### History — `~/Library/Application Support/pr-reviewer/history.json`

```json
[
  {
    "id": "owner/repo#123",
    "url": "https://github.com/owner/repo/pull/123",
    "owner": "owner",
    "repo": "repo",
    "pullNumber": 123,
    "title": "Fix diff parsing",
    "author": "alice",
    "baseRef": "main",
    "lastOpenedAt": "2026-03-15T08:10:00Z"
  }
]
```

### Cached bare repos — `~/.cache/pr-reviewer/{owner}/{repo}.git`

- Bare repos are reused across multiple PRs from the same repo
- No working tree, minimal disk usage
- Cleanup = delete the directory

### Settings — `~/Library/Application Support/pr-reviewer/settings.json`

```json
{
  "defaultViewMode": "split",
  "theme": "system",
  "maxRecentPRs": 50,
  "autoPruneDays": 30
}
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  [  Paste PR URL here...                    ] [Review]  │
├──────────────┬──────────────────────────────────────────┤
│              │  PR #123: Fix diff parsing               │
│  Recent PRs  │  owner/repo · alice · 2h ago             │
│              │──────────────────────────────────────────│
│  ● #123      │                                          │
│    owner/repo│  ┌─────────────────────────────────────┐ │
│              │  │                                     │ │
│  ● #456      │  │   @pierre/diffs rendered view       │ │
│    other/repo│  │   (split or unified)                │ │
│              │  │                                     │ │
│  ● #789      │  │   syntax highlighted                │ │
│    foo/bar   │  │   line numbers                      │ │
│              │  │   inline change markers              │ │
│              │  │                                     │ │
│              │  └─────────────────────────────────────┘ │
├──────────────┴──────────────────────────────────────────┤
│  [Split ◉ Unified ○]    [↗ Open on GitHub]   [Refresh] │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1 — MVP: "Paste URL, see diff" (2–4 days)

- [ ] Tauri 2 app shell with React + Vite
- [ ] PR URL input + parser (extract owner/repo/number)
- [ ] Git subprocess: bare clone + fetch PR ref
- [ ] Generate diff via `git diff`
- [ ] Render with `@pierre/diffs/react` (`parsePatchFiles` → `PatchDiff`)
- [ ] Split/unified view toggle
- [ ] Basic recent PRs list (in-memory)

**Done when:** Paste a public/private PR URL → see the diff rendered beautifully.

### Phase 2 — History & Cache (1–2 days)

- [ ] Persist history to JSON file
- [ ] Recent PRs sidebar (click to reopen)
- [ ] Reuse cached bare repos (skip clone if exists, just fetch)
- [ ] Show loading/progress states for clone + fetch
- [ ] Error handling: invalid URL, clone failure, network error

**Done when:** Reopening a recent PR from the same repo is fast (no re-clone).

### Phase 3 — Polish (2–3 days)

- [ ] macOS light/dark theme sync (pierre-light / pierre-dark)
- [ ] Keyboard shortcuts: `⌘L` focus URL, `⌘R` refresh, `⌘\` toggle view mode
- [ ] Cleanup UI: delete individual history entries, clear cache for a repo
- [ ] Auto-prune: remove bare repos not accessed in 30 days
- [ ] PR metadata display: title, author, base branch, file count

**Done when:** App feels polished for daily use.

### Phase 4 — Nice-to-haves (ongoing)

- [ ] File tree / jump-to-file navigation
- [ ] `@pierre/diffs` worker pool for large PRs
- [ ] Virtualization for PRs with many files
- [ ] "Open changed file on GitHub" deep links
- [ ] Persist view preferences per PR
- [ ] Search/filter recent PRs
- [ ] Drag-and-drop `.patch` file support

---

## Key Decisions & Tradeoffs

| Decision                        | Rationale                                                              |
| ------------------------------- | ---------------------------------------------------------------------- |
| **Git subprocess over REST API** | SSH auth "just works", no token management, works with private repos  |
| **Bare clone with blob filter** | Minimal disk (~1-5MB vs full clone), no working tree, reusable        |
| **Tauri over Electron**         | ~96% smaller bundles, lower memory, macOS-only so WebView is fine     |
| **JSON over SQLite**            | Simple data model, easy to debug, good enough for personal app        |
| **No repo cloning (full)**      | User wants quick review, not full IDE experience                      |
| **Cache bare repos**            | Second PR from same repo = just `git fetch`, near-instant             |

---

## Risks & Mitigations

| Risk                           | Mitigation                                                             |
| ------------------------------ | ---------------------------------------------------------------------- |
| **Large PRs are slow**         | Add file-level lazy loading; use `@pierre/diffs` virtualization later  |
| **First clone is slow**        | Show progress bar; `--filter=blob:none` keeps it fast                  |
| **`git` not installed**        | Check on startup, show install instructions (Xcode CLI tools)          |
| **Base branch detection**      | Try `gh pr view` first, fall back to `origin/HEAD`                     |
| **Bare repo disk accumulation**| Auto-prune repos not accessed in N days; manual cleanup in UI          |
| **Stale diff**                 | Show "last fetched" timestamp; Refresh button re-fetches               |

---

## Dependencies

```json
{
  "@pierre/diffs": "^1.1.0",
  "react": "^19.x",
  "react-dom": "^19.x"
}
```

- **Tauri 2** (Rust toolchain)
- **git** (via system, installed with Xcode CLI tools)
- **Optional:** `gh` CLI (for base branch detection)
