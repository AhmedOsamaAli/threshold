import { createContext, use } from "react";

/** Moves the app to another of its addresses without reloading the page; `replace` keeps Back where it was. */
export type Navigate = (url: string, options?: { replace?: boolean }) => void;

export const NavigateContext = createContext<Navigate>((url) => {
  window.location.assign(url);
});

export function useNavigate(): Navigate {
  return use(NavigateContext);
}

interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
}

/** A plain primary click, which the app handles in place; a modified or middle click opens the link as browsers do. */
export function isPlainClick(event: ClickLike): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}
