/**
 * Web port of expo-liquid-glass-view's public API + visual language.
 *
 * Native iOS uses SwiftUI `.glassEffect` / `GlassEffectContainer`.
 * Here we approximate the same surface types, continuous corners, interactive
 * spring press, and morphing control docks with CSS backdrop-filter + Motion.
 *
 * API mirrors:
 *   - ExpoLiquidGlassView  → LiquidGlassView
 *   - ExpoLiquidGlassContainer → LiquidGlassContainer
 *   - CornerStyle / LiquidGlassType enums (same string values)
 */
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { motion, type HTMLMotionProps } from "motion/react";

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
  "--lg-blur"?: string;
  "--lg-sat"?: string;
  "--lg-fill"?: string;
};

export interface LiquidGlassOptions {
  type?: LiquidGlassType | `${LiquidGlassType}`;
  tint?: string;
  cornerRadius?: number;
  isInteractive?: boolean;
  cornerStyle?: CornerStyle | `${CornerStyle}`;
}

type SharedGlassProps = LiquidGlassOptions & {
  className?: string;
  containerClassName?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export type LiquidGlassViewProps = SharedGlassProps &
  Omit<HTMLAttributes<HTMLDivElement>, "style" | "children" | "className"> & {
    /** Render as a semantic button (transport controls, etc.). */
    as?: "div" | "button";
    typeAttr?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
    disabled?: boolean;
    title?: string;
    onClick?: HTMLAttributes<HTMLElement>["onClick"];
  };

interface LiquidGlassContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Maps to iOS GlassEffectContainer `spacing` (morph distance). */
  morph?: number;
  horizontal?: boolean;
  children?: ReactNode;
}

function joinClassNames(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

/** Resolve CSS custom properties for tint / radius / type fill. */
export function liquidGlassStyle({
  tint,
  cornerRadius,
  type = LiquidGlassType.Regular,
}: Pick<LiquidGlassOptions, "tint" | "cornerRadius" | "type"> = {}): LiquidGlassVars {
  const resolvedType = type as LiquidGlassType;
  const fillByType: Record<LiquidGlassType, string> = {
    [LiquidGlassType.Clear]: "rgba(255,255,255,0.06)",
    [LiquidGlassType.Tint]: tint
      ? `color-mix(in srgb, ${tint} 42%, rgba(255,255,255,0.08))`
      : "rgba(255,255,255,0.12)",
    [LiquidGlassType.Regular]: "rgba(255,255,255,0.10)",
    [LiquidGlassType.Interactive]: "rgba(255,255,255,0.12)",
    [LiquidGlassType.Identity]: "transparent",
  };
  const blurByType: Record<LiquidGlassType, string> = {
    [LiquidGlassType.Clear]: "14px",
    [LiquidGlassType.Tint]: "22px",
    [LiquidGlassType.Regular]: "20px",
    [LiquidGlassType.Interactive]: "22px",
    [LiquidGlassType.Identity]: "0px",
  };
  const satByType: Record<LiquidGlassType, string> = {
    [LiquidGlassType.Clear]: "180%",
    [LiquidGlassType.Tint]: "210%",
    [LiquidGlassType.Regular]: "200%",
    [LiquidGlassType.Interactive]: "220%",
    [LiquidGlassType.Identity]: "100%",
  };

  return {
    ...(tint ? { "--lg-tint": tint } : {}),
    ...(cornerRadius !== undefined ? { "--lg-radius": `${cornerRadius}px` } : {}),
    "--lg-fill": fillByType[resolvedType] ?? fillByType[LiquidGlassType.Regular],
    "--lg-blur": blurByType[resolvedType] ?? "20px",
    "--lg-sat": satByType[resolvedType] ?? "200%",
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
  const interactive =
    isInteractive ||
    type === LiquidGlassType.Interactive ||
    String(type) === LiquidGlassType.Interactive;
  return joinClassNames(
    "liquid-glass",
    `liquid-glass--${type}`,
    `liquid-glass--corner-${cornerStyle}`,
    interactive && "liquid-glass-is-interactive",
    className
  );
}

/** Hidden SVG filter used for subtle edge refraction (optional polish). */
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
        <feDisplacementMap
          in="SourceGraphic"
          in2="softNoise"
          scale="10"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}

const interactiveMotion = {
  whileHover: { scale: 1.06 },
  whileTap: { scale: 0.92 },
  transition: { type: "spring" as const, stiffness: 420, damping: 28, mass: 0.55 },
};

/**
 * Single glass surface — mirrors ExpoLiquidGlassView.
 * Use `isInteractive` / type=`interactive` for spring press like iOS glass.interactive().
 */
export function LiquidGlassView({
  type = LiquidGlassType.Regular,
  tint,
  cornerRadius,
  isInteractive = false,
  cornerStyle = CornerStyle.Continuous,
  className,
  containerClassName,
  style,
  children,
  as = "div",
  typeAttr = "button",
  disabled,
  title,
  onClick,
  ...rest
}: LiquidGlassViewProps) {
  const interactive =
    isInteractive ||
    type === LiquidGlassType.Interactive ||
    String(type) === LiquidGlassType.Interactive;
  const classes = liquidGlassClassName({ type, isInteractive: interactive, cornerStyle }, className);
  const mergedStyle = {
    ...liquidGlassStyle({ tint, cornerRadius, type }),
    ...style,
  };

  const content = children ? (
    <div className={joinClassNames("liquid-glass__content", containerClassName)}>{children}</div>
  ) : null;

  if (as === "button") {
    const motionProps: HTMLMotionProps<"button"> = {
      type: typeAttr,
      disabled,
      title,
      onClick: onClick as HTMLMotionProps<"button">["onClick"],
      className: classes,
      style: mergedStyle,
      ...(interactive && !disabled ? interactiveMotion : {}),
    };
    return (
      <motion.button {...motionProps} {...(rest as object)}>
        {content}
      </motion.button>
    );
  }

  if (interactive) {
    return (
      <motion.div
        className={classes}
        style={mergedStyle}
        onClick={onClick as HTMLMotionProps<"div">["onClick"]}
        {...interactiveMotion}
        {...(rest as object)}
      >
        {content}
      </motion.div>
    );
  }

  return (
    <div className={classes} style={mergedStyle} onClick={onClick} {...rest}>
      {content}
    </div>
  );
}

/**
 * Morphing glass group — mirrors ExpoLiquidGlassContainer / GlassEffectContainer.
 * Nearby glass children share a dock rail so they visually "merge" like iOS morph.
 */
export function LiquidGlassContainer({
  morph = 12,
  horizontal = true,
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
      style={
        {
          "--lg-spacing": `${morph}px`,
          gap: `${morph}px`,
          ...style,
        } as LiquidGlassVars
      }
    >
      <div className="liquid-glass-container__morph" aria-hidden="true" />
      {children}
    </div>
  );
}

/** Convenience: circular interactive glass orb (ComplexVideo control buttons). */
export function LiquidGlassOrb({
  size = 50,
  active = false,
  children,
  className,
  ...rest
}: Omit<LiquidGlassViewProps, "cornerRadius" | "cornerStyle" | "type" | "as"> & {
  size?: number;
  active?: boolean;
}) {
  return (
    <LiquidGlassView
      as="button"
      type={LiquidGlassType.Clear}
      cornerStyle={CornerStyle.Circular}
      cornerRadius={size}
      isInteractive
      className={joinClassNames("liquid-glass-orb", active && "liquid-glass-orb--active", className)}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      {...rest}
    >
      {children}
    </LiquidGlassView>
  );
}
