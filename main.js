/* jii-panel — Obsidian plugin (no build step, plain JS)
 * Jii (GM) front door: request help, send notes into the system,
 * team status, and secure token intake.
 * Transport: POST JSON to hqWebhookIngest (Firebase) -> webhookInbox
 * -> VM hq-core -> Jii GM channel. Tokens/values are NEVER stored in notes.
 */
"use strict";

const { Plugin, PluginSettingTab, Setting, ItemView, Modal, Notice, requestUrl } = require("obsidian");

const VIEW_TYPE_JII_PANEL = "jii-panel-view";
const DEFAULT_SETTINGS = {
  ingestUrl: "https://asia-southeast1-chincha-eeed6.cloudfunctions.net/hqWebhookIngest",
  ingestToken: "",
  statusUrl: "https://asia-southeast1-chincha-eeed6.cloudfunctions.net/proxyToVm/api/health",
  hubFolder: "Jii Hub",
};

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- Modal: พูดกับจี้ ---------- */
class TalkToJiiModal extends Modal {
  constructor(plugin, onSend) {
    super(plugin.app);
    this.plugin = plugin;
    this.onSend = onSend;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "พูดกับจี้ 💬" });
    contentEl.createEl("p", { text: "เล่าสิ่งที่อยากให้จี้ช่วย — จี้จะได้รับในแชท GM ทันที" });
    const ta = contentEl.createEl("textarea", {
      attr: { rows: 5, style: "width:100%", placeholder: "เช่น ช่วยตรวจสต๊อกร้านชาวเรือน วันนี้ยอดต่ำผิดปกติ..." },
    });
    const row = contentEl.createDiv({ cls: "modal-button-container", attr: { style: "margin-top:10px;text-align:right" } });
    const cancel = row.createEl("button", { text: "ยกเลิก" });
    cancel.onclick = () => this.close();
    const send = row.createEl("button", { text: "ส่งถึงจี้", cls: "mod-cta" });
    send.onclick = async () => {
      const text = ta.value.trim();
      if (!text) { new Notice("ยังไม่ได้พิมพ์อะไรเลย"); return; }
      const leaf = this.plugin.app.workspace.activeLeaf;
      const notePath = leaf && leaf.view && leaf.view.file ? leaf.view.file.path : null;
      this.close();
      await this.onSend(text, notePath);
    };
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- Modal: เพิ่ม token ใหม่ ---------- */
class TokenIntakeModal extends Modal {
  constructor(plugin, onSend) {
    super(plugin.app);
    this.plugin = plugin;
    this.onSend = onSend;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "เพิ่ม token ใหม่ 🔐" });
    const warn = contentEl.createEl("p", { text: "ค่า token จะถูกส่งตรงเข้าตู้เซฟของจี้ (VM) ทันที และไม่ถูกบันทึกไว้ในโน้ตหรือ vault ของพี่", attr: { style: "color:var(--text-warning);font-size:0.9em" } });
    warn.style.whiteSpace = "normal";
    const nameField = new Setting(contentEl).setName("ชื่อ (UPPER_SNAKE เช่น GH_TOKEN_RENO)").addText((t) => { t.setPlaceholder("MY_NEW_TOKEN"); this.nameInput = t; });
    const valField = new Setting(contentEl).setName("ค่า token").addText((t) => { t.inputEl.type = "password"; t.setPlaceholder("วาง token ที่นี่"); this.valInput = t; });
    const row = contentEl.createDiv({ cls: "modal-button-container", attr: { style: "margin-top:10px;text-align:right" } });
    const cancel = row.createEl("button", { text: "ยกเลิก" });
    cancel.onclick = () => this.close();
    const send = row.createEl("button", { text: "ส่งเข้าตู้เซฟ", cls: "mod-warning" });
    send.onclick = async () => {
      const name = this.nameInput.getValue().trim().toUpperCase();
      const value = this.valInput.getValue().trim();
      if (!/^[A-Z0-9_]{3,}$/.test(name)) { new Notice("ชื่อต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข/ขีดล่าง อย่างน้อย 3 ตัว"); return; }
      if (!value) { new Notice("ยังไม่ได้ใส่ค่า token"); return; }
      this.nameInput.setValue(""); this.valInput.setValue("");
      this.close();
      await this.onSend(name, value);
    };
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- Modal: ยืนยันก่อนทำ (confirm) ---------- */
class ConfirmModal extends Modal {
  constructor(plugin, message, onYes) {
    super(plugin.app);
    this.plugin = plugin;
    this.message = message;
    this.onYes = onYes;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "ยืนยันก่อนนะคะ" });
    const p = contentEl.createEl("p", { text: this.message });
    p.style.whiteSpace = "pre-wrap";
    const row = contentEl.createDiv({ cls: "modal-button-container", attr: { style: "margin-top:10px;text-align:right" } });
    const no = row.createEl("button", { text: "ยกเลิก" });
    no.onclick = () => this.close();
    const yes = row.createEl("button", { text: "ยืนยัน", cls: "mod-warning" });
    yes.onclick = () => { this.close(); this.onYes(); };
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- แผงหลัก ---------- */
class JiiPanelView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE_JII_PANEL; }
  getDisplayText() { return "Jii Panel"; }
  getIcon() { return "user-round-cog"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.createEl("h3", { text: "Jii Panel — ประตูหน้าบ้าน 🎛️" });
    root.createEl("p", { text: "ปุ่มเดียวจบ: ขอความช่วยเหลือ ส่งโน้ต เช็คสถานะ และฝาก token เข้าตู้เซฟ", attr: { style: "color:var(--text-muted);font-size:0.9em" } });
    const log = root.createEl("div", { attr: { style: "font-size:0.85em;color:var(--text-muted);margin:8px 0;white-space:pre-wrap;max-height:120px;overflow:auto" } });

    const btn = (label, cls, fn) => {
      const b = root.createEl("button", { text: label, cls, attr: { style: "display:block;width:100%;margin:6px 0;padding:10px" } });
      b.onclick = fn;
      return b;
    };
    const setStatus = (s) => { log.textContent = `[${ts()}] ${s}` + (log.textContent ? "\n" + log.textContent : ""); };

    btn("พูดกับจี้ 💬", "mod-cta", () => {
      new TalkToJiiModal(this.plugin, async (text, notePath) => {
        setStatus("กำลังส่งข้อความถึงจี้...");
        try {
          await this.plugin.sendEvent("jii_request", { text, notePath });
          setStatus("ส่งถึงจี้แล้ว ✅ — รอจี้ตอบในแชท");
        } catch (e) { setStatus("ส่งไม่สำเร็จ ❌ " + e.message); }
      }).open();
    });

    btn("ส่งโน้ตปัจจุบันเข้าระบบ 📄", "", async () => {
      const file = this.plugin.app.workspace.getActiveFile();
      if (!file) { setStatus("ยังไม่มีโน้ตที่เปิดอยู่"); return; }
      setStatus("กำลังส่งโน้ต " + file.path + "...");
      try {
        const content = await this.plugin.app.vault.read(file);
        await this.plugin.sendEvent("note_drop", { path: file.path, content });
        setStatus("ส่งโน้ตเข้าระบบแล้ว ✅ — จี้จะจัดเก็บให้");
      } catch (e) { setStatus("ส่งไม่สำเร็จ ❌ " + e.message); }
    });

    btn("เพิ่ม token ใหม่ 🔐", "", () => {
      new TokenIntakeModal(this.plugin, async (name, value) => {
        setStatus("กำลังฝาก token " + name + " เข้าตู้เซฟ...");
        try {
          await this.plugin.sendEvent("secret_intake", { name, value, note: "store in VM /etc/jii via jii_secrets.py; never persist value in vault; confirm by name+status only" });
          setStatus("ฝาก token แล้ว ✅ — จี้จะเก็บเข้า VM และรายงานสถานะเป็นชื่อเท่านั้น");
        } catch (e) { setStatus("ส่งไม่สำเร็จ ❌ " + e.message); }
      }).open();
    });

    btn("สถานะทีมแบบ live 📡", "mod-cta", async () => {
      setStatus("กำลังถามสถานะจากระบบกลาง...");
      try {
        const res = await requestUrl({ url: this.plugin.settings.statusUrl, method: "GET" });
        const d = res.json;
        setStatus(`VM ${d.service} ${d.status} ✅ · เลน ${d.lanes.join(",")} · ws ${d.ws ? "ok" : "x"} · firestore ${d.firestore ? "ok" : "x"} · ${d.ts}`);
      } catch (e) { setStatus("ตรวจสถานะไม่สำเร็จ ❌ " + e.message); }
    });

    btn("ส่งขึ้น Google Drive ☁️ (กดส่งเอง)", "", async () => {
      new ConfirmModal(this.plugin, "ส่ง vault ขึ้น Google Drive ตอนนี้เลยไหม?\n(กฎของเรา: ไหลขึ้นเมื่อพี่กดส่งเองเท่านั้น — จี้จะรัน push ให้ทันทีที่เห็น)", async () => {
        setStatus("ส่งคำขอ push ขึ้น Drive ให้จี้แล้ว — จี้จะรันและรายงานกลับ");
        try {
          await this.plugin.sendEvent("push_to_drive", { ordered_by: "peach_panel_button" });
        } catch (e) { setStatus("ส่งไม่สำเร็จ ❌ " + e.message); }
      }).open();
    });

    btn("เปิดหมายเหตุทีม (Team Notes) 📋", "", async () => {
      const folder = this.plugin.settings.hubFolder || "Jii Hub";
      const path = `${folder}/Team Status.md`;
      let f = this.plugin.app.vault.getAbstractFileByPath(path);
      if (!f) {
        await this.plugin.app.vault.createFolder(folder).catch(() => {});
        f = await this.plugin.app.vault.create(path, "# Team Status\n\n(จี้จะอัปเดตสถานะงานทีมไว้ที่โน้ตนี้)\n");
      }
      await this.plugin.app.workspace.getLeaf("tab").openFile(f);
    });

    root.createEl("hr");
    root.createEl("p", { text: "ตั้งค่า: ตั้งค่า → Jii Panel (URL ของระบบกลาง)", attr: { style: "font-size:0.8em;color:var(--text-faint)" } });
  }

  async onClose() { this.contentEl.empty(); }
}

