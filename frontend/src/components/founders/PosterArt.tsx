import { useEffect, useId, useMemo, useState, type Ref } from "react";
import { posterLine, SANDBOX_NOTICE } from "../../lib/founders";
import { fitLines, layoutPoster, POSTER_FONTS, POSTER_H, POSTER_M, POSTER_W, roughMeasure, type Block, type Measure, type PosterCampaign, type PosterInput } from "../../lib/poster";
import { brandForPoster, DEFAULT_POSTER_APPEARANCE, type PosterAppearance } from "../../lib/posterBrand";
import { qrPath } from "../../lib/qr";
import { shortLink } from "../../lib/url";
import { PosterMotif } from "./PosterMotif";

export interface PosterStatus { ready: boolean; problem: string | null }
let fontsLoaded = false;

function useMeasure(): { measure: Measure; ready: boolean; problem: string | null } {
  const [ready, setReady] = useState(fontsLoaded);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void Promise.all([
      document.fonts.load(`400 40px ${POSTER_FONTS.serif}`),
      document.fonts.load(`italic 400 40px ${POSTER_FONTS.serif}`),
      document.fonts.load(`400 18px ${POSTER_FONTS.sans}`),
      document.fonts.load(`500 11px ${POSTER_FONTS.mono}`),
    ]).then(() => {
      fontsLoaded = true;
      if (live) setReady(true);
    }, () => {
      if (live) setProblem("The poster typefaces could not load. Reload before printing or exporting.");
    });
    return () => { live = false; };
  }, [ready]);
  const measure = useMemo<Measure>(() => {
    const context = ready ? document.createElement("canvas").getContext("2d") : null;
    if (!context) return roughMeasure;
    return (text, face, size, italic = false) => {
      context.font = `${italic ? "italic " : ""}${face === "mono" ? 500 : 400} ${size}px ${POSTER_FONTS[face]}`;
      return context.measureText(text).width;
    };
  }, [ready]);
  return { measure, ready, problem };
}

