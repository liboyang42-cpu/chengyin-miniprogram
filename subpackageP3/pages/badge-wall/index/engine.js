// 勋章墙 WebGL 引擎:单 canvas / 单 GL context / 三 pass(背景磁场点阵 + 徽章 uber-shader + GPU 粒子)。
// GLSL 与交互模型 1:1 平移自已定稿的 v5 原型(设计真源见 城瘾app/勋章墙_Shader数字装置_设计方案_20260712.md)。
// 微信适配要点:纹理走 ImageData 上传;RAF 用 canvas.requestAnimationFrame;
// 指针/触摸 y 必须翻转(shader vUv 屏幕向上,触摸坐标 y 向下)。

var GLYPHS = require('./glyphs.js');

var RAR_COL = [
  [0.19, 0.84, 0.29],   // 0 COMMON  绿
  [0.39, 0.82, 1.00],   // 1 RARE    青
  [1.00, 0.62, 0.04],   // 2 EPIC    橙
  [0.25, 0.55, 0.90],   // 3 LEGENDARY 蓝
  [1.00, 0.28, 0.23]    // 4 MYTHIC  红
];
var FLOAT_CNT = [0, 0, 220, 300, 380]; // 史诗/传说/神话常驻漂浮尘粒数

var VS_QUAD = [
  'attribute vec2 aP;',
  'uniform vec2 uRes,uC,uH; uniform float uS;',
  'varying vec2 vUv;',
  'void main(){ vUv=vec2(aP.x*0.5+0.5, 0.5-aP.y*0.5);',
  '  vec2 px=uC+aP*uH*uS; vec2 cl=px/uRes*2.0-1.0;',
  '  gl_Position=vec4(cl.x,-cl.y,0.0,1.0); }'
].join('\n');

