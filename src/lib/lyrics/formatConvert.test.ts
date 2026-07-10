import { describe, expect, it } from "vitest";
import { krcToLrc, looksLikeTimedLrc, qrcToLrc } from "./formatConvert";

describe("qrcToLrc", () => {
  it("converts QRC timed lines to plain LRC", () => {
    const qrc = "[0,2000]你好(0,500)(500,500)世界(1000,1000)";
    const lrc = qrcToLrc(qrc);
    expect(looksLikeTimedLrc(lrc)).toBe(true);
    expect(lrc).toContain("你好世界");
    expect(lrc).toMatch(/\[00:00\./);
  });
});

describe("krcToLrc", () => {
  it("strips KRC word tags", () => {
    const krc = "[1000,800]<0,200,0>一<200,200,0>二";
    const lrc = krcToLrc(krc);
    expect(lrc).toContain("一二");
    expect(lrc).toMatch(/\[00:01\./);
  });
});
