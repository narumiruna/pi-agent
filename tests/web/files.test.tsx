// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EditorSettings } from "../../src/web/editor/config.js";
import i18n, { setLanguage } from "../../src/web/i18n.js";

interface MockEditorProps {
  appearance: "dark" | "light";
  ariaLabel: string;
  path: string;
  pending: boolean;
  readOnly: boolean;
  settings: EditorSettings;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onSettingsChange: (settings: EditorSettings) => void;
}

interface MockDiffProps {
  modified: string;
  modifiedLabel: string;
  original: string;
  originalLabel: string;
  onModifiedChange: (value: string) => void;
}

vi.mock("../../src/web/components/CodeEditor.js", () => ({
  CodeEditor: ({
    ariaLabel,
    pending,
    readOnly,
    value,
    onChange,
    onSave,
  }: MockEditorProps) => (
    <textarea
      aria-label={ariaLabel}
      readOnly={readOnly}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "s" && !pending) {
          event.preventDefault();
          onSave();
        }
      }}
    />
  ),
  CodeDiffEditor: ({
    modified,
    modifiedLabel,
    original,
    originalLabel,
    onModifiedChange,
  }: MockDiffProps) => (
    <div>
      <textarea aria-label={originalLabel} readOnly value={original} />
      <textarea
        aria-label={modifiedLabel}
        value={modified}
        onChange={(event) => onModifiedChange(event.target.value)}
      />
    </div>
  ),
}));

import { FilesPage } from "../../src/web/pages/FilesPage.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function file(
  path: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const name = path.split("/").at(-1) ?? path;
  return {
    path,
    name,
    kind: "file",
    modifiedAt: 1,
    size: 4,
    revision: `revision-${name}`,
    downloadable: true,
    editable: true,
    writable: true,
    content: "text",
    ...overrides,
  };
}

function listing(
  path: string,
  entries: Array<Record<string, unknown>>,
  writable = true,
): Record<string, unknown> {
  return { path, entries, truncated: false, writable };
}

