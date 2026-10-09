import { DEFAULT_EFFECTS, type StudioEffects, type StudioProject } from "./types";

const legacyDefaults: StudioEffects = {
  ...DEFAULT_EFFECTS,
  compressor: { ...DEFAULT_EFFECTS.compressor, ratio: 3 },
  reverb: { ...DEFAULT_EFFECTS.reverb, mix: 0.12 },
};

/** Old projects did not record intent: only migrate the complete old preset. */
export function migrateStudioEffectDefaults(project: StudioProject): StudioProject {
  let changed = false;
  const tracks = project.tracks.map(track => {
    if (track.effectsVersion === 1) return track;
    changed = true;
    const untouched = (Object.keys(legacyDefaults) as (keyof StudioEffects)[]).every(group =>
      Object.entries(legacyDefaults[group]).every(([key, value]) =>
        (track.effects[group] as Record<string, number>)[key] === value));
    return { ...track, effectsVersion: 1 as const, effects: untouched ? structuredClone(DEFAULT_EFFECTS) : track.effects };
  });
  return changed ? { ...project, tracks } : project;
}
