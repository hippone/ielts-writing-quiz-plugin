import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_REMOTE_MANIFEST_URL =
  "https://api.github.com/repos/hippone/ielts-writing-quiz-plugin/contents/.codex-plugin/plugin.json?ref=main";

const DEFAULT_CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_MANIFEST_BYTES = 64 * 1024;

function coreVersion(version) {
  return version.split("+", 1)[0];
}

function cacheBustedUrl(source, now) {
  const url = new URL(source);
  url.searchParams.set("checked_at", String(now.getTime()));
  return url.toString();
}

function versionParts(version) {
  const match = coreVersion(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u);
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? null,
  };
}

export function comparePluginVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts.numbers[index] !== rightParts.numbers[index]) {
      return leftParts.numbers[index] > rightParts.numbers[index] ? 1 : -1;
    }
  }
  if (leftParts.prerelease === rightParts.prerelease) return 0;
  if (leftParts.prerelease === null) return 1;
  if (rightParts.prerelease === null) return -1;
  return leftParts.prerelease.localeCompare(rightParts.prerelease);
}

export function readLocalPluginVersion() {
  const manifestPath = fileURLToPath(new URL("../.codex-plugin/plugin.json", import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.name !== "ielts-writing-quiz" || typeof manifest?.version !== "string") {
    throw new Error("local_plugin_manifest_invalid");
  }
  return manifest.version;
}

export class PluginVersionChecker {
  constructor({
    localVersion = readLocalPluginVersion(),
    remoteManifestUrl = DEFAULT_REMOTE_MANIFEST_URL,
    fetchImpl = globalThis.fetch,
    cacheMs = DEFAULT_CACHE_MS,
    now = () => new Date(),
  } = {}) {
    this.localVersion = localVersion;
    this.remoteManifestUrl = remoteManifestUrl;
    this.fetchImpl = fetchImpl;
    this.cacheMs = cacheMs;
    this.now = now;
    this.cachedResult = null;
    this.cachedAtMs = 0;
  }

  async check({ force = false } = {}) {
    const now = this.now();
    if (!force && this.cachedResult && now.getTime() - this.cachedAtMs < this.cacheMs) {
      return { ...this.cachedResult, cached: true };
    }

    let result;
    try {
      if (typeof this.fetchImpl !== "function") throw new Error("fetch_unavailable");
      const response = await this.fetchImpl(cacheBustedUrl(this.remoteManifestUrl, now), {
        method: "GET",
        headers: { accept: "application/vnd.github.raw+json", "user-agent": "ielts-writing-quiz-plugin-version-check" },
        redirect: "follow",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response?.ok) throw new Error("remote_manifest_unavailable");
      const source = await response.text();
      if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES) throw new Error("remote_manifest_too_large");
      const manifest = JSON.parse(source);
      if (manifest?.name !== "ielts-writing-quiz" || typeof manifest?.version !== "string") {
        throw new Error("remote_manifest_invalid");
      }
      const comparison = comparePluginVersions(manifest.version, this.localVersion);
      const status = comparison === null
        ? "unknown"
        : comparison > 0
          ? "update_available"
          : comparison < 0
            ? "local_ahead"
            : "current";
      result = {
        schemaVersion: "plugin_update_check.v1",
        status,
        localVersion: this.localVersion,
        remoteVersion: manifest.version,
        checkedAt: now.toISOString(),
        sourceUrl: this.remoteManifestUrl,
        cached: false,
        message: {
          current: "The installed plugin matches the latest published version.",
          update_available: "A newer plugin version is available.",
          local_ahead: "The local plugin version is newer than the published version.",
          unknown: "The version strings could not be compared safely.",
        }[status],
      };
    } catch {
      result = {
        schemaVersion: "plugin_update_check.v1",
        status: "unavailable",
        localVersion: this.localVersion,
        remoteVersion: null,
        checkedAt: now.toISOString(),
        sourceUrl: this.remoteManifestUrl,
        cached: false,
        message: "The update check is temporarily unavailable; normal plugin use may continue.",
      };
    }
    this.cachedResult = result;
    this.cachedAtMs = now.getTime();
    return result;
  }
}
