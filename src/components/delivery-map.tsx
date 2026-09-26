import { useId } from "react";

type DeliveryMapProps = {
  className?: string;
  compact?: boolean;
  stage?: string;
};

const columns = [-200, -70, 60, 190, 320, 450, 580, 710, 840, 970];
const rows = [-200, -90, 20, 130, 240, 350, 460, 570];

/** An intentionally illustrative map; it does not represent live courier location. */
export function DeliveryMap({
  className,
  compact = false,
  stage,
}: DeliveryMapProps) {
  const id = useId().replace(/:/g, "");
  const delivered =
    stage === "PAID" || stage === "DELIVERY_CONFIRMED" || stage === "delivered";

  return (
    <svg
      className={className}
      viewBox="0 0 900 500"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Illustrative delivery route through San Francisco, from the Mission District to South of Market"
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <defs>
        <pattern
          id={`${id}-blocks`}
          width="130"
          height="110"
          patternUnits="userSpaceOnUse"
        >
          <rect x="12" y="12" width="106" height="86" rx="5" fill="#e8eae3" />
          <path d="M65 14v82M14 56h102" stroke="#eff0eb" strokeWidth="3" />
          <rect
            x="18"
            y="18"
            width="39"
            height="28"
            rx="2"
            fill="#e3e6dd"
            opacity=".7"
          />
          <rect
            x="74"
            y="64"
            width="35"
            height="25"
            rx="2"
            fill="#e3e6dd"
            opacity=".7"
          />
        </pattern>
        <filter
          id={`${id}-shadow`}
          x="-70%"
          y="-70%"
          width="240%"
          height="260%"
        >
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="5"
            floodColor="#264532"
            floodOpacity=".16"
          />
        </filter>
        <linearGradient id={`${id}-water`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#e0eae8" />
          <stop offset="1" stopColor="#d9e8ec" />
        </linearGradient>
      </defs>

      <rect width="900" height="500" fill="#edf0e9" />
      <g transform="rotate(-24 450 250)">
        <rect
          x="-200"
          y="-200"
          width="1300"
          height="990"
          fill={`url(#${id}-blocks)`}
        />
        {columns.map((x) => (
          <path
            key={`v${x}`}
            d={`M${x} -300V850`}
            stroke="#fafbf7"
            strokeWidth="13"
          />
        ))}
        {rows.map((y) => (
          <path
            key={`h${y}`}
            d={`M-350 ${y}H1300`}
            stroke="#fafbf7"
            strokeWidth="13"
          />
        ))}
        <path
          d="M-180 405H1100M385-200V850M775-200V850"
          stroke="#f8f9f4"
          strokeWidth="7"
        />

        <rect x="73" y="254" width="103" height="82" rx="7" fill="#dfe9d5" />
        <path d="m83 267 79 57m-78-2 77-55" stroke="#ecf1e5" strokeWidth="4" />
        <ellipse cx="126" cy="295" rx="18" ry="14" fill="#d2dfc7" />
        <rect x="594" y="34" width="101" height="82" rx="6" fill="#dfe9d5" />
        <path
          d="M605 90q41-59 80-45M609 104l62-59"
          fill="none"
          stroke="#eef3e7"
          strokeWidth="5"
        />
        <circle cx="665" cy="88" r="12" fill="#d2dfc7" />
        <rect x="463" y="364" width="103" height="82" rx="6" fill="#e0e9d8" />
        <rect
          x="484"
          y="379"
          width="61"
          height="51"
          rx="21"
          fill="none"
          stroke="#edf2e7"
          strokeWidth="6"
        />

        <g
          fill="#a3a79d"
          fontFamily="Arial, sans-serif"
          fontSize="8.5"
          letterSpacing="1.1"
        >
          <text x="207" y="134">
            FOLSOM ST
          </text>
          <text x="471" y="134">
            FOLSOM ST
          </text>
          <text x="74" y="245">
            HARRISON ST
          </text>
          <text x="608" y="245">
            HARRISON ST
          </text>
          <text x="214" y="354">
            BRYANT ST
          </text>
          <text x="476" y="354">
            BRYANT ST
          </text>
          <text x="199" y="64" transform="rotate(90 199 64)">
            11TH ST
          </text>
          <text x="329" y="368" transform="rotate(90 329 368)">
            9TH ST
          </text>
          <text x="589" y="269" transform="rotate(90 589 269)">
            5TH ST
          </text>
          <text x="719" y="58" transform="rotate(90 719 58)">
            3RD ST
          </text>
        </g>

        <path
          d="M-80 53 1000 53"
          fill="none"
          stroke="#e3e4dc"
          strokeWidth="24"
        />
        <path
          d="M-80 53 1000 53"
          fill="none"
          stroke="#f9f9f4"
          strokeWidth="19"
        />
        <path
          d="M-80 53 1000 53"
          fill="none"
          stroke="#e4e5de"
          strokeWidth="1.3"
          strokeDasharray="5 7"
        />

        <path
          d="M190 240H307Q320 240 320 227V145Q320 130 335 130H580"
          fill="none"
          stroke="#fff"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M190 240H307Q320 240 320 227V145Q320 130 335 130H580"
          fill="none"
          stroke="#2f6747"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={delivered ? undefined : "1 8"}
        />
        <path
          d="M190 240H307Q320 240 320 227V199"
          fill="none"
          stroke="#2f6747"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </g>

      <path
        d="M737-35 717 8 740 38 721 63 756 97 742 119 778 151 763 183 803 221 792 252 841 297 834 319 909 374V-35Z"
        fill="#d2dfdb"
      />
      <path
        d="M751-35 731 8 754 38 735 63 770 97 756 119 792 151 777 183 817 221 806 252 855 297 848 319 923 374V-35Z"
        fill={`url(#${id}-water)`}
      />
      <path
        d="m805 30 59 41m-82 7 51 36m-19 54 53 38m-31 43 64 46"
        stroke="#eff5f2"
        strokeWidth="2"
        opacity=".7"
      />
      <path
        d="m778 78 68-83m-36 122 81-103m-43 148 64-76"
        stroke="#cfdfe1"
        strokeWidth="10"
      />

      <g fontFamily="Arial, sans-serif" textAnchor="middle">
        <text
          x="594"
          y="310"
          fill="#949b8f"
          fontSize="12"
          fontWeight="500"
          letterSpacing="3"
        >
          SOUTH OF MARKET
        </text>
        <text
          x="134"
          y="447"
          fill="#949b8f"
          fontSize="11"
          fontWeight="500"
          letterSpacing="2.7"
        >
          MISSION DISTRICT
        </text>
        {!compact && (
          <text x="772" y="424" fill="#a0aa9d" fontSize="9" letterSpacing="1.5">
            MISSION BAY
          </text>
        )}
      </g>

      <g transform="translate(208 346)" filter={`url(#${id}-shadow)`}>
        <circle r="27" fill="#ffffff" fillOpacity=".55" />
        <circle r="20" fill="#fff" />
        <circle r="15" fill="#2e5e41" />
        <path
          d="m-7-4 7-4 7 4v8L0 8l-7-4Z M-7-4 0 0l7-4M0 0v8M-4-6l7 4"
          fill="none"
          stroke="#fff"
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
      </g>
      <g transform="translate(520 87)" filter={`url(#${id}-shadow)`}>
        <circle r="28" fill="#fff" fillOpacity=".45" />
        <circle r="20" fill="#fff" />
        <circle r="14" fill="#eaf0e5" stroke="#2e5e41" strokeWidth="2" />
        {delivered ? (
          <path
            d="m-6 0 4 4 8-8"
            fill="none"
            stroke="#2e5e41"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <circle r="4" fill="#2e5e41" />
            <path d="M0-24V-18" stroke="#fff" strokeWidth="2" />
          </>
        )}
      </g>

      {!delivered && (
        <g transform="translate(311 257)" filter={`url(#${id}-shadow)`}>
          <circle r="29" fill="#2e5e41" fillOpacity=".09" />
          <circle r="21" fill="#fff" />
          <circle r="17" fill="#e7ad79" />
          <g
            fill="none"
            stroke="#3d432e"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="-7" cy="5" r="4" />
            <circle cx="8" cy="5" r="4" />
            <path d="m-7 5 5-9 5 9H-7m9-15h4m-6 5h7l3 10M-3-7h4" />
          </g>
          {!compact && (
            <g transform="translate(-59 -59)">
              <rect width="118" height="27" rx="8" fill="#fff" />
              <path d="m53 26 6 6 6-6" fill="#fff" />
              <circle cx="14" cy="13.5" r="3" fill="#3d7751" />
              <text
                x="25"
                y="17"
                fill="#354b38"
                fontFamily="Arial, sans-serif"
                fontSize="10"
                fontWeight="600"
              >
                Courier on the way
              </text>
            </g>
          )}
        </g>
      )}

      <g transform="translate(23 470)" fontFamily="Arial, sans-serif">
        <rect
          x="-8"
          y="-14"
          width="111"
          height="23"
          rx="5"
          fill="#fafbf7"
          fillOpacity=".86"
        />
        <text fill="#8d978b" fontSize="9" letterSpacing=".3">
          Illustrative route
        </text>
      </g>
    </svg>
  );
}

export default DeliveryMap;
