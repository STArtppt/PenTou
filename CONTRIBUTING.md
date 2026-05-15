# 贡献指南 / Contributing

感谢你愿意为 PenTou 出一份力 🎉

## 报告问题（Issue）

提 issue 前请先：

1. 在已有 issues 中搜索一下，避免重复
2. 用对应的 Issue 模板（Bug / Feature）
3. **复现步骤** + **环境信息**（OS、Docker 版本、PenTou 镜像 tag）是关键

不接受 / 优先级低：

- 仅"我觉得 UI 应该是这样"而无具体痛点的视觉建议
- 与本地优先 / 单密码鉴权设计哲学相违的功能（如要求多用户、云同步）

## 提交 PR

### 本地起开发环境

```bash
git clone https://github.com/STArtppt/pentou.git
cd pentou
pnpm install
pnpm dev   # 浏览器打开 http://localhost:5173
```

开发模式不强制鉴权（本地直连无远程风险）。

### 分支与 commit message

- 从 `main` 拉分支：`feat/xxx` / `fix/xxx` / `docs/xxx`
- commit 风格不强制 Conventional Commits，但请使用清晰的中英文短句，开头标明类型：
  - `特性 / feat: 新增功能 X`
  - `修复 / fix: 解决 X 在 Y 场景下的 Z 问题`
  - `文档 / docs: 补充 X 说明`
  - `重构 / refactor: 拆分 X 模块`
  - `性能 / perf: X 操作从 NN ms 降到 MM ms`

### PR 自查清单

- [ ] `pnpm dev` 本地能跑，golden path 没坏
- [ ] 改动控制在最小范围，无顺手"改善"无关代码
- [ ] 若新增依赖：评估必要性、license 是否兼容 MIT
- [ ] 若改动数据格式：在 PR 描述中说明迁移路径

### 代码风格

- TypeScript 严格模式
- React + Vite + Tailwind CSS v4
- 优先函数式组件 + Hooks
- 不引入 UI 组件库（项目刻意保持轻量）

## 许可

提交 PR 即同意你的贡献以 [MIT License](./LICENSE) 授权。
