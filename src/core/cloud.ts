/**
 * Node-side Supabase client for optional HQFlow accounts. The session is stored in
 * `~/.hqflow/credentials.json` (mode 0600) so every CLI command on this machine shares one
 * login. `HQFLOW_HOME`, `HQFLOW_CLOUD_URL`, and `HQFLOW_CLOUD_KEY` override the defaults.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HQFLOW_CLOUD_PUBLISHABLE_KEY, HQFLOW_CLOUD_URL } from "@schema/cloud";

export function hqflowHomeDir(): string {
  return process.env.HQFLOW_HOME ?? path.join(os.homedir(), ".hqflow");
}

function credentialsFile(): string {
  return path.join(hqflowHomeDir(), "credentials.json");
}

async function readCredentials(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(credentialsFile(), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeCredentials(values: Record<string, string>): Promise<void> {
  const file = credentialsFile();
  if (Object.keys(values).length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${JSON.stringify(values, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  await fs.chmod(file, 0o600);
}

const fileStorage = {
  getItem: async (key: string): Promise<string | null> => (await readCredentials())[key] ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    await writeCredentials({ ...(await readCredentials()), [key]: value });
  },
  removeItem: async (key: string): Promise<void> => {
    const values = await readCredentials();
    delete values[key];
    await writeCredentials(values);
  },
};

export function createCloudClient(): SupabaseClient {
  return createClient(
    process.env.HQFLOW_CLOUD_URL ?? HQFLOW_CLOUD_URL,
    process.env.HQFLOW_CLOUD_KEY ?? HQFLOW_CLOUD_PUBLISHABLE_KEY,
    {
      auth: {
        storage: fileStorage,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

/** The signed-in user's id and email, or null when this machine is not logged in. */
export async function currentCloudUser(client: SupabaseClient): Promise<{ id: string; email: string } | null> {
  const { data } = await client.auth.getSession();
  if (data.session === null) {
    return null;
  }
  // getUser() asks the server, so a revoked or expired session reports as logged out.
  const { data: userData, error } = await client.auth.getUser();
  if (error !== null || userData.user === null) {
    return null;
  }
  return { id: userData.user.id, email: userData.user.email ?? "" };
}