var FS_BADGE = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uTex,uGly;',
  'uniform vec4 uA;',
  'uniform vec2 uRes,uPtr;',
  'uniform float uT,uMode,uSeed,uAppear,uP,uDim,uPx,uHov,uSnow,uColorful;',
  'uniform vec3 uTint;',
  'float h11(float n){ return fract(sin(n*127.1)*43758.5453); }',
  'float h12(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
  'float lum(vec2 uv){ uv=clamp(uv,0.0,1.0); return dot(texture2D(uTex,uA.xy+uv*uA.zw).rgb,vec3(0.299,0.587,0.114)); }',
  'vec3 srcC(vec2 uv){ uv=clamp(uv,0.0,1.0); return texture2D(uTex,uA.xy+uv*uA.zw).rgb; }',
  'vec3 duo(float l){ vec3 dk=uTint*0.18;',
  '  return mix(dk,mix(uTint,vec3(1.0),smoothstep(0.60,1.0,l)*0.62),l)*smoothstep(0.005,0.09,l); }',
  'float pd(vec2 uv){ return (uPtr.x>-5.0)?exp(-length(uv-uPtr)*3.2):0.0; }',
  'float burst(float t){ float cyc=floor(t*0.5+uSeed*13.0), ph=fract(t*0.5+uSeed*13.0);',
  '  return step(h11(cyc),0.18)*exp(-ph*12.0); }',
  'float ripple(vec2 uv){',
  '  if(uPtr.x<-5.0) return 0.0;',
  '  float d=length(uv-uPtr);',
  '  return 0.20*sin(d*24.0-uT*7.0)*exp(-d*4.0)*uHov;',
  '}',
  /* 点/半调共用:cell → 磁场位移 → 每粒微光晕 + R/B 径向色散 */
  'vec3 dotsCore(vec2 uv,float C,float colored,float rot){',
  '  mat2 R =mat2(cos(rot),-sin(rot),sin(rot),cos(rot));',
  '  mat2 Ri=mat2(cos(rot), sin(rot),-sin(rot),cos(rot));',
  '  vec2 ruv=R*(uv-0.5)+0.5;',
  '  vec2 cell=floor(ruv*C);',
  '  vec3 acc=vec3(0.0);',
  '  for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){',
  '    vec2 c=cell+vec2(float(i),float(j));',
  '    vec2 home=Ri*((c+0.5)/C-0.5)+0.5;',
  '    float inb=step(0.0,home.x)*step(home.x,1.0)*step(0.0,home.y)*step(home.y,1.0);',
  '    float l=pow(lum(home),0.85)*inb;',
  '    if(l<0.02) continue;',
  '    float prox=pd(home);',
  '    vec2 disp=vec2(0.0);',
  '    if(prox>0.003){ vec2 dp=home-uPtr; disp=normalize(dp+1e-5)*prox*0.055; }',
  '    vec2 pos=home+disp+vec2(sin(uT*1.1+c.y*1.7),cos(uT*0.9+c.x*1.3))*(0.10/C);',   /* 点阵微游动 */
  '    float br=0.5+0.5*sin(uT*1.4+c.x*0.37+c.y*0.23+uSeed*6.28);',
  '    float r=l*(0.34+0.20*br)+ripple(uv)*l+prox*0.10;',
  '    float d=length(uv-pos)*C;',
  '    float m=smoothstep(r,r-0.14,d);',
  '    vec2 rdir=normalize(pos-vec2(0.5)+1e-5)*(0.12/C);',
  '    float mR=smoothstep(r,r-0.14,length(uv-pos-rdir)*C);',
  '    float mB=smoothstep(r,r-0.14,length(uv-pos+rdir)*C);',
  '    float glo=exp(-d*d/max(r*1.5,0.04))*0.18;',
  '    vec3 sc=srcC(home);',
  '    vec3 tone=mix(duo(l), sc*(0.50+0.75*l), uColorful);',   /* 波点颜色=图案本色(参考片路径) */
  '    vec3 dcol=mix(vec3(0.88)*l, tone, colored);',
  '    vec3 gcol=mix(vec3(0.85)*l, mix(mix(uTint,vec3(1.0),0.40), sc*1.05, uColorful)*max(l,0.35), colored);',
  '    acc+=(vec3(dcol.r*mR,dcol.g*m,dcol.b*mB)+gcol*glo)*(0.55+0.45*br+prox*0.7);',
  '  }',
  '  return acc*(0.86+0.22*sin(uT*1.5+uv.y*4.0+uSeed*4.7));',   /* 光波掠过徽记 */
  '}',
  'vec3 fxDots(vec2 uv,float colored){',
  '  return dotsCore(uv,max(uPx/9.0,12.0),colored,0.0);',
  '}',
  'vec3 fxHalf(vec2 uv){',
  '  vec3 col=dotsCore(uv,max(uPx/8.0,13.0),1.0,0.26)*1.25;',
  '  float scan=0.88+0.12*sin(uv.y*uPx*2.4);',
  '  float sweep=exp(-pow((uv.y-fract(uT*0.14))*14.0,2.0))*0.45;',
  '  return col*scan+vec3(sweep)*pow(lum(uv),0.85);',
  '}',
  'vec3 fxAscii(vec2 uv,float colored){',
  '  float C=max(uPx/11.0,10.0);',
  '  vec2 cell=floor(uv*C), cuv=fract(uv*C);',
  '  float l=pow(lum((cell+0.5)/C),0.9);',
  '  float prox=pd((cell+0.5)/C);',
  '  float rr=h12(cell+floor(uT*7.0)+uSeed);',
  '  float jump=(rr>0.94-0.3*prox)?1.0:0.0;',
  '  float idx=floor(clamp(l*10.0+jump,0.0,10.0));',
  '  float g =texture2D(uGly,vec2((idx+cuv.x)/16.0,cuv.y)).r;',
  '  float gR=texture2D(uGly,vec2((idx+clamp(cuv.x-0.07,0.0,1.0))/16.0,cuv.y)).r;',
  '  float gB=texture2D(uGly,vec2((idx+clamp(cuv.x+0.07,0.0,1.0))/16.0,cuv.y)).r;',
  '  float scan=0.84+0.16*sin(uv.y*uPx*3.14159+uT*2.0);',
  '  float noise=h12(uv*vec2(191.0,173.0)+uT)*0.08;',
  '  vec3 base=mix(vec3(0.92), duo(max(l,0.15))*1.25, colored);',
  '  return vec3(base.r*gR,base.g*g,base.b*gB)*scan*(0.75+0.55*l)*(1.0+0.6*prox)+vec3(noise)*l*0.4;',
  '}',
  'vec2 grad(vec2 uv,float d){',
  '  return vec2(lum(uv+vec2(d,0.0))-lum(uv-vec2(d,0.0)),',
  '              lum(uv+vec2(0.0,d))-lum(uv-vec2(0.0,d)));',
  '}',
  'vec3 fxEdge(vec2 uv){',
  '  float d=1.6/uPx;',
  '  vec2 g=grad(uv,d); float m=length(g);',
  '  float prox=pd(uv);',
  '  float flow=0.55+0.45*sin(atan(g.y,g.x)*3.0+uT*(2.6+2.0*prox)+lum(uv)*9.0);',
  '  float line=smoothstep(0.10,0.42,m)*flow;',
  '  float glow=smoothstep(0.02,0.30,length(grad(uv,d*3.0)))*0.34;',
  '  float mr=length(grad(uv+vec2(d,0.0),d)), mb=length(grad(uv-vec2(d,0.0),d));',
  '  vec3 col=vec3(0.95,0.98,1.0)*line+uTint*glow;',
  '  col.r+=smoothstep(0.1,0.5,mr)*0.10; col.b+=smoothstep(0.1,0.5,mb)*0.10;',
  '  col+=uTint*lum(uv)*0.08;',
  '  for(int k=0;k<2;k++){',
  '    float fk=float(k), tt=uT*0.30+fk*7.31+uSeed*3.0;',
  '    vec2 p1=vec2(h11(floor(tt)+fk*13.0),h11(floor(tt)+fk*13.0+40.0));',
  '    vec2 p2=vec2(h11(floor(tt)+1.0+fk*13.0),h11(floor(tt)+1.0+fk*13.0+40.0));',
  '    vec2 sp=mix(p1,p2,smoothstep(0.0,1.0,fract(tt)));',
  '    float em=smoothstep(0.08,0.4,length(grad(sp,d*2.0)));',
  '    col+=uTint*em*exp(-dot(uv-sp,uv-sp)*800.0)*0.9;',
  '  }',
  '  return col*(1.0+0.35*prox);',
  '}',
  'vec3 fxDissolve(vec2 uv,float p){',
  '  float n=h12(floor(uv*28.0)+uSeed);',
  '  if(p<0.25){ return vec3(h12(uv*173.0+uT))*0.35*step(n,p*4.0); }',
  '  if(p<0.55){ float q=(p-0.25)/0.30; float B=mix(6.0,22.0,q);',
  '    float l=pow(lum((floor(uv*B)+0.5)/B),0.9); return vec3(0.85)*l*step(n,q+0.35); }',
  '  if(p<0.8){ return fxDots(uv,0.0)*smoothstep(0.55,0.8,p); }',
  '  float q=(p-0.8)/0.2; return mix(fxDots(uv,1.0),duo(lum(uv)),q);',
  '}',
  'vec3 fxScan(vec2 uv){',
  '  float sx=fract(uT*0.22);',
  '  float band=exp(-pow((uv.x-sx)*16.0,2.0));',
  '  float l=pow(lum(uv),0.9);',
  '  vec3 col=duo(l)*(0.16+0.9*smoothstep(0.0,0.02,band)*band);',
  '  col+=vec3(0.9,0.95,1.0)*band*band*l*1.4;',
  '  col+=vec3(0.9)*exp(-pow((uv.x-sx)*90.0,2.0))*0.5;',
  '  return col+duo(l)*smoothstep(sx,sx-0.4,uv.x)*0.55;',
  '}',
  'vec3 fxGrid(vec2 uv){',
  '  float C=max(uPx/9.0,12.0);',
  '  vec2 cell=floor(uv*C);',
  '  vec2 home=(cell+0.5)/C;',
  '  float prox=pd(home);',
  '  vec2 off=vec2(0.0);',
  '  if(prox>0.003){ vec2 dp=home-uPtr; off=normalize(dp+1e-5)*prox*0.05; }',
  '  vec2 pos=home+off+vec2(sin(uT*0.8+cell.y),cos(uT*0.7+cell.x))*0.002;',
  '  float l=pow(lum(home),0.9);',
  '  float d=length(uv-pos)*C;',
  '  float dot_=smoothstep(0.42,0.12,d);',
  '  return (duo(l)*(0.35+0.65*l)+vec3(0.9)*prox*0.55)*dot_*(0.45+0.55*l+prox);',
  '}',
  'vec3 fxRGB(vec2 uv){',
  '  float d=1.6/uPx;',
  '  float m=length(grad(uv,d));',
  '  float l=pow(lum(uv),0.9);',
  '  vec3 col=duo(l)*0.85;',
  '  float gj=h11(floor(uT*2.0));',
  '  vec2 sh=vec2(d*(1.6+1.6*step(0.93,gj)),0.0);',
  '  col.r+=smoothstep(0.08,0.45,length(grad(uv+sh,d)))*0.42;',
  '  col.b+=smoothstep(0.08,0.45,length(grad(uv-sh,d)))*0.42;',
  '  col.g+=smoothstep(0.08,0.45,m)*0.36;',
  '  float flick=0.97+0.03*sin(uT*11.0+uSeed*40.0);',
  '  return col*flick;',
  '}',
  'vec3 fxColor(vec2 uv){',
  '  float l=pow(lum(uv),0.9);',
  '  float soft=lum(uv+vec2(0.0,1.5/uPx))+lum(uv-vec2(1.5/uPx,0.0));',
  '  vec3 base=mix(duo(l), srcC(uv)*(0.55+0.65*l), uColorful);',
  '  return base+uTint*soft*0.12;',
  '}',
  'vec3 fxUnlock(vec2 uv,float t){',
  '  float l=lum(uv);',
  '  if(t<0.35){',
  '    float sx=t/0.35;',
  '    float band=exp(-pow((uv.x-sx)*40.0,2.0));',
  '    return vec3(0.9,0.95,1.0)*band*(0.3+l)+vec3(0.03)*l;',
  '  }',
  '  if(t<0.75) return fxAscii(uv,0.0)*smoothstep(0.35,0.45,t);',
  '  if(t<1.15) return fxDots(uv,0.35);',
  '  if(t<1.60) return fxDots(uv,0.6)*(1.0-(t-1.15)/0.45*0.85);',
  '  float q=(t-1.60)/0.40;',
  '  float bloom=exp(-pow((q-0.35)*3.2,2.0))*1.1;',
  '  return fxColor(uv)*smoothstep(0.0,0.5,q)+(uTint+vec3(0.5))*bloom*l;',
  '}',
  'void main(){',
  '  vec2 uv=vUv;',
  '  vec3 col;',
  '  float m=uMode;',
  '  if(m<0.5)      col=fxAscii(uv,0.0);',
  '  else if(m<1.5) col=fxHalf(uv);',
  '  else if(m<2.5) col=fxEdge(uv);',
  '  else if(m<3.5) col=fxDissolve(uv,0.5+0.5*sin(uT*0.7));',
  '  else if(m<4.5) col=fxDots(uv,1.0)*0.4;',
  '  else if(m<5.5) col=fxScan(uv);',
  '  else if(m<6.5) col=fxGrid(uv);',
  '  else if(m<7.5) col=fxRGB(uv);',
  '  else if(m<10.5) col=fxDots(uv,0.85);',
  '  else if(m<11.5) col=fxHalf(uv);',
  '  else if(m<12.5) col=fxEdge(uv);',
  '  else if(m<13.5) col=fxAscii(uv,1.0)+fxRGB(uv)*0.35;',
  '  else if(m<14.5){',
  '    float ph=mod(uT*0.35+uSeed*8.0,8.0);',
  '    vec3 a1=fxDots(uv,1.0), a2=fxAscii(uv,1.0), a3=fxColor(uv);',
  '    if(ph<2.0)      col=a1*smoothstep(0.0,0.6,ph);',
  '    else if(ph<3.0) col=mix(a1,a2,smoothstep(2.0,3.0,ph));',
  '    else if(ph<5.0) col=a2;',
  '    else if(ph<6.0) col=mix(a2,a3,smoothstep(5.0,6.0,ph));',
  '    else if(ph<7.5) col=a3;',
  '    else            col=mix(a3,a1,smoothstep(7.5,8.0,ph));',
  '  }',
  '  else if(m<20.5){',
  '    float l=lum(uv);',
  '    float grain=h12(uv*211.0+floor(uT*3.0))*0.05;',
  '    vec2 b=abs(uv-0.5);',
  '    float ring=smoothstep(0.500,0.492,max(b.x,b.y))-smoothstep(0.492,0.484,max(b.x,b.y));',
  '    col=fxDots(uv,0.0)*0.62+vec3(grain)*l+vec3(ring)*0.30;',   /* 锁定=呼吸点阵幽灵,暗但【看得见】 */
  /* 2026-07-16:0.42→0.62、边框 0.10→0.30。原值下 11 张里 7 张锁定卡几乎隐形,
     墙读起来是「空的」而不是「前面还有 7 段路」,直接废掉 PRD §8.3(锁定态展示可理解的下一步)——
     下一步藏在一个看不见的点后面。提亮的同时把本就存在的方框边推到可读:
     灰点(无彩)+ 银框 = 不靠颜色也能判「锁着」,满足 DS「状态三通道,不只靠色」。
     仍明显暗于点亮态,冷感不变。 */
  '    col+=vec3(0.50,0.55,0.62)*exp(-pow((uv.y-fract(uT*0.16+uSeed))*7.0,2.0))*l*0.65;',  /* 慢扫描带 */
  '  }',
  '  else col=fxUnlock(uv,uP);',
  '  if(m>13.5&&m<14.5){',
  '    col*=vec3(1.06,0.74+0.18*sin(uT*0.7+uv.y*2.0),0.62+0.12*sin(uT*0.9));',
  '  }',
  '  if(m>10.5&&m<14.5){',
  '    float bs=burst(uT);',
  '    col=col*(1.0-bs*0.30)+vec3(h12(uv*vec2(197.0,181.0)+floor(uT*24.0)))*bs*((m<11.5)?0.45:0.52);',
  '  }',
  '  if(uSnow>0.001){',
  '    col=col*(1.0-uSnow*0.35)+vec3(h12(uv*vec2(203.0,157.0)+floor(uT*24.0)))*uSnow*0.6;',
  '  }',
  '  if(uAppear<0.999) col*=smoothstep(0.45,1.0,uAppear);',
  '  col*=uDim;',
  '  gl_FragColor=vec4(col,1.0);',
  '}'
].join('\n');

