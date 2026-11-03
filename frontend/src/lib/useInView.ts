import { useEffect, useState, type RefObject } from "react";

/**
 * Whether the element is on screen right now, so work that only matters while it is seen (an animation) can wait while it
 * is not. Where the browser cannot tell, it is true.
 */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries.at(-1);
      if (latest) setInView(latest.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return inView;
}
