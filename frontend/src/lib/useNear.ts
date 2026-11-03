import { useEffect, useState, type RefObject } from "react";

/**
 * Whether the element has come within `margin` of the viewport yet, and true from then on: work for a part of a page that is
 * not in view (a check of what is around a place) starts only as the part is about to be seen, and never twice. Where the
 * browser cannot tell, it is true at once.
 */
export function useNear(ref: RefObject<Element | null>, margin = "300px"): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, near, margin]);
  return near;
}
