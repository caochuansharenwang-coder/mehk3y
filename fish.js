'use strict';
(()=>{
const TAU=Math.PI*2;
const canvas=document.getElementById('gl');
const hint=document.getElementById('hint');
const fallback=document.getElementById('fallback');
const fallbackMessage=document.getElementById('fallback-message');
const fishStatus=document.getElementById('fish-status');
const motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion=motionQuery.matches;
let ambT=3,last=0,lastRendered=0,rafId=0,running=false;

function showFallback(message){
  if(fallbackMessage)fallbackMessage.textContent=message;
  if(fallback)fallback.hidden=false;
  canvas.hidden=true;
  hint.hidden=true;
}

let gl;
try{
  gl=canvas.getContext('webgl2',{antialias:false,alpha:false,powerPreference:'high-performance'});
}catch(_){gl=null;}
if(!gl){showFallback('当前浏览器或设备不支持 WebGL 2，无法运行互动鱼池。');return;}
if(!gl.getExtension('EXT_color_buffer_float')){
  showFallback('当前设备缺少鱼池水波模拟所需的图形扩展。');
  return;
}
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
canvas.addEventListener('webglcontextlost',e=>{
  e.preventDefault();
  stopLoop();
  showFallback('图形上下文已中断。请刷新页面以重新打开互动鱼池。');
},{once:true});

/* ---------------- shaders ---------------- */
const VERT=`#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){vUv=aPos*0.5+0.5;gl_Position=vec4(aPos,0.,1.);}`;

const SIM_FRAG=`#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec4 uDrops[8];
uniform int uCount;
in vec2 vUv; out vec4 o;
void main(){
  vec2 c=texture(uPrev,vUv).rg;
  float sum=
    texture(uPrev,vUv+vec2(uTexel.x,0.)).r+
    texture(uPrev,vUv-vec2(uTexel.x,0.)).r+
    texture(uPrev,vUv+vec2(0.,uTexel.y)).r+
    texture(uPrev,vUv-vec2(0.,uTexel.y)).r;
  float nh=(sum*0.5-c.g)*0.992;
  vec2 px=vUv/uTexel;
  for(int i=0;i<8;i++){
    if(i>=uCount)break;
    vec4 d=uDrops[i];
    float dist=distance(px,d.xy);
    if(dist<d.z) nh+=d.w*(cos(dist/d.z*3.14159)*0.5+0.5);
  }
  vec2 e=min(vUv,1.0-vUv);
  float edge=smoothstep(0.0,0.05,min(e.x,e.y));
  nh*=mix(0.86,1.0,edge);
  o=vec4(nh,c.r,0.,1.);
}`;

const RENDER_FRAG=`#version 300 es
precision highp float;
uniform sampler2D uH;
uniform sampler2D uBottom;
uniform sampler2D uFish;
uniform vec2 uTexel;
uniform float uT;
in vec2 vUv; out vec4 o;
void main(){
  vec2 d=uTexel*1.5;
  float h =texture(uH,vUv).r;
  float hL=texture(uH,vUv-vec2(d.x,0.)).r;
  float hR=texture(uH,vUv+vec2(d.x,0.)).r;
  float hB=texture(uH,vUv-vec2(0.,d.y)).r;
  float hT=texture(uH,vUv+vec2(0.,d.y)).r;
  vec3 n=normalize(vec3((hL-hR)*6.0,(hB-hT)*6.0,1.0));
  n.xy+=0.0026*vec2(
    sin(vUv.x*130.0+uT*1.2)+sin(vUv.y*88.0-uT*0.7),
    cos(vUv.x*76.0-uT*0.9)+cos(vUv.y*140.0+uT*1.4));
  n=normalize(n);
  vec2 off=n.xy*0.042;
  vec3 bottom=texture(uBottom,vUv+off).rgb;
  float lap=(hL+hR+hB+hT-4.0*h);
  float caust=min(max(-lap,0.0)*90.0,0.7);
  bottom+=vec3(1.0,0.96,0.80)*caust*0.55;
  bottom*=1.0-min(max(lap,0.0)*70.0,0.30);
  float sh=texture(uFish,vUv+off+vec2(0.013,-0.018)).a;
  bottom*=1.0-sh*0.32;
  vec3 water=vec3(0.10,0.30,0.32);
  vec3 col=mix(bottom,water,0.27);
  vec4 fish=texture(uFish,vUv+off*0.45);
  vec3 fcol=mix(fish.rgb,water,0.10);
  col=mix(col,fcol,fish.a);
  vec3 L=normalize(vec3(-0.35,0.45,0.82));
  float spec=pow(max(dot(reflect(vec3(0.,0.,-1.),n),L),0.0),140.0);
  col+=vec3(1.0,0.98,0.90)*spec*0.95;
  col+=vec3(0.35,0.45,0.50)*pow(max(dot(n,normalize(vec3(0.2,-0.3,0.9))),0.0),3.0)*0.06;
  float vg=smoothstep(0.95,0.35,length(vUv-0.5));
  col*=mix(0.60,1.0,vg);
  o=vec4(col,1.0);
}`;

function compile(type,src){
  const s=gl.createShader(type);
  gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs,fs){
  const p=gl.createProgram();
  gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));
  gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  return p;
}
let simProg,renProg;
try{
  simProg=program(VERT,SIM_FRAG);
  renProg=program(VERT,RENDER_FRAG);
}catch(_){
  showFallback('图形程序初始化失败，请刷新页面或更换浏览器后重试。');
  return;
}
const su={
  prev:gl.getUniformLocation(simProg,'uPrev'),
  texel:gl.getUniformLocation(simProg,'uTexel'),
  drops:gl.getUniformLocation(simProg,'uDrops[0]'),
  count:gl.getUniformLocation(simProg,'uCount')};
