import { type SVGProps } from 'react';

/**
 * Caduceus mark — single-line geometric caduceus (twin snakes, wings, staff).
 * Stroke-based so it recolors via `currentColor`.
 */
export function CaduceusMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Wings */}
      <path d="M6 5.5c-1.6-.2-3 .3-3.5 1.2.9 0 2 .2 3 .7" />
      <path d="M18 5.5c1.6-.2 3 .3 3.5 1.2-.9 0-2 .2-3 .7" />
      {/* Orb on top */}
      <circle cx="12" cy="3.5" r="1.1" />
      {/* Staff */}
      <path d="M12 4.5v16.5" />
      {/* Left snake */}
      <path d="M12 7c-3 0-3 3 0 3s3 3 0 3 3 3 0 3 -3 3 0 3" />
      {/* Right snake */}
      <path d="M12 7c3 0 3 3 0 3s-3 3 0 3-3 3 0 3 3 3 0 3" />
    </svg>
  );
}
