// 3D 徽章转台 · 手写 WebGL(方案B:通用 pin 几何 + 每枚一张贴图)。
//
// 为什么不用 xr-frame:它在开发者工具里拉引擎 WASM/draco 会 500(模拟器老毛病),
// 而勋章墙(subpackageP3/pages/badge-wall)已证明手写 WebGL 在模拟器与真机都稳。
// 三个微信适配姿势与勋章墙同源:getContext('webgl',{preserveDrawingBuffer:true}) /
// 纹理走 离屏2d→getImageData→texImage2D / RAF 用 canvas.requestAnimationFrame。
//
// 几何 = 一枚"硬币"3 段:侧面圆环(金属)+ 背面圆盘(金属)+ 正面圆盘(珐琅贴图,透明角 discard)。
const SEG = 96;        // 圆周段数(铣齿边要够密)
const R = 1.0;         // 半径
const D = 0.09;        // 半厚
const TEX = 512;       // 贴图边长

const VS = [
  'attribute vec3 aP; attribute vec3 aN; attribute vec2 aUV;',
  'uniform float uRot,uAspect;',
  'varying vec3 vN; varying vec2 vUV; varying vec3 vMP; varying vec3 vMN;',
  'void main(){',
  '  float c=cos(uRot),s=sin(uRot);',
  '  vec3 p=vec3(c*aP.x+s*aP.z, aP.y, -s*aP.x+c*aP.z);',
  '  vN=vec3(c*aN.x+s*aN.z, aN.y, -s*aN.x+c*aN.z);',
  '  vMP=aP; vMN=aN;',   // 模型空间:铣齿按角度、颗粒按位置,都不能跟着旋转走
  '  vUV=aUV;',
  '  vec3 e=p+vec3(0.0,0.0,-3.2);',                       // 相机在 +z 侧,物体推远
  '  gl_Position=vec4(e.x/uAspect, e.y, -e.z*0.5-1.0, -e.z);',  // 简易透视
  '}'
].join('\n');

const FS = [
  'precision mediump float;',
  'varying vec3 vN; varying vec2 vUV; varying vec3 vMP; varying vec3 vMN;',
  'uniform sampler2D uTex; uniform sampler2D uMat; uniform float uUseTex;',
  // 金属质感 = matcap + 两层微扰(参考视频的磨砂金属):
  //   grain = 位置哈希噪声抖动法线 → 表面颗粒粗糙;
  //   ridges = 侧面按角度做 120 齿正弦扰动 → 硬币铣齿边。
  'float h3(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }',
  'void main(){',
  '  vec3 N=normalize(vN);',
  '  float side=1.0-abs(vMN.z);',                       // 1=侧面(铣齿区),0=正背面
  '  float ang=atan(vMP.y,vMP.x);',
  '  float ridge=sin(ang*120.0);',
  '  float grain=h3(floor(vMP*140.0))-0.5;',
  '  N.xy += vec2(-sin(ang),cos(ang))*ridge*0.22*side;', // 铣齿:沿切线方向扰动法线
  '  N.xy += grain*0.10*(1.0-uUseTex*0.6);',             // 颗粒:金属重、珐琅轻
  '  N=normalize(N);',
  '  vec2 muv=vec2(N.x*0.5+0.5, 0.5-N.y*0.5);',
  '  vec3 m=texture2D(uMat,muv).rgb;',
  '  m*= 0.90+0.10*ridge*side;',                         // 齿谷微暗,齿脊微亮
  '  m*= 0.94+0.12*grain;',
  '  if(uUseTex>0.5){',
  '    vec4 t=texture2D(uTex,vUV);',
  '    if(t.a<0.05) discard;',
  // 珐琅面:本色为主,matcap 当釉面光泽(亮部叠加,暗部微压)
  '    float lum=dot(m,vec3(0.299,0.587,0.114));',
  '    vec3 c=t.rgb*(0.62+0.55*lum)+m*0.18;',
  '    gl_FragColor=vec4(c,1.0);',
  '  } else {',
  // 金属包边/背面:直接吃 matcap(它就是"被照亮的金子")
  '    gl_FragColor=vec4(m,1.0);',
  '  }',
  '}'
].join('\n');

function buildGeometry() {
  const pos = [], idxGold = [], idxFace = [];
  const push = (x, y, z, nx, ny, nz, u, v) => { pos.push(x, y, z, nx, ny, nz, u, v); return pos.length / 8 - 1; };
  // 侧面圆环(法线径向)
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
    push(x * R, y * R, D, x, y, 0, 0, 0);
    push(x * R, y * R, -D, x, y, 0, 0, 0);
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idxGold.push(a, b, c, b, d, c);
  }
  // 正面(+z,贴图)与背面(-z,金属)圆盘
  const buildCap = (z, nz, out, flipU) => {
    const center = push(0, 0, z, 0, 0, nz, 0.5, 0.5);
    const ring = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
      const u = 0.5 + (flipU ? -x : x) * 0.5, v = 0.5 - y * 0.5;
      ring.push(push(x * R, y * R, z, 0, 0, nz, u, v));
    }
    for (let i = 0; i < SEG; i++) {
      if (nz > 0) out.push(center, ring[i], ring[i + 1]);
      else out.push(center, ring[i + 1], ring[i]);
    }
  };
  buildCap(D, 1, idxFace, false);
  buildCap(-D, -1, idxGold, true);
  return { pos: new Float32Array(pos), gold: new Uint16Array(idxGold), face: new Uint16Array(idxFace) };
}

