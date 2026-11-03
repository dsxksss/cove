import { describe, expect, it } from "vitest";
import { VOCAL_PRESETS, vocalPresetEffects } from "./studioVocalPresets";

describe("vocal preset definitions", () => {
  it("creates independent complete chains without accumulating previous effects", () => {
    for (const preset of VOCAL_PRESETS) {
      const effects = vocalPresetEffects(preset.id);
      expect(effects.eq.bands!.length).toBe(7);
      expect(effects.eq.bands![0].type).toBe("highpass");
      expect(effects.compressor.ratio).toBeGreaterThan(1);
      expect(effects.reverb.mix).toBeLessThan(0.2);
      effects.eq.bands![0].frequency = 9000;
      expect(vocalPresetEffects(preset.id).eq.bands![0].frequency).toBeLessThan(120);
    }
  });
});
