import pkg from "../package.json" with { type: "json" };

/** Semver build metadata: dot-separated identifiers of ASCII letters, digits and hyphens. */
const BUILD = /^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/;

/**
 * The version `--version` prints and reports carry: the package version, plus `+<build>` when the build that runs set
 * `API_GREP_BUILD` (the Docker image sets the commit it was built from), so a report names the exact code that wrote it.
 */
export function toolVersion(env: NodeJS.ProcessEnv = process.env): string {
  const build = env.API_GREP_BUILD?.trim();
  return build && BUILD.test(build) ? `${pkg.version}+${build}` : pkg.version;
}
