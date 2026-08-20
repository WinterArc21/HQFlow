/**
 * Owns the local Folder organization of workflows — split out of `App.tsx` along the same seam
 * as `useSavedLayout.ts`: fetching `/api/folders` on mount and exposing create/rename/delete/
 * assign actions that refetch afterwards, so the navigator always renders the server's view.
 */
import { useCallback, useEffect, useState } from "react";
import {
  assignWorkflowToFolder,
  createFolder,
  deleteFolder,
  getFolders,
  renameFolder,
  reorderFolder,
  type FolderState,
} from "../../api/client";

const EMPTY_STATE: FolderState = { folders: [] };

export interface UseFoldersResult {
  folderState: FolderState;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  assignWorkflowToFolder: (workflowId: string, folderId: string | null) => Promise<void>;
  reorderFolder: (folderId: string, workflowIds: string[]) => Promise<void>;
}

export function useFolders(): UseFoldersResult {
  const [folderState, setFolderState] = useState<FolderState>(EMPTY_STATE);

  const refetch = useCallback(async () => {
    const state = await getFolders().catch(() => EMPTY_STATE);
    setFolderState(state);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getFolders()
      .catch(() => EMPTY_STATE)
      .then((state) => {
        if (!cancelled) {
          setFolderState(state);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    folderState,
    createFolder: useCallback(async (name: string) => {
      await createFolder(name);
      await refetch();
    }, [refetch]),
    renameFolder: useCallback(async (folderId: string, name: string) => {
      await renameFolder(folderId, name);
      await refetch();
    }, [refetch]),
    deleteFolder: useCallback(async (folderId: string) => {
      await deleteFolder(folderId);
      await refetch();
    }, [refetch]),
    assignWorkflowToFolder: useCallback(async (workflowId: string, folderId: string | null) => {
      await assignWorkflowToFolder(workflowId, folderId);
      await refetch();
    }, [refetch]),
    reorderFolder: useCallback(async (folderId: string, workflowIds: string[]) => {
      await reorderFolder(folderId, workflowIds);
      await refetch();
    }, [refetch]),
  };
}