var FS_BG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform vec2 uRes,uPtrPx; uniform float uT,uAmp;',
  'float h12(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
  'void main(){',
  '  vec2 px=vUv*uRes;',
  '  float G=26.0;',
  '  vec2 cell=floor(px/G);',
  '  vec2 home=(cell+0.5)*G;',
  '  vec2 dp=home-uPtrPx; float dd=length(dp);',
  '  float prox=(uPtrPx.x>-500.0)?exp(-dd*0.011):0.0;',
  '  vec2 off=(prox>0.002)?normalize(dp+1e-4)*prox*16.0:vec2(0.0);',
  '  home+=off+vec2(sin(uT*0.4+cell.y*0.7),cos(uT*0.33+cell.x*0.6))*1.4*uAmp;',
  '  float d=length(px-home);',
  '  float rad=1.5+0.35*sin(uT*0.8+cell.x*0.7+cell.y*0.4)+prox*2.6;',
  '  float dot_=smoothstep(rad+0.9,rad-0.9,d);',
  '  float tw=0.68+0.32*sin(uT*1.2+cell.x*0.35+cell.y*0.52);',   /* 全场光泽流动 */
  '  float base=(0.10+0.08*h12(cell))*tw;',
  '  gl_FragColor=vec4(vec3(dot_*(base+prox*0.40)+prox*0.05),1.0);',
  '}'
].join('\n');

