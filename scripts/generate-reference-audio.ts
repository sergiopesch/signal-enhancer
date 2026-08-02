import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  REFERENCE_DIAGNOSTIC_SHA256,
  REFERENCE_DIAGNOSTIC_VERSION,
  createReferenceDiagnosticWav,
} from "../src/lib/audio/reference";

async function main(): Promise<void> {
  const projectDirectory = path.resolve(process.cwd());
  const outputDirectory = path.join(projectDirectory, "public", "audio");
  const outputPath = path.join(
    outputDirectory,
    "signal-enhancer-reference-v1.wav",
  );
  const wav = createReferenceDiagnosticWav(48_000);
  const bytes = new Uint8Array(wav);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== REFERENCE_DIAGNOSTIC_SHA256) {
    throw new Error(
      `Generated checksum ${sha256} does not match the pinned ${REFERENCE_DIAGNOSTIC_SHA256}. Bump the reference version and checksum intentionally.`,
    );
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, bytes);

  process.stdout.write(
    `Generated reference ${REFERENCE_DIAGNOSTIC_VERSION}: ${bytes.byteLength} bytes, sha256 ${sha256}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`Reference generation failed: ${String(error)}\n`);
  process.exitCode = 1;
});
