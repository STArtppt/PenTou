# Privacy Policy — Pentou Collector (Chrome Extension)

**Last updated:** 2026-07-27  
**Product:** Pentou Collector (browser extension) and the local Pentou application it writes to  
**Publisher:** STArtppt / PenTou project  
**Contact:** Open an issue at [https://github.com/STArtppt/PenTou](https://github.com/STArtppt/PenTou)

This policy describes how **Pentou Collector** (“the Extension”) handles data when you install and use it from the Chrome Web Store (or as an unpacked extension). It is written for end users and for Chrome Web Store privacy review.

> **Summary:** The Extension captures AI chat content only from supported sites you open while logged in, and sends that content **only** to the **Pentou server URL you configure** (typically a service on your own computer). We do **not** operate a cloud backend that receives your chats. We do **not** sell your data.

---

## 1. Who we are

Pentou is a **local-first** AI conversation manager. You run Pentou on your own machine (or your own private deployment). The Extension is a thin “collector”: it fetches conversation JSON from supported AI websites using your existing browser session and posts it to your configured Pentou ingest API.

This privacy policy is maintained in the public repository:  
[https://github.com/STArtppt/PenTou](https://github.com/STArtppt/PenTou)

---

## 2. What the Extension does (single purpose)

The Extension’s single purpose is:

**Capture AI conversations from supported chat websites and send them to the user-configured local (or self-hosted) Pentou server via `/api/ingest`.**

Supported platforms in the current release include:

- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- DeepSeek (`chat.deepseek.com`)

Optional features that serve the **same** purpose:

- Per-platform **auto-collect** (default **off**)
- **Offline queue** when your Pentou server is temporarily unreachable
- Toolbar badge / optional notifications for capture feedback

The Extension does **not** provide advertising, general web scraping, or unrelated browsing features.

---

## 3. Data the Extension handles

### 3.1 Data we process for capture

When you trigger a capture (manually via the toolbar icon, or automatically if you enabled auto-collect for a platform), the Extension may process:

| Data | Source | Purpose |
| --- | --- | --- |
| Conversation payload (raw JSON from the platform API, including messages you and the model wrote) | Supported AI site, via that site’s own API while you are logged in | Send to your Pentou instance so the chat can be stored and managed locally |
| Active tab URL / tab id | Browser | Decide whether the page is a supported conversation page; route capture to the correct tab |
| Capture result metadata | Extension + your Pentou response | Show badge / notification (e.g. new / updated / skipped / error) |

The Extension does **not** ask for or store your ChatGPT or DeepSeek **passwords**. It uses the **session you already have** in the browser (cookies / page storage as required by each platform adapter) only to call that platform’s conversation API for the open chat.

### 3.2 Settings you enter (stored in the browser)

Stored in Chrome **`chrome.storage.local`** on your device:

| Data | Purpose |
| --- | --- |
| Pentou server base URL | Where to POST captures and run connection tests (e.g. `http://localhost:5173`) |
| Ingest token | Authenticate write requests to your Pentou `/api/ingest` endpoint |
| Per-platform enable / auto-collect switches | Control which sites may be collected and whether auto-collect is on |
| Offline queue of pending capture payloads | Retry later if Pentou was unreachable |

We do **not** use Chrome sync storage to back up your chats to Google’s cloud for this feature.

### 3.3 Data we do **not** collect for ourselves

The Extension developers **do not** receive:

- Your conversation contents
- Your ingest token
- Your browsing history outside the capture flow described above
- Analytics or advertising identifiers from the Extension for marketing

There is **no** developer-operated telemetry backend required for the Extension to work.

---

## 4. Where data is sent

### 4.1 Your configured Pentou server (intended destination)

Captured payloads are sent **only** to the base URL **you** set in the Extension Options page, using:

- `POST …/api/ingest` — write captures  
- `GET` or equivalent ping to `…/api/ingest/ping` — “Test connection”

Typical addresses are on your own machine:

- `http://localhost:…`
- `http://127.0.0.1:…`

If you deliberately configure a **self-hosted** Pentou on another host you control, traffic goes there instead. That host is still **chosen by you**, not by a fixed developer cloud.

**We do not transmit conversation data to the Extension authors’ servers.**

### 4.2 Supported AI platforms (source of the chat)

To obtain the open conversation, the Extension contacts only the platform hosts declared in `host_permissions` (e.g. ChatGPT / DeepSeek), using each site’s own APIs as a logged-in user would. This is a **read** of the conversation you are already using, for the purpose of local archival in Pentou—not a transfer to a third-party analytics vendor.

### 4.3 Remote code

The Extension **does not use remote code**. All extension logic ships inside the package (service worker, content scripts, options page). It does not download and execute scripts from the network.

---

## 5. Permissions (why they exist)

| Permission | Why |
| --- | --- |
| `activeTab` | Temporary access to the active tab when you click the toolbar icon for manual capture |
| `tabs` | Read active tab URL/id to detect supported conversation pages |
| `scripting` | Inject the content script if the page was open before the Extension loaded/reloaded |
| `storage` | Save Options settings and the offline retry queue |
| `alarms` | Periodically flush the offline queue (~every 5 minutes) |
| `notifications` | Optional desktop notifications for **manual** capture results (auto-collect uses badge only) |
| Host: ChatGPT / DeepSeek | Content script + fetch conversation API on those sites |
| Host: `localhost` / `127.0.0.1` | Talk to your local Pentou ingest API |

Host access is **not** `<all_urls>`.

---

## 6. Offline queue

If your Pentou server is unreachable at capture time, the Extension may store the raw capture payload in **`chrome.storage.local`** (bounded queue, oldest items may be dropped when full) and retry later via `alarms`. Those payloads leave the browser only when successfully posted to **your** configured Pentou URL (or when discarded as permanently invalid after a server-side parse error, with user-facing feedback where applicable).

---

## 7. Auto-collect

Auto-collect is **off by default**. It only runs if you enable it for a given platform in Options. When enabled, it may capture after idle / tab hide / close under the same data rules as manual capture. Token rejection (401) pauses auto-collect until you update settings.

---

## 8. Data retention and deletion

| Location | Retention | How to delete |
| --- | --- | --- |
| Extension `chrome.storage.local` | Until you clear it, reset the Extension, or uninstall | Chrome → Extensions → Pentou Collector → clear data / Remove; or overwrite settings in Options |
| Offline queue | Until flushed, dropped when full, or cleared by successful retry / user action | Same as above; or restore Pentou and wait for flush |
| Your Pentou data directory / database | Controlled by **your** Pentou instance and OS files | Delete conversations in the Pentou UI or remove local data files per Pentou docs |

Uninstalling the Extension removes Extension storage managed by Chrome. It does **not** automatically delete conversations already saved inside your Pentou data folder—you manage that in Pentou.

You may **reset the ingest token** in Pentou settings; old tokens stop working immediately. Update the Extension Options with the new token if you continue collecting.

---

## 9. Children

The Extension is not directed at children under 13 (or the minimum age required in your jurisdiction). Do not use it to collect data from children in a way that violates applicable law.

---

## 10. Changes to this policy

We may update this file when the Extension’s data practices change (new platforms, new permissions, new destinations). The **Last updated** date at the top will change. Material changes should be reflected in the Chrome Web Store privacy disclosures as well.

---

## 11. Contact

Questions about this policy or the Extension’s data handling:

- GitHub Issues: [https://github.com/STArtppt/PenTou/issues](https://github.com/STArtppt/PenTou/issues)
- Repository: [https://github.com/STArtppt/PenTou](https://github.com/STArtppt/PenTou)

---

## 12. 中文摘要（同等效力的简明说明）

**Pentou Collector** 是一款浏览器扩展，用于将你在受支持 AI 网站（当前包括 ChatGPT、DeepSeek）上**已登录**状态下打开的对话，采集并发送到**你在选项页自行配置的 Pentou 服务地址**（通常是本机 `localhost` / `127.0.0.1` 上的 Pentou）。

- **我们（扩展作者）不会**接收你的对话内容，也**没有**用于收集聊天记录的作者云端后端。  
- 扩展会在浏览器本地（`chrome.storage.local`）保存：服务地址、采集令牌、平台开关，以及 Pentou 暂时不可达时的**离线队列**。  
- **自动采集默认关闭**；仅在你按平台手动开启后才会静默采集。  
- **不使用远程代码**；逻辑均在扩展安装包内。  
- 卸载扩展或清除扩展数据可删除浏览器内存储；**已写入你本机 Pentou 目录的数据**需在 Pentou 中自行管理或删除。  
- 完整说明以本文英文各节为准；行为变更时会更新文首日期。

Chrome Web Store 填写隐私政策 URL 时，请使用本文档的稳定链接，例如：

```text
https://github.com/STArtppt/PenTou/blob/main/PRIVACY.md
```
