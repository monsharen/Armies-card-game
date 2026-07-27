/* Kartenburg — Balatro-style swirl background as a WebGL fragment shader,
 * rendered at ~1/7 resolution and upscaled with nearest-neighbor filtering
 * for a chunky pixel look. Falls back silently to the CSS .bg-swirl. */

(function () {
  function init() {
    const canvas = document.getElementById('swirlCanvas');
    if (!canvas) return;
    let gl = null;
    try { gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false }); } catch (e) { }
    if (!gl) return;

    const vsSrc = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
    const fsSrc =
      'precision mediump float;\n' +
      'uniform float t;\n' +
      'uniform vec2 r;\n' +
      'void main() {\n' +
      '  vec2 uv = (gl_FragCoord.xy - 0.5 * r) / min(r.x, r.y);\n' +
      '  float d = length(uv);\n' +
      '  float a = atan(uv.y, uv.x);\n' +
      '  float sw = a + 2.2 * d - 0.22 * t + 0.55 * sin(3.0 * d - 0.35 * t);\n' +
      '  float b1 = 0.5 + 0.5 * sin(6.0 * sw);\n' +
      '  float b2 = 0.5 + 0.5 * sin(3.0 * sw + 1.9);\n' +
      '  vec3 c = mix(vec3(0.40, 0.12, 0.18), vec3(0.12, 0.17, 0.38), b1);\n' +
      '  c = mix(c, vec3(0.10, 0.34, 0.28), 0.5 * b2);\n' +
      '  c *= 0.9 - 0.35 * d;\n' +
      '  gl_FragColor = vec4(c, 1.0);\n' +
      '}';

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tLoc = gl.getUniformLocation(prog, 't');
    const rLoc = gl.getUniformLocation(prog, 'r');

    function resize() {
      const scale = 7; // low-res render target, upscaled pixelated by CSS
      canvas.width = Math.max(96, Math.floor(window.innerWidth / scale));
      canvas.height = Math.max(64, Math.floor(window.innerHeight / scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    document.body.classList.add('gl-swirl');
    const start = performance.now();
    function frame(now) {
      if (!document.hidden) {
        gl.uniform1f(tLoc, (now - start) / 1000);
        gl.uniform2f(rLoc, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