var VS_PTS = [
  'attribute vec2 aHome; attribute vec3 aRnd;',
  'uniform vec2 uRes,uC,uH; uniform float uPr,uT,uDpr,uSpread,uFloat;',
  'varying float vA;',
  'float eo(float x){ return 1.0-pow(1.0-x,3.0); }',
  'void main(){',
  '  vec2 uv; float size;',
  '  if(uFloat>0.5){',
  '    float ang=uT*(0.12+0.22*aRnd.z)+aRnd.x*6.2831;',
  '    uv=aHome+vec2(cos(ang),sin(ang))*(0.06+0.22*aRnd.y)',
  '       +(aRnd.xy-0.5)*0.10*sin(uT*0.8+aRnd.z*40.0);',
  '    size=1.1+aRnd.z*2.2;',
  '    vA=(0.24+0.34*aRnd.z)*(0.55+0.45*sin(uT*1.6+aRnd.z*80.0));',
  '  } else {',
  '    float e=eo(clamp(uPr,0.0,1.0));',
  '    vec2 scat=aHome+(aRnd.xy*2.0-1.0)*(1.0-e)*uSpread;',
  '    uv=mix(scat,aHome,e);',
  '    uv+=(aRnd.xy-0.5)*0.010*sin(uT*3.0+aRnd.z*40.0)*(1.0-e*0.8);',
  '    size=1.4+aRnd.z*2.4;',
  '    vA=(0.25+0.75*e)*(0.5+0.5*aRnd.z);',
  '  }',
  '  vec2 px=uC+(uv*2.0-1.0)*uH;',
  '  vec2 cl=px/uRes*2.0-1.0;',
  '  gl_Position=vec4(cl.x,-cl.y,0.0,1.0);',
  '  gl_PointSize=size*uDpr;',
  '}'
].join('\n');

