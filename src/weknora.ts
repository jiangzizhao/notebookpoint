// weknora 知识助理 OpenAPI 客户端 —— 签名按 WeKnora 开源 signer.go 精确复刻。
// 不依赖 obsidian, 纯逻辑, 方便单独跑测试; HTTP 由外部注入(插件里用 obsidian.requestUrl)。
import { createHash, randomUUID } from "crypto";

export interface KnowledgeItem {
  id: string;
  type?: string;        // url / manual / file
  title?: string;
  description?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
  tags?: unknown;
  [k: string]: unknown;
}

export interface KnowledgeBase {
  id: string;
  name?: string;
  description?: string;
  knowledge_count?: number;
  [k: string]: unknown;
}

export type HttpFn = (args: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<{ status: number; text: string }>;

const NONCE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SAFE = /[A-Za-z0-9\-_.~]/;

export function md5Hex(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}

// 对应 signer.go 的 rfc3986Encode(签名串里全是 ASCII, 多字节场景不会出现)。
export function rfc3986(s: string): string {
  let out = "";
  for (const ch of s) {
    if (SAFE.test(ch)) {
      out += ch;
    } else {
      out += "%" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

function genNonce(len = 16): string {
  let s = "";
  for (let i = 0; i < len; i++) s += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  return s;
}

// 生成一次请求的签名头。query: 带 ?参数 的接口必须把查询参数并入签名。
export function signHeaders(
  appid: string,
  secret: string,
  opts: { requestId: string; ts?: string; nonce?: string; bodyJson?: string; query?: Record<string, string> },
): Record<string, string> {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000).toString();
  const nonce = opts.nonce ?? genNonce();
  const bodyForHash = opts.bodyJson && opts.bodyJson.length ? opts.bodyJson : "{}";
  const params: Record<string, string> = {
    "x-appid": appid,
    "x-api-key": secret,
    "x-request-id": opts.requestId,
    "x-timestamp": ts,
    "x-nonce": nonce,
    body: md5Hex(bodyForHash),
    ...(opts.query ?? {}),
  };
  const canon = Object.keys(params)
    .sort()
    .map((k) => rfc3986(k) + "=" + rfc3986(params[k]))
    .join("&");
  return {
    "X-APPID": appid,
    "X-API-Key": secret,
    "X-Request-ID": opts.requestId,
    "X-Timestamp": ts,
    "X-Nonce": nonce,
    "X-Signature": md5Hex(canon),
    "Content-Type": "application/json",
  };
}

export class WeknoraClient {
  constructor(
    private appid: string,
    private secret: string,
    private http: HttpFn,
    private base = "https://weknora.weixin.qq.com",
  ) {}

  private async call(path: string, method = "GET", bodyJson = ""): Promise<{ status: number; json: any; text: string }> {
    const qi = path.indexOf("?");
    const query: Record<string, string> = {};
    if (qi >= 0) {
      for (const pair of path.slice(qi + 1).split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
        const v = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1));
        query[k] = v;
      }
    }
    const headers = signHeaders(this.appid, this.secret, { requestId: randomUUID(), bodyJson, query });
    const res = await this.http({
      url: this.base + path,
      method,
      headers,
      body: method !== "GET" && bodyJson ? bodyJson : undefined,
    });
    let json: any = null;
    try { json = JSON.parse(res.text); } catch { /* ignore */ }
    return { status: res.status, json, text: res.text };
  }

  async authMe() {
    return this.call("/api/v1/auth/me");
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    const r = await this.call("/api/v1/knowledge-bases");
    if (r.status !== 200) throw new Error(`列出知识库失败 [${r.status}] ${r.text.slice(0, 200)}`);
    return (r.json?.data ?? []) as KnowledgeBase[];
  }

  async listKnowledge(kbId: string, page = 1, pageSize = 50): Promise<{ items: KnowledgeItem[]; total: number }> {
    const r = await this.call(`/api/v1/knowledge-bases/${kbId}/knowledge?page=${page}&page_size=${pageSize}`);
    if (r.status !== 200) throw new Error(`列出知识失败 [${r.status}] ${r.text.slice(0, 200)}`);
    return { items: (r.json?.data ?? []) as KnowledgeItem[], total: r.json?.total ?? 0 };
  }

  async getKnowledge(id: string): Promise<KnowledgeItem> {
    const r = await this.call(`/api/v1/knowledge/${id}`);
    if (r.status !== 200) throw new Error(`取知识详情失败 [${r.status}] ${r.text.slice(0, 200)}`);
    return (r.json?.data ?? r.json) as KnowledgeItem;
  }

  // 取解析后的全文:/preview 返回分段(chunk)数组,按序拼接并去掉重叠。
  async getContent(id: string): Promise<string> {
    const r = await this.call(`/api/v1/knowledge/${id}/preview?page=1&page_size=1000`);
    if (r.status !== 200) return "";
    const chunks = ((r.json?.data ?? []) as Array<{ chunk_index?: number; content?: string }>)
      .slice()
      .sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0))
      .map((c) => c.content ?? "");
    return decodeEntities(stripLeadingFrontmatter(joinChunks(chunks))).trim();
  }
}

// 解码常见 HTML 实体(weknora 抓回的正文里常有 &gt; &amp; 等)。
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&#39;": "'", "&#x27;": "'", "&nbsp;": " ", "&apos;": "'",
  };
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (m) => named[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// 相邻 chunk 有 overlap(知识库 chunk_overlap),拼接时去掉重复边界。
function joinChunks(chunks: string[]): string {
  let out = "";
  for (const c of chunks) {
    if (!c) continue;
    if (!out) { out = c; continue; }
    const max = Math.min(400, out.length, c.length);
    let k = 0;
    for (let n = max; n > 16; n--) {
      if (out.slice(-n) === c.slice(0, n)) { k = n; break; }
    }
    out += (k ? c.slice(k) : "\n\n" + c);
  }
  return out;
}

// weknora 第一段常带一段 ---\n...\n--- 的元信息,去掉(我们自己写 frontmatter)。
function stripLeadingFrontmatter(text: string): string {
  return text.replace(/^\s*---\n[\s\S]*?\n---\n?/, "");
}
