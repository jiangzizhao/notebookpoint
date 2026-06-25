import {
  App, Plugin, PluginSettingTab, Setting, Notice, requestUrl, normalizePath, TFile,
} from "obsidian";
import { WeknoraClient } from "./weknora";
import type { HttpFn, KnowledgeItem } from "./weknora";
import { renderNote, noteRelPath, pickContent } from "./render";
import { verifyLicense, licenseStatusText } from "./license";

interface NbpSettings {
  appid: string;
  secret: string;
  license: string;
  folder: string;
  syncOnStartup: boolean;
  autoSyncMinutes: number;
  syncedIds: Record<string, true>;
  // 卡密激活缓存(避免每次同步都打服务器 + 断网宽限)
  actCard: string;
  actAppid: string;
  actOk: boolean;
  actExp: number;
  actChecked: number;
  // 微信客服自有机器人 inbox(v2: 微信转发 → 你服务器 → 这里);填了 key 才拉
  inboxKey: string;
}

const DEFAULTS: NbpSettings = {
  appid: "", secret: "", license: "",
  folder: "NotebookPoint", syncOnStartup: true, autoSyncMinutes: 1, syncedIds: {},
  actCard: "", actAppid: "", actOk: false, actExp: 0, actChecked: 0,
  inboxKey: "",
};

// 卡密激活: 托管在 Supabase(notbook 项目)。anon/publishable key 是公开的, 可嵌入插件。
const SUPABASE_URL = "https://prrhckcrgpvjynwtifdc.supabase.co";
const SUPABASE_ANON = "sb_publishable_H-JJD4LBn8Kbhef97xft7w_Ktg8vGFK";
const ACT_RECHECK_MS = 24 * 60 * 60 * 1000; // 缓存有效期: 24 小时复查一次

// 用 Obsidian 的 requestUrl 发请求(绕过 CORS),适配成 weknora 客户端要的 HttpFn。
const obsidianHttp: HttpFn = async ({ url, method, headers, body }) => {
  const r = await requestUrl({ url, method, headers, body, throw: false });
  return { status: r.status, text: r.text };
};

// 当 weknora 没解析出正文时(它后端偶尔抽风),让我们自己的服务器去抓原文。
const PARSE_API = "https://api.monoi.cn/nbp/parse";
async function backendParse(url: string): Promise<string> {
  try {
    const r = await requestUrl({ url: PARSE_API + "?url=" + encodeURIComponent(url), throw: false });
    const j = JSON.parse(r.text);
    return j && j.ok ? String(j.content || "") : "";
  } catch { return ""; }
}

// 微信客服自有机器人 inbox: 用户转发给「Obsidian同步助手」的内容已在服务器解析好, 这里直接拉取。
const INBOX_API = "https://api.monoi.cn/nbp/wxkf/items";
interface InboxItem {
  id: string; type?: string; title?: string; source?: string;
  content?: string; created_at?: string;
}
// 凭卡密拉取自己的内容(服务器按卡密绑定的微信号做多用户隔离)。
async function fetchInbox(card: string): Promise<InboxItem[]> {
  try {
    const r = await requestUrl({ url: INBOX_API + "?card=" + encodeURIComponent(card), throw: false });
    if (r.status !== 200) return [];
    const j = JSON.parse(r.text);
    return Array.isArray(j?.items) ? (j.items as InboxItem[]) : [];
  } catch { return []; }
}

// 检查更新: 开机比对服务器版本, 有新版只提示+给下载链接(不下载/不执行远程代码, 符合 Obsidian 商店规范)。
const PLUGIN_VER_API = "https://api.monoi.cn/nbp/plugin/version";
function isNewer(remote: string, cur: string): boolean {
  const pa = remote.split("."), pb = cur.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = parseInt(pa[i] || "0") || 0, db = parseInt(pb[i] || "0") || 0;
    if (da !== db) return da > db;
  }
  return false;
}

