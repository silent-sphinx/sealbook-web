import type { MdBlock, MdInline } from "../lib/markdown";

/**
 * Renders a parsed markdown tree as React elements.
 *
 * Text reaches the DOM as text children, so React escapes it. Nothing here calls
 * `dangerouslySetInnerHTML`, and the tree it is given carries no HTML and no
 * unvalidated URL, so there is no unsafe choice available to make.
 */
export function Markdown({ blocks }: { blocks: MdBlock[] }) {
  return <div className="md-body">{blocks.map((block, index) => renderBlock(block, index))}</div>;
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
