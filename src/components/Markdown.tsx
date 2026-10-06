import { Fragment, type ReactNode } from "react";

import type { MdBlock, MdInline, MdTableCell } from "../lib/markdown";

export type MdTableBlock = Extract<MdBlock, { kind: "table" }>;

/**
 * Renders a parsed markdown tree as React elements.
 *
 * Text reaches the DOM as text children, so React escapes it. Nothing here calls
 * `dangerouslySetInnerHTML`, and the tree it is given carries no HTML and no
 * unvalidated URL, so there is no unsafe choice available to make.
 */
export function Markdown({
  blocks,
  renderTable,
}: {
  blocks: MdBlock[];
  /**
   * Takes over the rendering of a top-level table, for the graphical editor. A
   * table inside a quote carries no line range, so it cannot be written back and
   * is left to the reader below.
   */
  renderTable?: (block: MdTableBlock, index: number) => ReactNode;
}) {
  let tables = 0;
  return (
    <div className="md-body">
      {blocks.map((block, index) => {
        if (renderTable && block.kind === "table" && block.line) {
          return <Fragment key={index}>{renderTable(block, tables++)}</Fragment>;
        }
        return renderBlock(block, index);
      })}
    </div>
  );
}

/** The inline tree on its own, for a renderer that supplies its own block. */
export function Inline({ nodes }: { nodes: MdInline[] }) {
  return <>{renderInline(nodes)}</>;
}

function renderBlock(block: MdBlock, key: number) {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as "h1";
      return <Tag key={key}>{renderInline(block.children)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.children)}</p>;
    case "rule":
      return <hr key={key} />;
    case "code":
      return (
        <pre key={key} data-language={block.language ?? undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key}>
          {block.blocks.map((inner, index) => renderBlock(inner, index))}
        </blockquote>
      );
    case "table":
      return (
        // `data-align` rather than an inline style keeps the element styling in
        // one stylesheet, as the rest of `.md-body` is.
        <div key={key} className="md-table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    data-align={block.align[columnOf(block.header, index)] ?? undefined}
                    colSpan={cell.span > 1 ? cell.span : undefined}
                    scope="col"
                  >
                    {renderInline(cell.children)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      data-align={block.align[columnOf(row, index)] ?? undefined}
                      colSpan={cell.span > 1 ? cell.span : undefined}
                    >
                      {renderInline(cell.children)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className={item.task ? "md-task" : undefined}>
          {item.task ? (
            <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-hidden />
          ) : null}
          {renderInline(item.children)}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
  }
}

/** The column a cell starts in, which spans to its left push along. */
export function columnOf(cells: MdTableCell[], index: number): number {
  let column = 0;
  for (let i = 0; i < index; i += 1) column += cells[i].span;
  return column;
}

function renderInline(nodes: MdInline[]) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "strike":
        return <del key={index}>{renderInline(node.children)}</del>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}
