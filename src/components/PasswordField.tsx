import { forwardRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

// Margin utilities move to the wrapper: `input` is inline-block, so a
// margin-top passed in `className` (eg. the shared `field` style) would
// otherwise sit inside the relative wrapper instead of collapsing outside
// it, throwing off the toggle button's vertical centering.
function splitMargin(className: string): { margin: string; rest: string } {
  const classes = className.split(/\s+/).filter(Boolean);
  const margin = classes.filter((cls) => /^-?m[trblxy]?-/.test(cls));
  const rest = classes.filter((cls) => !margin.includes(cls));
  return { margin: margin.join(" "), rest: rest.join(" ") };
}

export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { className = "", ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const { margin, rest } = splitMargin(className);
  return (
    <div className={`relative ${margin}`}>
      <input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        className={`${rest} pr-16`}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text disabled:pointer-events-none disabled:opacity-50"
        onClick={() => setVisible((current) => !current)}
        disabled={props.disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeSlashIcon /> : <EyeIcon />}
      </button>
    </div>
  );
});

function EyeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 4C5.5 4 2.4 7.2 1.3 10c1.1 2.8 4.2 6 8.7 6s7.6-3.2 8.7-6C17.6 7.2 14.5 4 10 4Zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.8a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />
    </svg>
  );
}

function EyeSlashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="m3.1 2.1 14.8 14.8-1.3 1.3-2.2-2.2A9.8 9.8 0 0 1 10 17c-4.5 0-7.6-3.2-8.7-6a11.8 11.8 0 0 1 3.2-4.2L1.8 3.4l1.3-1.3Zm4.2 6.8a2.8 2.8 0 0 0 3.8 3.8L7.3 8.9Zm2.7-4.9c4.5 0 7.6 3.2 8.7 6a11.8 11.8 0 0 1-2.5 3.6l-1.3-1.3a9.3 9.3 0 0 0 1.8-2.3c-1.1-2.1-3.4-4.2-6.7-4.2-.6 0-1.2.1-1.7.2L7 4.6c.9-.4 1.9-.6 3-.6Z" />
    </svg>
  );
}
