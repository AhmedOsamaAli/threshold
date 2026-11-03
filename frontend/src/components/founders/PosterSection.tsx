import "../../styles/poster.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { paypalOf, type Campaign } from "../../api/founders";
import { inSandbox } from "../../lib/founders";
import {
  brandForPoster, DEFAULT_POSTER_APPEARANCE, isPosterChoice, POSTER_DIRECTIONS, readPosterAppearance, type PosterAppearance,
} from "../../lib/posterBrand";
import { downloadPoster } from "../../lib/posterExport";
import { readPosterLogo } from "../../lib/posterLogo";
import { posterForCampaign } from "../../lib/posterProject";
import { campaignUrl } from "../../lib/routes";
import { absoluteUrl, shortLink } from "../../lib/url";
import { posterDesign, usePosterAppearance } from "../../state/poster";
import { useSession } from "../../state/session";
import { PosterArt, type PosterStatus } from "./PosterArt";

const KEY = "threshold-poster:";

function stored(scope: string): { appearance: PosterAppearance; notice: string | null } {
  if (typeof window === "undefined") return { appearance: { ...DEFAULT_POSTER_APPEARANCE }, notice: null };
  try { return { appearance: readPosterAppearance(window.localStorage.getItem(KEY + scope)), notice: null }; } catch {
    return { appearance: { ...DEFAULT_POSTER_APPEARANCE }, notice: "This browser could not restore the saved poster design. The project's automatic design is shown." };
  }
}

/** The editor, print copy and export path for a campaign's poster. */
export function PosterSection({ campaign }: { campaign: Campaign }) {
  const scope = `campaign:${campaign.id}`;
  const svg = useRef<SVGSVGElement>(null);
  const [initial] = useState(() => stored(scope));
  const appearance = usePosterAppearance(scope);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  const [error, setError] = useState<string | null>(null);
  const [ownsLogo, setOwnsLogo] = useState(Boolean(initial.appearance.logo));
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [status, setStatus] = useState<PosterStatus>({ ready: false, problem: null });
  const { config } = useSession();
  const paypal = paypalOf(config);
  const poster = posterForCampaign(campaign);
  const code = absoluteUrl(campaignUrl(campaign.id));
  const brand = brandForPoster(poster, appearance);
  const disabled = paypal === null || !status.ready || busy;

  function save(next: PosterAppearance) {
    setError(null);
    if (posterDesign.save(scope, next)) {
      setNotice("Design saved on this device. The logo is embedded in downloads, not uploaded to a server.");
    } else {
      setNotice("This browser cannot save the design. You can still print or download it during this visit.");
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const logo = await readPosterLogo(file);
      save({ ...appearance, logo: logo.data, logoBackground: logo.background, ...(logo.accent ? { accent: logo.accent } : {}) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The logo could not be read.");
    } finally { setBusy(false); }
  }

  async function exportAs(format: "svg" | "png") {
    if (!svg.current) { setError("The poster is not ready to export yet."); return; }
    setBusy(true);
    setError(null);
    try { await downloadPoster(svg.current, poster.name, format); } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The poster could not be downloaded.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!printing) return;
    document.documentElement.dataset.print = "poster";
    let live = true;
    const done = () => { setPrinting(false); };
    window.addEventListener("afterprint", done);
    void document.fonts.ready.then(() => {
      if (live) window.print();
    }).catch(() => {
      if (live) { setPrinting(false); setError("The poster could not be prepared for printing. Try downloading it instead."); }
    });
    return () => {
      live = false;
      window.removeEventListener("afterprint", done);
      delete document.documentElement.dataset.print;
    };
  }, [printing]);

  return (
    <div className="poster-section">
      <figure className="poster-frame">
        {paypal ? <PosterArt poster={poster} link={code} campaign={campaign} sandbox={inSandbox(paypal)}
          appearance={appearance} svgRef={svg} onStatus={setStatus} /> :
          <p className="poster-wait" role="status">Loading the payment settings...</p>}
      </figure>
      <div className="poster-side">
        <p className="poster-side-lead">
          Artwork around <b>{poster.name}</b>&apos;s identity and offer. The first participation perk leads; the other real
          perks and pledge terms follow.
        </p>
        <fieldset className="poster-design-controls">
          <legend className="mono">Make it yours</legend>
          <label>Lead with this participation perk
            <select className="field-input" value={appearance.leadPerk ?? ""} onChange={(event) => {
              const next = event.target.value;
              if (!next) {
                const { leadPerk: removed, ...rest } = appearance;
                if (removed) save(rest);
              } else if (campaign.perks.includes(next)) save({ ...appearance, leadPerk: next });
              else setError("Choose one of this campaign's actual participation perks.");
            }}>
              <option value="">Use the campaign's first perk</option>
              {campaign.perks.map((perk, i) => <option key={`${i}:${perk}`} value={perk}>{perk}</option>)}
            </select>
          </label>
          <label>Art direction
            <select className="field-input" value={appearance.choice} onChange={(event) => {
              if (isPosterChoice(event.target.value)) save({ ...appearance, choice: event.target.value });
              else setError("Choose one of the available art directions.");
            }}>
              <option value="auto">From this project's identity</option>
              {POSTER_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction.charAt(0).toUpperCase()}{direction.slice(1)}</option>)}
            </select>
          </label>
          <label>Brand accent
            <input type="color" value={appearance.accent ?? brand.accent}
              onChange={(event) => { save({ ...appearance, accent: event.target.value }); }} />
          </label>
          <label className="poster-check"><input type="checkbox" checked={ownsLogo} onChange={(event) => {
            setOwnsLogo(event.target.checked);
            if (!event.target.checked) {
              const { logo: removed, logoBackground: background, ...rest } = appearance;
              if (removed) save(rest);
              else if (background) save(rest);
            }
          }} />I own this logo or have permission to use it</label>
          <label>Add your logo
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!ownsLogo || busy}
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
          </label>
          <small>PNG, JPEG or WebP, up to 512 KB. Its main color can become the accent; text contrast stays readable.</small>
          <button type="button" className="text-button" onClick={() => { setOwnsLogo(false); save({ ...DEFAULT_POSTER_APPEARANCE }); }}>Reset artwork and logo</button>
        </fieldset>
        <p className="poster-link"><span className="mono">QR destination</span><br />{shortLink(code)}</p>
        {status.problem ? <p className="page-alert" role="alert">{status.problem}</p> : null}
        {error ? <p className="page-alert" role="alert">{error}</p> : null}
        {notice ? <p className="poster-tip" role="status">{notice}</p> : null}
        <div className="poster-actions">
          <button type="button" className="ink-button" disabled={disabled} onClick={() => { setPrinting(true); }}>Print the poster</button>
          <button type="button" className="ghost mono" disabled={disabled} onClick={() => { void exportAs("svg"); }}>Download SVG</button>
          <button type="button" className="ghost mono" disabled={disabled} onClick={() => { void exportAs("png"); }}>Download PNG</button>
        </div>
        <p className="poster-tip">Print one A4 or US Letter page, portrait, or choose Save as PDF. SVG and PNG downloads include the typefaces and logo. Test the QR code before putting the poster up.</p>
      </div>
      {printing && paypal ? createPortal(
        <div className="print-poster" aria-hidden="true">
          <PosterArt poster={poster} link={code} campaign={campaign} sandbox={inSandbox(paypal)} appearance={appearance} />
        </div>, document.body,
      ) : null}
    </div>
  );
}
