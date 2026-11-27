import { Extension, useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import Suggestion from "@tiptap/suggestion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { docToMarkdown, markdownToDoc, type DocNode } from "../lib/noteDoc";
import type { AttachmentResolver } from "../lib/attachmentImageExtension";
import { CELL_FILLS, noteExtensions } from "../lib/noteEditorSchema";
import { columnShares, setColumnShares } from "../lib/noteTableView";
import { focusRing } from "../lib/styles";

/** Uploads a chosen image and returns how to reference it, or null to cancel. */
export type ImageUploader = (
  file: File,
) => Promise<{ attachmentId: string; alt: string } | null>;

type Range = { from: number; to: number };

type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
};

const COMMANDS: SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    hint: "Plain paragraph",
    keywords: ["paragraph", "body", "plain"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `h${level}`,
    label: `Heading ${level}`,
    hint: `Level ${level} section title`,
    keywords: ["heading", "title", `h${level}`],
    run: (editor: Editor, range: Range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level }).run(),
  })),
  {
    id: "bullet",
    label: "Bulleted list",
    hint: "An unordered list",
    keywords: ["bullet", "unordered", "ul", "list"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "Numbered list",
    hint: "A list that counts",
    keywords: ["ordered", "number", "ol", "list"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "task",
    label: "Task list",
    hint: "Checkboxes you can tick",
    keywords: ["task", "todo", "check", "box"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    hint: "Set text apart",
    keywords: ["quote", "blockquote", "cite"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code block",
    hint: "Monospaced, with highlighting",
    keywords: ["code", "pre", "snippet", "fence"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "table",
    label: "Table",
    hint: "Three columns to start",
    keywords: ["table", "grid", "rows", "columns"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "rule",
    label: "Divider",
    hint: "A horizontal rule",
    keywords: ["divider", "rule", "hr", "separator", "line"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

function matchCommands(query: string, extra: SlashCommand[]): SlashCommand[] {
  const all = [...COMMANDS, ...extra];
  const needle = query.trim().toLowerCase();
  if (!needle) return all;
  return all.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.keywords.some((word) => word.startsWith(needle)),
  );
}

type SlashState = {
  items: SlashCommand[];
  index: number;
  rect: DOMRect | null;
  apply: (command: SlashCommand) => void;
};

/** Handlers the suggestion plugin calls, held in a ref so the plugin is built once. */
type SlashBridge = {
  open: (state: Omit<SlashState, "index">) => void;
  move: (delta: number) => void;
  choose: () => boolean;
  close: () => void;
};

function slashExtension(bridge: { current: SlashBridge }, extra: { current: SlashCommand[] }) {
  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand>({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          items: ({ query }) => matchCommands(query, extra.current),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) =>
              bridge.current.open({
                items: props.items,
                rect: props.clientRect?.() ?? null,
                apply: (command) => props.command(command),
              }),
            onUpdate: (props) =>
              bridge.current.open({
                items: props.items,
                rect: props.clientRect?.() ?? null,
                apply: (command) => props.command(command),
              }),
            onKeyDown: (props) => {
              if (props.event.key === "ArrowDown") {
                bridge.current.move(1);
                return true;
              }
              if (props.event.key === "ArrowUp") {
                bridge.current.move(-1);
                return true;
              }
              if (props.event.key === "Enter" || props.event.key === "Tab") {
                return bridge.current.choose();
              }
              if (props.event.key === "Escape") {
                bridge.current.close();
                return true;
              }
              return false;
            },
            onExit: () => bridge.current.close(),
          }),
        }),
      ];
    },
  });
}

type Props = {
  /** Changing this loads a different note, replacing the editor's document. */
  noteId: string;
  /** Markdown for `noteId`. Read when the note is loaded, not on every change. */
  value: string;
  onChange: (markdown: string) => void;
  /**
   * Drawn at the top of the document column, which is where the note title
   * goes. Inside the column rather than above it, so the title cannot drift out
   * of line with the body and scrolls with it.
   */
  header?: ReactNode;
  /**
   * Resolves a note photo's id to an object URL for display. Kept stable by the
   * caller: the editor builds its extensions once per note.
   */
  resolveAttachment?: AttachmentResolver;
  /** Uploads a picked image; absent disables the photo command. */
  onUploadImage?: ImageUploader;
  /** The saved display width in px for a photo, or undefined for natural size. */
  getAttachmentWidth?: (attachmentId: string) => number | undefined;
  /** Persists a photo's new display width after a corner drag. */
  onResizeAttachment?: (attachmentId: string, width: number) => void;
};

