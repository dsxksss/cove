import { describe, expect, it } from "vitest";
import { clipEnvelopeGain, createClipEnvelope, getClipFades } from "./studioFades";
import type { StudioClip } from "../studio/types";

const clip: StudioClip = { id: "clip", assetId: "audio", startSec: 0, offsetSec: 1, durationSec: 4, fadeInSec: 1, fadeOutSec: 2 };

describe("studio clip fades", () => {
  it("keeps legacy clips at unity and rejects invalid fade durations", () => {
    expect(getClipFades({}, 4)).toEqual({ fadeInSec: 0, fadeOutSec: 0 });
    expect(getClipFades({ fadeInSec: NaN, fadeOutSec: -1 }, 4)).toEqual({ fadeInSec: 0, fadeOutSec: 0 });
    expect(getClipFades({ fadeInSec: 4, fadeOutSec: 4 }, 2)).toEqual({ fadeInSec: 1, fadeOutSec: 1 });
    expect(clipEnvelopeGain(4, 1, 2, 0)).toBe(0);
    expect(clipEnvelopeGain(4, 1, 2, 0.5)).toBe(0.5);
    expect(clipEnvelopeGain(4, 1, 2, 1.5)).toBe(1);
    expect(clipEnvelopeGain(4, 1, 2, 3)).toBe(0.5);
    expect(clipEnvelopeGain(4, 1, 2, 4)).toBe(0);
  });

  it("continues the envelope when seeking into a fade or shifting before time zero", () => {
    const events: number[][] = [];
    const node = { gain: { setValueAtTime: (value: number, time: number) => events.push([value, time]), linearRampToValueAtTime: (value: number, time: number) => events.push([value, time]) }, connect: () => {} };
    const context = { createGain: () => node } as unknown as BaseAudioContext;
    createClipEnvelope(context, {} as AudioNode, clip, 4, 10, 0.5);
    expect(events).toEqual([[0.5, 10], [1, 10.5], [1, 11.5], [0, 13.5]]);
    events.length = 0;
    createClipEnvelope(context, {} as AudioNode, clip, 4, 20, 3);
    expect(events).toEqual([[0.5, 20], [0, 21]]);
  });

  it("makes complementary linear fades maintain a constant sum across an overlap", () => {
    for (let index = 0; index <= 20; index++) {
      const time = index / 20;
      expect(clipEnvelopeGain(3, 0, 1, 2 + time) + clipEnvelopeGain(3, 1, 0, time)).toBeCloseTo(1, 10);
    }
  });
});
