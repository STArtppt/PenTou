/**
 * parsers.ts — 前端入口 re-export。
 * 解析实现已抽至 src/shared/parsers.ts 供前端与服务端共用
 * （spec ingest-gateway §4.2 决策 5：抽共享模块而非服务端重写，避免解析行为漂移）。
 */
export * from "../shared/parsers.js";