export function posterLinkProblem(link: string): string | null {
  let url: URL;
  try { url = new URL(link); } catch { return "The poster link must be a complete web address."; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "Use a public web link without sign-in credentials.";
  if (/^\/(?:r\/[A-Za-z0-9_-]{32}|api\/receipts\/)/.test(url.pathname)) return "A private pledge receipt must never be printed on a poster.";
  if (/(^|\.)paypal\.com$/.test(url.hostname) && /checkoutnow|approve/.test(url.pathname)) return "Use the public campaign link, not one person's PayPal approval link.";
  return null;
}

function Words({ value, x = POSTER_M, anchor = "start", face = "sans", color }: {
  value: Block | null; x?: number; anchor?: "start" | "middle"; face?: "serif" | "sans" | "mono"; color: string;
}) {
  return value?.lines.map((line, i) => <text key={`${i}:${line}`} x={x} y={value.y[i]} textAnchor={anchor}
    fontFamily={POSTER_FONTS[face]} fontSize={value.size} fill={color}>{line}</text>) ?? null;
}

interface PosterArtProps {
  poster: PosterInput;
  /** The campaign's public page, which the QR code opens. */
  link: string;
  campaign: PosterCampaign;
  sandbox?: boolean;
  appearance?: PosterAppearance;
  svgRef?: Ref<SVGSVGElement>;
  onStatus?: (status: PosterStatus) => void;
}

/** One renderer: artwork around the business's identity, led by the campaign's actual perks, with its pledge terms. */
export function PosterArt({ poster, link, campaign, sandbox = false,
  appearance = DEFAULT_POSTER_APPEARANCE, svgRef, onStatus }: PosterArtProps) {
  const measured = useMeasure();
  const id = useId().replace(/[^\w-]/g, "");
  const { measure } = measured;
  const brand = brandForPoster(poster, appearance);
  const selectedPerk = appearance.leadPerk;
  const chosen = selectedPerk !== undefined && campaign.perks.includes(selectedPerk);
  const perks = chosen ? [selectedPerk, ...campaign.perks.filter((perk) => perk !== selectedPerk)] : campaign.perks;
  const terms = posterLine(campaign.amount, campaign.goal, campaign.deadline);
  const back = campaign.accepting ? terms :
    `This campaign is no longer taking pledges. Original terms: ${terms} Scan for its current status.`;
  const heading = perks[0] ?? null;
  const layout = layoutPoster({
    name: brand.face === "sans" ? poster.name.toUpperCase() : poster.name,
    tagline: poster.tagline, headline: heading, back, perks: perks.slice(1), location: poster.location,
  }, measure, { face: brand.face });
  const linkProblem = posterLinkProblem(link);
  const missingPerks = !perks.length ? "Campaign perks are missing. Load the real perks before exporting." : null;
  const changedPerk = selectedPerk !== undefined && !chosen ? "The chosen headline perk is not in this campaign. Choose one of its actual perks." : null;
  const problem = measured.problem ?? linkProblem ?? missingPerks ?? changedPerk ?? layout.problem;
  useEffect(() => { onStatus?.({ ready: measured.ready && !problem, problem }); }, [onStatus, measured.ready, problem]);
  const code = useMemo(() => posterLinkProblem(link) ? null : qrPath(link), [link]);
  const align = brand.centered ? "middle" : "start";
  const textX = brand.centered ? POSTER_W / 2 : POSTER_M;
  const label = [poster.name, heading, ...perks.slice(1), back].filter(Boolean).join(". ");
  const readableLink = fitLines(shortLink(link), layout.qr.x - POSTER_M - 22, (line) => measure(line, "mono", 8.5), 2);
  return (
    <svg ref={svgRef} className="poster-art" data-direction={brand.direction}
      data-poster-ready={measured.ready && !problem} data-poster-problem={problem ?? ""}
      viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>{`Marketing poster: ${label}`}</title>
      <defs>
        <clipPath id={`${id}-art`}><rect width={layout.art.width} height={layout.art.height} rx={brand.centered ? 60 : 4} /></clipPath>
      </defs>
      <rect width={POSTER_W} height={POSTER_H} fill={brand.paper} />
      {brand.direction === "kinetic" ? <rect x="0" y="0" width="12" height={POSTER_H} fill={brand.ink} /> : null}
      {brand.direction === "coastal" ? <rect x="16" y="16" width={POSTER_W - 32} height={POSTER_H - 32} rx="22" fill="none" stroke={brand.ink} strokeWidth="1.5" /> : null}
      {brand.direction === "editorial" || brand.direction === "workshop" ? <path d={`M${POSTER_M} 58H${POSTER_W - POSTER_M}`} stroke={brand.ink} strokeWidth="1.2" /> : null}
      {appearance.logo ? <g>
        <rect x={POSTER_M - 4} y="14" width="112" height="46" rx="4" fill={appearance.logoBackground ?? "#ffffff"} />
        <image href={appearance.logo} x={POSTER_M} y="18" width="104" height="38" preserveAspectRatio="xMinYMid meet" />
      </g> : null}
      <text x={appearance.logo ? POSTER_W - POSTER_M : textX} y="42" textAnchor={appearance.logo ? "end" : align}
        fontFamily={POSTER_FONTS.mono} fontSize="9" letterSpacing="1.4" fill={brand.ink}>
        {campaign.accepting ? "BECOME A FOUNDING SUPPORTER" : "THE FOUNDING CAMPAIGN"}
      </text>
      <Words value={layout.name} x={textX} anchor={align} face={brand.face} color={brand.ink} />
      <Words value={layout.tagline} x={textX} anchor={align} face="serif" color={brand.ink} />
      {layout.headlineLabelY !== null ? <text x={POSTER_M} y={layout.headlineLabelY} fontFamily={POSTER_FONTS.mono}
        fontSize="9" letterSpacing="1.4" fill={brand.ink}>{campaign.accepting ? "AS A FOUNDER, YOU GET" : "THE CAMPAIGN'S ORIGINAL PERKS"}</text> : null}
      {layout.headline ? <rect x={POSTER_M - 6} y={(layout.headline.y[0] ?? 0) - layout.headline.size * .83}
        width={POSTER_W - POSTER_M * 2 + 12} height={(layout.headline.y.at(-1) ?? 0) - (layout.headline.y[0] ?? 0) + layout.headline.size * 1.15}
        rx={brand.centered ? 14 : 2} fill={brand.accent} /> : null}
      <Words value={layout.headline} face={brand.face} color={brand.accentInk} />
      <PosterMotif box={layout.art} brand={brand} clipId={`${id}-art`} />
      {layout.perksLabelY !== null ? <text x={POSTER_M} y={layout.perksLabelY} fontFamily={POSTER_FONTS.mono}
        fontSize="9" letterSpacing="1.4" fill={brand.ink}>PLUS, AS A FOUNDER</text> : null}
      {layout.perks.map((perk, i) => <g key={i}>
        <circle cx={POSTER_M + 5} cy={(perk.y[0] ?? 0) - 5} r="3" fill={brand.ink} />
        <Words value={perk} x={POSTER_M + 22} color={brand.ink} />
      </g>)}
      <Words value={layout.location} color={brand.ink} />
      <path d={`M${POSTER_M} ${layout.bandTop}H${POSTER_W - POSTER_M}`} stroke={brand.ink} strokeWidth="1.3" />
      <text x={POSTER_M} y={layout.bandTop + 26} fontFamily={POSTER_FONTS.mono} fontSize="9.5" letterSpacing="1.2" fill={brand.ink}>
        THE PLEDGE
      </text>
      <Words value={layout.back} color={brand.ink} />
      {code ? <g transform={`translate(${layout.qr.x} ${layout.qr.y})`} data-poster-qr-frame="true">
        <rect x="-7" y="-3" width={layout.qr.size + 16} height={layout.qr.size + 16} rx="13" fill={brand.ink} opacity=".11" />
        <rect x="-10" y="-9" width={layout.qr.size + 20} height={layout.qr.size + 20} rx={brand.direction === "kinetic" ? "3" : "12"}
          fill={brand.paper} stroke={brand.ink} strokeWidth="1.25" />
        <path d={`M-10 21V-9H21M${layout.qr.size - 21} ${layout.qr.size + 11}H${layout.qr.size + 10}V${layout.qr.size - 19}`}
          fill="none" stroke={brand.accent} strokeWidth="4" />
        <rect width={layout.qr.size} height={layout.qr.size} rx="4" fill="#ffffff" />
        <path data-qr-quiet-modules="5" d={code.path}
          transform={`translate(${layout.qr.size * 5 / (code.size + 10)} ${layout.qr.size * 5 / (code.size + 10)}) scale(${layout.qr.size / (code.size + 10)})`}
          fill="#111111" shapeRendering="crispEdges" />
        <text x={layout.qr.size / 2} y="-16" textAnchor="middle" fontFamily={POSTER_FONTS.mono} fontSize="8.5" fill={brand.ink}>
          {campaign.accepting ? "SCAN TO JOIN" : "SCAN FOR STATUS"}
        </text>
      </g> : null}
      {sandbox ? <text x={POSTER_M} y={POSTER_H - 48} fontFamily={POSTER_FONTS.sans}
        fontSize="9" fill={brand.ink}>{SANDBOX_NOTICE}</text> : null}
      {readableLink.map((line, i) => <text key={i} x={POSTER_M} y={POSTER_H - 30 + i * 10} fontFamily={POSTER_FONTS.mono} fontSize="8.5" fill={brand.ink}>{line}</text>)}
      <text x={POSTER_W - POSTER_M} y={POSTER_H - 10} textAnchor="end" fontFamily={POSTER_FONTS.sans} fontSize="6.8" fill={brand.ink}>Made with Walk-in</text>
    </svg>
  );
}
