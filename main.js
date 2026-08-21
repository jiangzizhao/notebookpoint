"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => NotebookPointPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/weknora.ts
var import_crypto = require("crypto");
var NONCE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
var SAFE = /[A-Za-z0-9\-_.~]/;
function md5Hex(s) {
  return (0, import_crypto.createHash)("md5").update(s, "utf8").digest("hex");
}
function rfc3986(s) {
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
function genNonce(len = 16) {
  let s = "";
  for (let i = 0; i < len; i++)
    s += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  return s;
}
function signHeaders(appid, secret, opts) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1e3).toString();
  const nonce = opts.nonce ?? genNonce();
  const bodyForHash = opts.bodyJson && opts.bodyJson.length ? opts.bodyJson : "{}";
  const params = {
    "x-appid": appid,
    "x-api-key": secret,
    "x-request-id": opts.requestId,
    "x-timestamp": ts,
    "x-nonce": nonce,
    body: md5Hex(bodyForHash),
    ...opts.query ?? {}
  };
  const canon = Object.keys(params).sort().map((k) => rfc3986(k) + "=" + rfc3986(params[k])).join("&");
  return {
    "X-APPID": appid,
    "X-API-Key": secret,
    "X-Request-ID": opts.requestId,
    "X-Timestamp": ts,
    "X-Nonce": nonce,
    "X-Signature": md5Hex(canon),
    "Content-Type": "application/json"
  };
}
var WeknoraClient = class {
  constructor(appid, secret, http, base = "https://weknora.weixin.qq.com") {
    this.appid = appid;
    this.secret = secret;
    this.http = http;
    this.base = base;
  }
  async call(path, method = "GET", bodyJson = "") {
    const qi = path.indexOf("?");
    const query = {};
    if (qi >= 0) {
      for (const pair of path.slice(qi + 1).split("&")) {
        if (!pair)
          continue;
        const eq = pair.indexOf("=");
        const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
        const v = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1));
        query[k] = v;
      }
    }
    const headers = signHeaders(this.appid, this.secret, { requestId: (0, import_crypto.randomUUID)(), bodyJson, query });
    const res = await this.http({
      url: this.base + path,
      method,
      headers,
      body: method !== "GET" && bodyJson ? bodyJson : void 0
    });
    let json = null;
    try {
      json = JSON.parse(res.text);
    } catch {
    }
    return { status: res.status, json, text: res.text };
  }
  async authMe() {
    return this.call("/api/v1/auth/me");
  }
  async listKnowledgeBases() {
    const r = await this.call("/api/v1/knowledge-bases");
    if (r.status !== 200)
      throw new Error(`\u5217\u51FA\u77E5\u8BC6\u5E93\u5931\u8D25 [${r.status}] ${r.text.slice(0, 200)}`);
    return r.json?.data ?? [];
  }
  async listKnowledge(kbId, page = 1, pageSize = 50) {
    const r = await this.call(`/api/v1/knowledge-bases/${kbId}/knowledge?page=${page}&page_size=${pageSize}`);
    if (r.status !== 200)
      throw new Error(`\u5217\u51FA\u77E5\u8BC6\u5931\u8D25 [${r.status}] ${r.text.slice(0, 200)}`);
    return { items: r.json?.data ?? [], total: r.json?.total ?? 0 };
  }
  async getKnowledge(id) {
    const r = await this.call(`/api/v1/knowledge/${id}`);
    if (r.status !== 200)
      throw new Error(`\u53D6\u77E5\u8BC6\u8BE6\u60C5\u5931\u8D25 [${r.status}] ${r.text.slice(0, 200)}`);
    return r.json?.data ?? r.json;
  }
  // 取解析后的全文:/preview 返回分段(chunk)数组,按序拼接并去掉重叠。
  async getContent(id) {
    const r = await this.call(`/api/v1/knowledge/${id}/preview?page=1&page_size=1000`);
    if (r.status !== 200)
      return "";
    const chunks = (r.json?.data ?? []).slice().sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0)).map((c) => c.content ?? "");
    return decodeEntities(stripLeadingFrontmatter(joinChunks(chunks))).trim();
  }
};
function decodeEntities(s) {
  const named = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#x27;": "'",
    "&nbsp;": " ",
    "&apos;": "'"
  };
  return s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (m) => named[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function joinChunks(chunks) {
  let out = "";
  for (const c of chunks) {
    if (!c)
      continue;
    if (!out) {
      out = c;
      continue;
    }
    const max = Math.min(400, out.length, c.length);
    let k = 0;
    for (let n = max; n > 16; n--) {
      if (out.slice(-n) === c.slice(0, n)) {
        k = n;
        break;
      }
    }
    out += k ? c.slice(k) : "\n\n" + c;
  }
  return out;
}
function stripLeadingFrontmatter(text) {
  return text.replace(/^\s*---\n[\s\S]*?\n---\n?/, "");
}

// src/render.ts
function sanitize(s) {
  return s.replace(/[\\/:*?"<>|#^[\]]/g, "_").replace(/\s+/g, " ").trim() || "\u672A\u547D\u540D";
}
function escapeYaml(s) {
  return /[:#\n"']/.test(s) ? JSON.stringify(s) : s;
}
function pickContent(o) {
  return String(o?.markdown || o?.content || o?.text || o?.description || "");
}
function noteRelPath(folder, kbName, item) {
  const title = String(item.title || "\u672A\u547D\u540D");
  const ym = String(item.created_at || "").slice(0, 7) || "\u672A\u77E5\u65E5\u671F";
  return `${folder}/${sanitize(kbName)}/${ym}/${sanitize(title).slice(0, 80)}-${item.id.slice(0, 8)}.md`;
}
function renderNote(kbName, item, body) {
  const title = String(item.title || "\u672A\u547D\u540D");
  const fm = [
    "---",
    `title: ${escapeYaml(title)}`,
    item.source ? `source: ${escapeYaml(String(item.source))}` : null,
    item.type ? `type: ${item.type}` : null,
    item.created_at ? `created: ${item.created_at}` : null,
    `kb: ${escapeYaml(kbName)}`,
    `weknora_id: ${item.id}`,
    "---",
    ""
  ].filter((x) => x !== null).join("\n");
  const main = body || String(item.description || "");
  const linkLine = item.source ? `
[\u539F\u6587\u94FE\u63A5](${item.source})
` : "";
  return fm + main + linkLine + "\n";
}

// src/license.ts
var import_crypto2 = require("crypto");
var PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAxp8Vp4aptQeFPCIWAKQy2NZ+oWccg8vjo+PWEaXxbo0=";
function b64uToBuf(s) {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4)
    t += "=";
  return Buffer.from(t, "base64");
}
function verifyLicense(card) {
  if (!card || !card.trim())
    return { valid: false, reason: "\u672A\u586B\u5361\u5BC6" };
  const parts = card.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "NBP1")
    return { valid: false, reason: "\u5361\u5BC6\u683C\u5F0F\u4E0D\u5BF9" };
  let payloadBytes, sig;
  try {
    payloadBytes = b64uToBuf(parts[1]);
    sig = b64uToBuf(parts[2]);
  } catch {
    return { valid: false, reason: "\u5361\u5BC6\u635F\u574F" };
  }
  let ok = false;
  try {
    const pub = (0, import_crypto2.createPublicKey)({ key: Buffer.from(PUBLIC_KEY_B64, "base64"), format: "der", type: "spki" });
    ok = (0, import_crypto2.verify)(null, payloadBytes, pub, sig);
  } catch {
    return { valid: false, reason: "\u9A8C\u8BC1\u51FA\u9519" };
  }
  if (!ok)
    return { valid: false, reason: "\u5361\u5BC6\u65E0\u6548(\u7B7E\u540D\u4E0D\u7B26)" };
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { valid: false, reason: "\u5361\u5BC6\u635F\u574F" };
  }
  return { valid: true, payload };
}
function licenseStatusText(card) {
  if (!card || !card.trim())
    return "\u672A\u6FC0\u6D3B(\u516C\u4F17\u53F7\u4ED8\u6B3E\u540E\u83B7\u5F97\u5361\u5BC6)";
  const r = verifyLicense(card);
  if (!r.valid)
    return "\u274C " + (r.reason ?? "\u65E0\u6548");
  return "\u2705 \u5DF2\u6FC0\u6D3B\uFF08\u6709\u6548\u671F\u4EE5\u670D\u52A1\u5668\u4ED8\u6B3E\u8BB0\u5F55\u4E3A\u51C6\uFF09";
}

// src/main.ts
var DEFAULTS = {
  appid: "",
  secret: "",
  license: "",
  folder: "NotebookPoint",
  syncOnStartup: true,
  autoSyncMinutes: 1,
  syncedIds: {},
  mediaRetry: {},
  fetchedMedia: {},
  actCard: "",
  actAppid: "",
  actOk: false,
  actExp: 0,
  actChecked: 0,
  inboxKey: ""
};
var SUPABASE_URL = "https://prrhckcrgpvjynwtifdc.supabase.co";
var SUPABASE_ANON = "sb_publishable_H-JJD4LBn8Kbhef97xft7w_Ktg8vGFK";
var ACT_RECHECK_MS = 24 * 60 * 60 * 1e3;
var obsidianHttp = async ({ url, method, headers, body }) => {
  const r = await (0, import_obsidian.requestUrl)({ url, method, headers, body, throw: false });
  return { status: r.status, text: r.text };
};
var PARSE_API = "https://api.monoi.cn/nbp/parse";
async function backendParse(url) {
  try {
    const r = await (0, import_obsidian.requestUrl)({ url: PARSE_API + "?url=" + encodeURIComponent(url), throw: false });
    const j = JSON.parse(r.text);
    return j && j.ok ? String(j.content || "") : "";
  } catch {
    return "";
  }
}
function decodeEntities2(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)));
}
var isYouTube = (u) => /(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/i.test(u);
var isX = (u) => /(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+/i.test(u);
function ytVideoId(u) {
  const m = u.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}
function tweetId(u) {
  const m = u.match(/status\/(\d+)/);
  return m ? m[1] : "";
}
async function fetchYouTube(url) {
  const vid = ytVideoId(url);
  if (!vid)
    return null;
  try {
    const r = await (0, import_obsidian.requestUrl)({
      url: "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "IOS", clientVersion: "20.10.38", deviceModel: "iPhone16,2" } }, videoId: vid }),
      throw: false
    });
    const d = JSON.parse(r.text);
    const vd = d?.videoDetails || {};
    const title = String(vd.title || "YouTube \u89C6\u9891");
    const author = String(vd.author || "");
    const desc = String(vd.shortDescription || "").trim();
    let body = `> \u6765\u6E90: YouTube ${url}${author ? "\n> \u9891\u9053: " + author : ""}
`;
    if (desc)
      body += `
## \u7B80\u4ECB

${desc}
`;
    const tracks = d?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (tracks.length) {
      const pick = tracks.find((t) => String(t.languageCode || "").startsWith("zh")) || tracks.find((t) => t.languageCode === "en") || tracks[0];
      const xr = await (0, import_obsidian.requestUrl)({ url: String(pick.baseUrl), throw: false });
      const segs = Array.from(xr.text.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)).map((m) => decodeEntities2(String(m[1]).replace(/<[^>]+>/g, "")).trim()).filter(Boolean);
      if (segs.length)
        body += `
## \u6B63\u6587

${segs.join(" ")}
`;
    }
    return { title, body };
  } catch (e) {
    console.error("NotebookPoint YouTube \u6293\u53D6\u5931\u8D25", e);
    return null;
  }
}
async function fetchTweet(url) {
  const id = tweetId(url);
  if (!id)
    return null;
  try {
    const r = await (0, import_obsidian.requestUrl)({ url: "https://api.fxtwitter.com/i/status/" + id, throw: false });
    const t = JSON.parse(r.text)?.tweet;
    if (!t)
      return null;
    const nm = t.author?.name || "", sn = t.author?.screen_name || "";
    const author = nm ? `${nm}${sn ? " (@" + sn + ")" : ""}` : "";
    const text = String(t.text || "");
    const title = text.slice(0, 30).replace(/\s+/g, " ") || "\u63A8\u6587";
    let body = `> \u6765\u6E90: X ${url}${author ? "\n> \u4F5C\u8005: " + author : ""}

${text}`;
    const media = (t.media && t.media.all || []).map((m) => m.url).filter(Boolean);
    if (media.length)
      body += "\n\n" + media.map((u) => `![](${u})`).join("\n");
    return { title, body };
  } catch (e) {
    console.error("NotebookPoint X \u6293\u53D6\u5931\u8D25", e);
    return null;
  }
}
var INBOX_API = "https://api.monoi.cn/nbp/wxkf/items";
var MEDIA_API = "https://api.monoi.cn/nbp/wxkf/media";
async function fetchInbox(card) {
  try {
    const r = await (0, import_obsidian.requestUrl)({ url: INBOX_API + "?card=" + encodeURIComponent(card), throw: false });
    if (r.status !== 200)
      return [];
    const j = JSON.parse(r.text);
    return Array.isArray(j?.items) ? j.items : [];
  } catch {
    return [];
  }
}
var PLUGIN_VER_API = "https://api.monoi.cn/nbp/plugin/version";
function isNewer(remote, cur) {
  const pa = remote.split("."), pb = cur.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = parseInt(pa[i] || "0") || 0, db = parseInt(pb[i] || "0") || 0;
    if (da !== db)
      return da > db;
  }
  return false;
}
var NotebookPointPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.timer = null;
  }
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("refresh-cw", "NotebookPoint \u540C\u6B65", () => this.sync());
    this.addCommand({ id: "sync-now", name: "\u7ACB\u5373\u540C\u6B65", callback: () => this.sync() });
    this.addSettingTab(new NbpSettingTab(this.app, this));
    this.scheduleAuto();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncOnStartup)
        window.setTimeout(() => this.sync(true), 3e3);
      window.setTimeout(() => this.checkUpdate(), 6e3);
    });
  }
  // 检查更新: 只提示有新版 + 给下载链接(不下载/不执行远程代码, 符合商店规范)。
  async checkUpdate() {
    try {
      const r = await (0, import_obsidian.requestUrl)({ url: PLUGIN_VER_API, throw: false });
      if (r.status !== 200)
        return;
      const remote = String(JSON.parse(r.text).version || "");
      if (!remote || !isNewer(remote, this.manifest.version))
        return;
      new import_obsidian.Notice(`NotebookPoint \u6709\u65B0\u7248 v${remote}\u3002\u5230\u6559\u7A0B\u9875\u4E0B\u8F7D\u66F4\u65B0:
https://api.monoi.cn/nbp/guide`, 1e4);
    } catch (e) {
      console.error("NotebookPoint \u68C0\u67E5\u66F4\u65B0\u51FA\u9519", e);
    }
  }
  onunload() {
    if (this.timer)
      window.clearInterval(this.timer);
  }
  client() {
    return new WeknoraClient(this.settings.appid.trim(), this.settings.secret.trim(), obsidianHttp);
  }
  // 向激活服务器确认"这张卡归这个 AppID"。带缓存(24h)+断网宽限。
  // LICENSE_SERVER 为空时直接放行(仅离线卡密阶段)。
  async checkActivation(silent) {
    if (!SUPABASE_URL || !SUPABASE_ANON)
      return true;
    const s = this.settings;
    const appid = s.appid.trim();
    const now = Date.now();
    const cacheFresh = s.actOk && s.actCard === s.license && s.actAppid === appid && now - s.actChecked < ACT_RECHECK_MS && (!s.actExp || s.actExp * 1e3 > now);
    if (cacheFresh)
      return true;
    try {
      const r = await (0, import_obsidian.requestUrl)({
        url: SUPABASE_URL + "/rest/v1/rpc/activate_card",
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON,
          "Authorization": "Bearer " + SUPABASE_ANON,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ p_card: s.license, p_appid: appid }),
        throw: false
      });
      const j = JSON.parse(r.text);
      s.actCard = s.license;
      s.actAppid = appid;
      s.actOk = !!j.ok;
      s.actExp = j.exp ?? 0;
      s.actChecked = now;
      await this.saveSettings();
      if (!j.ok && !silent)
        new import_obsidian.Notice("NotebookPoint:" + (j.reason ?? "\u5361\u5BC6\u6FC0\u6D3B\u5931\u8D25"));
      return !!j.ok;
    } catch {
      if (s.actOk && s.actCard === s.license && s.actAppid === appid && (!s.actExp || s.actExp * 1e3 > now)) {
        return true;
      }
      if (!silent)
        new import_obsidian.Notice("NotebookPoint:\u6682\u65F6\u8FDE\u4E0D\u4E0A\u6FC0\u6D3B\u670D\u52A1\u5668,\u7A0D\u540E\u91CD\u8BD5");
      return false;
    }
  }
  scheduleAuto() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const m = this.settings.autoSyncMinutes;
    if (m && m > 0) {
      this.timer = window.setInterval(() => this.sync(true), m * 60 * 1e3);
      this.registerInterval(this.timer);
    }
  }
  async sync(silent = false) {
    const s = this.settings;
    const lic = verifyLicense(s.license);
    if (!lic.valid) {
      if (!silent)
        new import_obsidian.Notice("NotebookPoint:" + (lic.reason ?? "\u5361\u5BC6\u65E0\u6548") + ",\u8BF7\u5728\u8BBE\u7F6E\u91CC\u586B\u5165\u6709\u6548\u4ED8\u8D39\u5361\u5BC6");
      return;
    }
    if (!silent)
      new import_obsidian.Notice("NotebookPoint:\u5F00\u59CB\u540C\u6B65\u2026");
    let created = 0;
    try {
      created += await this.syncInbox();
    } catch (e) {
      console.error("NotebookPoint \u540C\u6B65\u51FA\u9519", e);
    }
    await this.saveSettings();
    if (!silent || created > 0) {
      new import_obsidian.Notice(`NotebookPoint:\u540C\u6B65\u5B8C\u6210,\u65B0\u589E ${created} \u6761`);
    }
  }
  // 拉取微信客服 inbox(自有机器人), 写成笔记。正文服务器已解析好, 直接用。
  async syncInbox() {
    const s = this.settings;
    const card = s.license.trim();
    if (!card)
      return 0;
    const items = await fetchInbox(card);
    let n = 0;
    for (const it of items) {
      const sid = "kf:" + it.id;
      const wasSynced = !!s.syncedIds[sid];
      const hasMedia = Array.isArray(it.media) && it.media.length > 0;
      if (wasSynced && (!hasMedia || this.allMediaFetched(it) || (s.mediaRetry[sid] || 0) >= 8))
        continue;
      const note = {
        id: String(it.id),
        title: it.title || "\u672A\u547D\u540D",
        source: it.source || "",
        type: it.type || "",
        created_at: it.created_at || ""
      };
      if (it.media)
        note.media = it.media;
      let pre = it.content || "";
      const src = String(it.source || "");
      if (src) {
        try {
          if (isYouTube(src)) {
            const y = await fetchYouTube(src);
            if (y) {
              pre = y.body;
              note.title = y.title;
            }
          } else if (isX(src)) {
            const x = await fetchTweet(src);
            if (x) {
              pre = x.body;
              note.title = x.title;
            }
          }
        } catch (e) {
          console.error("NotebookPoint \u7AEF\u6293\u53D6\u5931\u8D25", it.id, e);
        }
      }
      try {
        const mediaOk = await this.writeNote("\u5FAE\u4FE1\u8F6C\u53D1", note, null, pre);
        if (!wasSynced)
          n++;
        s.syncedIds[sid] = true;
        if (mediaOk)
          delete s.mediaRetry[sid];
        else
          s.mediaRetry[sid] = (s.mediaRetry[sid] || 0) + 1;
      } catch (e) {
        console.error("NotebookPoint inbox \u5199\u5165\u5931\u8D25", it.id, e);
      }
    }
    return n;
  }
  // 这条 item 的媒体是否都已"至少成功下过一次"(无媒体视为是)。
  // 一旦下过一次, 之后用户删了图/删了笔记都不再补 —— 靠这个判断"这条不用再处理了"。
  // 兜底:文件已在库里(老用户升级 / 之前下过)→ 就地记为"下过", 避免升级时重写笔记、也让之后的删除生效。
  allMediaFetched(it) {
    const media = it.media;
    if (!media || !media.length)
      return true;
    const fetched = this.settings.fetchedMedia;
    const attachDir = `${this.settings.folder}/${sanitize("\u5FAE\u4FE1\u8F6C\u53D1")}/_\u9644\u4EF6`;
    return media.every((md) => {
      if (fetched[md.id])
        return true;
      if (this.app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(`${attachDir}/${md.id}`))) {
        fetched[md.id] = true;
        return true;
      }
      return false;
    });
  }
  // c 为 null 时表示正文已由 preBody 给好(微信客服 inbox); 否则走 weknora 取正文+兜底。
  // 返回值: 该条的媒体是否都已就位(无媒体=true)。false 表示有图/文件没拉下来, 交由调用方重试。
  async writeNote(kbName, it, c, preBody) {
    let body = preBody || "";
    if (!body && c) {
      try {
        body = await c.getContent(it.id);
      } catch {
      }
      if (!body && it.source && /^https?:/i.test(String(it.source))) {
        body = await backendParse(String(it.source));
      }
      if (!body) {
        try {
          body = pickContent(await c.getKnowledge(it.id));
        } catch {
          body = pickContent(it);
        }
      }
    }
    let mediaOk = true;
    const media = it.media;
    if (media && media.length) {
      const attachDir = `${this.settings.folder}/${sanitize(kbName)}/_\u9644\u4EF6`;
      await this.ensureFolder(attachDir);
      const card = this.settings.license.trim();
      const fetched = this.settings.fetchedMedia;
      let embeds = "";
      let missing = 0;
      for (const md of media) {
        try {
          const apath = (0, import_obsidian.normalizePath)(`${attachDir}/${md.id}`);
          if (!this.app.vault.getAbstractFileByPath(apath)) {
            if (fetched[md.id])
              continue;
            const r = await (0, import_obsidian.requestUrl)({
              url: MEDIA_API + "?card=" + encodeURIComponent(card) + "&id=" + encodeURIComponent(md.id),
              throw: false
            });
            if (r.status === 200 && r.arrayBuffer)
              await this.app.vault.createBinary(apath, r.arrayBuffer);
          }
          if (this.app.vault.getAbstractFileByPath(apath)) {
            fetched[md.id] = true;
            if (md.kind === "image") {
              if (!body.includes(`![[${md.id}]]`))
                embeds += `
![[${md.id}]]
`;
            } else {
              const alias = String(md.name || md.id).replace(/[[\]|]/g, "_");
              embeds += `
[[${md.id}|${alias}]]
`;
            }
          } else {
            missing++;
          }
        } catch (e) {
          missing++;
          console.error("NotebookPoint \u5A92\u4F53\u4E0B\u8F7D\u5931\u8D25", md.id, e);
        }
      }
      if (missing) {
        mediaOk = false;
        embeds += `
> [!warning] \u6709 ${missing} \u5F20\u56FE\u7247/\u6587\u4EF6\u8FD8\u6CA1\u540C\u6B65\u4E0B\u6765
> \u6B63\u5728\u81EA\u52A8\u91CD\u8BD5\u3002\u82E5\u4E00\u76F4\u4E0D\u51FA\u73B0:\u8BF7\u786E\u8BA4\u63D2\u4EF6\u91CC\u7684\u300C\u4ED8\u8D39\u5361\u5BC6\u300D\u5C31\u662F\u4F60\u53D1\u7ED9\u300Cobsidian\u300D\u5BA2\u670D\u6FC0\u6D3B\u7684\u90A3\u5F20,\u518D\u70B9\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u7684\u300C\u8FDE\u63A5\u300D\u3002
`;
      }
      body = (body ? body + "\n" : "") + embeds;
    }
    const path = (0, import_obsidian.normalizePath)(noteRelPath(this.settings.folder, kbName, it));
    await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
    const content = renderNote(kbName, it, body);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian.TFile)
      await this.app.vault.modify(existing, content);
    else
      await this.app.vault.create(path, content);
    return mediaOk;
  }
  async ensureFolder(path) {
    const parts = path.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch {
        }
      }
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var NbpSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const hint = containerEl.createEl("p", { cls: "nbp-hint" });
    hint.setText("\u516C\u4F17\u53F7\u4ED8\u8D39\u540E\u4F1A\u62FF\u5230\u4E00\u5F20\u5361\u5BC6\u3002\u2460 \u628A\u5361\u5BC6\u586B\u5230\u4E0B\u9762;\u2461 \u5728\u5FAE\u4FE1\u91CC\u628A\u540C\u4E00\u5F20\u5361\u5BC6\u53D1\u7ED9\u300C\u7B14\u8BB0\u540C\u6B65\u52A9\u624B\u300D\u5BA2\u670D\u6FC0\u6D3B\u3002\u4E4B\u540E\u4F60\u8F6C\u53D1\u7684\u6587\u7AE0\u3001\u94FE\u63A5\u3001\u8D44\u6599\u5C31\u4F1A\u81EA\u52A8\u540C\u6B65\u8FDB\u4E0B\u9762\u8FD9\u4E2A\u6587\u4EF6\u5939\u3002");
    const licSetting = new import_obsidian.Setting(containerEl).setName("\u4ED8\u8D39\u5361\u5BC6");
    const refreshLic = () => licSetting.setDesc(licenseStatusText(this.plugin.settings.license));
    licSetting.addText((t) => t.setPlaceholder("NBP1.xxxx").setValue(this.plugin.settings.license).onChange(async (v) => {
      this.plugin.settings.license = v.trim();
      await this.plugin.saveSettings();
      refreshLic();
    }));
    refreshLic();
    new import_obsidian.Setting(containerEl).setName("\u540C\u6B65\u5230\u6587\u4EF6\u5939").addText((t) => t.setValue(this.plugin.settings.folder).onChange(async (v) => {
      this.plugin.settings.folder = v.trim() || "NotebookPoint";
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u6253\u5F00 Obsidian \u65F6\u81EA\u52A8\u540C\u6B65").setDesc("\u6BCF\u6B21\u542F\u52A8 Obsidian \u81EA\u52A8\u62C9\u53D6\u4E00\u6B21\u65B0\u5185\u5BB9").addToggle((t) => t.setValue(this.plugin.settings.syncOnStartup).onChange(async (v) => {
      this.plugin.settings.syncOnStartup = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u5B9A\u65F6\u81EA\u52A8\u540C\u6B65").setDesc("Obsidian \u5F00\u7740\u65F6,\u6BCF\u9694\u591A\u5C11\u5206\u949F\u81EA\u52A8\u540C\u6B65\u4E00\u6B21;0 = \u5173\u95ED").addText((t) => t.setValue(String(this.plugin.settings.autoSyncMinutes)).onChange(async (v) => {
      this.plugin.settings.autoSyncMinutes = Math.max(0, parseInt(v) || 0);
      await this.plugin.saveSettings();
      this.plugin.scheduleAuto();
    }));
    new import_obsidian.Setting(containerEl).setName("\u7ACB\u5373\u540C\u6B65").addButton((b) => b.setButtonText("\u540C\u6B65").setCta().onClick(() => this.plugin.sync()));
    new import_obsidian.Setting(containerEl).setName("\u91CD\u7F6E\u540C\u6B65\u8BB0\u5F55").setDesc("\u6E05\u7A7A\u300E\u5DF2\u540C\u6B65\u300F\u6807\u8BB0,\u4E0B\u6B21\u4F1A\u91CD\u65B0\u62C9\u53D6\u5168\u90E8").addButton((b) => b.setButtonText("\u91CD\u7F6E").setWarning().onClick(async () => {
      this.plugin.settings.syncedIds = {};
      await this.plugin.saveSettings();
      new import_obsidian.Notice("\u5DF2\u91CD\u7F6E\u540C\u6B65\u8BB0\u5F55");
    }));
  }
};