const PLACEHOLDER = "Write something. Press / for blocks, or type markdown.";

export function NoteEditor({
  noteId,
  value,
  onChange,
  header,
  resolveAttachment,
  onUploadImage,
  getAttachmentWidth,
  onResizeAttachment,
}: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The attachment hooks are read through refs, so the editor's extensions can be
  // built once per note while still calling the latest closures as the draft's
  // attachments change.
  const resolveRef = useRef(resolveAttachment);
  resolveRef.current = resolveAttachment;
  const uploadRef = useRef(onUploadImage);
  uploadRef.current = onUploadImage;
  const widthRef = useRef(getAttachmentWidth);
  widthRef.current = getAttachmentWidth;
  const resizeRef = useRef(onResizeAttachment);
  resizeRef.current = onResizeAttachment;

  // The file input the photo command opens, and the document position to insert
  // the resulting image at once the upload finishes.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const insertAtRef = useRef<number | null>(null);

  // The photo command, appended to the slash menu only when an uploader is
  // present. Held in a ref so the menu, built once per note, picks up the latest.
  const extraCommands = useRef<SlashCommand[]>([]);
  extraCommands.current = onUploadImage
    ? [
        {
          id: "photo",
          label: "Photo",
          hint: "Attach an image",
          keywords: ["photo", "image", "picture", "attachment", "upload"],
          run: (instance, range) => {
            instance.chain().focus().deleteRange(range).run();
            insertAtRef.current = instance.state.selection.from;
            fileInputRef.current?.click();
          },
        },
      ]
    : [];

  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  slashRef.current = slash;

  const bridge = useRef<SlashBridge>({
    open: () => {},
    move: () => {},
    choose: () => false,
    close: () => {},
  });
  bridge.current = {
    open: (next) =>
      setSlash((current) => ({
        ...next,
        // The highlight survives a narrowing query unless it has run off the end.
        index: current && next.items[current.index] ? current.index : 0,
      })),
    move: (delta) =>
      setSlash((current) => {
        if (current === null || current.items.length === 0) return current;
        const count = current.items.length;
        return { ...current, index: (current.index + delta + count) % count };
      }),
    choose: () => {
      const current = slashRef.current;
      const command = current?.items[current.index];
      if (!current || !command) return false;
      current.apply(command);
      return true;
    },
    close: () => setSlash(null),
  };

  // `value` is read here only; afterwards the editor owns the document, so a
  // keystroke is never undone by the markdown it just produced coming back in.
  const initial = useRef(value);
  initial.current = value;

  const editor = useEditor(
    {
      extensions: [
        ...noteExtensions(PLACEHOLDER, {
          resolve: (id) => resolveRef.current?.(id) ?? Promise.resolve(null),
          getWidth: (id) => widthRef.current?.(id),
          onResize: (id, width) => resizeRef.current?.(id, width),
        }),
        slashExtension(bridge, extraCommands),
      ],
      content: markdownToDoc(initial.current),
      onUpdate: ({ editor: instance }) =>
        onChangeRef.current(docToMarkdown(instance.getJSON() as DocNode)),
      editorProps: {
        attributes: {
          class: "note-doc md-body",
          spellcheck: "true",
          "aria-label": "Note body",
        },
      },
    },
    [noteId],
  );

  if (!editor) return <div className="min-h-0 flex-1" />;

  /**
   * Clicking the blank space around the document puts the caret at the end, as a
   * page of text implies.
   *
   * Only the two layout wrappers count, rather than everything that is not the
   * document: the title sits in this column too, and anything matched here has
   * its own click taken away from it.
   */
  function focusFromMargin(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && !target.classList.contains("note-column")) return;
    editor.chain().focus("end").run();
  }

  return (
    // Clicking the margin drops the caret into the editor, a pointer-only
    // convenience: the body is a contenteditable that the keyboard reaches
    // by tabbing to it directly.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      onClick={focusFromMargin}
      className="note-editor note-scroll relative min-h-0 flex-1 overflow-y-auto px-5 lg:px-10"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const at = insertAtRef.current;
          insertAtRef.current = null;
          const upload = uploadRef.current;
          if (!file || at === null || !upload) return;
          void upload(file).then((ref) => {
            if (!ref) return;
            editor
              .chain()
              .focus()
              .insertContentAt(at, {
                type: "attachmentImage",
                attrs: { attachmentId: ref.attachmentId, alt: ref.alt },
              })
              .run();
          });
        }}
      />
      <div className="note-column flex min-h-full flex-col pb-24 pt-7">
        {header ? (
          // Enter or Down from the title carries on into the body, the way one
          // field flowing into the next is expected to. Delegated from the
          // wrapper rather than bound to the title, which `header` owns; the
          // control itself is the input inside.
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== "ArrowDown") return;
              if (!(event.target instanceof HTMLInputElement)) return;
              event.preventDefault();
              editor.chain().focus("start").run();
            }}
          >
            {header}
          </div>
        ) : null}
        <EditorContent editor={editor} className="mt-4 flex min-h-0 flex-1 flex-col" />
      </div>
      <DragHandle editor={editor}>
        <div className="note-drag-handle" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <circle cx="6" cy="4" r="1.2" />
            <circle cx="10" cy="4" r="1.2" />
            <circle cx="6" cy="8" r="1.2" />
            <circle cx="10" cy="8" r="1.2" />
            <circle cx="6" cy="12" r="1.2" />
            <circle cx="10" cy="12" r="1.2" />
          </svg>
        </div>
      </DragHandle>
      <BubbleMenu editor={editor} className="note-bubble">
        <BubbleToolbar editor={editor} />
      </BubbleMenu>
      <TableToolbar editor={editor} />
      <SlashMenu state={slash} />
    </div>
  );
}

