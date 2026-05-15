# 安全策略 / Security Policy

## 支持的版本

| 版本 | 支持状态 |
| --- | --- |
| `latest` / 最近一个 minor | ✅ 接收安全修复 |
| 更早版本 | ❌ 请先升级 |

## 报告漏洞

**请不要在 public issue 中直接披露涉及鉴权、数据泄露、远程命令执行等敏感问题。**

请通过以下方式联系维护者：

- GitHub Security Advisory：https://github.com/STArtppt/pentou/security/advisories/new （推荐）
- 私信仓库 owner（GitHub `@STArtppt`）

报告时请尽量提供：

1. 受影响的版本与部署形态（Docker / 本地 dev）
2. 复现步骤或 PoC
3. 你认为的影响面与受影响数据

## 响应时长

- 7 天内首次回复
- 30 天内给出修复 / 缓解方案（重大问题会更快）

修复发布后，你的报告会在 release notes 中致谢（除非你要求匿名）。

## 范围

**在范围**：

- 鉴权绕过、Session 伪造
- 路径穿越、任意文件读写
- XSS、CSRF（对 PenTou Web UI）
- 容器逃逸、提权
- 依赖项中的高危漏洞（请先确认 PenTou 实际是否使用了脆弱代码路径）

**不在范围**：

- 缺少安全头但无实际利用路径
- 本地物理访问相关攻击
- 对默认弱密码的暴力破解（PenTou 强制要求自定义强密码）
- 已知的浏览器 / OS 漏洞