export default class NotebookPointPlugin extends Plugin {
  settings!: NbpSettings;
  private timer: number | null = null;

  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("refresh-cw", "NotebookPoint 同步", () => this.sync());
    this.addCommand({ id: "sync-now", name: "立即同步", callback: () => this.sync() });
    this.addSettingTab(new NbpSettingTab(this.app, this));
    this.scheduleAuto();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncOnStartup) window.setTimeout(() => this.sync(true), 3000);
      window.setTimeout(() => this.checkUpdate(), 6000);
    });
  }

  // 检查更新: 只提示有新版 + 给下载链接(不下载/不执行远程代码, 符合商店规范)。
  private async checkUpdate() {
    try {
      const r = await requestUrl({ url: PLUGIN_VER_API, throw: false });
      if (r.status !== 200) return;
      const remote = String(JSON.parse(r.text).version || "");
      if (!remote || !isNewer(remote, this.manifest.version)) return;
      new Notice(`NotebookPoint 有新版 v${remote}。到教程页下载更新:\nhttps://api.monoi.cn/nbp/guide`, 10000);
    } catch (e) {
      console.error("NotebookPoint 检查更新出错", e);
    }
  }

  onunload() {
    if (this.timer) window.clearInterval(this.timer);
  }

  client(): WeknoraClient {
    return new WeknoraClient(this.settings.appid.trim(), this.settings.secret.trim(), obsidianHttp);
  }

  // 向激活服务器确认"这张卡归这个 AppID"。带缓存(24h)+断网宽限。
  // LICENSE_SERVER 为空时直接放行(仅离线卡密阶段)。
  async checkActivation(silent: boolean): Promise<boolean> {
    if (!SUPABASE_URL || !SUPABASE_ANON) return true;
    const s = this.settings;
    const appid = s.appid.trim();
    const now = Date.now();
    const cacheFresh = s.actOk && s.actCard === s.license && s.actAppid === appid
      && now - s.actChecked < ACT_RECHECK_MS
      && (!s.actExp || s.actExp * 1000 > now);
    if (cacheFresh) return true;

    try {
      const r = await requestUrl({
        url: SUPABASE_URL + "/rest/v1/rpc/activate_card",
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON,
          "Authorization": "Bearer " + SUPABASE_ANON,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_card: s.license, p_appid: appid }),
        throw: false,
      });
      const j = JSON.parse(r.text) as { ok: boolean; reason?: string; exp?: number };
      s.actCard = s.license; s.actAppid = appid; s.actOk = !!j.ok;
      s.actExp = j.exp ?? 0; s.actChecked = now;
      await this.saveSettings();
      if (!j.ok && !silent) new Notice("NotebookPoint:" + (j.reason ?? "卡密激活失败"));
      return !!j.ok;
    } catch {
      // 服务器连不上: 若这张卡此前在本机激活过且未过期 → 宽限放行, 不锁付费用户
      if (s.actOk && s.actCard === s.license && s.actAppid === appid && (!s.actExp || s.actExp * 1000 > now)) {
        return true;
      }
      if (!silent) new Notice("NotebookPoint:暂时连不上激活服务器,稍后重试");
      return false;
    }
  }

  scheduleAuto() {
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    const m = this.settings.autoSyncMinutes;
    if (m && m > 0) {
      this.timer = window.setInterval(() => this.sync(true), m * 60 * 1000);
      this.registerInterval(this.timer);
    }
  }

  async sync(silent = false) {
    const s = this.settings;
    const lic = verifyLicense(s.license);
    if (!lic.valid) {
      if (!silent) new Notice("NotebookPoint:" + (lic.reason ?? "卡密无效") + ",请在设置里填入有效付费卡密");
      return;
    }
    if (!silent) new Notice("NotebookPoint:开始同步…");
    let created = 0;
    // 你在微信里转发给客服 → 你服务器解析入库 → 这里凭卡密只拉自己的, 写成笔记
    try { created += await this.syncInbox(); }
    catch (e) { console.error("NotebookPoint 同步出错", e); }
    await this.saveSettings();
    if (!silent || created > 0) {
      new Notice(`NotebookPoint:同步完成,新增 ${created} 条`);
    }
  }

  // 拉取微信客服 inbox(自有机器人), 写成笔记。正文服务器已解析好, 直接用。
  private async syncInbox(): Promise<number> {
    const s = this.settings;
    const card = s.license.trim();
    if (!card) return 0;
    const items = await fetchInbox(card);
    let n = 0;
    for (const it of items) {
      const sid = "kf:" + it.id;
      if (s.syncedIds[sid]) continue;
      const note: KnowledgeItem = {
        id: String(it.id),
        title: it.title || "未命名",
        source: it.source || "",
        type: it.type || "",
        created_at: it.created_at || "",
      };
      try {
        await this.writeNote("微信转发", note, null, it.content || "");
        s.syncedIds[sid] = true;
        n++;
      } catch (e) {
        console.error("NotebookPoint inbox 写入失败", it.id, e);
      }
    }
    return n;
  }

  // c 为 null 时表示正文已由 preBody 给好(微信客服 inbox); 否则走 weknora 取正文+兜底。
  private async writeNote(kbName: string, it: KnowledgeItem, c: WeknoraClient | null, preBody?: string) {
    let body = preBody || "";
    if (!body && c) {
      try { body = await c.getContent(it.id); } catch { /* 下面兜底 */ }
      // weknora 没抓到正文 → 用我们自己服务器抓原文(绕开 weknora 抽风)
      if (!body && it.source && /^https?:/i.test(String(it.source))) {
        body = await backendParse(String(it.source));
      }
      if (!body) {
        try { body = pickContent(await c.getKnowledge(it.id)); }
        catch { body = pickContent(it); }
      }
    }

    const path = normalizePath(noteRelPath(this.settings.folder, kbName, it));
    await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
    const content = renderNote(kbName, it, body);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(path, content);
  }

  private async ensureFolder(path: string) {
    const parts = path.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch { /* 已存在 */ }
      }
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class NbpSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NotebookPointPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "NotebookPoint 设置" });

    const hint = containerEl.createEl("p", { cls: "nbp-hint" });
    hint.setText("公众号付费后会拿到一张卡密。① 把卡密填到下面;② 在微信里把同一张卡密发给「笔记同步助手」客服激活。之后你转发的文章、链接、资料就会自动同步进下面这个文件夹。");

    const licSetting = new Setting(containerEl).setName("付费卡密");
    const refreshLic = () => licSetting.setDesc(licenseStatusText(this.plugin.settings.license));
    licSetting.addText((t) => t.setPlaceholder("NBP1.xxxx")
      .setValue(this.plugin.settings.license)
      .onChange(async (v) => { this.plugin.settings.license = v.trim(); await this.plugin.saveSettings(); refreshLic(); }));
    refreshLic();

    new Setting(containerEl)
      .setName("同步到文件夹")
      .addText((t) => t.setValue(this.plugin.settings.folder)
        .onChange(async (v) => { this.plugin.settings.folder = v.trim() || "NotebookPoint"; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("打开 Obsidian 时自动同步")
      .setDesc("每次启动 Obsidian 自动拉取一次新内容")
      .addToggle((t) => t.setValue(this.plugin.settings.syncOnStartup)
        .onChange(async (v) => { this.plugin.settings.syncOnStartup = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("定时自动同步")
      .setDesc("Obsidian 开着时,每隔多少分钟自动同步一次;0 = 关闭")
      .addText((t) => t.setValue(String(this.plugin.settings.autoSyncMinutes))
        .onChange(async (v) => {
          this.plugin.settings.autoSyncMinutes = Math.max(0, parseInt(v) || 0);
          await this.plugin.saveSettings();
          this.plugin.scheduleAuto();
        }));

    new Setting(containerEl)
      .setName("立即同步")
      .addButton((b) => b.setButtonText("同步").setCta().onClick(() => this.plugin.sync()));

    new Setting(containerEl)
      .setName("重置同步记录")
      .setDesc("清空『已同步』标记,下次会重新拉取全部")
      .addButton((b) => b.setButtonText("重置").setWarning().onClick(async () => {
        this.plugin.settings.syncedIds = {};
        await this.plugin.saveSettings();
        new Notice("已重置同步记录");
      }));
  }
}