const ru={
  h:gl.getUniformLocation(renProg,'uH'),
  bottom:gl.getUniformLocation(renProg,'uBottom'),
  fish:gl.getUniformLocation(renProg,'uFish'),
  texel:gl.getUniformLocation(renProg,'uTexel'),
  t:gl.getUniformLocation(renProg,'uT')};

const quad=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,quad);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);

/* ---------------- textures / targets ---------------- */
let cssW=0,cssH=0,dpr=1,fishScale=1;
let simW=0,simH=0,texA=null,texB=null,fboA=null,fboB=null;
const bCan=document.createElement('canvas'),bctx=bCan.getContext('2d');
const fCan=document.createElement('canvas'),fctx=fCan.getContext('2d');
if(!bctx||!fctx){showFallback('当前设备无法创建鱼池所需的绘图画布。');return;}
const bottomTex=gl.createTexture(),fishTex=gl.createTexture();
let fishTexW=0,fishTexH=0,bottomTexW=0,bottomTexH=0;

function texParams(){
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
}
function makeTarget(w,h){
  const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);
  texParams();
  const f=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
    gl.deleteTexture(t);gl.deleteFramebuffer(f);
    throw new Error('Framebuffer incomplete');
  }
  gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  return [t,f];
}
function createSim(){
  if(texA){gl.deleteTexture(texA);gl.deleteTexture(texB);gl.deleteFramebuffer(fboA);gl.deleteFramebuffer(fboB);}
  const simLimit=reducedMotion?448:640;
  const scale=Math.min(reducedMotion?0.32:0.45,simLimit/Math.max(cssW,cssH));
  simW=Math.max(64,Math.round(cssW*scale));
  simH=Math.max(64,Math.round(cssH*scale));
  [texA,fboA]=makeTarget(simW,simH);
  [texB,fboB]=makeTarget(simW,simH);
}
function uploadBottom(){
  gl.bindTexture(gl.TEXTURE_2D,bottomTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bCan);
  texParams();
  bottomTexW=bCan.width;bottomTexH=bCan.height;
}
function uploadFish(){
  gl.bindTexture(gl.TEXTURE_2D,fishTex);
  if(fishTexW!==fCan.width||fishTexH!==fCan.height){
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,fCan);
    texParams();
    fishTexW=fCan.width;fishTexH=fCan.height;
  }else{
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,fCan);
  }
}