const SLASH_MENU_WIDTH = 240;
const SLASH_MENU_HEIGHT = 272;
const SLASH_MENU_GAP = 6;
const SLASH_MENU_MARGIN = 8;

/** Places the menu below the caret, or above it where the space below is short. */
export function slashMenuPlacement(rect: DOMRect, viewport: { width: number; height: number }) {
  const below = viewport.height - rect.bottom - SLASH_MENU_GAP - SLASH_MENU_MARGIN;
  const above = rect.top - SLASH_MENU_GAP - SLASH_MENU_MARGIN;
  const left = Math.max(
    SLASH_MENU_MARGIN,
    Math.min(rect.left, viewport.width - SLASH_MENU_WIDTH - SLASH_MENU_MARGIN),
  );
  if (below >= SLASH_MENU_HEIGHT || below >= above) {
    return { top: rect.bottom + SLASH_MENU_GAP, left, maxHeight: Math.min(SLASH_MENU_HEIGHT, below) };
  }
  return {
    bottom: viewport.height - rect.top + SLASH_MENU_GAP,
    left,
    maxHeight: Math.min(SLASH_MENU_HEIGHT, above),
  };
}

function SlashMenu({ state }: { state: SlashState | null }) {
  if (state === null || state.rect === null || state.items.length === 0) return null;
  const { rect } = state;
  return (
    <div
      role="listbox"
      aria-label="Insert block"
      className="note-slash"
      style={slashMenuPlacement(rect, { width: window.innerWidth, height: window.innerHeight })}
    >
      {state.items.map((command, index) => (
        <button
          key={command.id}
          type="button"
          role="option"
          aria-selected={index === state.index}
          // The suggestion plugin owns the keyboard, so the pointer path only has
          // to avoid taking focus off the editor before the command runs.
          onMouseDown={(event) => {
            event.preventDefault();
            state.apply(command);
          }}
          className={`note-slash-row ${index === state.index ? "is-active" : ""}`}
        >
          <span className="note-slash-label">{command.label}</span>
          <span className="note-slash-hint">{command.hint}</span>
        </button>
      ))}
    </div>
  );
}

type MarkButton = { id: string; label: string; glyph: string; isActive: () => boolean; run: () => void };

function BubbleToolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState("");

  // Rebuilt on every selection change, so the pressed states stay truthful.
  const buttons = useMemo<MarkButton[]>(
    () => [
      {
        id: "bold",
        label: "Bold",
        glyph: "B",
        isActive: () => editor.isActive("bold"),
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        id: "italic",
        label: "Italic",
        glyph: "I",
        isActive: () => editor.isActive("italic"),
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        id: "strike",
        label: "Strikethrough",
        glyph: "S",
        isActive: () => editor.isActive("strike"),
        run: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        id: "code",
        label: "Inline code",
        glyph: "<>",
        isActive: () => editor.isActive("code"),
        run: () => editor.chain().focus().toggleCode().run(),
      },
    ],
    [editor],
  );

  const openLink = useCallback(() => {
    setHref(typeof editor.getAttributes("link").href === "string" ? editor.getAttributes("link").href : "");
    setLinking(true);
  }, [editor]);

  const commit = useCallback(() => {
    const target = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    // An empty box is how the link is taken off, rather than a separate control.
    if (target) chain.setLink({ href: target }).run();
    else chain.unsetLink().run();
    setLinking(false);
  }, [editor, href]);

  if (linking) {
    return (
      <form
        className="note-bubble-link"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <input
          autoFocus
          value={href}
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setLinking(false);
          }}
          placeholder="https://"
          aria-label="Link address"
          className={`h-7 w-56 rounded-md border border-line bg-bg px-2 text-xs text-text outline-none ${focusRing}`}
        />
        <button type="submit" className="note-bubble-btn" aria-label="Apply link">
          Apply
        </button>
      </form>
    );
  }

  return (
    <>
      {buttons.map((button) => (
        <button
          key={button.id}
          type="button"
          aria-label={button.label}
          aria-pressed={button.isActive()}
          title={button.label}
          onMouseDown={(event) => {
            event.preventDefault();
            button.run();
          }}
          className={`note-bubble-btn ${button.isActive() ? "is-active" : ""}`}
        >
          {button.glyph}
        </button>
      ))}
      <span className="note-bubble-sep" aria-hidden="true" />
      <button
        type="button"
        aria-label="Link"
        aria-pressed={editor.isActive("link")}
        title="Link"
        onMouseDown={(event) => {
          event.preventDefault();
          openLink();
        }}
        className={`note-bubble-btn ${editor.isActive("link") ? "is-active" : ""}`}
      >
        Link
      </button>
    </>
  );
}

const FILL_LABELS: Record<string, string> = {
  grey: "Grey",
  red: "Red",
  amber: "Amber",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

const HEIGHTS: { label: string; value: number | null }[] = [
  { label: "Auto", value: null },
  { label: "Short", value: 32 },
  { label: "Medium", value: 48 },
  { label: "Tall", value: 72 },
  { label: "Extra tall", value: 104 },
];

/** The rows the selection touches, innermost table only. */
function selectedRows(editor: Editor): { pos: number; height: number | null }[] {
  const { from, to } = editor.state.selection;
  const rows: { pos: number; height: number | null }[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "tableRow") return;
    const height = node.attrs.height;
    rows.push({ pos, height: typeof height === "number" ? height : null });
  });
  return rows;
}

/** `focus` is held back while typing into the exact-height box, which would otherwise lose the caret. */
function setRowHeight(editor: Editor, height: number | null, focus = true) {
  const rows = selectedRows(editor);
  if (rows.length === 0) return;
  const tr = editor.state.tr;
  for (const row of rows) tr.setNodeAttribute(row.pos, "height", height);
  editor.view.dispatch(tr);
  if (focus) editor.commands.focus();
}

/** The innermost table holding the selection, and where its content starts. */
function selectedTable(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "table") return { table: $from.node(depth), start: $from.start(depth) };
  }
  return null;
}

function hasColumnShares(editor: Editor): boolean {
  const at = selectedTable(editor);
  return at !== null && columnShares(at.table).some((share) => share > 0);
}

function evenColumns(editor: Editor) {
  const at = selectedTable(editor);
  if (at) setColumnShares(editor.view, at.table, at.start, null);
  editor.commands.focus();
}

/** The table element holding the selection, for anchoring the toolbar to it. */
function tableRect(editor: Editor): DOMRect | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== "table") continue;
    const dom = editor.view.nodeDOM($from.before(depth));
    const element = dom instanceof HTMLElement ? dom : null;
    // The resizable table is wrapped, and the wrapper is what is actually placed.
    const box = element?.closest(".tableWrapper") ?? element;
    return box ? box.getBoundingClientRect() : null;
  }
  return null;
}

