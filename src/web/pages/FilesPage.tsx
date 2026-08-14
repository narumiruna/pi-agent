import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FilePlusIcon,
  MagnifyingGlassIcon,
  Pencil1Icon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Flex,
  Heading,
  Spinner,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  WorkspaceDirectory,
  WorkspaceFile,
  WorkspaceMatch,
} from "../../shared/contracts.js";
import { ApiError, api, mutation } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DialogPortal } from "../components/DialogPortal.js";

interface Props {
  onDirtyChange?: (dirty: boolean) => void;
}

type FileDialogKind = "create" | "rename";

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function joinPath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function apiReason(error: unknown): string | undefined {
  return error instanceof ApiError && typeof error.params?.reason === "string"
    ? error.params.reason
    : undefined;
}

export function FilesPage({ onDirtyChange }: Props) {
  const { t } = useTranslation();
  const [directoryPath, setDirectoryPath] = useState("");
  const [directory, setDirectory] = useState<WorkspaceDirectory>();
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string>();
  const [selected, setSelected] = useState<WorkspaceFile>();
  const [draft, setDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [fileErrorReason, setFileErrorReason] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [fileDialog, setFileDialog] = useState<FileDialogKind>();
  const [fileName, setFileName] = useState("");
  const [fileDialogError, setFileDialogError] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingDiscardAction = useRef<(() => void) | undefined>(undefined);
  const directoryRequest = useRef(0);
  const fileRequest = useRef(0);

  const dirty = Boolean(
    selected?.content !== undefined && draft !== selected.content,
  );

  const errorMessage = useCallback(
    (error: unknown) => {
      switch (apiReason(error)) {
        case "binary":
          return t("filesBinary");
        case "exists":
          return t("filesExists");
        case "invalid_path":
          return t("filesInvalidPath");
        case "not_found":
          return t("filesNotFound");
        case "read_only":
          return t("filesReadOnly");
        case "stale":
          return t("filesStale");
        case "too_large":
          return t("filesTooLarge");
        default:
          return t("filesRequestFailed");
      }
    },
    [t],
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      const request = ++directoryRequest.current;
      setDirectoryPath(path);
      setDirectoryLoading(true);
      setDirectoryError(undefined);
      try {
        const result = await api<WorkspaceDirectory>(
          `/api/workspace/entries?path=${encodeURIComponent(path)}`,
        );
        if (request === directoryRequest.current) setDirectory(result);
      } catch (error) {
        if (request === directoryRequest.current) {
          setDirectory(undefined);
          setDirectoryError(errorMessage(error));
        }
      } finally {
        if (request === directoryRequest.current) setDirectoryLoading(false);
      }
    },
    [errorMessage],
  );

  const loadFile = useCallback(
    async (path: string) => {
      const request = ++fileRequest.current;
      setFileLoading(true);
      setFileError(undefined);
      setFileErrorReason(undefined);
      setStatus(undefined);
      try {
        const result = await api<WorkspaceFile>(
          `/api/workspace/file?path=${encodeURIComponent(path)}`,
        );
        if (request !== fileRequest.current) return;
        setSelected(result);
        setDraft(result.content ?? "");
      } catch (error) {
        if (request === fileRequest.current) {
          setSelected(undefined);
          setDraft("");
          setFileError(errorMessage(error));
          setFileErrorReason(apiReason(error));
        }
      } finally {
        if (request === fileRequest.current) setFileLoading(false);
      }
    },
    [errorMessage],
  );

  useEffect(() => void loadDirectory(""), [loadDirectory]);

  useEffect(
    () => () => {
      directoryRequest.current += 1;
      fileRequest.current += 1;
    },
    [],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(undefined);
      return;
    }
    const abort = new AbortController();
    setSearching(true);
    setSearchError(undefined);
    const timer = window.setTimeout(() => {
      void api<WorkspaceMatch[]>(
        `/api/workspace/files?q=${encodeURIComponent(query)}&limit=50`,
        { signal: abort.signal },
      )
        .then((results) => {
          setSearchResults(results);
          setSearching(false);
        })
        .catch((error) => {
          if (!abort.signal.aborted) {
            setSearchResults([]);
            setSearching(false);
            setSearchError(errorMessage(error));
          }
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [errorMessage, search]);

  const requestDiscard = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    pendingDiscardAction.current = action;
    setDiscardOpen(true);
  };

  const confirmDiscard = () => {
    setDraft(selected?.content ?? "");
    setDiscardOpen(false);
    const action = pendingDiscardAction.current;
    pendingDiscardAction.current = undefined;
    action?.();
  };

  const clearSelection = () => {
    fileRequest.current += 1;
    setSelected(undefined);
    setDraft("");
    setFileError(undefined);
    setFileErrorReason(undefined);
    setStatus(undefined);
  };

  const openDirectory = (path: string) => {
    requestDiscard(() => {
      clearSelection();
      void loadDirectory(path);
    });
  };

  const openFile = (path: string) => {
    requestDiscard(() => void loadFile(path));
  };

  const openSearchResult = (result: WorkspaceMatch) => {
    setSearch("");
    setSearchResults([]);
    setSearchError(undefined);
    if (result.directory) {
      openDirectory(result.path);
      return;
    }
    requestDiscard(() => {
      void loadDirectory(parentPath(result.path));
      void loadFile(result.path);
    });
  };

  const save = async () => {
    if (!selected || selected.content === undefined || pending) return;
    setPending(true);
    setFileError(undefined);
    setFileErrorReason(undefined);
    setStatus(undefined);
    try {
      const result = await api<WorkspaceFile>(
        "/api/workspace/file",
        mutation("PUT", {
          path: selected.path,
          content: draft,
          revision: selected.revision,
        }),
      );
      setSelected(result);
      setDraft(result.content ?? draft);
      setStatus(t("filesSaved"));
      await loadDirectory(parentPath(result.path));
    } catch (error) {
      setFileError(errorMessage(error));
      setFileErrorReason(apiReason(error));
    } finally {
      setPending(false);
    }
  };

  const openFileDialog = (kind: FileDialogKind) => {
    requestDiscard(() => {
      setFileName(kind === "rename" ? (selected?.name ?? "") : "");
      setFileDialogError(undefined);
      setFileDialog(kind);
    });
  };

  const submitFileDialog = async () => {
    const name = fileName.trim();
    if (!name || pending || !fileDialog) return;
    setPending(true);
    setFileError(undefined);
    setFileErrorReason(undefined);
    setFileDialogError(undefined);
    setDirectoryError(undefined);
    setStatus(undefined);
    try {
      const result =
        fileDialog === "create"
          ? await api<WorkspaceFile>(
              "/api/workspace/file",
              mutation("PUT", {
                path: joinPath(directoryPath, name),
                content: "",
              }),
            )
          : selected
            ? await api<WorkspaceFile>(
                "/api/workspace/file",
                mutation("PATCH", {
                  path: selected.path,
                  name,
                  revision: selected.revision,
                }),
              )
            : undefined;
      if (!result) return;
      setFileDialog(undefined);
      setFileName("");
      setSelected(result);
      setDraft(result.content ?? "");
      setStatus(
        fileDialog === "create" ? t("filesCreated") : t("filesRenamed"),
      );
      await loadDirectory(parentPath(result.path));
    } catch (error) {
      setFileDialogError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const requestDelete = () => {
    requestDiscard(() => setDeleteOpen(true));
  };

  const deleteFile = async () => {
    if (!selected || pending) return;
    setDeleteOpen(false);
    setPending(true);
    setFileError(undefined);
    setFileErrorReason(undefined);
    setStatus(undefined);
    const deletedPath = selected.path;
    try {
      await api(
        "/api/workspace/file",
        mutation("DELETE", {
          path: selected.path,
          revision: selected.revision,
        }),
      );
      clearSelection();
      setStatus(t("filesDeleted"));
      await loadDirectory(parentPath(deletedPath));
    } catch (error) {
      setFileError(errorMessage(error));
      setFileErrorReason(apiReason(error));
    } finally {
      setPending(false);
    }
  };

  const breadcrumbs = useMemo(() => {
    const result = [{ label: t("filesWorkspace"), path: "" }];
    let path = "";
    for (const segment of directoryPath.split("/")) {
      if (!segment) continue;
      path = joinPath(path, segment);
      result.push({ label: segment, path });
    }
    return result;
  }, [directoryPath, t]);

  return (
    <section className="filesPage" aria-labelledby="files-heading">
      <header className="filesHeader">
        <div>
          <Heading id="files-heading" size="6">
            {t("files")}
          </Heading>
          <Text as="p" color="gray">
            {t("filesDescription")}
          </Text>
        </div>
        <Button
          highContrast
          disabled={!directory?.writable || directoryLoading || pending}
          onClick={() => openFileDialog("create")}
        >
          <FilePlusIcon /> {t("filesNewFile")}
        </Button>
      </header>

      <div className="filesSearch">
        <TextField.Root
          aria-label={t("filesSearch")}
          placeholder={t("filesSearch")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
        {search.trim() && (
          <section
            className="filesSearchResults"
            aria-label={t("filesSearchResults")}
          >
            {searching ? (
              <div className="filesSearchState">
                <Spinner size="1" /> {t("loading")}
              </div>
            ) : searchError ? (
              <div className="filesSearchState" role="alert">
                {searchError}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="filesSearchState">
                {t("filesNoSearchResults")}
              </div>
            ) : (
              searchResults.map((result) => (
                <button
                  type="button"
                  key={`${result.directory}-${result.path}`}
                  disabled={pending}
                  onClick={() => openSearchResult(result)}
                >
                  <FileIcon aria-hidden="true" />
                  <span>{result.path}</span>
                  <small>{result.directory ? t("directory") : t("file")}</small>
                </button>
              ))
            )}
          </section>
        )}
      </div>

      <nav className="filesBreadcrumbs" aria-label={t("filesBreadcrumbs")}>
        {breadcrumbs.map((breadcrumb, index) => (
          <span key={breadcrumb.path || "root"}>
            {index > 0 && <ChevronRightIcon aria-hidden="true" />}
            <button
              type="button"
              disabled={pending || breadcrumb.path === directoryPath}
              onClick={() => openDirectory(breadcrumb.path)}
            >
              {breadcrumb.label}
            </button>
          </span>
        ))}
      </nav>

      {status && (
        <div className="filesNotice success filesGlobalNotice" role="status">
          {status}
        </div>
      )}

      <div className="filesLayout">
        <section className="filesBrowser" aria-label={t("filesBrowser")}>
          {directoryLoading ? (
            <div className="filesPaneState">
              <Spinner /> {t("loading")}
            </div>
          ) : directoryError ? (
            <div className="filesPaneState" role="alert">
              <span>{directoryError}</span>
              <Button
                highContrast
                variant="soft"
                onClick={() => void loadDirectory(directoryPath)}
              >
                {t("tryAgain")}
              </Button>
            </div>
          ) : directory?.entries.length ? (
            <ul className="filesEntries">
              {directory.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    disabled={pending}
                    className={selected?.path === entry.path ? "selected" : ""}
                    onClick={() =>
                      entry.kind === "directory"
                        ? openDirectory(entry.path)
                        : openFile(entry.path)
                    }
                  >
                    <FileIcon aria-hidden="true" />
                    <span>{entry.name}</span>
                    <small>
                      {entry.kind === "directory"
                        ? t("directory")
                        : formatBytes(entry.size ?? 0)}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="filesPaneState">{t("filesEmptyDirectory")}</div>
          )}
          {directory?.truncated && (
            <div className="filesNotice" role="status">
              {t("filesDirectoryTruncated")}
            </div>
          )}
          {directory && !directory.writable && (
            <div className="filesNotice" role="status">
              {t("filesDirectoryReadOnly")}
            </div>
          )}
        </section>

        <section className="filesEditor" aria-label={t("filesEditor")}>
          {fileLoading ? (
            <div className="filesPaneState">
              <Spinner /> {t("loading")}
            </div>
          ) : selected ? (
            <>
              <header className="filesEditorHeader">
                <div>
                  <Heading size="4">{selected.name}</Heading>
                  <Text as="p" size="1" color="gray">
                    {selected.path} · {formatBytes(selected.size)}
                  </Text>
                </div>
                <Flex gap="2" wrap="wrap">
                  {selected.downloadable && (
                    <Button asChild highContrast variant="soft">
                      <a
                        href={`/api/workspace/download?path=${encodeURIComponent(selected.path)}`}
                      >
                        <DownloadIcon /> {t("filesDownload")}
                      </a>
                    </Button>
                  )}
                  <Button
                    highContrast
                    variant="soft"
                    disabled={!selected.writable || pending}
                    onClick={() => openFileDialog("rename")}
                  >
                    <Pencil1Icon /> {t("filesRename")}
                  </Button>
                  <Button
                    highContrast
                    color="red"
                    variant="soft"
                    disabled={!selected.writable || pending}
                    onClick={requestDelete}
                  >
                    <TrashIcon /> {t("delete")}
                  </Button>
                </Flex>
              </header>

              {selected.content !== undefined ? (
                <TextArea
                  className="filesTextEditor"
                  aria-label={t("filesFileContent", { name: selected.name })}
                  readOnly={!selected.editable}
                  rows={24}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              ) : (
                <div className="filesUnsupported">
                  <FileIcon width="32" height="32" aria-hidden="true" />
                  <Text weight="medium">
                    {selected.reason === "too_large"
                      ? t("filesTooLargePreview")
                      : t("filesBinaryPreview")}
                  </Text>
                  <Text size="2" color="gray">
                    {selected.downloadable
                      ? t("filesDownloadInstead")
                      : t("filesDownloadUnavailable")}
                  </Text>
                </div>
              )}

              {selected.reason === "read_only" && (
                <div className="filesNotice" role="status">
                  {t("filesReadOnlyPreview")}
                </div>
              )}
              {fileError && (
                <div className="filesNotice error" role="alert">
                  <span>{fileError}</span>
                  {fileErrorReason === "stale" && (
                    <Button
                      highContrast
                      variant="soft"
                      onClick={() =>
                        requestDiscard(() => void loadFile(selected.path))
                      }
                    >
                      {t("filesReloadDisk")}
                    </Button>
                  )}
                </div>
              )}
              {selected.content !== undefined && selected.editable && (
                <Flex justify="end">
                  <Button
                    highContrast
                    disabled={!dirty || pending}
                    onClick={() => void save()}
                  >
                    {pending ? t("filesSaving") : t("save")}
                  </Button>
                </Flex>
              )}
            </>
          ) : fileError ? (
            <div className="filesPaneState" role="alert">
              {fileError}
            </div>
          ) : (
            <div className="filesPaneState">{t("filesSelectFile")}</div>
          )}
        </section>
      </div>

      <Dialog.Root
        open={fileDialog !== undefined}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setFileDialog(undefined);
            setFileDialogError(undefined);
          }
        }}
      >
        <DialogPortal>
          <Dialog.Overlay className="dialogOverlay" />
          <Dialog.Content className="dialogContent fileNameDialog">
            <Dialog.Title className="dialogTitle">
              {fileDialog === "rename"
                ? t("filesRenameFile")
                : t("filesCreateFile")}
            </Dialog.Title>
            <Dialog.Description asChild>
              <Text as="p" color="gray">
                {t("filesNameDescription")}
              </Text>
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitFileDialog();
              }}
            >
              <TextField.Root
                autoFocus
                aria-label={t("name")}
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
              />
              {fileDialogError && (
                <div className="filesNotice error" role="alert">
                  {fileDialogError}
                </div>
              )}
              <Flex className="dialogActions" gap="2" justify="end">
                <Dialog.Close asChild>
                  <Button
                    highContrast
                    type="button"
                    variant="soft"
                    disabled={pending}
                  >
                    {t("cancel")}
                  </Button>
                </Dialog.Close>
                <Button
                  highContrast
                  type="submit"
                  disabled={!fileName.trim() || pending}
                >
                  {fileDialog === "rename"
                    ? t("filesRename")
                    : t("filesCreate")}
                </Button>
              </Flex>
            </form>
          </Dialog.Content>
        </DialogPortal>
      </Dialog.Root>

      <ConfirmDialog
        open={deleteOpen}
        destructive
        title={t("filesDeleteFile")}
        description={t("filesDeleteDescription", {
          name: selected?.name ?? "",
        })}
        confirmLabel={t("delete")}
        onOpenChange={(open) => {
          if (!pending) setDeleteOpen(open);
        }}
        onConfirm={() => void deleteFile()}
      />
      <ConfirmDialog
        open={discardOpen}
        title={t("filesDiscardTitle")}
        description={t("filesDiscardDescription")}
        confirmLabel={t("filesDiscard")}
        onOpenChange={(open) => {
          setDiscardOpen(open);
          if (!open) pendingDiscardAction.current = undefined;
        }}
        onConfirm={confirmDiscard}
      />
    </section>
  );
}
