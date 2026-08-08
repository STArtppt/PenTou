/**
 * 类型闸门的差异逻辑。重点钉住**行号无关**这一条：
 * lint-ui 的 baseline 按行号存，结果任何一次插行都会把一堆无关存量错误伪装成"新增"
 * （本仓库已因此被迫重生成过 baseline）。这里的 key 不含行号，必须挡住同样的坑。
 */
import { describe, expect, it } from "vitest";
import { parseTscOutput, errorKey, countByKey, newErrors } from "./typecheck.mjs";

const OUT = [
  "src/app/a.tsx(12,5): error TS2345: Argument of type 'string' is not assignable.",
  "  Types of property 'x' are incompatible.",
  "src/app/b.ts(3,1): error TS18048: 'plan' is possibly 'undefined'.",
].join("\n");

describe("解析 tsc 输出", () => {
  it("按行取出文件/行号/错误码/消息，忽略缩进的续行说明", () => {
    const errors = parseTscOutput(OUT);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({
      file: "src/app/a.tsx",
      line: 12,
      code: "TS2345",
      message: "Argument of type 'string' is not assignable.",
    });
  });

  it("空输出就是零错误", () => {
    expect(parseTscOutput("")).toEqual([]);
  });
});

describe("与 baseline 比对", () => {
  const baseline = countByKey(parseTscOutput(OUT));

  it("原样不动时零新增", () => {
    expect(newErrors(parseTscOutput(OUT), baseline)).toEqual([]);
  });

  it("行号变了不算新增 —— 在别处插行不该让存量错误变红", () => {
    const shifted = parseTscOutput(OUT.replace("(12,5)", "(999,5)"));
    expect(newErrors(shifted, baseline)).toEqual([]);
  });

  it("同一文件冒出新错误码 → 报红", () => {
    const withNew = parseTscOutput(
      `${OUT}\nsrc/app/a.tsx(20,1): error TS2339: Property 'gone' does not exist.`,
    );
    const fresh = newErrors(withNew, baseline);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].code).toBe("TS2339");
  });

  it("同一错误重复出现次数变多 → 报红（按计数比对，不是按存在性）", () => {
    const twice = parseTscOutput(`${OUT}\nsrc/app/b.ts(9,1): error TS18048: 'plan' is possibly 'undefined'.`);
    expect(newErrors(twice, baseline)).toHaveLength(1);
  });

  it("修好了错误不报红（只是提示可以重生成 baseline）", () => {
    const fewer = parseTscOutput("src/app/b.ts(3,1): error TS18048: 'plan' is possibly 'undefined'.");
    expect(newErrors(fewer, baseline)).toEqual([]);
  });

  it("key 不含行号", () => {
    expect(errorKey({ file: "a.ts", line: 1, code: "TS1", message: "m" })).toBe(
      errorKey({ file: "a.ts", line: 999, code: "TS1", message: "m" }),
    );
  });
});
