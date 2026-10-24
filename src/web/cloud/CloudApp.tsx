/**
 * Hosted, read-only viewer for workflows synced to an HQFlow account. It works on any device,
 * including phones, without a local HQFlow server. It reuses the live app's canvas and step
 * drawer inside `ExportModeProvider`, so server-only actions stay hidden.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import { HQFLOW_CLOUD_PUBLISHABLE_KEY, HQFLOW_CLOUD_URL, type SyncedProjectRow, type SyncedWorkflowRow } from "@schema/cloud";
import { WorkflowCanvas } from "../components/canvas";
import { StepDrawer } from "../components/drawer";
import { ExportModeProvider } from "../export-viewer/ExportModeContext";
import { useCodeHQStore } from "../store/useCodeHQStore";
import styles from "./CloudApp.module.css";

const supabase = createClient(HQFLOW_CLOUD_URL, HQFLOW_CLOUD_PUBLISHABLE_KEY);

type ProjectSummary = Pick<SyncedProjectRow, "id" | "name" | "updated_at">;
type WorkflowSummary = Pick<SyncedWorkflowRow, "workflow_id" | "name" | "updated_at">;

/** `#/<projectId>/<workflowId>` keeps the phone's back button working. */
function readRoute(): { projectId: string | null; workflowId: string | null } {
  const [projectId, workflowId] = window.location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  return { projectId: projectId || null, workflowId: workflowId || null };
}

function go(projectId?: string, workflowId?: string): void {
  window.location.hash = ["", projectId, workflowId].filter((part) => part !== undefined).map((part) => encodeURIComponent(part!)).join("/");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function CloudApp() {
  const theme = useCodeHQStore((state) => state.theme);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    const onHash = (): void => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  if (session === undefined) {
    return <main className={styles.page} aria-busy="true" />;
  }
  if (session === null) {
    return <SignIn />;
  }
  if (route.projectId !== null && route.workflowId !== null) {
    return <WorkflowView projectId={route.projectId} workflowId={route.workflowId} />;
  }
  if (route.projectId !== null) {
    return <WorkflowList projectId={route.projectId} />;
  }
  return <ProjectList email={session.user.email ?? ""} />;
}

function SignIn() {
  const [mode, setMode] = useState<"login" | "create">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error !== null) {
        setMessage(error.message);
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (error !== null) {
        setMessage(error.message);
      } else if (data.session === null) {
        setMessage(`Check ${email} for a confirmation link, then log in.`);
        setMode("login");
      }
    }
    setBusy(false);
  };

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={(event) => void submit(event)}>
        <h1 className={styles.title}>{mode === "login" ? "Log in to HQFlow" : "Create an HQFlow account"}</h1>
        <p className={styles.muted}>
          See the workflows you synced with <code>hqflow sync</code> on any device. Your source code is never uploaded.
        </p>
        <label className={styles.field}>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className={styles.field}>
          Password
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {message !== null ? <p className={styles.message} role="status">{message}</p> : null}
        <button className={styles.primary} type="submit" disabled={busy}>
          {mode === "login" ? "Log in" : "Create account"}
        </button>
        <button className={styles.link} type="button" onClick={() => setMode(mode === "login" ? "create" : "login")}>
          {mode === "login" ? "No account yet? Create one" : "Have an account? Log in"}
        </button>
      </form>
    </main>
  );
}

