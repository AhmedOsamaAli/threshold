import type { Spot } from "../../api/spot";
import { planOf } from "../../lib/spot";

/** A walk of ten minutes drawn as a plan, north up: the area (street network or a plain circle, as the check says), the
 * address at its centre, and the places OpenStreetMap lists in it, the asked kind filled. */
export function SpotPlan({ spot }: { spot: Spot }) {
  const plan = planOf(spot);
  if (!plan) return null;
  const same = plan.dots.filter((dot) => dot.same).length;
  const label = `A plan of a ${spot.walk_minutes}-minute walk from ${spot.place.label}. Filled dots: ${same} listed ${spot.kind} places. Hollow dots: ${plan.dots.length - same} other places.`;
  const { x, y } = plan.centre;
  return (
    <figure className="spot-plan">
      <svg viewBox={`0 0 ${plan.size} ${plan.size}`} role="img" aria-label={label}>
        <polygon className="spot-ring" points={plan.ring} />
        {plan.dots.map((dot, index) => (
          <circle key={index} className={dot.same ? "spot-dot same" : "spot-dot"} cx={dot.x} cy={dot.y} r={dot.same ? 5 : 3} />
        ))}
        <g className="spot-centre">
          <circle cx={x} cy={y} r={7} />
          <path d={`M ${x - 12} ${y} H ${x + 12} M ${x} ${y - 12} V ${y + 12}`} />
        </g>
        <text className="spot-north mono" x={plan.size - 22} y={22}>
          N
        </text>
      </svg>
      <figcaption className="mono">
        {spot.walk_minutes}-minute walk{spot.area?.source === "circle" ? " (a circle of that radius, not the streets)" : " along streets"} ·
        filled: {spot.kind} · hollow: other places
      </figcaption>
    </figure>
  );
}
