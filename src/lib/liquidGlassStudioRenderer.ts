type UniformValue = number | number[] | WebGLTexture | undefined | null;

interface ShaderSource {
  vertex: string;
  fragment: string;
}

interface UniformInfo {
  location: WebGLUniformLocation;
  type: number;
  isArray: boolean;
}

interface RenderPassConfig {
  name: string;
  shader: ShaderSource;
  inputs?: Record<string, string>;
  outputToScreen?: boolean;
}

export function computeGaussianKernelByRadius(radius: number) {
  const sigma = Math.max(radius / 3, 0.001);
  const kernel: number[] = [];
  let sum = 0;

  for (let i = 0; i <= radius; i += 1) {
    const weight = Math.exp(-0.5 * (i * i) / (sigma * sigma));
    kernel.push(weight);
    sum += i === 0 ? weight : weight * 2;
  }

  return kernel.map((weight) => weight / sum);
}

class ShaderProgram {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, UniformInfo>();
  private readonly attributes = new Map<string, number>();

  constructor(gl: WebGL2RenderingContext, source: ShaderSource) {
    this.gl = gl;
    this.program = this.createProgram(source);
    this.detectAttributes();
    this.detectUniforms();
  }

  use() {
    this.gl.useProgram(this.program);
  }

  setUniform(name: string, value: UniformValue) {
    if (value === undefined || value === null) return;

    const uniform = this.uniforms.get(name);
    if (!uniform) return;

    const gl = this.gl;
    const location = uniform.location;

    if (uniform.isArray && Array.isArray(value)) {
      if (uniform.type === gl.FLOAT) gl.uniform1fv(location, value);
      return;
    }

    switch (uniform.type) {
      case gl.FLOAT:
        gl.uniform1f(location, value as number);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(location, value as number[]);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(location, value as number[]);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(location, value as number[]);
        break;
      case gl.INT:
      case gl.SAMPLER_2D:
        gl.uniform1i(location, value as number);
        break;
      default:
        break;
    }
  }

  getAttributeLocation(name: string) {
    return this.attributes.get(name) ?? -1;
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.uniforms.clear();
    this.attributes.clear();
  }

  private createShader(type: number, source: string) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info ?? "unknown"}`);
    }

    return shader;
  }

  private createProgram(source: ShaderSource) {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");

    const vertexShader = this.createShader(gl.VERTEX_SHADER, source.vertex);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, source.fragment);

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info ?? "unknown"}`);
    }

    return program;
  }

  private detectAttributes() {
    const gl = this.gl;
    const count = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES) as number;

    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveAttrib(this.program, i);
      if (!info) continue;
      this.attributes.set(info.name, gl.getAttribLocation(this.program, info.name));
    }
  }

  private detectUniforms() {
    const gl = this.gl;
    const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;

    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(this.program, i);
      if (!info) continue;

      const name = info.name.replace(/\[\d+\]$/, "");
      const location = gl.getUniformLocation(this.program, name);
      if (!location) continue;

      this.uniforms.set(name, {
        location,
        type: info.type,
        isArray: /\[\d+\]$/.test(info.name),
      });
    }
  }
}

class FrameBuffer {
  private readonly gl: WebGL2RenderingContext;
  private readonly fbo: WebGLFramebuffer;
  private readonly texture: WebGLTexture;
  private readonly depthTexture: WebGLTexture;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;

    const fbo = gl.createFramebuffer();
    const texture = gl.createTexture();
    const depthTexture = gl.createTexture();
    if (!fbo || !texture || !depthTexture) throw new Error("Failed to create framebuffer");

    this.fbo = fbo;
    this.texture = texture;
    this.depthTexture = depthTexture;
    this.resize(width, height);
  }

  bind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
  }

  unbind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  getTexture() {
    return this.texture;
  }

  resize(width: number, height: number) {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      width,
      height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Framebuffer is incomplete");
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
    this.gl.deleteTexture(this.depthTexture);
  }
}

class RenderPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: ShaderProgram;
  private readonly frameBuffer: FrameBuffer | null;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;

  constructor(
    gl: WebGL2RenderingContext,
    readonly config: RenderPassConfig,
    width: number,
    height: number
  ) {
    this.gl = gl;
    this.program = new ShaderProgram(gl, config.shader);
    this.frameBuffer = config.outputToScreen ? null : new FrameBuffer(gl, width, height);

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error("Failed to create geometry");

    this.vao = vao;
    this.buffer = buffer;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const positionLoc = this.program.getAttributeLocation("a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
  }

  render(uniforms: Record<string, UniformValue>) {
    const gl = this.gl;

    if (this.frameBuffer) {
      this.frameBuffer.bind();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    this.program.use();

    let textureSlot = 0;
    Object.entries(uniforms).forEach(([name, value]) => {
      if (value instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + textureSlot);
        gl.bindTexture(gl.TEXTURE_2D, value);
        this.program.setUniform(name, textureSlot);
        textureSlot += 1;
      } else {
        this.program.setUniform(name, value);
      }
    });

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    if (this.frameBuffer) this.frameBuffer.unbind();
  }

  getOutputTexture() {
    return this.frameBuffer?.getTexture() ?? null;
  }

  resize(width: number, height: number) {
    this.frameBuffer?.resize(width, height);
  }

  dispose() {
    this.frameBuffer?.dispose();
    this.program.dispose();
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
  }
}

export class MultiPassRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly passes: RenderPass[];
  private readonly passByName = new Map<string, RenderPass>();
  private globalUniforms: Record<string, UniformValue> = {};

  constructor(canvas: HTMLCanvasElement, configs: RenderPassConfig[]) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("WebGL2 is not supported");
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("EXT_color_buffer_float is not supported");
    }

    this.gl = gl;
    this.passes = configs.map((config) => {
      const pass = new RenderPass(gl, config, canvas.width, canvas.height);
      this.passByName.set(config.name, pass);
      return pass;
    });
  }

  setUniforms(uniforms: Record<string, UniformValue>) {
    this.globalUniforms = { ...this.globalUniforms, ...uniforms };
  }

  resize(width: number, height: number) {
    this.gl.viewport(0, 0, width, height);
    this.passes.forEach((pass) => pass.resize(width, height));
  }

  render(passUniforms: Record<string, Record<string, UniformValue>>) {
    this.passes.forEach((pass) => {
      const uniforms = {
        ...this.globalUniforms,
        ...(passUniforms[pass.config.name] ?? {}),
      };

      if (pass.config.inputs) {
        Object.entries(pass.config.inputs).forEach(([uniformName, passName]) => {
          uniforms[uniformName] = this.passByName.get(passName)?.getOutputTexture();
        });
      }

      pass.render(uniforms);
    });
  }

  dispose() {
    this.passes.forEach((pass) => pass.dispose());
    this.passByName.clear();
    this.globalUniforms = {};
  }
}

export function loadTextureFromURL(
  gl: WebGL2RenderingContext,
  url: string
): Promise<{ texture: WebGLTexture; ratio: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      const texture = gl.createTexture();
      if (!texture) {
        reject(new Error("Failed to create texture"));
        return;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      resolve({ texture, ratio: image.naturalWidth / image.naturalHeight });
    };

    image.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
    image.src = url;
  });
}
