// 把一条 weknora 知识渲染成 Obsidian markdown 笔记(纯函数, 便于测试)。
import type { KnowledgeItem } from "./weknora";

export function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]/g, "_").replace(/\s+/g, " ").trim() || "未命名";
}

function escapeYaml(s: string): string {
  return /[:#\n"']/.test(s) ? JSON.stringify(s) : s;
}

// 从知识对象里挑出正文(weknora 不同来源字段名可能不同, 逐个兜底)。
export function pickContent(o: any): string {
  return String(o?.markdown || o?.content || o?.text || o?.description || "");
}

export function noteRelPath(folder: string, kbName: string, item: KnowledgeItem): string {
  const title = String(item.title || "未命名");
  const ym = String(item.created_at || "").slice(0, 7) || "未知日期";   // 按转发月份归档: 2026-06
  return `${folder}/${sanitize(kbName)}/${ym}/${sanitize(title).slice(0, 80)}-${item.id.slice(0, 8)}.md`;
}

export function renderNote(kbName: string, item: KnowledgeItem, body: string): string {
  const title = String(item.title || "未命名");
  const fm = [
    "---",
    `title: ${escapeYaml(title)}`,
    item.source ? `source: ${escapeYaml(String(item.source))}` : null,
    item.type ? `type: ${item.type}` : null,
    item.created_at ? `created: ${item.created_at}` : null,
    `kb: ${escapeYaml(kbName)}`,
    `weknora_id: ${item.id}`,
    "---",
    "",
  ].filter((x) => x !== null).join("\n");
  const main = body || String(item.description || "");
  const linkLine = item.source ? `\n[原文链接](${item.source})\n` : "";
  return fm + main + linkLine + "\n";
}