/* ---------------- pond bottom ---------------- */
function paintBottom(){
  const c=bctx,w=cssW,h=cssH;
  c.setTransform(fishScale,0,0,fishScale,0,0);
  const g=c.createRadialGradient(w*0.5,h*0.42,0,w*0.5,h*0.5,Math.max(w,h)*0.75);
  g.addColorStop(0,'#7e6f4e');g.addColorStop(0.55,'#5c5a40');g.addColorStop(1,'#323a2c');
  c.fillStyle=g;c.fillRect(0,0,w,h);
  for(let i=0;i<9;i++){
    const x=Math.random()*w,y=Math.random()*h,r=80+Math.random()*180;
    const ag=c.createRadialGradient(x,y,0,x,y,r);
    ag.addColorStop(0,'rgba(34,52,28,0.28)');ag.addColorStop(1,'rgba(34,52,28,0)');
    c.fillStyle=ag;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();
  }
  const grainCount=Math.min(reducedMotion?900:1800,Math.max(500,Math.round(w*h/850)));
  for(let i=0;i<grainCount;i++){
    const x=Math.random()*w,y=Math.random()*h,r=Math.random()*1.7+0.4;
    c.fillStyle=Math.random()<0.5
      ?'rgba(255,240,200,'+(Math.random()*0.09).toFixed(3)+')'
      :'rgba(18,24,14,'+(Math.random()*0.13).toFixed(3)+')';
    c.beginPath();c.arc(x,y,r,0,TAU);c.fill();
  }
  const np=Math.max(14,Math.round(w*h/55000));
  for(let i=0;i<np;i++){
    drawPebble(c,Math.random()*w,Math.random()*h,12+Math.random()*46,Math.random()*TAU);
  }
}
function drawPebble(c,x,y,r,rot){
  c.save();c.translate(x,y);c.rotate(rot);
  const ry=r*(0.62+Math.random()*0.3);
  c.fillStyle='rgba(0,0,0,0.30)';
  c.beginPath();c.ellipse(r*0.13,ry*0.2,r*1.02,ry*1.02,0,0,TAU);c.fill();
  const hue=28+Math.random()*32,sat=7+Math.random()*14,li=36+Math.random()*26;
  const g=c.createRadialGradient(-r*0.35,-ry*0.4,r*0.08,0,0,r*1.15);
  g.addColorStop(0,'hsl('+hue+','+sat+'%,'+(li+17)+'%)');
  g.addColorStop(0.7,'hsl('+hue+','+sat+'%,'+li+'%)');
  g.addColorStop(1,'hsl('+hue+','+(sat+5)+'%,'+(li-14)+'%)');
  c.fillStyle=g;
  c.beginPath();c.ellipse(0,0,r,ry,0,0,TAU);c.fill();
  c.restore();
}

/* ---------------- goldfish ---------------- */
function palette(type){
  if(type==='orange')return{core:'#ffb347',mid:'#ff7d17',edge:'#cf4708',fin:'rgba(255,138,38,',patches:[]};
  if(type==='red')return{core:'#ff7a45',mid:'#f04a12',edge:'#a82803',fin:'rgba(238,76,26,',patches:[]};
  if(type==='kohaku'){
    const p=[];const n=3+(Math.random()*2|0);
    for(let i=0;i<n;i++)p.push({s:0.10+Math.random()*0.62,o:(Math.random()-0.5)*1.2,r:0.13+Math.random()*0.13,col:'rgba(241,71,18,0.92)'});
    return{core:'#ffffff',mid:'#f4ecdd',edge:'#cdbfa8',fin:'rgba(255,234,214,',patches:p};
  }
  if(type==='calico'){
    const p=[];
    for(let i=0;i<3;i++)p.push({s:0.12+Math.random()*0.58,o:(Math.random()-0.5)*1.3,r:0.12+Math.random()*0.12,col:'rgba(249,109,30,0.9)'});
    for(let i=0;i<3;i++)p.push({s:0.10+Math.random()*0.68,o:(Math.random()-0.5)*1.4,r:0.05+Math.random()*0.07,col:'rgba(36,36,48,0.85)'});
    return{core:'#ffffff',mid:'#f1e9da',edge:'#c9bba2',fin:'rgba(255,240,224,',patches:p};
  }
  return{core:'#ffffff',mid:'#f6efe3',edge:'#d3c5ae',fin:'rgba(255,238,222,',
    patches:[{s:0.07,o:0,r:0.12,col:'rgba(234,40,18,0.95)'}]};
}
function makeFish(type,len){
  const pal=palette(type);
  return{
    x:120+Math.random()*Math.max(60,cssW-240),
    y:120+Math.random()*Math.max(60,cssH-240),
    a:Math.random()*TAU,len,
    phase:Math.random()*10,speed:28,spT:30,turn:0,
    changeT:Math.random()*3,wakeT:Math.random()*0.2,speedN:0.3,
    po:Math.random()*TAU,
    core:pal.core,mid:pal.mid,edge:pal.edge,fin:pal.fin,patches:pal.patches
  };
}
let fishes=[];
const foods=[];
const angDiff=(a,b)=>{let d=a-b;while(d>Math.PI)d-=TAU;while(d<-Math.PI)d+=TAU;return d;};

