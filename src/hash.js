import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * SHA-256 hex digest of a file's full contents. Streams so memory cost
 * stays bounded regardless of file size.
 *
 * Used to detect when a raw source file has changed since its source page
 * was compiled. Cheap stat-checks (size + mtime) gate this — we only hash
 * when stat suggests something might have changed.
 */
export function hashFile(absPath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Short deterministic suffix derived from a string (typically a vault-relative
 * path). Used for slug-collision disambiguation: when two raw files with the
 * same basename would compile to the same source-page slug, the longer-path
 * one gets this suffix.
 *
 * 8 hex chars = 32 bits, collision probability ~negligible for any realistic
 * vault size.
 */
export function shortHash(input) {
  return createHash("sha256").update(String(input)).digest("hex").slice(0, 8);
}