/* ---------- Settings ---------- */
class JiiPanelSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Jii Panel — การเชื่อมต่อ").setHeading();
    new Setting(containerEl)
      .setName("Ingest URL")
      .setDesc("ที่อยู่ระบบกลาง (hqWebhookIngest) — แตะไว้ให้จี้ตั้งค่า อย่าแก้เอง")
      .addText((t) => { t.setValue(this.plugin.settings.ingestUrl).onChange(async (v) => { this.plugin.settings.ingestUrl = v.trim(); await this.plugin.saveSettings(); }); });
    new Setting(containerEl)
      .setName("Ingest Token (ถ้ามี)")
      .setDesc("ใช้เมื่อระบบกลางเปิดโหมดต้องพิสูจน์ตัวตน — เว้นว่างไว้ถ้ายังไม่ได้ตั้ง")
      .addText((t) => { t.inputEl.type = "password"; t.setValue(this.plugin.settings.ingestToken).onChange(async (v) => { this.plugin.settings.ingestToken = v.trim(); await this.plugin.saveSettings(); }); });
    new Setting(containerEl)
      .setName("Status URL (สถานะ live)")
      .setDesc("ที่อยู่ตรวจสุขภาพระบบกลาง — แตะไว้ให้จี้ตั้งค่า")
      .addText((t) => { t.setValue(this.plugin.settings.statusUrl).onChange(async (v) => { this.plugin.settings.statusUrl = v.trim(); await this.plugin.saveSettings(); }); });
    new Setting(containerEl)
      .setName("โฟลเดอร์หน้าบ้าน")
      .setDesc("โฟลเดอร์ใน vault สำหรับหมายเหตุทีม")
      .addText((t) => { t.setValue(this.plugin.settings.hubFolder).onChange(async (v) => { this.plugin.settings.hubFolder = v.trim() || "Jii Hub"; await this.plugin.saveSettings(); }); });
  }
}

