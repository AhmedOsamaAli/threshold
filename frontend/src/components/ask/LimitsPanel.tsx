import { useId, useState, type ReactNode, type SyntheticEvent } from "react";
import { BUSINESS_KINDS, type BusinessKind } from "../../api/founders";
import {
  DEFAULT_LIMITS_FORM,
  DURATIONS,
  leftText,
  limitsLines,
  limitsProblems,
  limitsRequestOf,
  usedShare,
  type LimitsForm,
} from "../../lib/ask";
import { cssVars, cx } from "../../lib/css";
import { limits, useLimits } from "../../state/limits";

type Locate = "idle" | "asking" | "refused";

function Field({ id, label, problem, children }: { id: string; label: string; problem: string | undefined; children: ReactNode }) {
  return (
    <div className="cf-field">
      <label className="mono label" htmlFor={id}>
        {label}
      </label>
      {children}
      {problem ? (
        <span className="cf-hint bad" id={`${id}-hint`}>
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/** What the person lets an assistant do: the most for one pledge and in all, how many, for how long, and optionally
 * which kinds and how far. The server checks every pledge against it. */
function LimitsEditor({ onDone, onCancel }: { onDone: () => void; onCancel: (() => void) | null }) {
  const ids = useId();
  const state = useLimits();
  const [form, setForm] = useState<LimitsForm>(DEFAULT_LIMITS_FORM);
  const [tried, setTried] = useState(false);
  const [locate, setLocate] = useState<Locate>("idle");
  const problems = tried ? limitsProblems(form) : {};

  function change(patch: Partial<LimitsForm>) {
    setForm((was) => ({ ...was, ...patch }));
  }

  function toggleKind(kind: BusinessKind) {
    change({ kinds: form.kinds.includes(kind) ? form.kinds.filter((each) => each !== kind) : [...form.kinds, kind] });
  }

  function askWhere(on: boolean) {
    if (!on) {
      change({ near: null });
      setLocate("idle");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocate("refused");
      return;
    }
    setLocate("asking");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocate("idle");
        change({ near: { lat: coords.latitude, lon: coords.longitude } });
      },
      () => {
        setLocate("refused");
      },
      { maximumAge: 600_000, timeout: 15_000 },
    );
  }

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setTried(true);
    const request = limitsRequestOf(form);
    if (request && (await limits.create(request))) onDone();
  }

  return (
    <form className="ask-limits-form" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset className="cf-grid ask-fields" disabled={state.busy}>
        <legend className="sr-only">The limits an assistant works within</legend>
        <Field id={`${ids}-one`} label="Most for one pledge" problem={problems.maxPledge}>
          <span className="cf-money">
            <span className="cf-currency mono" aria-hidden="true">
              USD
            </span>
            <input
              id={`${ids}-one`}
              className="field-input"
              inputMode="decimal"
              value={form.maxPledge}
              aria-invalid={problems.maxPledge ? true : undefined}
              aria-describedby={problems.maxPledge ? `${ids}-one-hint` : undefined}
              onChange={(event) => {
                change({ maxPledge: event.target.value });
              }}
            />
          </span>
        </Field>
        <Field id={`${ids}-all`} label="Most in all" problem={problems.maxTotal}>
          <span className="cf-money">
            <span className="cf-currency mono" aria-hidden="true">
              USD
            </span>
            <input
              id={`${ids}-all`}
              className="field-input"
              inputMode="decimal"
              value={form.maxTotal}
              aria-invalid={problems.maxTotal ? true : undefined}
              aria-describedby={problems.maxTotal ? `${ids}-all-hint` : undefined}
              onChange={(event) => {
                change({ maxTotal: event.target.value });
              }}
            />
          </span>
        </Field>
        <Field id={`${ids}-count`} label="Most pledges" problem={problems.maxCount}>
          <input
            id={`${ids}-count`}
            className="field-input"
            inputMode="numeric"
            value={form.maxCount}
            aria-invalid={problems.maxCount ? true : undefined}
            aria-describedby={problems.maxCount ? `${ids}-count-hint` : undefined}
            onChange={(event) => {
              change({ maxCount: event.target.value });
            }}
          />
        </Field>
        <Field id={`${ids}-days`} label="For how long" problem={undefined}>
          <select
            id={`${ids}-days`}
            className="field-input"
            value={form.duration}
            onChange={(event) => {
              const found = DURATIONS.find((each) => each.id === event.target.value);
              if (found) change({ duration: found.id });
            }}
          >
            {DURATIONS.map((each) => (
              <option key={each.id} value={each.id}>
                {each.label}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="ask-kinds cf-wide">
          <legend className="mono label">Only these kinds of place (optional)</legend>
          <div className="ask-kind-list">
            {BUSINESS_KINDS.map((kind) => (
              <label key={kind} className={cx("ask-kind", form.kinds.includes(kind) && "on")}>
                <input
                  type="checkbox"
                  checked={form.kinds.includes(kind)}
                  onChange={() => {
                    toggleKind(kind);
                  }}
                />
                {kind}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="cf-field cf-wide ask-near">
          <label className="ask-check">
            <input
              type="checkbox"
              checked={form.near !== null || locate === "asking"}
              onChange={(event) => {
                askWhere(event.target.checked);
              }}
            />
            Only places near where I am now
          </label>
          {form.near ? (
            <span className="cf-money">
              <label className="sr-only" htmlFor={`${ids}-km`}>
                How many kilometres from here
              </label>
              <input
                id={`${ids}-km`}
                className="field-input ask-km"
                inputMode="decimal"
                value={form.nearKm}
                aria-invalid={problems.nearKm ? true : undefined}
                onChange={(event) => {
                  change({ nearKm: event.target.value });
                }}
              />
              <span className="cf-currency mono">km</span>
            </span>
          ) : null}
          {locate === "asking" ? <span className="cf-hint">Asking your browser where you are…</span> : null}
          {locate === "refused" ? (
            <span className="cf-hint bad">Your browser would not say where you are, so there is no limit on distance.</span>
          ) : null}
          {problems.nearKm ? <span className="cf-hint bad">{problems.nearKm}</span> : null}
        </div>
      </fieldset>
      {state.error ? (
        <p className="page-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="cf-actions">
        <button className="go" type="submit" disabled={state.busy}>
          {state.busy ? "Setting…" : "Set my limits"}
        </button>
        {onCancel ? (
          <button className="text-button" type="button" onClick={onCancel}>
            Keep the ones I have
          </button>
        ) : null}
      </div>
    </form>
  );
}

function LimitsSummary({ onChange }: { onChange: () => void }) {
  const { limits: current } = useLimits();
  if (!current) return <p className="ask-limits-wait mono">Reading your limits…</p>;
  const left = leftText(current);
  const prepared = current.pledges ?? 0;
  return (
    <div className="ask-limits-summary">
      <ul className="ask-limits-lines">
        {limitsLines(current).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {left ? (
        <div className="ask-left">
          <p>
            <b>{left}</b>
            {prepared ? (
              <span className="mono">
                {" "}
                · {prepared} pledge{prepared === 1 ? "" : "s"} prepared or held
              </span>
            ) : null}
          </p>
          <span className="ask-meter" aria-hidden="true" style={cssVars({ "--p": usedShare(current) })}>
            <i />
          </span>
        </div>
      ) : null}
      <div className="cf-actions">
        <button className="ghost mono" type="button" onClick={onChange}>
          Change
        </button>
        <button className="text-button" type="button" onClick={limits.clear}>
          Remove
        </button>
      </div>
    </div>
  );
}

/** The person's limits: set them, see what is left of them, change or remove them. */
export function LimitsPanel() {
  const { token } = useLimits();
  const [editing, setEditing] = useState(false);
  const heading = useId();
  const showForm = editing || token === null;
  return (
    <section className="ask-limits" aria-labelledby={heading}>
      <p className="eyebrow mono">
        <b>Your</b> limits
      </p>
      <h2 className="ask-side-title" id={heading}>
        What the assistant may prepare for you
      </h2>
      <p className="ask-limits-lede">
        An assistant can prepare a pledge only inside these limits. The server checks every one, not the AI, and you still
        approve each pledge yourself in PayPal.
      </p>
      {showForm ? (
        <LimitsEditor
          onDone={() => {
            setEditing(false);
          }}
          onCancel={
            token
              ? () => {
                  setEditing(false);
                }
              : null
          }
        />
      ) : (
        <LimitsSummary
          onChange={() => {
            setEditing(true);
          }}
        />
      )}
    </section>
  );
}
