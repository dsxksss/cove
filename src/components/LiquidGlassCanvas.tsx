import { useEffect, useMemo, useRef } from "react";
import {
  computeGaussianKernelByRadius,
  loadTextureFromURL,
  MultiPassRenderer,
} from "../lib/liquidGlassStudioRenderer";
import vertexShader from "../shaders/liquid-glass/vertex.glsl?raw";
import fragmentBgShaderRaw from "../shaders/liquid-glass/fragment-bg.glsl?raw";
import fragmentBgVblurShader from "../shaders/liquid-glass/fragment-bg-vblur.glsl?raw";
import fragmentBgHblurShader from "../shaders/liquid-glass/fragment-bg-hblur.glsl?raw";
import fragmentMainShaderRaw from "../shaders/liquid-glass/fragment-main.glsl?raw";
import sdfShader from "../shaders/liquid-glass/lib/sdf.glsl?raw";
import mathShader from "../shaders/liquid-glass/lib/math.glsl?raw";
import colorShader from "../shaders/liquid-glass/lib/color.glsl?raw";

interface LiquidGlassCanvasProps {
  imageUrl: string;
  tint: string;
}

function resolveIncludes(source: string) {
  return source
    .replace("#include './lib/sdf.glsl'", sdfShader)
    .replace("#include './lib/math.glsl'", mathShader)
    .replace("#include './lib/color.glsl'", colorShader);
}

function parseColor(color: string): [number, number, number, number] {
  const rgba = color.match(/rgba?\(([^)]+)\)/i);
  if (!rgba) return [1, 1, 1, 0.08];

  const parts = rgba[1].split(",").map((part) => Number(part.trim()));
  const [r = 255, g = 255, b = 255, a = 0.18] = parts;
  return [r / 255, g / 255, b / 255, Math.max(0.08, Math.min(a, 0.32))];
}

const fragmentBgShader = resolveIncludes(fragmentBgShaderRaw);
const fragmentMainShader = resolveIncludes(fragmentMainShaderRaw);

export default function LiquidGlassCanvas({ imageUrl, tint }: LiquidGlassCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MultiPassRenderer | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const textureRatioRef = useRef(1);
  const textureReadyRef = useRef(false);
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const rafRef = useRef<number | null>(null);
  const tintVec = useMemo(() => parseColor(tint), [tint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let renderer: MultiPassRenderer;
    try {
      renderer = new MultiPassRenderer(canvas, [
        { name: "bgPass", shader: { vertex: vertexShader, fragment: fragmentBgShader } },
        {
          name: "vBlurPass",
          shader: { vertex: vertexShader, fragment: fragmentBgVblurShader },
          inputs: { u_prevPassTexture: "bgPass" },
        },
        {
          name: "hBlurPass",
          shader: { vertex: vertexShader, fragment: fragmentBgHblurShader },
          inputs: { u_prevPassTexture: "vBlurPass" },
        },
        {
          name: "mainPass",
          shader: { vertex: vertexShader, fragment: fragmentMainShader },
          inputs: { u_blurredBg: "hBlurPass", u_bg: "bgPass" },
          outputToScreen: true,
        },
      ]);
    } catch {
      return;
    }

    rendererRef.current = renderer;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        renderer.resize(width, height);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const blurRadius = 18;
    const blurWeights = computeGaussianKernelByRadius(blurRadius);

    const render = () => {
      if (disposed) return;

      const { width, height, dpr } = sizeRef.current;
      const physicalWidth = Math.max(1, Math.round(width * dpr));
      const physicalHeight = Math.max(1, Math.round(height * dpr));
      const center = [physicalWidth / 2, physicalHeight / 2];

      renderer.setUniforms({
        u_resolution: [physicalWidth, physicalHeight],
        u_dpr: dpr,
        u_blurWeights: blurWeights,
        u_blurRadius: blurRadius,
        u_mouse: center,
        u_mouseSpring: center,
        u_shapeWidth: Math.max(1, width),
        u_shapeHeight: Math.max(1, height),
        u_shapeRadius: 20,
        u_shapeRoundness: 2,
        u_mergeRate: 0.05,
        u_showShape1: 0,
        u_glareAngle: -Math.PI / 4,
      });

      renderer.render({
        bgPass: {
          u_bgType: 11,
          u_bgTexture: textureRef.current,
          u_bgTextureRatio: textureRatioRef.current,
          u_bgTextureReady: textureReadyRef.current ? 1 : 0,
          u_shadowExpand: 1,
          u_shadowFactor: 0,
          u_shadowPosition: [0, 0],
        },
        mainPass: {
          u_tint: tintVec,
          u_refThickness: 12,
          u_refFactor: 1.18,
          u_refDispersion: 3,
          u_refFresnelRange: 46,
          u_refFresnelHardness: 0.12,
          u_refFresnelFactor: 0.08,
          u_glareRange: 48,
          u_glareHardness: 0.12,
          u_glareConvergence: 0.35,
          u_glareOppositeFactor: 0.45,
          u_glareFactor: 0.28,
          u_blurEdge: 1,
          STEP: 9,
        },
      });

      rafRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      disposed = true;
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const gl = canvas.getContext("webgl2");
      if (textureRef.current) gl?.deleteTexture(textureRef.current);
      renderer.dispose();
      rendererRef.current = null;
      textureRef.current = null;
    };
  }, [tintVec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2");
    if (!gl) return;

    let cancelled = false;
    textureReadyRef.current = false;

    loadTextureFromURL(gl, imageUrl)
      .then(({ texture, ratio }) => {
        if (cancelled) {
          gl.deleteTexture(texture);
          return;
        }
        if (textureRef.current) gl.deleteTexture(textureRef.current);
        textureRef.current = texture;
        textureRatioRef.current = ratio;
        textureReadyRef.current = true;
      })
      .catch(() => {
        textureReadyRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return (
    <canvas
      ref={canvasRef}
      className="liquid-glass-studio-canvas absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
}
