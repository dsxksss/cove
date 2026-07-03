import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export enum CornerStyle {
  Continuous = "continuous",
  Circular = "circular",
}

export enum LiquidGlassType {
  Clear = "clear",
  Tint = "tint",
  Regular = "regular",
  Interactive = "interactive",
  Identity = "identity",
}

type LiquidGlassVars = CSSProperties & {
  "--lg-radius"?: string;
  "--lg-tint"?: string;
  "--lg-spacing"?: string;
};

interface LiquidGlassOptions {
  type?: LiquidGlassType;
  tint?: string;
  cornerRadius?: number;
  isInteractive?: boolean;
  cornerStyle?: CornerStyle;
}

interface LiquidGlassViewProps
  extends LiquidGlassOptions,
    Omit<HTMLAttributes<HTMLDivElement>, "style"> {
  style?: CSSProperties;
  containerClassName?: string;
  children?: ReactNode;
}

interface LiquidGlassContainerProps extends HTMLAttributes<HTMLDivElement> {
  morph?: number;
  horizontal?: boolean;
  children?: ReactNode;
}

function joinClassNames(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function liquidGlassStyle({
  tint,
  cornerRadius,
}: Pick<LiquidGlassOptions, "tint" | "cornerRadius"> = {}): LiquidGlassVars {
  return {
    ...(tint ? { "--lg-tint": tint } : {}),
    ...(cornerRadius !== undefined ? { "--lg-radius": `${cornerRadius}px` } : {}),
  };
}

export function liquidGlassClassName(
  {
    type = LiquidGlassType.Regular,
    isInteractive = false,
    cornerStyle = CornerStyle.Continuous,
  }: Pick<LiquidGlassOptions, "type" | "isInteractive" | "cornerStyle"> = {},
  className?: string
) {
  return joinClassNames(
    "liquid-glass",
    `liquid-glass--${type}`,
    `liquid-glass--corner-${cornerStyle}`,
    isInteractive && "liquid-glass-is-interactive",
    className
  );
}

export function LiquidGlassFilters() {
  return (
    <svg className="liquid-glass-filters" aria-hidden="true" focusable="false">
      <filter id="liquid-glass-refract" x="-12%" y="-12%" width="124%" height="124%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.009 0.018"
          numOctaves="2"
          seed="13"
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="1.2" result="softNoise" />
        <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="13" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

export function LiquidGlassView({
  type,
  tint,
  cornerRadius,
  isInteractive,
  cornerStyle,
  className,
  containerClassName,
  style,
  children,
  ...rest
}: LiquidGlassViewProps) {
  return (
    <div
      {...rest}
      className={liquidGlassClassName({ type, isInteractive, cornerStyle }, className)}
      style={{ ...liquidGlassStyle({ tint, cornerRadius }), ...style }}
    >
      {children ? <div className={joinClassNames("liquid-glass__content", containerClassName)}>{children}</div> : null}
    </div>
  );
}

export function LiquidGlassContainer({
  morph = 200,
  horizontal = false,
  className,
  style,
  children,
  ...rest
}: LiquidGlassContainerProps) {
  return (
    <div
      {...rest}
      className={joinClassNames(
        "liquid-glass-container",
        horizontal ? "liquid-glass-container--horizontal" : "liquid-glass-container--vertical",
        className
      )}
      style={{ "--lg-spacing": `${morph}px`, ...style } as LiquidGlassVars}
    >
      {children}
    </div>
  );
}
