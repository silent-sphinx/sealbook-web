import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query. Layouts that only differ in styling should
 * stay in Tailwind's responsive variants; this is for the cases where the two
 * breakpoints need different markup — a column on a wide screen, a slide-over
 * on a narrow one — and rendering both copies would duplicate the DOM.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
