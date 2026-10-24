/**
 * `hqflow login`, `hqflow logout`, and `hqflow whoami` — optional HQFlow accounts. An account
 * is needed only for cloud sync; every other command works without one.
 */
import { createInterface } from "node:readline";
import { createCloudClient, currentCloudUser } from "@core/cloud";

export interface LoginOptions {
  create?: boolean;
}

export interface AccountResult {
  exitCode: 0 | 1;
}

/** Reads the email and password. Typed passwords are not echoed in a terminal. */
async function promptCredentials(): Promise<{ email: string; password: string }> {
  const input = process.stdin;
  const rl = createInterface({ input, output: process.stdout, terminal: input.isTTY === true });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string, hidden: boolean): Promise<string> => {
    process.stdout.write(question);
    const mutable = rl as unknown as { _writeToOutput: ((text: string) => void) | undefined };
    const original = mutable._writeToOutput;
    if (hidden && input.isTTY === true) {
      mutable._writeToOutput = () => undefined;
    }
    const next = await lines.next();
    mutable._writeToOutput = original;
    if (hidden) {
      process.stdout.write("\n");
    }
    return next.done === true ? "" : String(next.value).trim();
  };
  try {
    const email = await ask("Email: ", false);
    const password = await ask("Password: ", true);
    return { email, password };
  } finally {
    rl.close();
  }
}

export async function runLogin(options: LoginOptions): Promise<AccountResult> {
  const client = createCloudClient();
  const { email, password } = await promptCredentials();
  if (email.length === 0 || password.length === 0) {
    console.error("Email and password are required.");
    return { exitCode: 1 };
  }

  if (options.create === true) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error !== null) {
      console.error(`Could not create the account: ${error.message}`);
      return { exitCode: 1 };
    }
    if (data.session === null) {
      console.log(`Account created. Open the confirmation email sent to ${email}, then run \`hqflow login\`.`);
      return { exitCode: 0 };
    }
    console.log(`Account created. Logged in as ${email}.`);
    return { exitCode: 0 };
  }

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null) {
    console.error(`Could not log in: ${error.message}`);
    console.error("If you do not have an account yet, run `hqflow login --create`.");
    return { exitCode: 1 };
  }
  console.log(`Logged in as ${email}. Run \`hqflow sync\` in a repository to sync it.`);
  return { exitCode: 0 };
}

export async function runLogout(): Promise<AccountResult> {
  const client = createCloudClient();
  // "local" removes this machine's session only; other devices stay logged in.
  await client.auth.signOut({ scope: "local" });
  console.log("Logged out on this machine.");
  return { exitCode: 0 };
}

export async function runWhoami(): Promise<AccountResult> {
  const user = await currentCloudUser(createCloudClient());
  if (user === null) {
    console.log("Not logged in. Run `hqflow login` to use cloud sync.");
    return { exitCode: 1 };
  }
  console.log(user.email);
  return { exitCode: 0 };
}
