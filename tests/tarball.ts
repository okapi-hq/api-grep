import { gzipSync } from "node:zlib";
import { c as create, Header } from "tar";

export interface TarEntry {
  path: string;
  type?: "File" | "Directory" | "SymbolicLink" | "Link" | "FIFO";
  body?: string | Buffer;
  linkpath?: string;
}

/** A gzip-compressed tar archive written header by header, so a test can put in it what no well-behaved tool would. */
export function tarball(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const type = e.type ?? "File";
    const body = type !== "File" ? Buffer.alloc(0) : Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body ?? "");
    const header = Buffer.alloc(512);
    new Header({ path: e.path, type, size: body.length, mode: 0o644, mtime: new Date(0), linkpath: e.linkpath, uid: 0, gid: 0 }).encode(header, 0);
    blocks.push(header);
    if (body.length > 0) blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** `dir` packed as `tar -czf - -C <parent> <name>`: one top-level directory, as `git archive --prefix` writes. */
export async function packDirectory(parent: string, name: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of create({ gzip: true, cwd: parent, portable: true }, [name])) chunks.push(chunk);
  return Buffer.concat(chunks);
}