function updateFish(f,dt){
  f.changeT-=dt;
  if(f.changeT<=0){
    f.spT=18+Math.random()*40;
    if(Math.random()<0.16)f.spT=95+Math.random()*45;
    f.changeT=2+Math.random()*4;
  }
  f.turn+=(Math.random()-0.5)*3.2*dt;
  f.turn*=Math.exp(-dt*1.4);
  let target=null,fdist=1e9;
  for(const fd of foods){
    const d=Math.hypot(fd.x-f.x,fd.y-f.y);
    if(d<fdist){fdist=d;target=fd;}
  }
  let ta;
  if(target&&fdist<560){
    ta=Math.atan2(target.y-f.y,target.x-f.x);
    f.spT=Math.max(f.spT,fdist<90?55:95);
  }else{target=null;ta=f.a+f.turn;}
  const m=85;
  if(f.x<m||f.y<m||f.x>cssW-m||f.y>cssH-m)
    ta=Math.atan2(cssH*0.5-f.y,cssW*0.5-f.x);
  for(const g of fishes){
    if(g===f)continue;
    const dx=f.x-g.x,dy=f.y-g.y;
    if(dx*dx+dy*dy<5600){ta=Math.atan2(dy,dx);break;}
  }
  const da=angDiff(ta,f.a);
  const mt=(target?2.6:1.1)*dt;
  f.a+=Math.max(-mt,Math.min(mt,da));
  f.speed+=(f.spT-f.speed)*Math.min(1,dt*1.8);
  f.x+=Math.cos(f.a)*f.speed*dt;
  f.y+=Math.sin(f.a)*f.speed*dt;
  f.x=Math.max(24,Math.min(cssW-24,f.x));
  f.y=Math.max(24,Math.min(cssH-24,f.y));
  f.speedN=Math.min(1,f.speed/120);
  f.phase+=dt*(3.5+f.speed*0.075)*2.4;
  f.wakeT-=dt;
  if(f.wakeT<=0&&f.speed>30){
    addDrop(f.x+Math.cos(f.a)*f.len*0.42,f.y+Math.sin(f.a)*f.len*0.42,
      6+f.speedN*8,0.05+0.16*f.speedN);
    f.wakeT=0.10+Math.random()*0.08;
  }
  if(target&&fdist<16){
    foods.splice(foods.indexOf(target),1);
    addDrop(f.x,f.y,10,0.5);
    f.spT=14;f.changeT=1.2;
  }
}

