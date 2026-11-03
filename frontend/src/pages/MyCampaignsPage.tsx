import "../styles/founders.css";
import { useCallback, useEffect, useState } from "react";
import { account, type User } from "../api/account";
import { ApiError } from "../api/client";
import type { MyCampaign } from "../api/founders";
import { Avatar } from "../components/Avatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProgressBar } from "../components/founders/ProgressBar";
import { Link } from "../components/Link";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { SectionHead } from "../components/SectionHead";
import { SignInOptions } from "../components/SignIn";
import { plainError } from "../lib/account";
import { dayText, heldText, statusText } from "../lib/founders";
import { forgetGoogleChoice } from "../lib/google";
import { PRIVACY_URL, START_CAMPAIGN_URL } from "../lib/routes";
import { useEngine } from "../state/engine";
import { session, useSession } from "../state/session";

type Load = { state: "loading" } | { state: "shown"; campaigns: MyCampaign[] } | { state: "failed"; message: string };

/** A campaign: its title, how far along it is, its state and its deadline. */
function CampaignRow({ campaign }: { campaign: MyCampaign }) {
  const funded = campaign.supporters >= campaign.goal;
  return (
    <li>
      <Link className="place-row" href={campaign.url}>
        <span className="place-main">
          <span className="place-kicker mono">Campaign</span>
          <span className="place-name">{campaign.title}</span>
          <span className="place-sub">
            {campaign.supporters} of {campaign.goal} neighbors · {heldText(campaign.status, campaign.total)}
            {campaign.status === "open" ? ` · ${funded ? "goal met" : `${campaign.goal - campaign.supporters} more needed`}` : ""}
          </span>
          <ProgressBar supporters={campaign.supporters} goal={campaign.goal} funded={funded} className="place-bar" />
        </span>
        <span className="place-meta mono">
          <span className="state" data-state={campaign.status}>
            {statusText(campaign.status)}
          </span>
          <time dateTime={campaign.deadline}>Ends {dayText(campaign.deadline)}</time>
        </span>
        <span className="place-arrow" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  );
}

