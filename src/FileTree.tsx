import { useState, useMemo } from "react";
import type { FileDiffMetadata, ChangeTypes } from "@pierre/diffs";
import { ChevronRight, Folder, FolderOpen, File } from "lucide-react";

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: { index: number; type: ChangeTypes; additions: number; deletions: number };
}

function buildTree(files: FileDiffMetadata[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };

  files.forEach((file, i) => {
    const filePath = file.name ?? file.prevName ?? `file-${i}`;
    const parts = filePath.split("/");
    let current = root;

    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      const isFile = p === parts.length - 1;
      const fullPath = parts.slice(0, p + 1).join("/");

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: fullPath,
          children: new Map(),
        });
      }

      const node = current.children.get(part)!;
      if (isFile) {
        const additions = file.hunks.reduce((s, h) => s + h.additionLines, 0);
        const deletions = file.hunks.reduce((s, h) => s + h.deletionLines, 0);
        node.file = { index: i, type: file.type, additions, deletions };
      }
      current = node;
    }
  });

  return compactTree(root);
}

function compactTree(node: TreeNode): TreeNode {
  for (const [key, child] of node.children) {
    node.children.set(key, compactTree(child));
  }

  if (!node.file && node.children.size === 1 && node.name !== "") {
    const [, only] = [...node.children.entries()][0];
    if (!only.file) {
      return {
        name: `${node.name}/${only.name}`,
        path: only.path,
        children: only.children,
        file: only.file,
      };
    }
  }

  return node;
}

function sortedEntries(node: TreeNode): TreeNode[] {
  const entries = [...node.children.values()];
  entries.sort((a, b) => {
    const aIsDir = !a.file;
    const bIsDir = !b.file;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

function typeLabel(t: ChangeTypes): string | null {
  switch (t) {
    case "new": return "A";
    case "deleted": return "D";
    case "rename-pure":
    case "rename-changed": return "R";
    default: return "M";
  }
}

function typeCls(t: ChangeTypes): string {
  switch (t) {
    case "new": return "added";
    case "deleted": return "deleted";
    case "rename-pure":
    case "rename-changed": return "renamed";
    default: return "modified";
  }
}

function DirNode({ node, onFileClick, depth }: { node: TreeNode; onFileClick: (i: number) => void; depth: number }) {
  const [open, setOpen] = useState(true);
  const children = useMemo(() => sortedEntries(node), [node]);

  return (
    <div className="ft-dir">
      <div
        className="ft-dir-row"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight size={12} className={`ft-chevron${open ? " open" : ""}`} />
        {open ? <FolderOpen size={14} className="ft-dir-icon" /> : <Folder size={14} className="ft-dir-icon" />}
        <span className="ft-dir-name">{node.name}</span>
      </div>
      {open && children.map((child) =>
        child.file ? (
          <FileNode key={child.path} node={child} onFileClick={onFileClick} depth={depth + 1} />
        ) : (
          <DirNode key={child.path} node={child} onFileClick={onFileClick} depth={depth + 1} />
        )
      )}
    </div>
  );
}

function FileNode({ node, onFileClick, depth }: { node: TreeNode; onFileClick: (i: number) => void; depth: number }) {
  const f = node.file!;
  return (
    <div
      className="ft-file-row"
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={() => onFileClick(f.index)}
    >
      <File size={14} className="ft-file-icon" />
      <span className="ft-file-name">{node.name}</span>
      <span className="ft-file-right">
        {f.additions > 0 && <span className="ft-stat-add">+{f.additions}</span>}
        {f.deletions > 0 && <span className="ft-stat-del">−{f.deletions}</span>}
        <span className={`ft-type-badge ${typeCls(f.type)}`}>{typeLabel(f.type)}</span>
      </span>
    </div>
  );
}

export default function FileTree({ files, onFileClick }: { files: FileDiffMetadata[]; onFileClick: (i: number) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const rootChildren = useMemo(() => sortedEntries(tree), [tree]);

  return (
    <div className="file-tree">
      <div className="ft-body">
        {rootChildren.map((child) =>
          child.file ? (
            <FileNode key={child.path} node={child} onFileClick={onFileClick} depth={0} />
          ) : (
            <DirNode key={child.path} node={child} onFileClick={onFileClick} depth={0} />
          )
        )}
      </div>
    </div>
  );
}
