import { useId } from "react";

type ParcelArtProps = {
  className?: string;
};

export function ParcelArt({ className }: ParcelArtProps) {
  const id = useId().replace(/:/g, "");

  return (
    <svg
      className={className}
      viewBox="0 0 330 220"
      fill="none"
      role="img"
      aria-label="Illustration of a Haulie delivery parcel"
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <defs>
        <linearGradient id={`${id}-top`} x1="110" y1="54" x2="222" y2="112" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f7ead1" />
          <stop offset="1" stopColor="#ead7b3" />
        </linearGradient>
        <linearGradient id={`${id}-left`} x1="92" y1="114" x2="164" y2="187" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e9d5b0" />
          <stop offset="1" stopColor="#d8bb8c" />
        </linearGradient>
        <linearGradient id={`${id}-right`} x1="163" y1="127" x2="243" y2="173" gradientUnits="userSpaceOnUse">
          <stop stopColor="#dfc7a0" />
          <stop offset="1" stopColor="#cfac79" />
        </linearGradient>
        <radialGradient id={`${id}-sphere`} cx=".3" cy=".25" r=".8">
          <stop stopColor="#fbfdf5" />
          <stop offset="1" stopColor="#c7d8b6" />
        </radialGradient>
        <filter id={`${id}-blur`} x="-50%" y="-100%" width="200%" height="300%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <path d="M35 156c-24-19-7-43 24-40 41 5 10 62 82 65 54 3 55-73 104-73 39 0 64 31 40 49-15 12-27-4-15-14" stroke="#a7bf95" strokeWidth="1.3" strokeDasharray="4 5" strokeLinecap="round" opacity=".75" />
      <path d="M75 87c-18-14-14-39 2-45 27-10 21 37 52 32 29-4 43-56 86-36 38 18 33 56 65 41" stroke="#b7cba5" strokeWidth="1.3" strokeLinecap="round" opacity=".7" />
      <ellipse cx="170" cy="189" rx="69" ry="10" fill="#709657" opacity=".17" filter={`url(#${id}-blur)`} />
      <circle cx="274" cy="57" r="14" fill={`url(#${id}-sphere)`} opacity=".8" />
      <circle cx="66" cy="171" r="9" fill={`url(#${id}-sphere)`} />
      <circle cx="253" cy="187" r="5" fill="#ceddbc" opacity=".8" />
      <circle cx="91" cy="58" r="3" fill="#8aaa75" opacity=".65" />

      <path d="m94 89 76-39 75 41-78 42Z" fill={`url(#${id}-top)`} stroke="#e3cea8" strokeWidth=".7" strokeLinejoin="round" />
      <path d="m94 89 73 41v66l-70-41a6 6 0 0 1-3-5Z" fill={`url(#${id}-left)`} />
      <path d="m167 130 78-39v63a6 6 0 0 1-3 5l-75 37Z" fill={`url(#${id}-right)`} />
      <path d="m94 89 73 41 78-39M167 130v66" stroke="#c8a570" strokeWidth=".8" strokeLinejoin="round" opacity=".65" />
      <path d="m122 74 75 40 0 23 15-8v-23L139 65Z" fill="#f5e7cb" opacity=".86" />
      <path d="m129 70 75 40" stroke="#ddcbaa" strokeWidth=".8" strokeDasharray="2 3" />
      <path d="m98 92 65 37m8 2 69-35" stroke="#fff7e7" strokeWidth="1.2" opacity=".7" />

      <g transform="matrix(.88 .49 0 1 107 107)">
        <rect width="41" height="41" rx="10" fill="#2b5539" />
        <path d="M12 10h6v11c2-3 4-4 7-4 5 0 7 3 7 8v9h-6v-8c0-3-1-4-3-4-3 0-5 3-5 7v5h-6Z" fill="#f2f1db" />
        <path d="M28 9v4m-2-2h4" stroke="#b9cb97" strokeWidth="1.3" strokeLinecap="round" />
      </g>
      <g transform="matrix(.85 -.43 0 1 211 140)">
        <rect x="-3" y="-1" width="23" height="18" rx="2" fill="#ecdbbb" opacity=".8" />
        <path d="M1 3v8m3-8v8m2-8v8m4-8v8m3-8v8m2-8v8" stroke="#9a7d53" strokeWidth="1" />
      </g>

      <g transform="translate(251 110)">
        <circle r="18" fill="#f6faee" />
        <circle r="14" fill="#2e6040" />
        <path d="m-6 0 4 4 8-8" stroke="#f4f7e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export default ParcelArt;