var FS_PTS = [
  'precision highp float;',
  'uniform vec3 uTint; varying float vA;',
  'void main(){',
  '  vec2 pc=gl_PointCoord-0.5;',
  '  float aG=smoothstep(0.5,0.12,length(pc));',
  '  float aR=smoothstep(0.5,0.12,length(pc-vec2(0.08,0.0)));',
  '  float aB=smoothstep(0.5,0.12,length(pc+vec2(0.08,0.0)));',
  '  vec3 base=mix(uTint,vec3(1.0),0.25);',
  '  gl_FragColor=vec4(vec3(base.r*aR,base.g*aG,base.b*aB)*vA,aG*vA);',
  '}'
].join('\n');

var ATLAS = 1024, CELL = 256, GRID = 4;   // 图集 4×4 × 256px,P0 上限 16 枚(超出的取前 16)

function createEngine(opts) {
  var canvas = opts.canvas;
  // preserveDrawingBuffer:模拟器/截图链路读取 drawingBuffer 需要;整屏每帧全绘,无残留依赖
  var gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) return null;

  var W = opts.width, H = opts.height;
  var DPR = Math.min(opts.pixelRatio || 2, 2);
  var insets = { top: 100, bottom: 200 };
  var quality = 2;                        // 2=全效果 1=降档(DPR1+关漂浮粒子+弱化背景)
  var frameDts = [], degraded = false;

  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);

  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var inf = gl.getActiveUniform(p, i); u[inf.name] = gl.getUniformLocation(p, inf.name); }
    return { p: p, u: u };
  }

  var pBadge = prog(VS_QUAD, FS_BADGE);
  var pBg = prog(VS_QUAD, FS_BG);
  var pPts = prog(VS_PTS, FS_PTS);

  var quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enable(gl.BLEND);

  // ── 图集:离屏 2d canvas,白色亮度徽记;远程彩图灰度化后逐格替换 ──
  var off = opts.createOffscreen(ATLAS, ATLAS);
  // willReadFrequently:这块离屏画布下面要反复 getImageData(灰度化逐格替换),
  // 不声明的话每次读像素都会把 GPU 纹理回读到内存,微信控制台会持续告警。
  var octx = off.getContext('2d', { willReadFrequently: true });
  octx.fillStyle = '#000'; octx.fillRect(0, 0, ATLAS, ATLAS);
  var emblemT = gl.createTexture(), glyphT = gl.createTexture();
  var atlasDirty = true;

  function texParams() {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function uploadAtlas() {
    var img = octx.getImageData(0, 0, ATLAS, ATLAS);
    gl.bindTexture(gl.TEXTURE_2D, emblemT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS, ATLAS, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.data.buffer));
    texParams();
    atlasDirty = false;
  }

  // 字符图集:16 格 × 32px,亮度阶梯 " .:-~=+*#%@"
  (function buildGlyph() {
    var g = opts.createOffscreen(512, 32);
    // 同上:字形图集画完就要 getImageData 取出来传进 WebGL 纹理
    var x = g.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000'; x.fillRect(0, 0, 512, 32);
    x.fillStyle = '#fff'; x.font = '26px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    ' .:-~=+*#%@'.split('').forEach(function (ch, i) { x.fillText(ch, i * 32 + 16, 17); });
    var img = x.getImageData(0, 0, 512, 32);
    gl.bindTexture(gl.TEXTURE_2D, glyphT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 32, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.data.buffer));
    texParams();
  })();

  // 徽记(远程 glyph_url 图就位前/失败时):glyphs 模块按 PRD 主符号程序化绘制(彩色)
  var slotColorful = {};   // 彩色图集槽位:程序化徽记=1(波点采本色),灰度化远程图=0(走类别 duotone)
  function drawPlaceholder(slot, glyphKey) {
    var cx = (slot % GRID) * CELL + CELL / 2, cy = Math.floor(slot / GRID) * CELL + CELL / 2;
    octx.save(); octx.translate(cx, cy);
    octx.fillStyle = '#000'; octx.fillRect(-CELL / 2, -CELL / 2, CELL, CELL);
    octx.scale(1.4, 1.4);
    GLYPHS.draw(octx, glyphKey);
    octx.restore();
    slotColorful[slot] = 1;
  }

  // 远程彩图 → 亮度徽记:contain 铺进格子 → luma×alpha → 自动拉平(暗 logo 也能出形)
  function grayscaleSlot(slot) {
    var x0 = (slot % GRID) * CELL, y0 = Math.floor(slot / GRID) * CELL;
    var img = octx.getImageData(x0, y0, CELL, CELL), d = img.data;
    var max = 0, i, l;
    for (i = 0; i < d.length; i += 4) {
      l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * (d[i + 3] / 255);
      d[i] = l; if (l > max) max = l;
    }
    var scale = max > 30 ? 255 / max : 1;
    for (i = 0; i < d.length; i += 4) {
      l = Math.min(255, d[i] * scale);
      d[i] = d[i + 1] = d[i + 2] = l; d[i + 3] = 255;
    }
    octx.putImageData(img, x0, y0);
  }

  function loadEmblem(slot, url) {
    if (!url) return;
    var img = off.createImage();
    img.onload = function () {
      var x0 = (slot % GRID) * CELL, y0 = Math.floor(slot / GRID) * CELL;
      octx.fillStyle = '#000'; octx.fillRect(x0, y0, CELL, CELL);
      var s = Math.min((CELL - 48) / img.width, (CELL - 48) / img.height);
      var w = img.width * s, h = img.height * s;
      octx.drawImage(img, x0 + (CELL - w) / 2, y0 + (CELL - h) / 2, w, h);
      grayscaleSlot(slot);
      slotColorful[slot] = 0;
      delete ptCache[slot];
      atlasDirty = true;
      if (S && S.staticMode) renderStatic();
    };
    img.onerror = function () { /* 保留占位徽记 */ };
    img.src = url;
  }

  // ── 粒子:对亮像素拒绝采样,1500 点/枚,懒生成 ──
  var ptCache = {};
  function pointsFor(slot) {
    if (ptCache[slot]) return ptCache[slot];
    var N = 1500;
    var x0 = (slot % GRID) * CELL, y0 = Math.floor(slot / GRID) * CELL;
    var img = octx.getImageData(x0, y0, CELL, CELL).data;
    var home = new Float32Array(N * 2), rnd = new Float32Array(N * 3);
    var n = 0, guard = 0;
    while (n < N && guard < N * 60) {
      guard++;
      var u = Math.random(), v = Math.random();
      var px = (u * CELL) | 0, py = (v * CELL) | 0;
      var ii = (py * CELL + px) * 4;
      if (0.299 * img[ii] + 0.587 * img[ii + 1] + 0.114 * img[ii + 2] > 60) {   // 亮度采样(彩色徽记兼容)
        home[n * 2] = u; home[n * 2 + 1] = v;
        rnd[n * 3] = Math.random(); rnd[n * 3 + 1] = Math.random(); rnd[n * 3 + 2] = Math.random();
        n++;
      }
    }
    var hb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, hb); gl.bufferData(gl.ARRAY_BUFFER, home, gl.STATIC_DRAW);
    var rb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, rb); gl.bufferData(gl.ARRAY_BUFFER, rnd, gl.STATIC_DRAW);
    ptCache[slot] = { hb: hb, rb: rb, n: n };
    return ptCache[slot];
  }

  // ── 状态 ──
  var S = {
    badges: [], sel: -1, selT: 0, unlock: null,
    ptr: { x: -9999, y: -9999 }, hovIdx: -1,
    t0: Date.now(), running: false, staticMode: false, rafId: 0
  };

  function setBadges(list) {
    S.badges = list.slice(0, GRID * GRID).map(function (b, i) {
      return {
        name: b.name, rarity: Math.max(0, Math.min(4, b.rarity | 0)),
        locked: !!b.locked, slot: i,
        appear0: Date.now() + i * 110,
        cx: 0, cy: 0, half: 0
      };
    });
    ptCache = {};
    octx.fillStyle = '#000'; octx.fillRect(0, 0, ATLAS, ATLAS);
    list.slice(0, GRID * GRID).forEach(function (b, i) { drawPlaceholder(i, b.glyph); });
    atlasDirty = true;
    list.slice(0, GRID * GRID).forEach(function (b, i) { loadEmblem(i, b.iconUrl); });
    layout();
  }

  function setInsets(t, btm) { insets.top = t; insets.bottom = btm; layout(); }

  function layout() {
    var top = insets.top, bottom = H - insets.bottom;
    var availH = Math.max(bottom - top, 180), availW = Math.min(W - 24, 640);
    var n = S.badges.length || 1;
    var cols = n <= 12 ? 3 : 4, rows = Math.ceil(n / cols);   /* ≤12 枚走 3 列大格,主角级存在感 */
    var gap = 12;
    var cell = Math.min((availW - (cols - 1) * gap) / cols, (availH - (rows - 1) * gap) / rows, 134);
    cell = Math.max(cell, 40);
    var gw = cols * cell + (cols - 1) * gap, gh = rows * cell + (rows - 1) * gap;
    var ox = (W - gw) / 2 + cell / 2, oy = top + Math.max((availH - gh) / 2, 0) + cell / 2;
    S.badges.forEach(function (b, i) {
      var c = i % cols, r = (i / cols) | 0;
      b.cx = ox + c * (cell + gap); b.cy = oy + r * (cell + gap); b.half = cell / 2;
    });
  }

  function rarMode(r) { return 10 + r; }

  // 每枚徽章的全部 uniform;返回本帧几何/进度供粒子 pass 复用
  function badgeUniforms(b, i, t, now) {
    var u = pBadge.u;
    var mode, P = 0;
    if (S.unlock && S.unlock.idx === i) {
      P = (now - S.unlock.t0) / 1000;
      if (P >= 2.05) { b.locked = false; S.unlock = null; mode = rarMode(b.rarity); }
      else mode = 21;
    } else mode = b.locked ? 20 : rarMode(b.rarity);

    var appear = Math.min(Math.max((now - b.appear0) / 650, 0), 1);

    var cx = b.cx, cy = b.cy, half = b.half, dim = 1;
    if (S.sel >= 0) {
      var k = Math.min((now - S.selT) / 420, 1), e = 1 - Math.pow(1 - k, 3);
      if (S.sel === i) {
        var fx = W / 2, fy = Math.min(H * 0.30, H - 420), fh = Math.min(W * 0.28, 150);
        cx = b.cx + (fx - b.cx) * e; cy = b.cy + (fy - b.cy) * e; half = b.half + (fh - b.half) * e;
      } else dim = 1 - e;   /* 详情态:其余勋章完全隐去,主角独占点场 */
    }
    // 详情打开 = 开场:粒子聚合 + 雪花
    var da = 1, snow = 0;
    if (S.sel === i) {
      da = Math.min((now - S.selT) / 600, 1);
      snow = Math.max(0, 1 - (now - S.selT) / 450);
    }
    var scale = 0.72 + 0.28 * (1 - Math.pow(1 - appear, 3));

    gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uC, cx, cy); gl.uniform2f(u.uH, half, half);
    gl.uniform1f(u.uS, scale);
    gl.uniform4fv(u.uA, [(b.slot % GRID) / GRID, Math.floor(b.slot / GRID) / GRID, 1 / GRID, 1 / GRID]);
    gl.uniform1f(u.uT, t); gl.uniform1f(u.uMode, mode); gl.uniform1f(u.uSeed, i * 0.173);
    gl.uniform1f(u.uAppear, Math.min(appear, da)); gl.uniform1f(u.uP, P);
    gl.uniform1f(u.uSnow, snow);
    gl.uniform1f(u.uColorful, slotColorful[b.slot] ? 1 : 0);
    gl.uniform1f(u.uDim, dim); gl.uniform1f(u.uPx, half * 2);
    var tint = RAR_COL[b.rarity];
    gl.uniform3f(u.uTint, tint[0], tint[1], tint[2]);
    // 指针局部坐标每枚都传(磁场全屏贯通);y 翻转:vUv 屏幕向上 vs 触摸 y 向下
    var lx = -10, ly = -10;
    if (S.ptr.x > -999) {
      lx = (S.ptr.x - (cx - half)) / (half * 2);
      ly = ((cy + half) - S.ptr.y) / (half * 2);
    }
    gl.uniform2f(u.uPtr, lx, ly);
    gl.uniform1f(u.uHov, S.hovIdx === i ? 1 : 0);
    return { mode: mode, P: P, cx: cx, cy: cy, half: half, appear: appear, da: da };
  }

  var frameCount = 0, lastPixels = null;
  function render(now) {
    frameCount++;
    if (atlasDirty) uploadAtlas();
    var t = (now - S.t0) / 1000;
    gl.viewport(0, 0, canvas.width, canvas.height);
    // 2026-08-05 去相：原值 (0.0196, 0.0196, 0.0235) = #050506，饱和度 9%，超 §0.3 的
    // ≤5%。WebGL 的 clearColor 是**归一化浮点数**，连 hex 扫描都搜不到 —— 这是本轮
    // 挖到的最深一层盲区：wxss 改了、json 改了，画面主色仍是它，因为整屏是 canvas 画的。
    // 与 --cy-color-bg-page (#000000) 对齐；那个 token 变了要回来同步这一行。
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.blendFunc(gl.ONE, gl.ONE);

    // Pass1 背景磁场点阵
    gl.useProgram(pBg.p);
    var aP = gl.getAttribLocation(pBg.p, 'aP');
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(pBg.u.uRes, W, H); gl.uniform2f(pBg.u.uC, W / 2, H / 2); gl.uniform2f(pBg.u.uH, W / 2, H / 2);
    gl.uniform1f(pBg.u.uS, 1);
    gl.uniform1f(pBg.u.uT, t);
    gl.uniform2f(pBg.u.uPtrPx, S.ptr.x, H - S.ptr.y);   // y 翻转
    gl.uniform1f(pBg.u.uAmp, quality === 2 ? 1 : 0.5);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pass2 徽章
    gl.useProgram(pBadge.p);
    aP = gl.getAttribLocation(pBadge.p, 'aP');
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(pBadge.u.uTex, 0); gl.uniform1i(pBadge.u.uGly, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, emblemT);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glyphT);

    var now2 = Date.now();
    var ptsJobs = [];
    for (var i = 0; i < S.badges.length; i++) {
      var b = S.badges[i];
      var st = badgeUniforms(b, i, t, now2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      var hidden = S.sel >= 0 && S.sel !== i;   /* 详情态:非主角不发粒子 */
      if (!hidden && st.appear < 1) ptsJobs.push({ i: i, pr: st.appear, st: st, spread: 0.95 });   // 进墙开场
      if (S.sel === i && st.da < 1) ptsJobs.push({ i: i, pr: st.da, st: st, spread: 0.9 });        // 详情开场
      if (!hidden && st.mode === 21 && st.P > 1.1 && st.P < 1.72) ptsJobs.push({ i: i, pr: (st.P - 1.15) / 0.45, st: st, spread: 1.1 });
      if (!hidden && st.mode === 14) { var ph = (t * 0.35 + i * 0.173 * 8) % 8; if (ph < 2) ptsJobs.push({ i: i, pr: ph / 2, st: st, spread: 0.5 }); }
      if (!hidden && quality === 2 && st.mode >= 12 && st.mode <= 14) ptsJobs.push({ i: i, st: st, isFloat: 1, count: FLOAT_CNT[b.rarity] }); // 常驻漂浮尘粒
    }

    // Pass3 粒子
    if (ptsJobs.length) {
      gl.useProgram(pPts.p);
      for (var j = 0; j < ptsJobs.length; j++) {
        var job = ptsJobs[j], P_ = pointsFor(S.badges[job.i].slot), bb = S.badges[job.i];
        var aH = gl.getAttribLocation(pPts.p, 'aHome'), aR = gl.getAttribLocation(pPts.p, 'aRnd');
        gl.bindBuffer(gl.ARRAY_BUFFER, P_.hb); gl.enableVertexAttribArray(aH); gl.vertexAttribPointer(aH, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, P_.rb); gl.enableVertexAttribArray(aR); gl.vertexAttribPointer(aR, 3, gl.FLOAT, false, 0, 0);
        gl.uniform2f(pPts.u.uRes, W, H); gl.uniform2f(pPts.u.uC, job.st.cx, job.st.cy); gl.uniform2f(pPts.u.uH, job.st.half, job.st.half);
        gl.uniform1f(pPts.u.uPr, job.pr || 0); gl.uniform1f(pPts.u.uT, t); gl.uniform1f(pPts.u.uDpr, DPR);
        gl.uniform1f(pPts.u.uSpread, job.spread || 0);
        gl.uniform1f(pPts.u.uFloat, job.isFloat ? 1 : 0);
        var tc = RAR_COL[bb.rarity];
        gl.uniform3f(pPts.u.uTint, tc[0], tc[1], tc[2]);
        gl.drawArrays(gl.POINTS, 0, Math.min(job.count || P_.n, P_.n));
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    }

    // 自检:每 97 帧扫第 2 枚徽章中心 33×33 窗口的 max/avg 亮度(readPixels y 轴自下而上,需翻转)
    if (frameCount % 97 === 1 && S.badges.length > 1) {
      var b2 = S.badges[1], sz = 33;
      var gx = Math.max(0, Math.round(b2.cx * DPR) - 16);
      var gy = Math.max(0, Math.round(canvas.height - b2.cy * DPR) - 16);
      var buf = new Uint8Array(4 * sz * sz);
      gl.readPixels(gx, gy, sz, sz, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var mx = 0, sum = 0;
      for (var q = 0; q < buf.length; q += 4) { var v = Math.max(buf[q], buf[q + 1], buf[q + 2]); if (v > mx) mx = v; sum += v; }
      lastPixels = { max: mx, avg: Math.round(sum / (sz * sz)) };
    }
  }

  // 帧循环 + 性能降档:前 90 帧均耗 >25ms → DPR=1 + 关漂浮粒子 + 弱化背景
  var lastT = 0;
  function frame() {
    if (!S.running) return;
    var now = Date.now();
    if (lastT && !degraded) {
      frameDts.push(now - lastT);
      if (frameDts.length === 90) {
        var avg = frameDts.slice(10).reduce(function (a, b) { return a + b; }, 0) / 80;
        if (avg > 25) {
          quality = 1; DPR = 1;
          canvas.width = Math.floor(W); canvas.height = Math.floor(H);
        }
        degraded = true;
      }
    }
    lastT = now;
    try { render(now); } catch (e) { S.running = false; if (opts.onError) opts.onError(e); return; }
    S.rafId = canvas.requestAnimationFrame(frame);
  }

  // 减少动态效果：把入场/详情过渡直接推进到稳定终态，只画一帧且不续订 RAF。
  // 远程徽记稍后加载完成时，loadEmblem 会在 staticMode 下自动重画这一帧。
  function renderStatic() {
    var now = Date.now();
    S.running = false;
    S.staticMode = true;
    if (S.rafId) canvas.cancelAnimationFrame(S.rafId);
    S.rafId = 0;
    S.badges.forEach(function (badge) { badge.appear0 = now - 1000; });
    if (S.sel >= 0) S.selT = now - 1000;
    render(now);
  }

  function hit(x, y) {
    for (var i = 0; i < S.badges.length; i++) {
      var b = S.badges[i];
      if (Math.abs(x - b.cx) <= b.half && Math.abs(y - b.cy) <= b.half) return i;
    }
    return -1;
  }

  return {
    setBadges: setBadges,
    setInsets: setInsets,
    start: function () { if (S.running) return; S.staticMode = false; S.running = true; lastT = 0; S.rafId = canvas.requestAnimationFrame(frame); },
    stop: function () { S.running = false; if (S.rafId) canvas.cancelAnimationFrame(S.rafId); },
    renderStatic: function () { renderStatic(); },
    destroy: function () { this.stop(); ptCache = {}; },
    setPointer: function (x, y) { S.ptr = { x: x, y: y }; S.hovIdx = hit(x, y); },
    clearPointer: function () { S.ptr = { x: -9999, y: -9999 }; S.hovIdx = -1; },
    tap: function (x, y) { return hit(x, y); },
    openDetail: function (i) { S.sel = i; S.selT = Date.now(); },
    closeDetail: function () { S.sel = -1; },
    playUnlock: function (i) { if (!S.unlock) { S.badges[i].locked = true; S.unlock = { idx: i, t0: Date.now() }; } },
    replayEntrance: function () { S.badges.forEach(function (b, i) { b.appear0 = Date.now() + i * 110; }); },
    getState: function () {
      return { count: S.badges.length, quality: quality, sel: S.sel,
               W: W, H: H, cw: canvas.width, ch: canvas.height,
               running: S.running, frames: frameCount, dpr: DPR, px: lastPixels };
    },
    // 回读当前帧(降采样 RGB,y 已翻正)。自动化视觉审用;P1 分享图同源复用。
    // 依赖 preserveDrawingBuffer:true(已开)。
    captureFrame: function (scale) {
      scale = scale || 4;
      var cw = canvas.width, ch = canvas.height;
      var w = Math.floor(cw / scale), h = Math.floor(ch / scale);
      var buf = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var out = new Uint8Array(w * h * 3);
      for (var y = 0; y < h; y++) {
        var sy = ch - 1 - y * scale;
        for (var x = 0; x < w; x++) {
          var si = (sy * cw + x * scale) * 4, di = (y * w + x) * 3;
          out[di] = buf[si]; out[di + 1] = buf[si + 1]; out[di + 2] = buf[si + 2];
        }
      }
      return { w: w, h: h, rgb: out };
    }
  };
}

module.exports = { createEngine: createEngine, RAR_COL: RAR_COL };