function bodyOutline(pts,wfun){
  const top=[],bot=[];
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    const pa=pts[Math.max(0,i-1)],pb=pts[Math.min(pts.length-1,i+1)];
    let dx=pb.x-pa.x,dy=pb.y-pa.y;
    const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;
    const w=wfun(p.s);
    top.push({x:p.x-dy*w,y:p.y+dx*w});
    bot.push({x:p.x+dy*w,y:p.y-dx*w});
  }
  return{top,bot};
}
function tailLobe(c,len,spread,sw){
  const ty=spread+sw;
  c.beginPath();
  c.moveTo(0,0);
  c.bezierCurveTo(len*0.32,spread*0.06+sw*0.2,len*0.72,ty*0.6,len,ty);
  c.bezierCurveTo(len*0.78,ty*0.98,len*0.30,spread*0.55+sw*0.25,0,0);
  c.closePath();c.fill();
}
function finShape(c,x,y,ang,len,flip){
  c.save();c.translate(x,y);c.rotate(ang);
  if(flip)c.scale(1,-1);
  c.beginPath();c.moveTo(0,0);
  c.quadraticCurveTo(len*0.55,-len*0.10,len,len*0.22);
  c.quadraticCurveTo(len*0.45,len*0.34,0,0);
  c.closePath();c.fill();c.restore();
}
function drawFish(c,f){
  const L=f.len;
  c.save();
  c.translate(f.x,f.y);c.rotate(f.a);
  const segs=16,pts=[];
  const amp=L*(0.05+0.06*f.speedN);
  for(let i=0;i<=segs;i++){
    const s=i/segs;
    pts.push({x:L*0.48-s*L*0.96,y:Math.sin(f.phase-s*4.4)*amp*Math.pow(s,1.5),s});
  }
  const wmax=L*0.16;
  const wf=s=>wmax*Math.pow(Math.sin(Math.PI*Math.min(0.10+s*0.90,1)),0.85)*(1-0.58*s)+L*0.018;
  /* tail */
  const tp=pts[segs],tq=pts[segs-1];
  const tang=Math.atan2(tp.y-tq.y,tp.x-tq.x);
  c.save();c.translate(tp.x,tp.y);c.rotate(tang);
  const tl=L*0.66;
  const sw=Math.sin(f.phase-5.2)*tl*0.30;
  const tg=c.createRadialGradient(0,0,tl*0.06,0,0,tl);
  tg.addColorStop(0,f.fin+'0.85)');
  tg.addColorStop(0.55,f.fin+'0.5)');
  tg.addColorStop(1,f.fin+'0)');
  c.fillStyle=tg;
  tailLobe(c,tl,tl*0.52,sw);
  tailLobe(c,tl,-tl*0.52,sw*0.85);
  tailLobe(c,tl*0.72,tl*0.16,sw*0.7);
  tailLobe(c,tl*0.72,-tl*0.16,sw*0.6);
  c.restore();
  /* pectoral fins */
  const pp=pts[5],wp=wf(pts[5].s);
  const fl=Math.sin(f.phase*1.2+f.po)*0.22;
  c.fillStyle=f.fin+'0.55)';
  finShape(c,pp.x,pp.y+wp*0.85,2.3+fl,L*0.24,false);
  finShape(c,pp.x,pp.y-wp*0.85,-2.3-fl,L*0.24,true);
  /* body */
  const o=bodyOutline(pts,wf);
  const path=()=>{
    c.beginPath();
    c.moveTo(o.top[0].x,o.top[0].y);
    for(let i=1;i<o.top.length;i++)c.lineTo(o.top[i].x,o.top[i].y);
    for(let i=o.bot.length-1;i>=0;i--)c.lineTo(o.bot[i].x,o.bot[i].y);
    c.quadraticCurveTo(pts[0].x+L*0.16,pts[0].y,o.top[0].x,o.top[0].y);
    c.closePath();
  };
  const bg=c.createRadialGradient(L*0.12,0,L*0.05,L*0.05,0,L*0.62);
  bg.addColorStop(0,f.core);bg.addColorStop(0.55,f.mid);bg.addColorStop(1,f.edge);
  path();c.fillStyle=bg;c.fill();
  if(f.patches.length){
    c.save();path();c.clip();
    for(const p of f.patches){
      const i=Math.min(segs,Math.round(p.s*segs));
      const pt=pts[i],w=wf(p.s);
      c.beginPath();c.ellipse(pt.x,pt.y+p.o*w,p.r*L,p.r*L*0.75,0,0,TAU);
      c.fillStyle=p.col;c.fill();
    }
    c.restore();
  }
  c.save();path();c.clip();
  const hg=c.createRadialGradient(L*0.15,0,0,L*0.10,0,L*0.5);
  hg.addColorStop(0,'rgba(255,255,255,0.30)');hg.addColorStop(1,'rgba(255,255,255,0)');
  c.fillStyle=hg;
  c.beginPath();c.ellipse(L*0.10,0,L*0.45,wmax*0.55,0,0,TAU);c.fill();
  c.strokeStyle='rgba(60,20,0,0.18)';c.lineWidth=L*0.016;
  c.beginPath();c.moveTo(pts[3].x,pts[3].y);
  for(let i=4;i<=11;i++)c.lineTo(pts[i].x,pts[i].y);
  c.stroke();
  c.strokeStyle='rgba(0,0,0,0.10)';c.lineWidth=L*0.012;
  c.beginPath();c.arc(pts[2].x-L*0.02,pts[2].y,wf(pts[2].s)*0.85,-1.2,1.2);c.stroke();
  c.restore();
  path();c.strokeStyle='rgba(40,15,0,0.18)';c.lineWidth=1;c.stroke();
  /* eyes */
  const ep=pts[1],ew=wf(pts[1].s);
  c.fillStyle='#19120a';
  c.beginPath();c.arc(ep.x,ep.y+ew*0.72,L*0.026,0,TAU);c.fill();
  c.beginPath();c.arc(ep.x,ep.y-ew*0.72,L*0.026,0,TAU);c.fill();
  c.fillStyle='rgba(255,255,255,0.6)';
  c.beginPath();c.arc(ep.x-L*0.008,ep.y+ew*0.72-L*0.008,L*0.008,0,TAU);c.fill();
  c.beginPath();c.arc(ep.x-L*0.008,ep.y-ew*0.72-L*0.008,L*0.008,0,TAU);c.fill();
  c.restore();
}
function drawFishCanvas(t){
  fctx.setTransform(fishScale,0,0,fishScale,0,0);
  fctx.clearRect(0,0,cssW,cssH);
  for(const fd of foods){
    const bob=Math.sin(t*3+fd.ph)*1.3;
    fctx.fillStyle='rgba(238,220,170,0.92)';
    fctx.beginPath();fctx.arc(fd.x+bob,fd.y+Math.cos(t*2.4+fd.ph)*1.1,2.3,0,TAU);fctx.fill();
  }
  for(const f of fishes)drawFish(fctx,f);
}

