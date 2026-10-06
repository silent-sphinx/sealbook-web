/**
 * The editor's schema.
 *
 * Every node and mark here has a markdown spelling, because markdown is what a
 * note is stored as. Anything the serialiser could not write back is turned off
 * rather than offered: an editor that can produce content its own storage format
 * drops is an editor that loses work silently.
 */

import { Extension, InputRule } from "@tiptap/react";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { StarterKit } from "@tiptap/starter-kit";

import { MD_TABLE_FILLS } from "./markdown";
import { createLowlight } from "lowlight";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * A chosen set rather than lowlight's `common`, which is 37 grammars. Each one
 * is bundled into the app, and this is a vault client that people open on a
 * phone connection.
 */
const lowlight = createLowlight();
lowlight.register({ bash, c, cpp, css, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml });

export const CODE_LANGUAGES = [
  "bash", "c", "cpp", "css", "go", "java", "javascript", "json",
  "markdown", "python", "rust", "sql", "typescript", "xml", "yaml",
] as const;

/**
 * The schemes a link may carry, matching `safeHref` in the markdown parser.
 * Without this the editor would render a `javascript:` href that the parser
 * refuses, so what is on screen would be more permissive than what is stored.
 */
const LINK_PROTOCOLS = ["http", "https", "mailto"];

/** Mirrors `MD_TABLE_FILLS`, which is what the stored sidecar accepts. */
export const CELL_FILLS = MD_TABLE_FILLS;

function allowedUri(uri: string): boolean {
  try {
    const url = new URL(uri, "https://sealbook.invalid/");
    return LINK_PROTOCOLS.includes(url.protocol.replace(/:$/u, ""));
  } catch {
    return false;
  }
}

/**
 * A GFM column alignment and a cell fill, neither of which the cell schema has
 * an attribute for. The fill is rendered as a data attribute rather than an
 * inline colour so that the stylesheet owns the palette.
 */
const cellAttributes = {
  addAttributes() {
    return {
      // @ts-expect-error `parent` is supplied by the extension at call time.
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.textAlign || null,
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.align === "string" && attributes.align
            ? { style: `text-align: ${attributes.align}` }
            : {},
      },
      background: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const fill = element.getAttribute("data-fill");
          return fill && (CELL_FILLS as readonly string[]).includes(fill) ? fill : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.background === "string" &&
          (CELL_FILLS as readonly string[]).includes(attributes.background)
            ? { "data-fill": attributes.background }
            : {},
      },
    };
  },
};

/** Carries a row height, which the row schema has no attribute for. */
const rowAttribute = {
  addAttributes() {
    return {
      // @ts-expect-error `parent` is supplied by the extension at call time.
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const height = Number.parseInt(element.style.height, 10);
          return Number.isInteger(height) && height > 0 ? height : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.height === "number" && attributes.height > 0
            ? { style: `height: ${attributes.height}px` }
            : {},
      },
    };
  },
};

/**
 * `- [ ] ` is the spelling this app stores and exports, so it is the one a user
 * is most likely to type. By the time the brackets are typed the `- ` has
 * already made a bullet, and `TaskItem`'s own rule does not fire inside one, so
 * the bullet is converted here instead.
 */
const TaskFromBullet = Extension.create({
  name: "taskFromBullet",
  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX])?\][ ]$/,
        handler: ({ state, range, match, chain }) => {
          const { $from } = state.selection;
          // Two levels up from the paragraph is the list itself.
          if ($from.node(-2)?.type.name !== "bulletList") return null;
          const checked = (match[1] ?? "").toLowerCase() === "x";
          chain()
            .deleteRange(range)
            .toggleList("taskList", "taskItem", false)
            .updateAttributes("taskItem", { checked })
            .run();
          return undefined;
        },
      }),
    ];
  },
});

export function noteExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      // No markdown spelling, so the editor must not be able to make one.
      underline: false,
      // Replaced below by the highlighting version.
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: LINK_PROTOCOLS,
        isAllowedUri: allowedUri,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskFromBullet,
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow.extend(rowAttribute),
    TableHeader.extend(cellAttributes),
    TableCell.extend(cellAttributes),
    Placeholder.configure({ placeholder, includeChildren: false }),
  ];
}
