import type { StudioProject } from "./types";

type Stem = "instrumental" | "vocals";
const stemLabel = (stem: Stem) => stem === "instrumental" ? "伴奏" : "人声";

/** A display name is independent of the fixed, ID-based asset path on disk. */
export function studioStemName(title: string, stem: Stem, sourceName = "", mimeType = "audio/wav"): string {
  const extension = sourceName.match(/\.(wav|mp3|flac|m4a|ogg)$/i)?.[1]
    ?? (mimeType === "audio/mpeg" ? "mp3" : "wav");
  return `${title.trim() || "当前歌曲"} (${stemLabel(stem)}).${extension.toLowerCase()}`;
}

// Older cache metadata replaced every non-ASCII character with an underscore,
// including the two characters in the generated " (伴奏)" / " (人声)" suffix.
function repairLegacyStemName(name: string, title: string, stem: Stem): string {
  const match = name.match(/^(.*) \(__\)\.(wav|mp3|flac|m4a|ogg)$/i);
  if (!match) return name;
  const legacyTitle = Array.from(title).map(char => /^[a-zA-Z0-9.\-_ ()]$/.test(char) ? char : "_").join("");
  // Match the known old encoder, not arbitrary user-supplied underscores.
  // Fully erased names can also be recovered after the project was renamed.
  if (match[1] !== legacyTitle && !/^[_\s]+$/.test(match[1])) return name;
  return studioStemName(title, stem, name);
}

/** Repair names in memory on open; saving persists them without rewriting audio. */
export function repairStudioAssetNames(project: StudioProject): StudioProject {
  let changed = false;
  const tracks = project.tracks.map(track => {
    const stem: Stem | undefined = track.kind === "instrumental" ? "instrumental"
      : track.kind === "reference" && track.referenceStem === "vocals" ? "vocals" : undefined;
    if (!stem) return track;
    let trackChanged = false;
    const assets = track.assets.map(asset => {
      const name = repairLegacyStemName(asset.name, project.title, stem);
      if (name === asset.name) return asset;
      changed = trackChanged = true;
      return { ...asset, name };
    });
    return trackChanged ? { ...track, assets } : track;
  });
  let instrumental = project.instrumental;
  if (instrumental) {
    const name = repairLegacyStemName(instrumental.name, project.title, "instrumental");
    if (name !== instrumental.name) { changed = true; instrumental = { ...instrumental, name }; }
  }
  return changed ? { ...project, tracks, instrumental } : project;
}
