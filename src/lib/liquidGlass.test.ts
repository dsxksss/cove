import { describe, expect, it } from "vitest";
import { getDisplacementFilter, getDisplacementMap } from "./liquidGlass";

describe("getDisplacementMap", () => {
  it("returns a data-url SVG with rounded lens and neutral gray base", () => {
    const map = getDisplacementMap({
      width: 200,
      height: 120,
      radius: 20,
      depth: 10,
    });
    expect(map.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const svg = decodeURIComponent(map.slice("data:image/svg+xml;utf8,".length));
    expect(svg).toContain('height="120"');
    expect(svg).toContain('width="200"');
    expect(svg).toContain('rx="20"');
    expect(svg).toContain("#808080"); // zero-displacement base
    expect(svg).toContain("lens-shape");
  });

  it("clamps radius/depth so corners never spike outside bounds", () => {
    const map = getDisplacementMap({
      width: 40,
      height: 40,
      radius: 999,
      depth: 999,
    });
    const svg = decodeURIComponent(map.slice("data:image/svg+xml;utf8,".length));
    // max radius is half min side = 20
    expect(svg).toContain('rx="20"');
  });
});

describe("getDisplacementFilter", () => {
  it("embeds the displacement map and exposes #displace fragment", () => {
    const filter = getDisplacementFilter({
      width: 100,
      height: 80,
      radius: 16,
      depth: 8,
      strength: 90,
      chromaticAberration: 2,
    });
    expect(filter.endsWith("#displace")).toBe(true);
    expect(filter).toContain("feDisplacementMap");
    expect(filter).toContain("data:image/svg+xml");
  });
});
