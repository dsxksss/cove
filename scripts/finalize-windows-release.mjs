/** Publish local checksums/manifest only after both compiled frontends and extracted payloads pass. */
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const root = resolve(`.tmp/Cove-${version}-Windows-x64`);
const json = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
const digest = async file => { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex").toUpperCase(); };
const installers = [];
for (const edition of ["full", "player"]) {
  const build = await json(`BUILD-${edition}.json`);
  const frontend = await json(`frontend-verification-${edition}.json`);
  const payload = await json(`payload-verification-${edition}.json`);
  assert.equal(build.version, version); assert.equal(frontend.passed, true); assert.equal(payload.passed, true);
  assert.equal(payload.checks.applicationSha256, build.applicationSha256);
  if (edition === "full") { assert.equal(payload.checks.cpuSeparation, true); assert.equal(payload.checks.installedPitchAndMp3, true); }
  else assert.equal(payload.checks.noStudioRuntime, true);
  const file = resolve(root, build.installer), bytes = (await stat(file)).size, sha256 = await digest(file);
  assert.equal(bytes, build.installerBytes); assert.equal(sha256, build.installerSha256);
  installers.push({ edition, file: build.installer, bytes, sha256, applicationSha256: build.applicationSha256, studioIncluded: build.studioIncluded });
  if (build.prerequisiteStrategy) installers.at(-1).prerequisiteStrategy = build.prerequisiteStrategy;
}
const portableFile = `Cove_${version}-player-portable.zip`;
const portablePath = resolve(root, portableFile);
const portable = { edition: "player-portable", file: portableFile, bytes: (await stat(portablePath)).size, sha256: await digest(portablePath), studioIncluded: false, prerequisites: "existing system runtime required" };
const portableVerification = await json("portable-verification-player.json");
assert.equal(portableVerification.passed, true);
assert.equal(portableVerification.applicationSha256, installers.find(file => file.edition === "player").applicationSha256);
const frontendLog = await readFile(`.tmp/package-unit-tests-${version}.log`, "utf8");
const nativeLog = await readFile(`.tmp/package-native-tests-${version}.log`, "utf8");
assert.match(frontendLog, /Failed: 0/); assert.match(nativeLog, /test result: ok\./);
const manifest = {
  version, platform: "Windows x64", installers, portable,
  checks: { frontendTestsPassed: Number(frontendLog.match(/Passed assertions \(approx\): (\d+)/)?.[1]), nativeStudioTestsPassed: Number(nativeLog.match(/test result: ok\. (\d+) passed/)?.[1]), productionFrontendChecks: "passed, local IPC fixtures", archiveIntegrityAndPayloadHashes: "passed", fullRuntimeCpuSeparationPitchAndMp3: "passed", installationRegistration: "not completed: sandbox registry access denied; archive payloads verified by extraction instead" },
  provenance: { baseCommit: (await json("BUILD-full.json")).baseCommit, containsLocalChanges: true, published: false },
  verifiedAtUtc: new Date().toISOString(),
};
await writeFile(resolve(root, "SHA256SUMS.txt"), [...installers, portable].map(file => `${file.sha256}  ${file.file}`).join("\r\n") + "\r\n", "ascii");
await writeFile(resolve(root, "RELEASE.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify(manifest, null, 2));
