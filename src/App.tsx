import { useState, useCallback, useRef, useEffect } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { Clock, FolderTree, ChevronRight, ChevronDown, ExternalLink, ClipboardList, X } from "lucide-react";
import FileTree from "./FileTree";
import "./App.css";

interface ProgressPayload {
  step: string;
  percent: number;
}

interface PrInfo {
  url: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body?: string;
  fetchedAt: number;
}

interface HistoryEntry {
  id: string;
  url: string;
  owner: string;
  repo: string;
  pullNumber: number;
  baseRef: string;
  lastOpenedAt: string;
  title?: string;
  body?: string;
}

interface FetchPrResult {
  diff: string;
  title?: string;
  body?: string;
}

type PrLoadStatus = "idle" | "loading" | "parsing" | "ready" | "error";

interface PrState {
  info: PrInfo;
  status: PrLoadStatus;
  progress: ProgressPayload | null;
  rawDiff: string | null;
  parsedFiles: FileDiffMetadata[];
  collapsedFiles: Set<number>;
  error: string | null;
}

function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type ViewMode = "split" | "unified";
const LARGE_FILE_LINE_THRESHOLD = 2000;

function App() {
  const [url, setUrl] = useState("");
  const [recentPrs, setRecentPrs] = useState<PrInfo[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [activePrUrl, setActivePrUrl] = useState<string | null>(null);
  const [prStates, setPrStates] = useState<Map<string, PrState>>(new Map());
  const abortRefs = useRef<Map<string, number>>(new Map());
  const fetchIdCounter = useRef(0);

  const activePr = activePrUrl ? prStates.get(activePrUrl) ?? null : null;

  useEffect(() => {
    invoke<HistoryEntry[]>("get_recent_prs").then((entries) => {
      setRecentPrs(entries.map((e) => ({
        url: e.url,
        owner: e.owner,
        repo: e.repo,
        number: e.pullNumber,
        title: e.title ?? `PR #${e.pullNumber}`,
        body: e.body,
        fetchedAt: new Date(e.lastOpenedAt).getTime(),
      })));
    }).catch(() => {});
  }, []);

  const updatePrState = useCallback((prUrl: string, update: Partial<PrState> | ((prev: PrState) => Partial<PrState>)) => {
    setPrStates((prev) => {
      const existing = prev.get(prUrl);
      if (!existing) return prev;
      const changes = typeof update === "function" ? update(existing) : update;
      const next = new Map(prev);
      next.set(prUrl, { ...existing, ...changes });
      return next;
    });
  }, []);

  const parseDiff = useCallback((prUrl: string, rawDiff: string) => {
    updatePrState(prUrl, { status: "parsing" });
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          const patches = parsePatchFiles(rawDiff);
          const files = patches.flatMap((p) => p.files);
          const autoCollapsed = new Set<number>();
          files.forEach((file, i) => {
            if ((file.unifiedLineCount ?? 0) > LARGE_FILE_LINE_THRESHOLD) {
              autoCollapsed.add(i);
            }
          });
          updatePrState(prUrl, { status: "ready", parsedFiles: files, collapsedFiles: autoCollapsed });
        } catch {
          updatePrState(prUrl, { status: "error", error: "Failed to parse diff", parsedFiles: [] });
        }
      }, 0);
    });
  }, [updatePrState]);

  const initPrState = useCallback((info: PrInfo): PrState => ({
    info,
    status: "loading",
    progress: null,
    rawDiff: null,
    parsedFiles: [],
    collapsedFiles: new Set(),
    error: null,
  }), []);

  const fetchDiff = useCallback(async (prUrl: string, info?: PrInfo) => {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) return;

    const prInfo = info ?? {
      url: prUrl, owner: parsed.owner, repo: parsed.repo,
      number: parsed.number, title: `PR #${parsed.number}`, fetchedAt: Date.now(),
    };

    const myId = ++fetchIdCounter.current;
    abortRefs.current.set(prUrl, myId);

    setPrStates((prev) => {
      const next = new Map(prev);
      next.set(prUrl, initPrState(prInfo));
      return next;
    });

    const isStale = () => abortRefs.current.get(prUrl) !== myId;

    const channel = new Channel<ProgressPayload>();
    channel.onmessage = (msg) => {
      if (!isStale()) updatePrState(prUrl, { progress: msg });
    };

    try {
      const result = await invoke<FetchPrResult>("fetch_pr_diff", { prUrl, onProgress: channel });
      if (isStale()) return;

      const updatedInfo: PrInfo = {
        ...prInfo,
        fetchedAt: Date.now(),
        title: result.title ?? prInfo.title,
        body: result.body,
      };
      updatePrState(prUrl, { rawDiff: result.diff, info: updatedInfo, progress: null });
      parseDiff(prUrl, result.diff);

      setRecentPrs((prev) => {
        const filtered = prev.filter((p) => p.url !== prUrl);
        return [updatedInfo, ...filtered].slice(0, 50);
      });
    } catch (e) {
      if (isStale()) return;
      updatePrState(prUrl, { status: "error", error: e instanceof Error ? e.message : String(e), progress: null });
    }
  }, [initPrState, updatePrState, parseDiff]);

  const loadCachedOrFetch = useCallback(async (pr: PrInfo) => {
    const myId = ++fetchIdCounter.current;
    abortRefs.current.set(pr.url, myId);

    setPrStates((prev) => {
      const next = new Map(prev);
      next.set(pr.url, initPrState(pr));
      return next;
    });

    const isStale = () => abortRefs.current.get(pr.url) !== myId;

    try {
      const diff = await invoke<string>("load_cached_diff", {
        owner: pr.owner, repo: pr.repo, pullNumber: pr.number,
      });
      if (isStale()) return;
      updatePrState(pr.url, { rawDiff: diff, progress: null });
      parseDiff(pr.url, diff);
    } catch {
      if (isStale()) return;
      fetchDiff(pr.url, pr);
    }
  }, [initPrState, updatePrState, parseDiff, fetchDiff]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setActivePrUrl(trimmed);
    fetchDiff(trimmed);
  };

  const handlePrClick = (pr: PrInfo) => {
    setUrl(pr.url);
    setActivePrUrl(pr.url);
    const existing = prStates.get(pr.url);
    if (existing && (existing.status === "ready" || existing.status === "loading" || existing.status === "parsing")) {
      return;
    }
    loadCachedOrFetch(pr);
  };

  const handleDeletePr = async (e: React.MouseEvent, pr: PrInfo) => {
    e.stopPropagation();
    try {
      await invoke("delete_pr", { owner: pr.owner, repo: pr.repo, pullNumber: pr.number });
    } catch {}
    setRecentPrs((prev) => prev.filter((p) => p.url !== pr.url));
    setPrStates((prev) => {
      const next = new Map(prev);
      next.delete(pr.url);
      return next;
    });
    if (activePrUrl === pr.url) setActivePrUrl(null);
  };

  const handleRefresh = () => {
    if (activePrUrl) fetchDiff(activePrUrl);
  };

  const toggleFile = (i: number) => {
    if (!activePrUrl) return;
    updatePrState(activePrUrl, (prev) => {
      const next = new Set(prev.collapsedFiles);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return { collapsedFiles: next };
    });
  };

  const statusForPr = (prUrl: string): PrLoadStatus => {
    return prStates.get(prUrl)?.status ?? "idle";
  };

  const progressForPr = (prUrl: string): number => {
    const st = prStates.get(prUrl);
    if (!st) return 0;
    if (st.status === "parsing") return 90;
    if (st.status === "ready") return 100;
    return st.progress?.percent ?? 0;
  };

  const fileBlockRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  type SidebarTab = "history" | "files";
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("history");
  const hasFiles = activePr?.status === "ready" && activePr.parsedFiles.length > 0;
  const [headerExpanded, setHeaderExpanded] = useState(false);

  const scrollToFile = useCallback((index: number) => {
    const el = fileBlockRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return (
    <div className="app">
      <form className="top-bar" onSubmit={handleSubmit}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste PR URL here... (e.g. https://github.com/owner/repo/pull/123)"
        />
        <button type="submit" className="btn btn-primary" disabled={!url.trim()}>
          Review
        </button>
      </form>

      <div className="middle">
        <div className="sidebar">
          <div className="sidebar-tabs">
            <button
              type="button"
              className={`sidebar-tab${sidebarTab === "history" ? " active" : ""}`}
              onClick={() => setSidebarTab("history")}
              title="History"
            >
              <Clock size={15} />
              <span>History</span>
            </button>
            {hasFiles && (
              <button
                type="button"
                className={`sidebar-tab${sidebarTab === "files" ? " active" : ""}`}
                onClick={() => setSidebarTab("files")}
                title="Files"
              >
                <FolderTree size={15} />
                <span>Files</span>
              </button>
            )}
          </div>

          <div className="sidebar-body">
            {sidebarTab === "history" && (
              <>
                {recentPrs.length === 0 ? (
                  <div className="sidebar-empty">No PRs reviewed yet</div>
                ) : (
                  recentPrs.map((pr) => {
                    const status = statusForPr(pr.url);
                    const pct = progressForPr(pr.url);
                    const isActive = pr.url === activePrUrl;
                    return (
                      <div
                        key={pr.url}
                        className={`pr-item${isActive ? " active" : ""}`}
                        onClick={() => handlePrClick(pr)}
                      >
                        <div className="pr-left">
                          {status === "loading" || status === "parsing" ? (
                            <div className="pr-spinner" />
                          ) : status === "ready" ? (
                            <div className="pr-dot ready" />
                          ) : status === "error" ? (
                            <div className="pr-dot error" />
                          ) : (
                            <div className="pr-dot" />
                          )}
                          <div className="pr-info">
                            <div className="pr-title">{pr.title}</div>
                            <div className="pr-repo">{pr.owner}/{pr.repo} #{pr.number}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="pr-delete"
                          onClick={(e) => handleDeletePr(e, pr)}
                          title="Delete PR"
                        >
                          <X size={14} />
                        </button>
                        {(status === "loading" || status === "parsing") && (
                          <div className="pr-progress-track">
                            <div className="pr-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {sidebarTab === "files" && hasFiles && (
              <FileTree files={activePr!.parsedFiles} onFileClick={scrollToFile} />
            )}
          </div>
        </div>

        <div className="content">
          {activePr?.status === "ready" && activePr.parsedFiles.length > 0 && (
            <div className={`content-header${headerExpanded ? " expanded" : ""}`}>
              <div className="content-header-toggle" onClick={() => setHeaderExpanded((v) => !v)}>
                {headerExpanded ? <ChevronDown size={14} className="content-header-chevron" /> : <ChevronRight size={14} className="content-header-chevron" />}
                <h2>{activePr.info.title}</h2>
                <span className="pr-number-badge">#{activePr.info.number}</span>
              </div>
              {headerExpanded && (
                <div className="content-header-details">
                  <p className="content-header-meta">
                    {activePr.info.owner}/{activePr.info.repo} · {activePr.parsedFiles.length} file{activePr.parsedFiles.length !== 1 ? "s" : ""} · {timeAgo(activePr.info.fetchedAt)}
                  </p>
                  {activePr.info.body && (
                    <div className="pr-description">{activePr.info.body}</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="diff-area">
            {activePr && (activePr.status === "loading" || activePr.status === "parsing") && (
              <div className="loading">
                <div className="progress-container">
                  <div className="spinner" />
                  <p className="progress-step">
                    {activePr.status === "parsing" ? "Parsing diff…" : (activePr.progress?.step ?? "Starting…")}
                  </p>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${activePr.status === "parsing" ? 90 : (activePr.progress?.percent ?? 0)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {activePr?.status === "error" && (
              <div className="error-message">
                <div className="error-box">
                  <h3>Failed to fetch PR</h3>
                  <p>{activePr.error}</p>
                </div>
              </div>
            )}

            {activePr?.status === "ready" && activePr.parsedFiles.length > 0 && (
              <div className="diff-list">
                  {activePr.parsedFiles.map((file, i) => {
                    const fileName = file.name ?? file.prevName ?? `file-${i}`;
                    const isCollapsed = activePr.collapsedFiles.has(i);
                    const lineCount = file.unifiedLineCount ?? 0;
                    const isLarge = lineCount > LARGE_FILE_LINE_THRESHOLD;
                    const additions = file.hunks.reduce((s, h) => s + h.additionLines, 0);
                    const deletions = file.hunks.reduce((s, h) => s + h.deletionLines, 0);
                    return (
                      <div
                        key={fileName}
                        className="file-block"
                        ref={(el) => { if (el) fileBlockRefs.current.set(i, el); else fileBlockRefs.current.delete(i); }}
                      >
                        <div
                          className={`file-header${isCollapsed ? " collapsed" : ""}`}
                          onClick={() => toggleFile(i)}
                        >
                          <ChevronRight size={14} className={`file-chevron${isCollapsed ? "" : " open"}`} />
                          {file.type !== "change" && (
                            <span className={`file-type-badge ${file.type}`}>
                              {file.type === "new" ? "Added" : file.type === "deleted" ? "Deleted" : file.type === "rename-pure" ? "Renamed" : "Renamed"}
                            </span>
                          )}
                          <span className="file-header-name">
                            {file.prevName && file.prevName !== file.name
                              ? `${file.prevName} → ${file.name}`
                              : fileName}
                          </span>
                          <span className="file-stats">
                            {additions > 0 && <span className="stat-add">+{additions}</span>}
                            {deletions > 0 && <span className="stat-del">−{deletions}</span>}
                          </span>
                          {isLarge && isCollapsed && (
                            <span className="file-header-badge">
                              {lineCount.toLocaleString()} lines
                            </span>
                          )}
                        </div>
                        {!isCollapsed && (
                          <FileDiff fileDiff={file} options={{ diffStyle: viewMode }} />
                        )}
                      </div>
                    );
                  })}
                </div>
            )}

            {!activePr && (
              <div className="placeholder">
                <ClipboardList size={48} className="placeholder-icon" />
                <p>Paste a GitHub PR URL above to review the diff</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bottom-bar">
        <div className="toggle-group">
          <button
            type="button"
            className={`toggle-btn${viewMode === "split" ? " active" : ""}`}
            onClick={() => setViewMode("split")}
          >
            Split
          </button>
          <button
            type="button"
            className={`toggle-btn${viewMode === "unified" ? " active" : ""}`}
            onClick={() => setViewMode("unified")}
          >
            Unified
          </button>
        </div>

        <div className="bottom-actions">
          {activePrUrl && (
            <a className="link-btn" href={activePrUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} />
              Open on GitHub
            </a>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={!activePrUrl}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
