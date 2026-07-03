/**
 * Liquid-glass displacement filter generator.
 * Ported from nikdelvin/liquid-glass (MIT) — src/utils/liquidGlass.ts.
 *
 * Why this fixes corner spikes: the displacement MAP is neutral gray
 * (#808080 = zero displacement) outside the rounded lens and through the
 * interior. Only the rounded edge band bends pixels, so the filter cannot
 * create a square outline at the card corners.
 */

type DisplacementOptions = {
  height: number;
  width: number;
  radius: number;
  depth: number;
  strength?: number;
  chromaticAberration?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const getDisplacementMap = ({
  height,
  width,
  radius,
  depth,
}: Omit<DisplacementOptions, "chromaticAberration" | "strength">) => {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const maxRadius = Math.min(safeWidth, safeHeight) / 2;
  const outerRadius = clamp(radius, 0, maxRadius);
  const edgeDepth = clamp(depth, 0, maxRadius);
  const innerWidth = Math.max(1, safeWidth - edgeDepth * 2);
  const innerHeight = Math.max(1, safeHeight - edgeDepth * 2);
  const innerRadius = Math.max(0, outerRadius - edgeDepth);
  const y1 = clamp(Math.ceil((outerRadius / safeHeight) * 15), 0, 100);
  const y2 = clamp(Math.floor(100 - (outerRadius / safeHeight) * 15), 0, 100);
  const x1 = clamp(Math.ceil((outerRadius / safeWidth) * 15), 0, 100);
  const x2 = clamp(Math.floor(100 - (outerRadius / safeWidth) * 15), 0, 100);

  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`<svg height="${safeHeight}" width="${safeWidth}" viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">
    <style>
        .mix { mix-blend-mode: screen; }
    </style>
    <defs>
        <clipPath id="lens-shape">
          <rect x="0" y="0" height="${safeHeight}" width="${safeWidth}" rx="${outerRadius}" ry="${outerRadius}" />
        </clipPath>
        <linearGradient
          id="Y"
          x1="0"
          x2="0"
          y1="${y1}%"
          y2="${y2}%">
            <stop offset="0%" stop-color="#0F0" />
            <stop offset="100%" stop-color="#000" />
        </linearGradient>
        <linearGradient
          id="X"
          x1="${x1}%"
          x2="${x2}%"
          y1="0"
          y2="0">
            <stop offset="0%" stop-color="#F00" />
            <stop offset="100%" stop-color="#000" />
        </linearGradient>
    </defs>

    <rect x="0" y="0" height="${safeHeight}" width="${safeWidth}" fill="#808080" />
    <g clip-path="url(#lens-shape)">
    <g filter="blur(2px)">
      <rect x="0" y="0" height="${safeHeight}" width="${safeWidth}" fill="#000080" />
      <rect
          x="0"
          y="0"
          height="${safeHeight}"
          width="${safeWidth}"
          fill="url(#Y)"
          class="mix"
      />
      <rect
          x="0"
          y="0"
          height="${safeHeight}"
          width="${safeWidth}"
          fill="url(#X)"
          class="mix"
      />
      <rect
          x="${edgeDepth}"
          y="${edgeDepth}"
          height="${innerHeight}"
          width="${innerWidth}"
          fill="#808080"
          rx="${innerRadius}"
          ry="${innerRadius}"
          filter="blur(${edgeDepth}px)"
      />
    </g>
    </g>
</svg>`)
  );
};

export const getDisplacementFilter = ({
  height,
  width,
  radius,
  depth,
  strength = 100,
  chromaticAberration = 0,
}: DisplacementOptions) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg height="${height}" width="${width}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <filter id="displace" color-interpolation-filters="sRGB">
            <feImage x="0" y="0" height="${height}" width="${width}" href="${getDisplacementMap(
              {
                height,
                width,
                radius,
                depth,
              },
            )}" result="displacementMap" />
            <feDisplacementMap
                transform-origin="center"
                in="SourceGraphic"
                in2="displacementMap"
                scale="${strength + chromaticAberration * 2}"
                xChannelSelector="R"
                yChannelSelector="G"
            />
            <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="displacedR"
                    />
            <feDisplacementMap
                in="SourceGraphic"
                in2="displacementMap"
                scale="${strength + chromaticAberration}"
                xChannelSelector="R"
                yChannelSelector="G"
            />
            <feColorMatrix
            type="matrix"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="displacedG"
                    />
            <feDisplacementMap
                    in="SourceGraphic"
                    in2="displacementMap"
                    scale="${strength}"
                    xChannelSelector="R"
                    yChannelSelector="G"
                />
                <feColorMatrix
                type="matrix"
                values="0 0 0 0 0
                        0 0 0 0 0
                        0 0 1 0 0
                        0 0 0 1 0"
                result="displacedB"
                        />
              <feBlend in="displacedR" in2="displacedG" mode="screen"/>
              <feBlend in2="displacedB" mode="screen"/>
        </filter>
    </defs>
</svg>`) +
  "#displace";
