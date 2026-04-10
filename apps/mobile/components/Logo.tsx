import Svg, { Rect, Path, Ellipse, Polygon, Circle } from "react-native-svg";

export function Logo({ size = 48 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="16 16 480 480">
      <Rect x="16" y="16" width="480" height="480" rx="80" ry="80" fill="#7a3fb0" />
      <Path
        d="M248,192 Q185,128 112,120 Q68,116 62,168 Q58,222 118,248 Q163,265 248,257"
        fill="#ffffff"
        stroke="#111827"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <Path
        d="M264,192 Q327,128 400,120 Q444,116 450,168 Q454,222 394,248 Q349,265 264,257"
        fill="#ffffff"
        stroke="#111827"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <Path
        d="M248,278 Q232,335 180,350 Q128,362 120,325 Q114,290 160,276 L248,268"
        fill="#ffffff"
        stroke="#111827"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <Path
        d="M264,278 Q280,335 332,350 Q384,362 392,325 Q398,290 352,276 L264,268"
        fill="#ffffff"
        stroke="#111827"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <Ellipse cx="256" cy="148" rx="11" ry="11" fill="#f0a0b0" stroke="#111827" strokeWidth="3" />
      <Rect
        x="245"
        y="156"
        width="22"
        height="14"
        rx="2"
        fill="#c0c0c0"
        stroke="#111827"
        strokeWidth="2.5"
      />
      <Rect
        x="246"
        y="168"
        width="20"
        height="198"
        rx="3"
        fill="#fdd835"
        stroke="#111827"
        strokeWidth="3"
      />
      <Polygon
        points="246,366 266,366 256,398"
        fill="#f5c16c"
        stroke="#111827"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <Polygon points="252,388 260,388 256,400" fill="#2d1a24" />
      <Path
        d="M247,158 Q216,96 182,80"
        stroke="#111827"
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M265,158 Q296,96 330,80"
        stroke="#111827"
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M247,158 Q216,96 182,80"
        stroke="#ffffff"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M265,158 Q296,96 330,80"
        stroke="#ffffff"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <Circle cx="182" cy="80" r="7" fill="#ffffff" stroke="#111827" strokeWidth="3" />
      <Circle cx="330" cy="80" r="7" fill="#ffffff" stroke="#111827" strokeWidth="3" />
    </Svg>
  );
}