/** The account's campaigns, newest first. */
function Campaigns({ userId }: { userId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    account.campaigns(abort.signal).then(
      (campaigns) => {
        setLoad({ state: "shown", campaigns });
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        // A session that ended elsewhere turns the page into the sign-in prompt.
        if (error instanceof ApiError && error.status === 401) void session.refresh();
        setLoad({ state: "failed", message: plainError(error, "Your campaigns could not be loaded.") });
      },
    );
    return () => {
      abort.abort();
    };
  }, [userId, attempt]);

  const campaigns = load.state === "shown" ? load.campaigns : [];
  const note = campaigns.length
    ? `${campaigns.length === 1 ? "One campaign" : `${campaigns.length} campaigns`}, newest first. Each page shows you its pledges and its payout.`
    : "Neighbors back a business before it opens: they pledge with PayPal, which only holds the money until enough of them join.";

  return (
    <section className="pg-sec" aria-labelledby="mine-campaigns" aria-busy={load.state === "loading"}>
      <SectionHead id="mine-campaigns" no="01" title="Campaigns you run" note={note} />
      {load.state === "loading" ? (
        <div className="place-list" aria-hidden="true">
          <div className="sk sk-row" />
          <div className="sk sk-row" />
          <div className="sk sk-row" />
        </div>
      ) : null}
      {load.state === "failed" ? (
        <p className="page-alert" role="alert">
          {load.message}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setLoad({ state: "loading" });
              setAttempt((count) => count + 1);
            }}
          >
            Try again
          </button>
        </p>
      ) : null}
      {load.state === "shown" ? (
        campaigns.length ? (
          <ol className="place-list">
            {campaigns.map((campaign) => (
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </ol>
        ) : (
          <div className="places-empty">
            <p>No campaigns yet.</p>
            <Link className="text-link" href={START_CAMPAIGN_URL}>
              Start one <span aria-hidden="true">→</span>
            </Link>
          </div>
        )
      ) : null}
    </section>
  );
}

/** How the reader left their account from this page. */
type Left = "deleted" | "signed-out";

/** Said where the account section was, once it is gone; it takes the focus so it isn't lost with the section. */
function Farewell({ left }: { left: Left }) {
  const focus = useCallback((node: HTMLParagraphElement | null) => {
    node?.focus();
  }, []);
  return (
    <p className="page-notice" ref={focus} tabIndex={-1} role="status">
      {left === "deleted"
        ? "Your account is deleted. The campaigns you started stay online, with no owner left to manage them."
        : "You're signed out. Your campaigns stay saved to your account."}
    </p>
  );
}

/** Who is signed in, what Threshold keeps about them, and the ways out: signing out, or deleting the account. */
function AccountSection({ user, onLeft }: { user: User; onLeft: (how: Left) => void }) {
  const { busy, error } = useSession();
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    const done = await session.deleteAccount();
    setDeleting(false);
    if (done) {
      forgetGoogleChoice();
      onLeft("deleted");
    }
  }

  return (
    <section className="pg-sec" aria-labelledby="mine-account">
      <SectionHead id="mine-account" no="02" title="Your account" note="What Threshold keeps about you, and how to remove it." />
      <div className="account-card">
        <div className="account-id">
          <Avatar user={user} className="avatar-large" />
          <p>
            <b>{user.name || user.email}</b>
            {user.name ? <span>{user.email}</span> : null}
          </p>
        </div>
        <p className="account-keeps">
          Threshold keeps your account id, email, name and picture link, only to show you&apos;re signed in and to list your
          campaigns here.{" "}
          <Link className="text-link" href={PRIVACY_URL}>
            How Threshold handles your data
          </Link>
        </p>
        <div className="account-actions">
          <button
            type="button"
            className="ghost mono"
            disabled={busy}
            onClick={() => {
              void session.signOut().then((done) => {
                if (!done) return;
                forgetGoogleChoice();
                onLeft("signed-out");
              });
            }}
          >
            Sign out
          </button>
          <button
            type="button"
            className="ghost mono danger"
            disabled={busy}
            onClick={() => {
              session.clearError();
              setAsking(true);
            }}
          >
            Delete my account
          </button>
        </div>
        <p className="account-status" role="status">
          {deleting ? "Deleting your account…" : ""}
        </p>
        {error ? (
          <p className="signin-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={asking}
        title="Delete your account?"
        confirm="Delete my account"
        cancel="Keep my account"
        danger
        onConfirm={() => {
          setAsking(false);
          void remove();
        }}
        onCancel={() => {
          setAsking(false);
        }}
      >
        <p>Deletes your account and signs you out on every device. The campaigns you started stay online, with no owner left to manage them.</p>
        <p>This can&apos;t be undone.</p>
      </ConfirmDialog>
    </section>
  );
}

/** My campaigns: the signed-in user's campaigns and account, or the ways to sign in. */
export function MyCampaignsPage() {
  const { phase, user } = useSession();
  const { note } = useEngine();
  const titleRef = useFocusOnMount();
  const [left, setLeft] = useState<Left | null>(null);
  const [shownUser, setShownUser] = useState(user?.id ?? null);
  // Signing in again starts afresh: the note about leaving belongs to the account that left.
  if ((user?.id ?? null) !== shownUser) {
    setShownUser(user?.id ?? null);
    if (user) setLeft(null);
  }
  useDocumentTitle("My campaigns");

  return (
    <Page>
      <PageHead
        eyebrow="Account · My campaigns"
        title="My campaigns"
        titleRef={titleRef}
        standfirst={
          user
            ? `Signed in as ${user.email}. The campaigns you run, open on any device.`
            : "The campaigns you run, open on any device."
        }
      />
      {user ? (
        <>
          <Campaigns key={user.id} userId={user.id} />
          <AccountSection user={user} onLeft={setLeft} />
        </>
      ) : phase === "loading" ? (
        <section className="pg-sec" aria-busy="true">
          {note === "waking" ? <p className="places-wait">Your campaigns will show as soon as the server wakes.</p> : null}
          <div className="sk sk-row" />
        </section>
      ) : (
        <section className="pg-sec" aria-labelledby="mine-signin">
          {left ? <Farewell left={left} /> : null}
          <div className="prompt-card">
            <h2 className="prompt-title" id="mine-signin">
              Sign in to see your campaigns
            </h2>
            <p className="prompt-text">
              Campaigns you start while signed in are listed here, with their pledges and their payout. Backing a campaign
              never needs an account.
            </p>
            <SignInOptions />
          </div>
        </section>
      )}
    </Page>
  );
}
