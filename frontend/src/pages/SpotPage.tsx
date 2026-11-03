import "../styles/founders.css";
import "../styles/ask.css";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { BUSINESS_KINDS, type BusinessKind } from "../api/founders";
import { spot as spotApi, type Spot, type SpotWhere } from "../api/spot";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { SpotPlan } from "../components/spot/SpotPlan";
import { plainError } from "../lib/account";
import { whenText } from "../lib/ask";
import { metresText, SPOT_EXAMPLES, topKindsText } from "../lib/spot";

type Load =
  | { phase: "idle" }
  | { phase: "loading"; what: string }
  | { phase: "ready"; spot: Spot }
  | { phase: "failed"; message: string };

type Locate = "idle" | "asking" | "refused";

function Result({ spot, again }: { spot: Spot; again: () => void }) {
  const nearest = spot.same_kind?.nearest ?? [];
  return (
    <section className="spot-result" aria-label="What was found">
      <p className="spot-summary serif">{spot.summary}</p>
      {spot.checked ? null : (
        <div className="cf-actions">
          <button className="go" type="button" onClick={again}>
            Check again
          </button>
        </div>
      )}
      {spot.checked ? (
        <div className="spot-grid">
          <SpotPlan spot={spot} />
          <div className="spot-facts">
            {spot.same_kind && spot.same_kind.count !== null ? (
              <p className="spot-count">
                <b>{spot.same_kind.count}</b> listed {spot.kind} place{spot.same_kind.count === 1 ? "" : "s"} in the walk
              </p>
            ) : null}
            {nearest.length ? (
              <>
                <h3 className="mono label">Nearest of the same kind</h3>
                <ul className="spot-nearest">
                  {nearest.map((place) => (
                    <li key={`${place.name}-${place.distance_m}`}>
                      <span>{place.name}</span> <span className="mono">{metresText(place.distance_m)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {spot.around ? (
              <>
                <h3 className="mono label">{spot.around.count} places of any kind listed around</h3>
                {spot.around.top_kinds.length ? <p className="spot-kinds">{topKindsText(spot.around.top_kinds)}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
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
            <li key={example.address}>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setAddress(example.address);
                  setKind(example.kind);
                  void check({ address: example.address }, example.kind, example.address);
                }}
              >
                {example.kind} · {example.address}
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
