import "../styles/founders.css";
import "../styles/ask.css";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { BUSINESS_KINDS, type BusinessKind } from "../api/founders";
import { spot as spotApi, type Spot, type SpotWhere } from "../api/spot";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { SpotMap } from "../components/spot/SpotMap";
import { plainError } from "../lib/account";
import { whenText } from "../lib/ask";
import { prefersReducedMotion } from "../lib/motion";
import { SPOT_EXAMPLES } from "../lib/spot";

type Load =
  | { phase: "idle" }
  | { phase: "loading"; what: string }
  | { phase: "ready"; spot: Spot }
  | { phase: "failed"; message: string };

type Locate = "idle" | "asking" | "refused";

function Result({ spot, again }: { spot: Spot; again: () => void }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    // The answer is below the form: bring it into view, so the map is the first thing seen.
    section.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, []);
  return (
    <section ref={section} className="spot-result" aria-label="What was found">
      <p className="spot-summary serif">{spot.summary}</p>
      {spot.checked ? null : (
        <div className="cf-actions">
          <button className="go" type="button" onClick={again}>
            Check again
          </button>
        </div>
      )}
      {spot.checked ? <SpotMap key={`${spot.place.lat},${spot.place.lon},${spot.kind},${spot.checked_at}`} spot={spot} /> : null}
      <p className="spot-note">{spot.note}</p>
      <p className="spot-source mono">
        Source:{" "}
        <a className="text-link" href={spot.source.url} rel="noreferrer">
          {spot.source.name}
        </a>
        {spot.source.as_of ? ` · data as of ${whenText(spot.source.as_of)}` : ""} · checked {whenText(spot.checked_at)}
      </p>
    </section>
  );
}

export function SpotPage() {
  const titleRef = useFocusOnMount();
  useDocumentTitle("Check a spot");
  const ids = useId();
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState<BusinessKind>("cafe");
  const [load, setLoad] = useState<Load>({ phase: "idle" });
  const [locate, setLocate] = useState<Locate>("idle");
  const last = useRef<{ where: SpotWhere; kind: BusinessKind } | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  async function check(where: SpotWhere, asked: BusinessKind, what: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    last.current = { where, kind: asked };
    setLoad({ phase: "loading", what });
    try {
      const found = await spotApi.check(where, asked, controller.signal);
      if (!controller.signal.aborted) setLoad({ phase: "ready", spot: found });
    } catch (failure) {
      if (!controller.signal.aborted) setLoad({ phase: "failed", message: plainError(failure, "The check could not be made. Try again.") });
    }
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    const text = address.trim();
    if (text.length < 3) {
      setLoad({ phase: "failed", message: "Type a street, a neighborhood or a city." });
      return;
    }
    void check({ address: text }, kind, text);
  }

  function again() {
    if (last.current) void check(last.current.where, last.current.kind, "the same place");
  }

  function here() {
    if (!("geolocation" in navigator)) {
      setLocate("refused");
      return;
    }
    setLocate("asking");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocate("idle");
        void check({ lat: coords.latitude, lon: coords.longitude }, kind, "where you are");
      },
      () => {
        setLocate("refused");
      },
      { maximumAge: 600_000, timeout: 15_000 },
    );
  }

  const busy = load.phase === "loading";
  return (
    <Page className="spot">
      <PageHead
        eyebrow="Check a spot · Before you back a place"
        title="What is already there?"
        titleRef={titleRef}
        standfirst="Pick an address and a kind of business. This lists what OpenStreetMap shows within a ten-minute walk, so you can see the competition before you pledge. It shows what is open nearby, never what people want."
      />
      <form className="spot-form" onSubmit={submit} noValidate>
        <div className="cf-grid">
          <div className="cf-field">
            <label className="mono label" htmlFor={`${ids}-address`}>
              Address, neighborhood or city
            </label>
            <input
              id={`${ids}-address`}
              className="field-input"
              autoComplete="street-address"
              value={address}
              placeholder="Logan Square, Chicago"
              onChange={(event) => {
                setAddress(event.target.value);
              }}
            />
          </div>
          <div className="cf-field">
            <label className="mono label" htmlFor={`${ids}-kind`}>
              Kind of business
            </label>
            <select
              id={`${ids}-kind`}
              className="field-input"
              value={kind}
              onChange={(event) => {
                const found = BUSINESS_KINDS.find((each) => each === event.target.value);
                if (found) setKind(found);
              }}
            >
              {BUSINESS_KINDS.map((each) => (
                <option key={each} value={each}>
                  {each}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="cf-actions">
          <button className="go" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Check this spot"}
          </button>
          <button className="ghost mono" type="button" disabled={busy || locate === "asking"} onClick={here}>
            Use where I am
          </button>
        </div>
        {locate === "refused" ? (
          <p className="cf-hint bad">Your browser would not say where you are. Type an address instead.</p>
        ) : null}
        <ul className="spot-examples" aria-label="Places to try">
          {SPOT_EXAMPLES.map((example) => (
            <li key={example.label}>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setAddress(example.label);
                  setKind(example.kind);
                  void check({ lat: example.lat, lon: example.lon, label: example.label }, example.kind, example.label);
                }}
              >
                {example.kind} · {example.label}
              </button>
            </li>
          ))}
        </ul>
      </form>
      <div className="page-state" aria-busy={busy}>
        {load.phase === "loading" ? (
          <p role="status">
            Checking {load.what} on OpenStreetMap. Its free servers can be slow, so this can take up to 45 seconds.
          </p>
        ) : null}
        {load.phase === "failed" ? (
          <p className="page-alert" role="alert">
            {load.message}
          </p>
        ) : null}
        {load.phase === "ready" ? <Result spot={load.spot} again={again} /> : null}
      </div>
    </Page>
  );
}
