import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fail early, and say what to do, when a folder cannot be written. The usual cause is a Docker bind mount owned by another
 * user than the one the process runs as: without this the first save fails with a bare EACCES from deep inside git.
 */
export async function assertWritable(dir: string, what: string): Promise<void> {
  const probe = join(dir, `.defluance-write-test-${randomUUID()}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") throw e;
    const uid = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid?.() ?? "?"}` : "this user";
    throw new Error(`${what} (${dir}) is not writable by ${uid}${code === "EROFS" ? ": the file system is read-only" : ""}. With Docker, run the container as the owner of the folder (--user "$(id -u):$(id -g)", or \`user:\` in the compose file), or change the folder's owner.`, { cause: e });
  } finally {
    await rm(probe, { force: true });
  }
}
