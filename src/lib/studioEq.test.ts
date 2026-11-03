import { describe, expect, it } from "vitest";
import { defaultEqBands, frequencyToUnit, getEqBands, isEqBandActive, unitToFrequency } from "./studioEq";

describe("seven-band parametric EQ", () => {
  it("preserves legacy frequency, gain and Q instead of reinterpreting saved projects", () => {
    const bands = getEqBands({ lowDb: -24, midDb: 5, highDb: 2 });
    expect(bands.length).toBe(7);
    expect(bands.filter(isEqBandActive).map(band => [band.type, band.frequency, band.gainDb])).toEqual([["lowshelf", 120, -24], ["peaking", 1000, 5], ["highshelf", 8000, 2]]);
    expect(bands[3].q).toBe(0.8);
    expect(defaultEqBands().some(isEqBandActive)).toBe(false);
  });
  it("uses a logarithmic frequency axis and enables non-gain filters at zero gain", () => {
    expect(unitToFrequency(frequencyToUnit(1234))).toBeCloseTo(1234, 8);
    expect(unitToFrequency(0)).toBe(20); expect(unitToFrequency(1)).toBe(20000);
    expect(isEqBandActive({ ...defaultEqBands()[0], type: "highpass" })).toBe(true);
    expect(isEqBandActive({ ...defaultEqBands()[0], type: "notch", enabled: false })).toBe(false);
  });
});
