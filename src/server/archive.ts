import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { type ReadEntry, x as extract } from "tar";
import { type Limits, MB } from "./config.js";
import { HttpError } from "./errors.js";

/** Entry types worth writing: a scan reads regular files and the directories holding them. */
const KEPT = new Set<string>(["File", "OldFile", "ContiguousFile", "Directory"]);

/** `.git` is never scanned, and its config could name programs for git to run: it is not unpacked. */
function gitMetadata(entryPath: string): boolean {
  return entryPath.split("/").includes(".git");
}

const tooLarge = (what: string): HttpError => new HttpError(413, "archive_too_large", `the archive is over the server's limit: ${what}`);

/** Why node-tar refused an archive, without its paths or the server's directories. */
const REASONS: Record<string, string> = {
  TAR_BAD_ARCHIVE: "the body is not a tar archive",
  TAR_ENTRY_ERROR: "an entry has an unsafe path (`..`) or cannot be written",
  TAR_ENTRY_INFO: "an entry has an absolute path",
  TAR_ENTRY_INVALID: "an entry is invalid",
  TAR_ABORT: "the archive is truncated, corrupt or inflates too much",
};

function archiveError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const code = (err as { tarCode?: string; code?: string } | null)?.tarCode ?? (err as { code?: string } | null)?.code ?? "";
  const reason = REASONS[code] ?? (code.startsWith("Z_") ? "the body is not valid gzip" : "the archive cannot be unpacked");
  return new HttpError(422, "invalid_archive", reason);
}

/** The archive's single top-level directory (`git archive --prefix=repo/`, GitHub tarballs), else `dest` itself. */
async function scanRoot(dest: string): Promise<string> {
  const top = await readdir(dest, { withFileTypes: true });
  return top.length === 1 && top[0]!.isDirectory() ? path.join(dest, top[0]!.name) : dest;
}

/**
 * Unpacks a gzip-compressed tar archive into `dest` and returns the directory to scan. The archive is untrusted: only
 * files and directories are written, never links, devices or `.git`; an absolute or `..` path, a corrupt archive or
 * one past a limit fails the whole request (`strict`), and node-tar stops archives that inflate over 1000 times.
 */
export async function unpackArchive(input: Readable, dest: string, limits: Limits): Promise<string> {
  let archiveBytes = 0;
  let unpackedBytes = 0;
  let entries = 0;
  const unpack = extract({
    cwd: dest,
    strict: true,
    preserveOwner: false,
    filter: (entryPath, entry) => {
      const e = entry as ReadEntry;
      if (!KEPT.has(e.type) || gitMetadata(entryPath)) return false;
      entries += 1;
      unpackedBytes += e.size ?? 0;
      if (entries > limits.maxEntries) unpack.abort(tooLarge(`more than ${limits.maxEntries} files`));
      else if (unpackedBytes > limits.maxUnpackedBytes) unpack.abort(tooLarge(`more than ${limits.maxUnpackedBytes / MB} MB unpacked`));
      else return true;
      return false;
    },
  });
  const done = new Promise<void>((resolve, reject) => {
    unpack.on("error", reject);
    unpack.on("close", () => resolve());
  });
  input.on("data", (chunk: Buffer) => {
    archiveBytes += chunk.length;
    if (archiveBytes > limits.maxArchiveBytes) unpack.abort(tooLarge(`more than ${limits.maxArchiveBytes / MB} MB`));
  });
  input.on("error", (err) => unpack.abort(err));
  input.pipe(unpack);
  try {
    await done;
  } catch (err) {
    throw archiveError(err);
  } finally {
    input.unpipe(unpack);
    input.pause();
  }
  return scanRoot(dest);
}