/* ---------------- ripples ---------------- */
const drops=[];
function addDrop(x,y,r,s){
  drops.push({x,y,r,s});
  if(drops.length>24)drops.shift();
}
const dropArr=new Float32Array(32);
function simulate(steps=2){
  gl.useProgram(simProg);
  gl.viewport(0,0,simW,simH);
  gl.uniform2f(su.texel,1/simW,1/simH);
  for(let step=0;step<steps;step++){
    let n=0;
    if(step===0){
      n=Math.min(drops.length,8);
      for(let j=0;j<n;j++){
        const d=drops[j];
        dropArr[j*4]=d.x/cssW*simW;
        dropArr[j*4+1]=(1-d.y/cssH)*simH;
        dropArr[j*4+2]=Math.max(2,d.r*simW/cssW);
        dropArr[j*4+3]=d.s;
      }
      drops.splice(0,n);
    }
    gl.uniform4fv(su.drops,dropArr);
    gl.uniform1i(su.count,n);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fboB);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,texA);
    gl.uniform1i(su.prev,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    let tt=texA;texA=texB;texB=tt;
    tt=fboA;fboA=fboB;fboB=tt;
  }
}
function render(t){
  gl.useProgram(renProg);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texA);gl.uniform1i(ru.h,0);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,bottomTex);gl.uniform1i(ru.bottom,1);
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,fishTex);gl.uniform1i(ru.fish,2);
  gl.uniform2f(ru.texel,1/simW,1/simH);
  gl.uniform1f(ru.t,t);
  gl.drawArrays(gl.TRIANGLES,0,3);
}