/* ---------- Plugin ---------- */
module.exports = class JiiPanelPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new JiiPanelSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_JII_PANEL, (leaf) => new JiiPanelView(leaf, this));

    this.addRibbonIcon("user-round-cog", "เปิด Jii Panel", () => this.activateView());
    this.addCommand({ id: "open-panel", name: "เปิด Jii Panel", callback: () => this.activateView() });

    this.app.workspace.onLayoutReady(() => { /* nothing async to preload */ });
  }

  onunload() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_JII_PANEL)) leaf.detach();
  }

  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_JII_PANEL);
    if (existing.length) { workspace.revealLeaf(existing[0]); return; }
    const leaf = workspace.getRightLeaf(false) || workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_JII_PANEL, active: true });
    workspace.revealLeaf(leaf);
  }

  async sendEvent(event, data) {
    const body = {
      source: "obsidian-jii-panel",
      event,
      channel: "jii",
      data,
    };
    const headers = { "Content-Type": "application/json" };
    if (this.settings.ingestToken) headers["Authorization"] = "Bearer " + this.settings.ingestToken;
    const res = await requestUrl({
      url: this.settings.ingestUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status >= 300) throw new Error("HTTP " + res.status);
    return res.json;
  }

  async saveSettings() { await this.saveData(this.settings); }
};