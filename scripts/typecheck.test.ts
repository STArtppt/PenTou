/**
 * 类型闸门的 tsc 输出解析。baseline 机制已删除（typecheck-debt-zero），
 * 此处只钉住解析正确性。
 */
import { describe, expect, it } from "vitest";
import { parseTscOutput } from "./typecheck.mjs";

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
