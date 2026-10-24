/**
 * `hqflow sync [--off]` — turns on cloud sync for this repository and runs one sync round.
 * While sync is on, `hqflow open` keeps syncing in the background.
 */
import { createCloudClient } from "@core/cloud";
import { disableSync, summarizeSyncReport, syncProject } from "@core/sync";
import { resolveCliRoot } from "../resolve-root";

export interface SyncOptions {
  root?: string;
  off?: boolean;
}

export async function runSync(options: SyncOptions): Promise<{ exitCode: 0 | 1 }> {
  const root = resolveCliRoot(options.root);

  if (options.off === true) {
    await disableSync(root);
    console.log("Cloud sync is off for this repository. Its cloud copy was not deleted.");
    return { exitCode: 0 };
  }

  try {
    const report = await syncProject(root, createCloudClient());
    const lines = summarizeSyncReport(report);
    console.log(`Synced '${report.projectName}'.`);
    for (const line of lines.length > 0 ? lines : ["Everything is up to date."]) {
      console.log(`  ${line}`);
    }
    console.log("Cloud sync is on. `hqflow open` keeps this repository in sync while it runs.");
    return { exitCode: 0 };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}
