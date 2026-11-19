import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { focusRing } from "../lib/styles";
import { Icon } from "./Icon";

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

// Spellcheck and keyboard learning are switched off whatever the visibility:
// once the toggle makes this a text input, the password would otherwise be
// sent to spellcheck services as typed.
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { className = "", ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const { margin, rest } = splitMargin(className);
  return (
    <div className={`relative ${margin}`}>
      <input
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        className={`${rest} pr-16`}
      />
      <button
        type="button"
        className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text disabled:pointer-events-none disabled:opacity-50 ${focusRing}`}
        onClick={() => setVisible((current) => !current)}
        disabled={props.disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        <Icon name={visible ? "eyeOff" : "eye"} className="h-4 w-4" />
      </button>
    </div>
  );
});