function TableToolbar({ editor }: { editor: Editor }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [panel, setPanel] = useState<"fill" | "height" | null>(null);

  useEffect(() => {
    const update = () => {
      const next = editor.isActive("table") ? tableRect(editor) : null;
      setRect(next);
      if (next === null) setPanel(null);
    };
    update();
    editor.on("transaction", update);
    editor.on("focus", update);
    // Capture, so a scroll on the editor's own column is seen as well.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("transaction", update);
      editor.off("focus", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  if (rect === null) return null;

  const act = (run: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    run();
    setPanel(null);
  };

  const rows = selectedRows(editor);
  const height = rows.length > 0 ? rows[0].height : null;
  const fill = editor.getAttributes("tableCell").background ?? editor.getAttributes("tableHeader").background ?? null;

  const button = (glyph: string, label: string, run: () => void, enabled = true) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      disabled={!enabled}
      onMouseDown={act(run)}
      className="note-bubble-btn"
    >
      {glyph}
    </button>
  );

  return (
    <div
      className="note-table-tools"
      role="toolbar"
      aria-label="Table"
      style={{ top: `${Math.max(rect.top - 40, 8)}px`, left: `${rect.left}px` }}
    >
      {button("Row +", "Insert row below", () => editor.chain().focus().addRowAfter().run())}
      {button("Row −", "Delete row", () => editor.chain().focus().deleteRow().run())}
      <span className="note-bubble-sep" aria-hidden="true" />
      {button("Col +", "Insert column right", () => editor.chain().focus().addColumnAfter().run())}
      {button("Col −", "Delete column", () => editor.chain().focus().deleteColumn().run())}
      {button("Even", "Make columns equal width", () => evenColumns(editor), hasColumnShares(editor))}
      <span className="note-bubble-sep" aria-hidden="true" />
      {button("Merge", "Merge cells", () => editor.chain().focus().mergeCells().run(), editor.can().mergeCells())}
      {button("Split", "Split cell", () => editor.chain().focus().splitCell().run(), editor.can().splitCell())}
      <span className="note-bubble-sep" aria-hidden="true" />
      <div className="note-table-menu">
        <button
          type="button"
          title="Cell colour"
          aria-label="Cell colour"
          aria-expanded={panel === "fill"}
          onMouseDown={(event) => {
            event.preventDefault();
            setPanel((current) => (current === "fill" ? null : "fill"));
          }}
          className={`note-bubble-btn ${panel === "fill" ? "is-active" : ""}`}
        >
          <span className="note-table-swatch" data-fill={fill ?? undefined} aria-hidden="true" />
          Fill
        </button>
        {panel === "fill" ? (
          <div className="note-table-panel" role="menu" aria-label="Cell colour">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={fill === null}
              onMouseDown={act(() => editor.chain().focus().setCellAttribute("background", null).run())}
              className="note-table-fill"
            >
              <span className="note-table-swatch" aria-hidden="true" />
              None
            </button>
            {CELL_FILLS.map((name) => (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                aria-checked={fill === name}
                onMouseDown={act(() => editor.chain().focus().setCellAttribute("background", name).run())}
                className="note-table-fill"
              >
                <span className="note-table-swatch" data-fill={name} aria-hidden="true" />
                {FILL_LABELS[name]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="note-table-menu">
        <button
          type="button"
          title="Row height"
          aria-label="Row height"
          aria-expanded={panel === "height"}
          onMouseDown={(event) => {
            event.preventDefault();
            setPanel((current) => (current === "height" ? null : "height"));
          }}
          className={`note-bubble-btn ${panel === "height" ? "is-active" : ""}`}
        >
          Height
        </button>
        {panel === "height" ? (
          <div className="note-table-panel" role="menu" aria-label="Row height">
            {HEIGHTS.map((option) => (
              <button
                key={option.label}
                type="button"
                role="menuitemradio"
                aria-checked={height === option.value}
                onMouseDown={act(() => setRowHeight(editor, option.value))}
                className="note-table-fill"
              >
                {option.label}
              </button>
            ))}
            <label className="note-table-height">
              Exact
              <input
                type="number"
                min={20}
                max={400}
                step={4}
                value={height ?? ""}
                placeholder="auto"
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  setRowHeight(editor, Number.isInteger(next) && next > 0 ? next : null, false);
                }}
                className={`h-6 w-14 rounded-md border border-line bg-bg px-1 text-xs text-text outline-none ${focusRing}`}
              />
            </label>
          </div>
        ) : null}
      </div>
      <span className="note-bubble-sep" aria-hidden="true" />
      {button("Delete", "Delete table", () => editor.chain().focus().deleteTable().run())}
    </div>
  );
}