function useRows<T>(load: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, key: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    void load().then((result) => {
      setRows(result.data ?? []);
      setError(result.error?.message ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(reload, [reload]);
  return { rows, error, reload };
}

function ProjectList({ email }: { email: string }) {
  const { rows, error, reload } = useRows<ProjectSummary>(
    () => supabase.from("synced_projects").select("id,name,updated_at").order("updated_at", { ascending: false }),
    "projects",
  );

  const deleteAccount = async (): Promise<void> => {
    if (!window.confirm("Delete your HQFlow account and all synced projects? Local .codehq files are not changed.")) {
      return;
    }
    const { error: rpcError } = await supabase.rpc("delete_own_account");
    if (rpcError !== null) {
      window.alert(`Could not delete the account: ${rpcError.message}`);
      return;
    }
    await supabase.auth.signOut({ scope: "local" });
  };

  const deleteProject = async (project: ProjectSummary): Promise<void> => {
    if (!window.confirm(`Delete the cloud copy of "${project.name}"? Local .codehq files are not changed.`)) {
      return;
    }
    await supabase.from("synced_projects").delete().eq("id", project.id);
    reload();
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Your projects</h1>
        <span className={styles.muted}>{email}</span>
      </header>
      {error !== null ? <p className={styles.message} role="alert">{error}</p> : null}
      {rows !== null && rows.length === 0 ? (
        <p className={styles.muted}>
          No synced projects yet. Run <code>hqflow login</code>, then <code>hqflow sync</code> in a repository.
        </p>
      ) : null}
      <ul className={styles.list}>
        {(rows ?? []).map((project) => (
          <li key={project.id} className={styles.row}>
            <button className={styles.rowMain} type="button" onClick={() => go(project.id)}>
              <span className={styles.rowTitle}>{project.name}</span>
              <span className={styles.muted}>Updated {formatDate(project.updated_at)}</span>
            </button>
            <button className={styles.danger} type="button" onClick={() => void deleteProject(project)} aria-label={`Delete cloud copy of ${project.name}`}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <footer className={styles.footer}>
        <button className={styles.link} type="button" onClick={() => void supabase.auth.signOut({ scope: "local" })}>
          Log out
        </button>
        <button className={styles.dangerLink} type="button" onClick={() => void deleteAccount()}>
          Delete account
        </button>
      </footer>
    </main>
  );
}

function WorkflowList({ projectId }: { projectId: string }) {
  const [projectName, setProjectName] = useState("");
  const { rows, error } = useRows<WorkflowSummary>(
    () => supabase.from("synced_workflows").select("workflow_id,name,updated_at").eq("project_id", projectId).order("name"),
    projectId,
  );

  useEffect(() => {
    void supabase.from("synced_projects").select("name").eq("id", projectId).maybeSingle<{ name: string }>()
      .then(({ data }) => setProjectName(data?.name ?? "Project not found"));
  }, [projectId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button className={styles.link} type="button" onClick={() => go()}>
          ← Projects
        </button>
        <h1 className={styles.title}>{projectName}</h1>
      </header>
      {error !== null ? <p className={styles.message} role="alert">{error}</p> : null}
      {rows !== null && rows.length === 0 ? <p className={styles.muted}>This project has no synced workflows.</p> : null}
      <ul className={styles.list}>
        {(rows ?? []).map((workflow) => (
          <li key={workflow.workflow_id} className={styles.row}>
            <button className={styles.rowMain} type="button" onClick={() => go(projectId, workflow.workflow_id)}>
              <span className={styles.rowTitle}>{workflow.name}</span>
              <span className={styles.muted}>Updated {formatDate(workflow.updated_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

function WorkflowView({ projectId, workflowId }: { projectId: string; workflowId: string }) {
  const [row, setRow] = useState<SyncedWorkflowRow | null | undefined>(undefined);
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);
  const hydrateCanvasLayout = useCodeHQStore((state) => state.hydrateCanvasLayout);

  useEffect(() => {
    selectStep(null);
    void supabase.from("synced_workflows").select("*").eq("project_id", projectId).eq("workflow_id", workflowId)
      .maybeSingle<SyncedWorkflowRow>()
      .then(({ data }) => {
        if (data !== null) {
          hydrateCanvasLayout(data.workflow_id, data.layout);
        }
        setRow(data);
      });
  }, [hydrateCanvasLayout, projectId, selectStep, workflowId]);

  return (
    <ExportModeProvider value={{ hideFilePaths: false }}>
      <div className={styles.app}>
        <header className={styles.bar}>
          <button className={styles.link} type="button" onClick={() => go(projectId)}>
            ← Workflows
          </button>
          {row ? <span className={styles.muted}>Read-only · synced {formatDate(row.updated_at)}</span> : null}
        </header>
        <div className={styles.canvas}>
          {row === null ? <p className={styles.message}>This workflow was not found.</p> : null}
          {row ? <WorkflowCanvas workflow={row.workflow} sourceChecks={row.source_checks} exportEnabled={false} /> : null}
        </div>
      </div>
      {row && selectedStepId !== null ? (
        <StepDrawer
          workflow={row.workflow}
          stepId={selectedStepId}
          sourceChecks={row.source_checks}
          onClose={() => selectStep(null)}
          onSelectStep={selectStep}
        />
      ) : null}
    </ExportModeProvider>
  );
}
