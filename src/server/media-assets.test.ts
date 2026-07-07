/**
 * media-assets 单元测试（spec media-assets §6.1）。
 * 覆盖：data URI 落盘 / 内容寻址去重 / 幂等 / AST 替换边界（决策 8）/
 * baseDir 契约（边界 6）/ SSRF 防护（边界 3）/ 远程下载 mock / 扩展名判定（边界 7）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  localizeMedia,
  localizeMessages,
  setAssetsDataDir,
  ensureAssetsDir,
  saveAssetBuffer,
  isForbiddenIp,
  resolveAssetExt,
  __setHttpGetForTests,
  __setDnsLookupForTests,
} from "./media-assets";

// 1×1 像素 PNG / GIF
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF_B64 = "R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=";
const PNG_BUF = Buffer.from(PNG_B64, "base64");

const PUBLIC_IP = [{ address: "93.184.216.34", family: 4 }];

let dataDir: string;

function assetFiles(): string[] {
  const dir = path.join(dataDir, "assets");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(tmpdir(), "pentou-media-assets-"));
  ensureAssetsDir(dataDir);
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  __setHttpGetForTests(null);
  __setDnsLookupForTests(null);
});

describe("data URI 落盘（US-02）", () => {
  it("解码落盘并替换为 /api/assets 引用，保留周边文本", async () => {
    const md = `before\n\n![logo](data:image/png;base64,${PNG_B64})\n\nafter`;
    const out = await localizeMedia(md);
    expect(out).toMatch(/!\[logo\]\(\/api\/assets\/[0-9a-f]{16}\.png\)/);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(assetFiles()).toHaveLength(1);
  });

  it("相同字节内容只落一份（内容寻址去重，US-02 AC2）", async () => {
    const a = await localizeMedia(`![a](data:image/png;base64,${PNG_B64})`);
    const b = await localizeMedia(`![b](data:image/png;base64,${PNG_B64})`);
    expect(assetFiles()).toHaveLength(1);
    expect(a.match(/\/api\/assets\/\S+\)/)?.[0]).toBe(b.match(/\/api\/assets\/\S+\)/)?.[0]);
  });

  it("已是 /api/assets/ 引用时幂等（边界 1）", async () => {
    const once = await localizeMedia(`![x](data:image/png;base64,${PNG_B64})`);
    const twice = await localizeMedia(once);
    expect(twice).toBe(once);
  });

  it("超大 data URI（解码后 > 20MB）保留原样，入库不失败（US-02 AC3）", async () => {
    const huge = Buffer.alloc(21 * 1024 * 1024).toString("base64");
    const md = `![big](data:image/png;base64,${huge})`;
    expect(await localizeMedia(md)).toBe(md);
    expect(assetFiles()).toHaveLength(0);
  });

  it("畸形 / 未知格式 / SVG data URI 保留原样（决策 10）", async () => {
    const cases = [
      "![x](data:image/png;base64,@@@@)",
      "![x](data:application/pdf;base64,JVBERi0=)",
      `![x](data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")})`,
    ];
    for (const md of cases) {
      expect(await localizeMedia(md)).toBe(md);
    }
    expect(assetFiles()).toHaveLength(0);
  });
});

describe("AST 替换边界（决策 8）", () => {
  it("围栏代码块与行内代码中的图片语法不被替换", async () => {
    const md = [
      "```",
      `![code](data:image/png;base64,${PNG_B64})`,
      "```",
      "",
      `inline \`![inline](data:image/png;base64,${PNG_B64})\` end`,
    ].join("\n");
    expect(await localizeMedia(md)).toBe(md);
    expect(assetFiles()).toHaveLength(0);
  });

  it("frontmatter 与 HTML <img> 原样保留", async () => {
    const md = [
      "---",
      `cover: ![fm](data:image/png;base64,${PNG_B64})`,
      "---",
      "",
      `<img src="data:image/png;base64,${PNG_B64}">`,
    ].join("\n");
    expect(await localizeMedia(md)).toBe(md);
    expect(assetFiles()).toHaveLength(0);
  });

  it("GFM 表格内的 image 节点正常处理", async () => {
    const md = `| col |\n| --- |\n| ![t](data:image/png;base64,${PNG_B64}) |`;
    const out = await localizeMedia(md);
    expect(out).toMatch(/\/api\/assets\/[0-9a-f]{16}\.png/);
  });
});

describe("baseDir 契约（边界 6 / US-02 AC4）", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(tmpdir(), "pentou-basedir-"));
    fs.mkdirSync(path.join(baseDir, "images"));
    fs.writeFileSync(path.join(baseDir, "images", "a.png"), PNG_BUF);
    fs.writeFileSync(path.join(path.dirname(baseDir), "escape.png"), PNG_BUF);
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(baseDir), "escape.png"), { force: true });
  });

  it("baseDir 内相对路径引用读取落盘", async () => {
    const out = await localizeMedia("![p](images/a.png)", { baseDir });
    expect(out).toMatch(/!\[p\]\(\/api\/assets\/[0-9a-f]{16}\.png\)/);
  });

  it("../ 越界与绝对路径引用保留原样不读取", async () => {
    const escape = "![p](../escape.png)";
    const absolute = `![p](${path.join(path.dirname(baseDir), "escape.png")})`;
    expect(await localizeMedia(escape, { baseDir })).toBe(escape);
    expect(await localizeMedia(absolute, { baseDir })).toBe(absolute);
    expect(assetFiles()).toHaveLength(0);
  });

  it("未传 baseDir 时相对路径一律不处理", async () => {
    const md = "![p](images/a.png)";
    expect(await localizeMedia(md)).toBe(md);
  });
});

describe("SSRF 防护（边界 3）", () => {
  it("isForbiddenIp 覆盖内网 / 环回 / 链路本地 / 保留 / 组播 / 未指定地址段", () => {
    const forbidden = [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
      "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:192.168.0.1",
    ];
    for (const ip of forbidden) expect(isForbiddenIp(ip), ip).toBe(true);

    const allowed = ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"];
    for (const ip of allowed) expect(isForbiddenIp(ip), ip).toBe(false);
  });

  it("直连内网 IP / localhost 的远程图片拒绝下载，引用保留，零网络请求", async () => {
    const transport = vi.fn();
    __setHttpGetForTests(transport);
    __setDnsLookupForTests(async () => [{ address: "127.0.0.1", family: 4 }]);

    const cases = [
      "![x](http://127.0.0.1/a.png)",
      "![x](http://10.0.0.1/a.png)",
      "![x](http://192.168.1.5/a.png)",
      "![x](http://169.254.169.254/latest/meta-data.png)",
      "![x](http://[::1]/a.png)",
      "![x](http://0.0.0.0/a.png)",
      "![x](http://localhost/a.png)", // DNS 解析到 127.0.0.1 后拒绝
    ];
    for (const md of cases) {
      expect(await localizeMedia(md, { downloadRemote: true }), md).toBe(md);
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("重定向跳转至内网地址拒绝（逐跳校验）", async () => {
    __setDnsLookupForTests(async () => PUBLIC_IP);
    const transport = vi.fn(async () => ({
      statusCode: 302,
      headers: { location: "http://127.0.0.1/internal.png" },
      body: Buffer.alloc(0),
    }));
    __setHttpGetForTests(transport);

    const md = "![x](https://example.com/a.png)";
    expect(await localizeMedia(md, { downloadRemote: true })).toBe(md);
    expect(transport).toHaveBeenCalledTimes(1); // 第二跳在校验阶段被拒绝
  });

  it("非 http/https 协议拒绝", async () => {
    const transport = vi.fn();
    __setHttpGetForTests(transport);
    const md = "![x](ftp://example.com/a.png)";
    expect(await localizeMedia(md, { downloadRemote: true })).toBe(md);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("远程下载（US-03 / 决策 9）", () => {
  beforeEach(() => {
    __setDnsLookupForTests(async () => PUBLIC_IP);
  });

  it("下载成功落盘并替换引用", async () => {
    const transport = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "image/png" },
      body: PNG_BUF,
    }));
    __setHttpGetForTests(transport);

    const out = await localizeMedia("![r](https://example.com/pic)", { downloadRemote: true });
    expect(out).toMatch(/!\[r\]\(\/api\/assets\/[0-9a-f]{16}\.png\)/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("同一 URL 同批出现多次只下载一次（US-03 AC3）", async () => {
    const transport = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "image/png" },
      body: PNG_BUF,
    }));
    __setHttpGetForTests(transport);

    const md = "![a](https://example.com/pic)\n\n![b](https://example.com/pic)";
    const out = await localizeMedia(md, { downloadRemote: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(out.match(/\/api\/assets\//g)).toHaveLength(2);
  });

  it("localizeMessages 共享同批 urlCache，跨消息同 URL 只下载一次", async () => {
    const transport = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "image/png" },
      body: PNG_BUF,
    }));
    __setHttpGetForTests(transport);

    const messages = [
      { content: "![a](https://example.com/pic)" },
      { content: "![b](https://example.com/pic)" },
    ];
    await localizeMessages(messages, { downloadRemote: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(messages[0].content).toMatch(/\/api\/assets\//);
    expect(messages[1].content).toMatch(/\/api\/assets\//);
  });

  it("下载失败（4xx/5xx/超时）保留原 URL，不中断（US-03 AC2）", async () => {
    const cases: Array<() => Promise<any>> = [
      async () => ({ statusCode: 404, headers: {}, body: Buffer.alloc(0) }),
      async () => ({ statusCode: 500, headers: {}, body: Buffer.alloc(0) }),
      async () => { throw new Error("Download timed out"); },
    ];
    for (const impl of cases) {
      __setHttpGetForTests(vi.fn(impl));
      const md = "![x](https://example.com/a.png)";
      expect(await localizeMedia(md, { downloadRemote: true })).toBe(md);
    }
  });

  it("非 image/* 响应放弃本地化", async () => {
    __setHttpGetForTests(vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html></html>"),
    })));
    const md = "![x](https://example.com/a.png)";
    expect(await localizeMedia(md, { downloadRemote: true })).toBe(md);
  });

  it("重定向跟随成功（上限内），超限放弃", async () => {
    let calls = 0;
    __setHttpGetForTests(vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return { statusCode: 302, headers: { location: "https://example.com/real.png" }, body: Buffer.alloc(0) };
      }
      return { statusCode: 200, headers: { "content-type": "image/png" }, body: PNG_BUF };
    }));
    const ok = await localizeMedia("![x](https://example.com/a)", { downloadRemote: true });
    expect(ok).toMatch(/\/api\/assets\//);

    __setHttpGetForTests(vi.fn(async () => ({
      statusCode: 302,
      headers: { location: "https://example.com/loop" },
      body: Buffer.alloc(0),
    })));
    const md = "![x](https://example.com/loop)";
    expect(await localizeMedia(md, { downloadRemote: true })).toBe(md);
  });

  it("downloadRemote 未开启时远程图片零网络请求（决策 9）", async () => {
    const transport = vi.fn();
    const lookup = vi.fn();
    __setHttpGetForTests(transport);
    __setDnsLookupForTests(lookup);

    const md = "![x](https://example.com/a.png)";
    expect(await localizeMedia(md)).toBe(md);
    expect(await localizeMedia(md, { downloadRemote: false })).toBe(md);
    expect(transport).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("扩展名判定（边界 7）", () => {
  beforeEach(() => {
    __setDnsLookupForTests(async () => PUBLIC_IP);
  });

  it("Content-Type 优先于 URL 后缀变体（.webp.jpg / .jpeg~...png / 无后缀）", async () => {
    __setHttpGetForTests(vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "image/png" },
      body: PNG_BUF,
    })));
    for (const url of [
      "https://example.com/a.webp.jpg",
      "https://example.com/a.jpeg~tplv-abc.png",
      "https://example.com/signed-no-ext",
    ]) {
      const out = await localizeMedia(`![x](${url})`, { downloadRemote: true });
      expect(out, url).toMatch(/\/api\/assets\/[0-9a-f]{16}\.png\)/);
    }
  });

  it("Content-Type 不可映射时回退魔数判定", async () => {
    __setHttpGetForTests(vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "image/x-unknown" },
      body: Buffer.from(GIF_B64, "base64"),
    })));
    const out = await localizeMedia("![x](https://example.com/whatever)", { downloadRemote: true });
    expect(out).toMatch(/\/api\/assets\/[0-9a-f]{16}\.gif\)/);
  });

  it("无法识别为白名单位图时保留原 URL", async () => {
    __setHttpGetForTests(vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "image/tiff" },
      body: Buffer.from("not-a-known-image-format!"),
    })));
    const md = "![x](https://example.com/mystery)";
    expect(await localizeMedia(md, { downloadRemote: true })).toBe(md);
  });

  it("resolveAssetExt 三级判定顺序：Content-Type → 魔数 → fallback 后缀", () => {
    expect(resolveAssetExt(Buffer.from("x"), "image/jpeg", ".png")).toBe(".jpg");
    expect(resolveAssetExt(PNG_BUF, null, ".gif")).toBe(".png");
    expect(resolveAssetExt(Buffer.from("plain"), null, ".webp")).toBe(".webp");
    expect(resolveAssetExt(Buffer.from("plain"), null, ".svg")).toBe(null);
    expect(resolveAssetExt(Buffer.from("plain"), null, null)).toBe(null);
  });
});

describe("saveAssetBuffer", () => {
  it("内容寻址命名：sha256 前 16 位 + 扩展名", () => {
    const url = saveAssetBuffer(PNG_BUF, ".png");
    expect(url).toMatch(/^\/api\/assets\/[0-9a-f]{16}\.png$/);
    expect(saveAssetBuffer(PNG_BUF, ".png")).toBe(url);
    expect(assetFiles()).toHaveLength(1);
  });
});
