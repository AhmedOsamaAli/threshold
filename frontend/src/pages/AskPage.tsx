import "../styles/founders.css";
import "../styles/ask.css";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { assistant, type AskAnswer, type AskCard } from "../api/assistant";
import { AskCards } from "../components/ask/AskCards";
import { LimitsPanel } from "../components/ask/LimitsPanel";
import { PledgePanel } from "../components/ask/PledgePanel";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { plainError } from "../lib/account";
import { MAX_CHARS, SUGGESTIONS, turnsOf, type Message } from "../lib/ask";
import { useNow } from "../lib/useNow";
import { limits, useLimits } from "../state/limits";

/** What the assistant did to answer, step by step, as the server recorded it: the proof that it only used its tools. */
function Trace({ steps }: { steps: AskAnswer["trace"] }) {
  if (!steps.length) return null;
  return (
    <details className="ask-trace">
      <summary className="mono">
        What the assistant did · {steps.length} step{steps.length === 1 ? "" : "s"}
      </summary>
      <ol>
        {steps.map((step, index) => (
          <li key={`${index}-${step.tool}`} className={step.ok ? undefined : "held"}>
            <span className="mono">{step.tool}</span> {step.summary}
          </li>
        ))}
      </ol>
    </details>
  );
}

interface BubbleProps {
  message: Message;
  now: number;
  busy: boolean;
  onBack: (card: AskCard) => void;
}

function Bubble({ message, now, busy, onBack }: BubbleProps) {
  const answer = message.answer;
  if (message.role === "user") {
    return (
      <li className="ask-msg me">
        <p>{message.content}</p>
      </li>
    );
  }
  return (
    <li className="ask-msg bot">
      <p className="ask-reply">{message.content}</p>
      {answer ? (
        <p className="ask-mode mono">{answer.mode === "model" ? "AI wording, checked by the server" : "Plain answer from the server"}</p>
      ) : null}
      {answer?.cards.length ? <AskCards cards={answer.cards} now={now} onBack={onBack} disabled={busy} /> : null}
      {answer?.pledge ? <PledgePanel pledge={answer.pledge} /> : null}
      {answer?.refusal ? (
        <p className="ask-refusal mono">
          Held back · {answer.refusal.code.replaceAll("_", " ")}
        </p>
      ) : null}
      {answer ? <Trace steps={answer.trace} /> : null}
    </li>
  );
}

export function AskPage() {
  const titleRef = useFocusOnMount();
  useDocumentTitle("Ask");
  const now = useNow(30_000);
  const { token } = useLimits();
  const field = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(1);
  const pending = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void limits.refresh();
    return () => {
      pending.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (messages.length) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send(content: string, back?: string) {
    const clean = content.trim().slice(0, MAX_CHARS);
    if (!clean || busy) return;
    const mine: Message = { id: counter.current++, role: "user", content: clean };
    const turns = turnsOf([...messages, mine]);
    const controller = new AbortController();
    pending.current = controller;
    setMessages((was) => [...was, mine]);
    setText("");
    setError(null);
    setBusy(true);
    try {
      const answer = await assistant.ask(turns, token, back, controller.signal);
      setMessages((was) => [...was, { id: counter.current++, role: "assistant", content: answer.reply, answer }]);
      // A pledge prepared or held back changes what is left of the limits, and ended limits are dropped.
      if (answer.pledge || answer.refusal) void limits.refresh();
    } catch (failure) {
      if (!controller.signal.aborted) setError(plainError(failure, "The assistant could not answer. Try again."));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    void send(text);
  }

  function enter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(text);
  }

  return (
    <Page className="ask">
      <PageHead
        eyebrow="Ask · An assistant that cannot pay"
        title="Ask for a place to back"
        titleRef={titleRef}
        standfirst="Say what you would like to see open near you. The assistant finds the campaigns and prepares a pledge, only inside the limits you set. Only you can approve it, in PayPal."
        fields={[
          { label: "Sets the limits", lines: ["You"] },
          { label: "Checks them", lines: ["The server,", "not the AI"] },
          { label: "Approves", lines: ["You, in PayPal"] },
        ]}
      />
      <LimitsPanel />
      <section className="ask-chat" aria-label="Conversation with the assistant">
        <ol className="ask-log" role="log" aria-live="polite" aria-relevant="additions">
          {messages.map((message) => (
            <Bubble
              key={message.id}
              message={message}
              now={now}
              busy={busy}
              onBack={(card) => {
                void send(`Back ${card.name}`, card.id);
              }}
            />
          ))}
        </ol>
        {busy ? (
          <p className="ask-thinking mono" role="status">
            Looking…
          </p>
        ) : null}
        {error ? (
          <p className="page-alert" role="alert">
            {error}
          </p>
        ) : null}
        {messages.length === 0 ? (
          <ul className="ask-suggestions" aria-label="Things to try">
            {SUGGESTIONS.map((suggestion) => (
              <li key={suggestion}>
                <button
                  className="ghost mono"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void send(suggestion);
                  }}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div ref={end} />
        <form className="ask-composer" onSubmit={submit}>
          <label className="sr-only" htmlFor={field}>
            Your message to the assistant
          </label>
          <textarea
            id={field}
            className="field-input"
            rows={2}
            maxLength={MAX_CHARS}
            placeholder="A bakery near Williamsburg, Brooklyn…"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={enter}
          />
          <button className="go" type="submit" disabled={busy || !text.trim()}>
            Ask
          </button>
        </form>
      </section>
    </Page>
  );
}
