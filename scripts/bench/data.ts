/**
 * Maintains the committed manifest of the private benchmark data:
 *
 *   npm run bench:data -- verify     check the data directory against scripts/bench/manifest.json
 *   npm run bench:data -- manifest   rewrite the manifest from the data directory (after adding or
 *                                    correcting cases; review the diff before committing it)
 */
import { loadLocalEnvironment } from "../load-local-environment";
import { resolveDataDir } from "./lib/data-dir";
import {
  buildManifest,
  MANIFEST_PATH,
  readManifest,
  verifyAgainstManifest,
  writeManifest,
} from "./lib/manifest";

function main(): void {
  const command = process.argv[2];
  loadLocalEnvironment();
  const dataDir = resolveDataDir();

  if (command === "manifest") {
    const manifest = buildManifest(dataDir);
    writeManifest(manifest);
    const annotations = Object.entries(manifest.annotations)
      .map(([task, entries]) => `${Object.keys(entries).length} ${task}`)
      .join(", ");
    console.log(
      `wrote ${MANIFEST_PATH}: ${Object.keys(manifest.documents).length} documents, ${annotations} annotations`
    );
    return;
  }
  if (command === "verify") {
    const { errors, warnings } = verifyAgainstManifest(dataDir, readManifest());
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log("data matches the manifest");
    return;
  }
  throw new Error("usage: data.ts verify | manifest");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
