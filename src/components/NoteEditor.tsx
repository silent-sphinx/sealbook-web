import { Extension, useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import Suggestion from "@tiptap/suggestion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { docToMarkdown, markdownToDoc, type DocNode } from "../lib/noteDoc";
import { noteExtensions } from "../lib/noteEditorSchema";
import { focusRing } from "../lib/styles";

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

function matchCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return COMMANDS;
  return COMMANDS.filter(
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

function slashExtension(bridge: { current: SlashBridge }) {
  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand>({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          items: ({ query }) => matchCommands(query),
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
  editable: boolean;
  onChange: (markdown: string) => void;
  /**
   * Drawn at the top of the document column, which is where the note title
   * goes. Inside the column rather than above it, so the title cannot drift out
   * of line with the body and scrolls with it.
   */
  header?: ReactNode;
};

const PLACEHOLDER = "Write something. Press / for blocks, or type markdown.";

export function NoteEditor({ noteId, value, editable, onChange, header }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
      extensions: [...noteExtensions(PLACEHOLDER), slashExtension(bridge)],
      content: markdownToDoc(initial.current),
      editable,
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

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

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
    if (!editable) return;
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && !target.classList.contains("note-column")) return;
    editor.chain().focus("end").run();
  }

  return (
    <div
      onClick={focusFromMargin}
      className="note-editor note-scroll relative min-h-0 flex-1 overflow-y-auto px-5 lg:px-10"
    >
      <div className="note-column flex min-h-full flex-col pb-24 pt-7">
        {header ? (
          // Enter or Down from the title carries on into the body, the way one
          // field flowing into the next is expected to.
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
      {editable ? (
        <>
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
          <SlashMenu state={slash} />
        </>
      ) : null}
    </div>
  );
}

function SlashMenu({ state }: { state: SlashState | null }) {
  if (state === null || state.rect === null || state.items.length === 0) return null;
  const { rect } = state;
  return (
    <div
      role="listbox"
      aria-label="Insert block"
      className="note-slash"
      style={{ top: `${rect.bottom + 6}px`, left: `${rect.left}px` }}
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