Component({
  properties: {
    src: { type: String, value: '/subpackageP3/assets/badge-demo.png' },
    reduced: { type: Boolean, value: false },
  },
  lifetimes: {
    attached() { this._initSoon(); },
    detached() {
      this._dead = true;
      if (this._cv && this._raf) this._cv.cancelAnimationFrame(this._raf);
    },
  },
  methods: {
    _initSoon() {
      const that = this;
      this.createSelectorQuery().select('#pincv').fields({ node: true, size: true }).exec((res) => {
        try {
          const info = res && res[0];
          if (!info || !info.node) { that.triggerEvent('unsupported'); return; }
          that._boot(info.node, info.width, info.height);
        } catch (e) { that.triggerEvent('unsupported'); }
      });
    },
    _boot(canvas, w, h) {
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      const gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (!gl) { this.triggerEvent('unsupported'); return; }
      this._cv = canvas;

      const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.triggerEvent('unsupported'); return; }
      gl.useProgram(prog);

      const g = buildGeometry();
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW);
      const STRIDE = 32;
      const bind = (name, size, off) => {
        const loc = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off);
      };
      bind('aP', 3, 0); bind('aN', 3, 12); bind('aUV', 2, 24);
      const iboGold = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboGold);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.gold, gl.STATIC_DRAW);
      const iboFace = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboFace);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.face, gl.STATIC_DRAW);

      const uRot = gl.getUniformLocation(prog, 'uRot');
      const uAspect = gl.getUniformLocation(prog, 'uAspect');
      const uUseTex = gl.getUniformLocation(prog, 'uUseTex');
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'uMat'), 1);
      gl.uniform1f(uAspect, canvas.width / canvas.height);

      // 珐琅贴图:勋章墙同款上传链(离屏 2d → getImageData → texImage2D)
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
      const off = wx.createOffscreenCanvas({ type: '2d', width: TEX, height: TEX });
      // willReadFrequently:matcap / 珐琅贴图都是画完立刻 getImageData → texImage2D
      const octx = off.getContext('2d', { willReadFrequently: true });
      const that = this;
      // matcap 贴图(单元 1):金属质感的全部来源
      const matTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, matTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([214, 172, 80, 255]));
      const mimg = off.createImage();
      mimg.onload = () => {
        if (that._dead) return;
        octx.clearRect(0, 0, TEX, TEX);
        octx.drawImage(mimg, 0, 0, TEX, TEX);
        const d = octx.getImageData(0, 0, TEX, TEX);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, matTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX, TEX, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(d.data.buffer));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
      };
      mimg.src = '/subpackageP3/assets/gold-matcap.png';
      const img = off.createImage();
      img.onload = () => {
        if (that._dead) return;
        octx.clearRect(0, 0, TEX, TEX);
        octx.drawImage(img, 0, 0, TEX, TEX);
        const data = octx.getImageData(0, 0, TEX, TEX);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX, TEX, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.data.buffer));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        that.triggerEvent('loaded');
      };
      img.onerror = () => {
        if (!that._dead) that.triggerEvent('unsupported', { reason: 'asset' });
      };
      img.src = this.data.src;

      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0.039, 0.039, 0.043, 1);

      this._rot = -0.5;
      this._dragging = false;
      let last = 0;
      const frame = (ts) => {
        if (that._dead) return;
        const dt = last ? Math.min(50, ts - last) : 16; last = ts;
        if (!that._dragging && !that.data.reduced) that._rot += (dt / 1000) * 0.9;  // ~14s/圈,对齐参考视频慢速
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniform1f(uRot, that._rot);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, matTex); gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(uUseTex, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboGold);
        gl.drawElements(gl.TRIANGLES, g.gold.length, gl.UNSIGNED_SHORT, 0);
        gl.uniform1f(uUseTex, 1);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboFace);
        gl.drawElements(gl.TRIANGLES, g.face.length, gl.UNSIGNED_SHORT, 0);
        that._raf = canvas.requestAnimationFrame(frame);
      };
      this._raf = canvas.requestAnimationFrame(frame);
      this.triggerEvent('xready');   // 页面 3s 超时判定的活信号(契约与 xr 版一致)
    },
    onTouchStart(e) { this._dragging = true; this._lx = e.touches[0].clientX; },
    onTouchMove(e) {
      if (!this._dragging) return;
      const x = e.touches[0].clientX;
      this._rot += (x - this._lx) * 0.012;
      this._lx = x;
    },
    onTouchEnd() { this._dragging = false; },
  },
});