describe("Files page", () => {
  beforeEach(async () => {
    await setLanguage("en");
    vi.stubGlobal("fetch", vi.fn());
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test("browses lazily and saves a revision-protected text edit", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(
          listing("", [
            {
              path: "src",
              name: "src",
              kind: "directory",
              modifiedAt: 1,
            },
          ]),
        );
      }
      if (url === "/api/workspace/entries?path=src") {
        return json(
          listing("src", [
            {
              path: "src/index.ts",
              name: "index.ts",
              kind: "file",
              modifiedAt: 1,
              size: 4,
            },
          ]),
        );
      }
      if (url === "/api/workspace/file?path=src%2Findex.ts") {
        return json(file("src/index.ts", { content: "old" }));
      }
      if (url === "/api/workspace/file" && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({
          path: "src/index.ts",
          content: "new content",
          revision: "revision-index.ts",
        });
        return json(
          file("src/index.ts", {
            content: "new content",
            revision: "revision-updated",
            size: 11,
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage />
      </Theme>,
    );

    await user.click(await screen.findByRole("button", { name: /src/i }));
    expect(
      await screen.findByRole("button", { name: /index\.ts/i }),
    ).toBeVisible();
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/workspace/file?path=src%2Findex.ts",
      expect.anything(),
    );
    await user.click(screen.getByRole("button", { name: /index\.ts/i }));
    const editor = await screen.findByLabelText("Contents of index.ts");
    expect(editor).toHaveValue("old");
    await user.clear(editor);
    await user.type(editor, "new content");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("File saved.")).toBeVisible();
    expect(editor).toHaveValue("new content");
  });

  test("prevents draft changes while a save is pending", async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    const saveResponse = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(
          listing("", [
            {
              path: "notes.txt",
              name: "notes.txt",
              kind: "file",
              modifiedAt: 1,
              size: 3,
            },
          ]),
        );
      }
      if (url === "/api/workspace/file?path=notes.txt") {
        return json(file("notes.txt", { content: "old" }));
      }
      if (url === "/api/workspace/file" && init?.method === "PUT") {
        return saveResponse;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage />
      </Theme>,
    );

    await user.click(
      await screen.findByRole("button", { name: /notes\.txt/i }),
    );
    const editor = await screen.findByLabelText("Contents of notes.txt");
    await user.clear(editor);
    await user.type(editor, "saved draft");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(editor).toHaveAttribute("readonly");
    await user.type(editor, " must not be lost");
    expect(editor).toHaveValue("saved draft");

    await act(async () => {
      resolveSave?.(
        json(
          file("notes.txt", {
            content: "saved draft",
            revision: "revision-saved",
          }),
        ),
      );
    });
    expect(await screen.findByText("File saved.")).toBeVisible();
    expect(editor).toHaveValue("saved draft");
  });

  test("creates, renames, and confirms deletion without duplicate submissions", async () => {
    let currentName: string | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(
          listing(
            "",
            currentName
              ? [
                  {
                    path: currentName,
                    name: currentName,
                    kind: "file",
                    modifiedAt: 1,
                    size: 0,
                  },
                ]
              : [],
          ),
        );
      }
      if (url === "/api/workspace/file" && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({
          path: "created.txt",
          content: "",
        });
        currentName = "created.txt";
        return json(file(currentName, { content: "", size: 0 }), 201);
      }
      if (url === "/api/workspace/file" && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          path: "created.txt",
          name: "renamed.txt",
        });
        currentName = "renamed.txt";
        return json(
          file(currentName, {
            content: "",
            revision: "revision-renamed",
            size: 0,
          }),
        );
      }
      if (url === "/api/workspace/file" && init?.method === "DELETE") {
        expect(JSON.parse(String(init.body))).toEqual({
          path: "renamed.txt",
          revision: "revision-renamed",
        });
        currentName = undefined;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage />
      </Theme>,
    );

    await user.click(await screen.findByRole("button", { name: "New file" }));
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "created.txt",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("File created.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "renamed.txt");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("File renamed.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/permanently deleted/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Delete", hidden: false }),
    );
    expect(await screen.findByText("File deleted.")).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, options]) => options?.method === "DELETE"),
    ).toHaveLength(1);
  });

  test("keeps a failed create name and error inside its dialog", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(listing("", []));
      }
      if (url === "/api/workspace/file" && init?.method === "PUT") {
        return json(
          { error: { code: "conflict", params: { reason: "exists" } } },
          409,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage />
      </Theme>,
    );

    await user.click(await screen.findByRole("button", { name: "New file" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.type(name, "existing.txt");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("A file with that name already exists."),
    ).toBeVisible();
    expect(name).toHaveValue("existing.txt");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  test("reviews and saves a stale draft against the latest revision", async () => {
    let diskContent = "original";
    let saveAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(
          listing("", [
            {
              path: "notes.txt",
              name: "notes.txt",
              kind: "file",
              modifiedAt: 1,
              size: diskContent.length,
            },
          ]),
        );
      }
      if (url === "/api/workspace/file?path=notes.txt") {
        return json(
          file("notes.txt", {
            content: diskContent,
            revision: `revision-${diskContent}`,
          }),
        );
      }
      if (url === "/api/workspace/file" && init?.method === "PUT") {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          diskContent = "changed outside";
          return json(
            { error: { code: "conflict", params: { reason: "stale" } } },
            409,
          );
        }
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({
          path: "notes.txt",
          content: "merged draft",
          revision: "revision-changed outside",
        });
        diskContent = body.content;
        return json(
          file("notes.txt", {
            content: diskContent,
            revision: "revision-merged",
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage />
      </Theme>,
    );

    await user.click(
      await screen.findByRole("button", { name: /notes\.txt/i }),
    );
    const editor = await screen.findByLabelText("Contents of notes.txt");
    await user.clear(editor);
    await user.type(editor, "my unsaved draft");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Review file changes")).toBeVisible();
    expect(screen.getByLabelText("Latest disk version")).toHaveValue(
      "changed outside",
    );
    const merged = screen.getByLabelText("Your editable draft");
    expect(merged).toHaveValue("my unsaved draft");
    await user.clear(merged);
    await user.type(merged, "merged draft");
    await user.click(
      screen.getByRole("button", { name: "Apply merged draft" }),
    );

    expect(screen.getByText("Merged draft is ready to save.")).toBeVisible();
    expect(screen.getByLabelText("Contents of notes.txt")).toHaveValue(
      "merged draft",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("File saved.")).toBeVisible();
  });

  test("can cancel repeated stale reviews and explicitly reload the disk version", async () => {
    let diskContent = "original";
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(
          listing("", [
            {
              path: "notes.txt",
              name: "notes.txt",
              kind: "file",
              modifiedAt: 1,
              size: diskContent.length,
            },
          ]),
        );
      }
      if (url === "/api/workspace/file?path=notes.txt") {
        return json(
          file("notes.txt", {
            content: diskContent,
            revision: `revision-${diskContent}`,
          }),
        );
      }
      if (url === "/api/workspace/file" && init?.method === "PUT") {
        diskContent = "changed outside";
        return json(
          { error: { code: "conflict", params: { reason: "stale" } } },
          409,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage />
      </Theme>,
    );
    await user.click(
      await screen.findByRole("button", { name: /notes\.txt/i }),
    );
    const editor = await screen.findByLabelText("Contents of notes.txt");
    await user.clear(editor);
    await user.type(editor, "local draft");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(
      await screen.findByRole("button", { name: "Cancel", hidden: false }),
    );
    expect(screen.getByLabelText("Contents of notes.txt")).toHaveValue(
      "local draft",
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(
      await screen.findByRole("button", { name: "Use disk version" }),
    );
    expect(screen.getByLabelText("Contents of notes.txt")).toHaveValue(
      "changed outside",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  test.each([
    [
      "unsupported content",
      () =>
        json(
          file("notes.txt", {
            content: undefined,
            editable: false,
            reason: "binary",
          }),
        ),
      "The latest file cannot be merged here. Your local draft is unchanged.",
    ],
    [
      "a missing refreshed file",
      () =>
        json(
          { error: { code: "not_found", params: { reason: "not_found" } } },
          404,
        ),
      "This file is no longer available.",
    ],
    [
      "a refresh error",
      () => json({ error: { code: "server_error" } }, 500),
      "The file operation failed. Try again.",
    ],
  ])(
    "preserves the draft when stale refresh returns %s",
    async (_case, refresh, message) => {
      let reads = 0;
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/api/workspace/entries?path=")
          return json(
            listing("", [
              {
                path: "notes.txt",
                name: "notes.txt",
                kind: "file",
                modifiedAt: 1,
                size: 8,
              },
            ]),
          );
        if (url === "/api/workspace/file?path=notes.txt") {
          reads += 1;
          return reads === 1
            ? json(file("notes.txt", { content: "original" }))
            : refresh();
        }
        if (url === "/api/workspace/file" && init?.method === "PUT")
          return json(
            { error: { code: "conflict", params: { reason: "stale" } } },
            409,
          );
        throw new Error(`Unexpected request: ${url}`);
      });
      const user = userEvent.setup();

      render(
        <Theme>
          <FilesPage />
        </Theme>,
      );
      await user.click(
        await screen.findByRole("button", { name: /notes\.txt/i }),
      );
      const editor = await screen.findByLabelText("Contents of notes.txt");
      await user.clear(editor);
      await user.type(editor, "local draft");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByLabelText("Contents of notes.txt")).toHaveValue(
        "local draft",
      );
      expect(screen.queryByText("Review file changes")).not.toBeInTheDocument();
    },
  );

  test("confirms dirty file switches and renders metadata-only files safely", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(
          listing("", [
            {
              path: "editable.txt",
              name: "editable.txt",
              kind: "file",
              modifiedAt: 1,
              size: 4,
            },
            {
              path: "binary.dat",
              name: "binary.dat",
              kind: "file",
              modifiedAt: 1,
              size: 50,
            },
            {
              path: "read-only.txt",
              name: "read-only.txt",
              kind: "file",
              modifiedAt: 1,
              size: 7,
            },
          ]),
        );
      }
      if (url === "/api/workspace/file?path=editable.txt") {
        return json(file("editable.txt", { content: "edit" }));
      }
      if (url === "/api/workspace/file?path=binary.dat") {
        return json(
          file("binary.dat", {
            content: undefined,
            editable: false,
            reason: "binary",
            size: 50,
          }),
        );
      }
      if (url === "/api/workspace/file?path=read-only.txt") {
        return json(
          file("read-only.txt", {
            content: "preview",
            editable: false,
            writable: false,
            reason: "read_only",
            size: 7,
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const onDirtyChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage onDirtyChange={onDirtyChange} />
      </Theme>,
    );

    await user.click(
      await screen.findByRole("button", { name: /editable\.txt/i }),
    );
    const editor = await screen.findByLabelText("Contents of editable.txt");
    await user.type(editor, " changed");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("button", { name: /binary\.dat/i }));
    expect(screen.getByText("Discard unsaved changes?")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(editor).toHaveValue("edit changed");

    await user.click(screen.getByRole("button", { name: /binary\.dat/i }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      await screen.findByText("This file cannot be shown as text."),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("Contents of binary.dat"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/api/workspace/download?path=binary.dat",
    );

    await user.click(screen.getByRole("button", { name: /read-only\.txt/i }));
    const preview = await screen.findByLabelText("Contents of read-only.txt");
    expect(preview).toHaveValue("preview");
    expect(preview).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByText(/Preview only/)).toBeVisible();
  });

  test("search opens a nested file while loading only its parent directory", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/workspace/entries?path=") {
        return json(listing("", []));
      }
      if (url.startsWith("/api/workspace/files?")) {
        return json([{ path: "src/result.ts", directory: false }]);
      }
      if (url === "/api/workspace/entries?path=src") {
        return json(
          listing("src", [
            {
              path: "src/result.ts",
              name: "result.ts",
              kind: "file",
              modifiedAt: 1,
              size: 6,
            },
          ]),
        );
      }
      if (url === "/api/workspace/file?path=src%2Fresult.ts") {
        return json(file("src/result.ts", { content: "result" }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <FilesPage />
      </Theme>,
    );

    await user.type(
      await screen.findByRole("textbox", { name: "Search workspace files" }),
      "result",
    );
    await user.click(
      await screen.findByRole("button", { name: /src\/result\.ts/i }),
    );

    expect(await screen.findByLabelText("Contents of result.ts")).toHaveValue(
      "result",
    );
    expect(screen.getByRole("button", { name: "src" })).toBeDisabled();
  });

  test("provides English and Traditional Chinese Files labels", async () => {
    expect(i18n.t("files", { lng: "en" })).toBe("Files");
    expect(i18n.t("files", { lng: "zh-TW" })).toBe("檔案");
  });
});
