import type { StudioEffects, StudioTrack } from "../studio/types";
import { configureEqFilter, getEqBands, isEqBandActive } from "./studioEq";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
export function normalizeEffects(e: StudioEffects): StudioEffects {
  return {
    outputDb: clamp(e.outputDb ?? 0, -60, 18),
    eq: { ...e.eq, lowDb: clamp(e.eq.lowDb, -24, 24), midDb: clamp(e.eq.midDb, -24, 24), highDb: clamp(e.eq.highDb, -24, 24), outputDb: clamp(e.eq.outputDb ?? 0, -18, 18) },
    compressor: { thresholdDb: clamp(e.compressor.thresholdDb, -100, 0), ratio: clamp(e.compressor.ratio, 1, 20), attackMs: clamp(e.compressor.attackMs, 0, 1000), releaseMs: clamp(e.compressor.releaseMs, 1, 1000) },
    reverb: { mix: clamp(e.reverb.mix, 0, 1), decaySec: clamp(e.reverb.decaySec, 0.1, 8) },
    delay: { mix: clamp(e.delay.mix, 0, 1), timeMs: clamp(e.delay.timeMs, 1, 2000), feedback: clamp(e.delay.feedback, 0, 0.85) },
  };
}

// Deterministic impulse: realtime and exported renders use identical reverberation.
export function impulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.round(seconds * context.sampleRate));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let c = 0; c < 2; c++) {
    let seed = 17 + c;
    const samples = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      samples[i] = ((seed >>> 0) / 0xffffffff * 2 - 1) * Math.pow(1 - i / length, 3);
    }
  }
  return buffer;
}

export function createTrackGraph(context: BaseAudioContext, destination: AudioNode) {
  const input = context.createGain();
  const filters = Array.from({ length: 7 }, () => context.createBiquadFilter());
  const eqOutput = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const dry = context.createGain();
  const reverb = context.createConvolver();
  const wet = context.createGain();
  const delay = context.createDelay(2);
  const feedback = context.createGain();
  const echo = context.createGain();
  const gain = context.createGain();
  const effectGain = context.createGain(); effectGain.connect(gain);
  const pan = context.createStereoPanner();
  gain.connect(pan).connect(destination);
  const nodes = [input, ...filters, eqOutput, compressor, dry, reverb, wet, delay, feedback, echo, effectGain, gain, pan];
  const effectNodes = [input, ...filters, eqOutput, compressor, dry, reverb, wet, delay, feedback, echo];
  let analyser: AnalyserNode | null = null;
  let routing = "";
  let decay = 0;
  return {
    input,
    update(track: StudioTrack, hasSolo: boolean) {
      const e = normalizeEffects(track.effects);
      const bands = getEqBands(e.eq);
      const active = bands.map(band => !e.eq.bypass && isEqBandActive(band));
      const enabled = [e.compressor.ratio > 1, e.reverb.mix > 0, e.delay.mix > 0];
      const nextRouting = [...active, ...enabled].join(",");
      if (routing !== nextRouting) {
        // A neutral compressor still introduces lookahead. Disconnect unused
        // effects completely, for identical dry playback and offline export.
        effectNodes.forEach(node => node.disconnect());
        let output: AudioNode = input;
        filters.forEach((node, index) => { if (active[index]) { output.connect(node); output = node; } });
        output.connect(eqOutput); output = eqOutput;
        if (enabled[0]) { output.connect(compressor); output = compressor; }
        output.connect(dry).connect(effectGain);
        if (enabled[1]) output.connect(reverb).connect(wet).connect(effectGain);
        if (enabled[2]) {
          output.connect(delay).connect(echo).connect(effectGain);
          delay.connect(feedback).connect(delay);
        }
        routing = nextRouting;
      }
      input.gain.value = clamp(track.normalizationGain ?? 1, 0, 100);
      filters.forEach((filter, index) => configureEqFilter(filter, bands[index], context.sampleRate));
      eqOutput.gain.value = e.eq.bypass ? 1 : Math.pow(10, (e.eq.outputDb ?? 0) / 20);
      effectGain.gain.value = Math.pow(10, (e.outputDb ?? 0) / 20);
      compressor.threshold.value = e.compressor.thresholdDb; compressor.ratio.value = e.compressor.ratio;
      compressor.attack.value = e.compressor.attackMs / 1000; compressor.release.value = e.compressor.releaseMs / 1000;
      dry.gain.value = 1 - e.reverb.mix; wet.gain.value = e.reverb.mix;
      if (e.reverb.mix > 0 && decay !== e.reverb.decaySec) { reverb.buffer = impulse(context, e.reverb.decaySec); decay = e.reverb.decaySec; }
      echo.gain.value = e.delay.mix; delay.delayTime.value = e.delay.timeMs / 1000; feedback.gain.value = e.delay.feedback;
      gain.gain.value = track.mixer.mute || (hasSolo && !track.mixer.solo) ? 0 : clamp(track.mixer.gain, 0, 2);
      // Fold the complete effect output before panning. Preserve the previous
      // channel negotiation for legacy projects and native mono recordings.
      gain.channelCount = track.mixer.channelMode === "mono" ? 1 : 2;
      gain.channelCountMode = track.mixer.channelMode === "mono" ? "explicit" : "max";
      gain.channelInterpretation = "speakers";
      pan.pan.value = clamp(track.mixer.pan, -1, 1);
    },
    spectrum() {
      if (!analyser) { analyser = context.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.75; pan.connect(analyser); }
      const bins = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(bins);
      return { bins, sampleRate: context.sampleRate };
    },
    dispose() { nodes.forEach(node => node.disconnect()); analyser?.disconnect(); },
  };
}
export type TrackGraph = ReturnType<typeof createTrackGraph>;
