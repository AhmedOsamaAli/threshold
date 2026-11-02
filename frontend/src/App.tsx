/* The app's router: what the address shows, a page each, and every move between them, by a link, by Back and Forward
   or by a page's own navigation (state/route.ts). The pages are in pages/PageView.tsx. */
import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { NavigateContext } from "./lib/navigation";
import { pageUrl } from "./lib/routes";
import { PageView } from "./pages/PageView";
import { engine } from "./state/engine";
import { navigate, useRoute } from "./state/route";
import { session } from "./state/session";
import { ThemeContext, useTheme } from "./state/theme";

export function App() {
  const { theme, toggleTheme } = useTheme();
  const route = useRoute();
  const page = pageUrl(route);

  useEffect(() => {
    // The engine first: a nap shows its note before any other request starts waiting on it.
    engine.start();
    void session.load();
    // Settings that gave up while the engine would not wake load as soon as it does.
    let was = engine.get().phase;
    return engine.subscribe(() => {
      const phase = engine.get().phase;
      if (phase === "ready" && was !== "ready" && session.get().phase === "failed") void session.load();
      was = phase;
    });
  }, []);

  // Another page starts at its top; the same page with only its query changed keeps its place.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);

  return (
    <ThemeContext value={theme}>
      <NavigateContext value={navigate}>
        <TopBar route={route} theme={theme} onToggleTheme={toggleTheme} />
        <PageView route={route} />
      </NavigateContext>
    </ThemeContext>
  );
}