/* ---------------- layout / input ---------------- */
function resize(){
  cssW=Math.max(1,window.innerWidth);cssH=Math.max(1,window.innerHeight);
  const requestedDpr=Math.min(window.devicePixelRatio||1,reducedMotion?1:1.75);
  const pixelBudget=reducedMotion?1000000:2200000;
  const requestedPixels=cssW*cssH*requestedDpr*requestedDpr;
  const budgetScale=Math.min(1,Math.sqrt(pixelBudget/Math.max(1,requestedPixels)));
  dpr=Math.max(0.6,requestedDpr*budgetScale);
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  fishScale=Math.min(dpr,reducedMotion?1:1.25);
  fCan.width=Math.round(cssW*fishScale);
  fCan.height=Math.round(cssH*fishScale);
  fishTexW=0;
  bCan.width=fCan.width;bCan.height=fCan.height;
  paintBottom();
  uploadBottom();
  createSim();
  for(const f of fishes){
    f.x=Math.max(40,Math.min(cssW-40,f.x));
    f.y=Math.max(40,Math.min(cssH-40,f.y));
  }
}
let resizeRaf=0;
function scheduleResize(){
  cancelAnimationFrame(resizeRaf);
  resizeRaf=requestAnimationFrame(()=>{
    try{resize();}
    catch(_){stopLoop();showFallback('设备无法创建鱼池所需的图形缓冲区。');}
  });
}
window.addEventListener('resize',scheduleResize,{passive:true});

function handleMotionPreference(e){
  reducedMotion=e.matches;
  scheduleResize();
}
if(motionQuery.addEventListener)motionQuery.addEventListener('change',handleMotionPreference);
else motionQuery.addListener(handleMotionPreference);

let feedCount=0;
function feedAt(x,y){
  x=Math.max(0,Math.min(cssW,x));
  y=Math.max(0,Math.min(cssH,y));
  addDrop(x,y,18,1.3);
  if(foods.length<25)
    foods.push({x:x+(Math.random()-0.5)*16,y:y+(Math.random()-0.5)*16,ph:Math.random()*TAU});
  hint.style.opacity=0;
  feedCount++;
  if(fishStatus)fishStatus.textContent=`已投喂 ${feedCount} 次，水面出现涟漪。`;
}

canvas.addEventListener('pointerdown',e=>{
  if(e.isPrimary===false)return;
  feedAt(e.clientX,e.clientY);
});
let lmx=-1,lmy=-1;
canvas.addEventListener('pointermove',e=>{
  if(reducedMotion||document.hidden)return;
  if(lmx<0){lmx=e.clientX;lmy=e.clientY;return;}
  const d=Math.hypot(e.clientX-lmx,e.clientY-lmy);
  if(d>26){
    addDrop(e.clientX,e.clientY,7,0.06);
    lmx=e.clientX;lmy=e.clientY;
  }
});
canvas.addEventListener('pointerleave',()=>{lmx=-1;lmy=-1;});
canvas.addEventListener('keydown',e=>{
  if((e.key!=='Enter'&&e.key!==' ')||e.repeat)return;
  e.preventDefault();
  feedAt(cssW*0.5,cssH*0.5);
});

/* ---------------- main loop ---------------- */
try{
  resize();
  fishes=[
    makeFish('orange',118),
    makeFish('kohaku',104),
    makeFish('calico',92),
    makeFish('red',128),
    makeFish('orange',72),
    makeFish('tancho',86)
  ];
  for(let i=0;i<3;i++)
    addDrop(Math.random()*cssW,Math.random()*cssH,14,0.6);
}catch(_){
  showFallback('设备无法创建鱼池所需的图形缓冲区。');
  return;
}
setTimeout(()=>{hint.style.opacity=0;},9000);

function frame(ts){
  if(!running)return;
  rafId=requestAnimationFrame(frame);
  if(reducedMotion&&ts-lastRendered<1000/12)return;
  lastRendered=ts;
  const t=ts/1000;
  const dt=Math.min(0.05,Math.max(0.001,t-last));
  last=t;
  const motionDt=reducedMotion?dt*0.15:dt;
  if(!reducedMotion)ambT-=dt;
  if(!reducedMotion&&ambT<=0){
    addDrop(Math.random()*cssW,Math.random()*cssH,8,0.32);
    ambT=3+Math.random()*5;
  }
  for(const f of fishes)updateFish(f,motionDt);
  drawFishCanvas(t);
  uploadFish();
  simulate(reducedMotion?1:2);
  render(t);
}
function startLoop(){
  if(running||document.hidden||canvas.hidden)return;
  running=true;
  last=performance.now()/1000;
  lastRendered=0;
  rafId=requestAnimationFrame(frame);
}
function stopLoop(){
  running=false;
  if(rafId)cancelAnimationFrame(rafId);
  rafId=0;
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)stopLoop();
  else startLoop();
});
startLoop();
})();
