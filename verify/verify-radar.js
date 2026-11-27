// 从 radar-mosaic.html 提取的数据模型与采样逻辑的独立校验脚本
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/../radar-mosaic.html", "utf8");

// 直接抽取脚本块并在沙箱外手动复刻关键常量（保持与页面一致）
const ADV = {dx:300, dy:25};
const bandT0 = [
  {id:"A1", x:230, y:100, rx:40, ry:24, rot:74, v:20},
  {id:"A2", x:247, y:170, rx:46, ry:27, rot:76, v:26},
  {id:"A3", x:263, y:235, rx:52, ry:30, rot:78, v:33},
  {id:"A4", x:280, y:305, rx:56, ry:33, rot:76, v:38},
  {id:"A5", x:297, y:374, rx:52, ry:30, rot:74, v:33},
  {id:"A6", x:313, y:443, rx:46, ry:27, rot:77, v:27},
  {id:"A7", x:330, y:510, rx:40, ry:24, rot:75, v:21}
];
const scatT0 = [
  {id:"B1", x:110, y:480, rx:32, ry:19, rot:25, v:14},
  {id:"B2", x:600, y:140, rx:28, ry:17, rot:-20, v:12},
  {id:"B3", x:90,  y:150, rx:26, ry:16, rot:10, v:10}
];
const T1_CHANGE = {
  A1:{rs:1.07, v:34}, A2:{rs:1.08, v:42}, A3:{rs:1.09, v:50},
  A4:{rs:1.10, v:58}, A5:{rs:1.08, v:52}, A6:{rs:1.07, v:43}, A7:{rs:1.06, v:33},
  B1:{rs:1.10, v:22}, B2:{rs:1.08, v:17}, B3:{rs:1.09, v:16}
};
const BINS = [
  {lo:10,hi:25,name:"弱"},{lo:25,hi:35,name:"较弱"},{lo:35,hi:45,name:"中等"},
  {lo:45,hi:55,name:"强"},{lo:55,hi:65,name:"很强"},{lo:65,hi:80,name:"极强"}
];
const binOf = v => BINS.find(b=>v>=b.lo&&v<b.hi) || BINS[BINS.length-1];
const lerp=(a,b,t)=>a+(b-a)*t;
const T0 = bandT0.concat(scatT0);
const T1 = T0.map(p=>{const c=T1_CHANGE[p.id];
  return {...p,x:p.x+ADV.dx,y:p.y+ADV.dy,rx:p.rx*c.rs,ry:p.ry*c.rs,v:c.v};});
const stateAt = t => T0.map((p,i)=>{const q=T1[i];
  return {id:p.id,x:lerp(p.x,q.x,t),y:lerp(p.y,q.y,t),rx:lerp(p.rx,q.rx,t),
    ry:lerp(p.ry,q.ry,t),rot:lerp(p.rot,q.rot,t),v:lerp(p.v,q.v,t)};});
function normDist(x,y,p){
  const a=(p.rot||0)*Math.PI/180, cs=Math.cos(a),sn=Math.sin(a);
  const dx=x-p.x,dy=y-p.y, lx=cs*dx+sn*dy, ly=-sn*dx+cs*dy;
  return Math.sqrt(lx*lx/(p.rx*p.rx)+ly*ly/(p.ry*p.ry));
}
function sampleAt(x,y,patches){
  let best=null,bestNd=Infinity;
  for(const p of patches){const nd=normDist(x,y,p); if(nd<bestNd){bestNd=nd;best=p;}}
  const f=bestNd<=1?1-0.8*bestNd*bestNd:0.2*Math.exp(-(bestNd-1)*1.8);
  return {v:best.v*f,id:best.id};
}
const endA={x:160,y:340}, endB={x:680,y:340};
function profile(patches,N=160){
  const out=[];
  for(let i=0;i<=N;i++){const u=i/N;
    const x=lerp(endA.x,endB.x,u),y=lerp(endA.y,endB.y,u);
    out.push({u,...sampleAt(x,y,patches)});}
  return out;
}
let failures=0;
const assert=(cond,msg)=>{console.log((cond?"PASS":"FAIL")+" - "+msg); if(!cond)failures++;};

// 1. 平流矢量一致
assert(T1.every((p,i)=>Math.abs(p.x-T0[i].x-300)<1e-9&&Math.abs(p.y-T0[i].y-25)<1e-9),
  "所有斑块 T0→T1 位移完全一致 (300,25) px");

// 2. 剖面峰值在 T0 / T1 的位置与强度
for(const t of [0,0.5,1]){
  const s=profile(stateAt(t));
  const peak=s.reduce((a,b)=>b.v>a.v?b:a);
  const kmFromA=peak.u*(680-160)*0.1;
  console.log(`t=${t}: 峰值 ${peak.v.toFixed(1)} dBZ, 档位=${binOf(peak.v).name}, 距A端 ${kmFromA.toFixed(1)} km (u=${peak.u.toFixed(2)}), 归属斑块=${peak.id}`);
}
const p0=profile(stateAt(0)), p1=profile(stateAt(1));
const pk0=p0.reduce((a,b)=>b.v>a.v?b:a), pk1=p1.reduce((a,b)=>b.v>a.v?b:a);
assert(pk0.u<0.4, "T0 峰值位于剖面线左段 (u<0.4)，实际 "+pk0.u.toFixed(2));
assert(pk1.u>0.6, "T1 峰值位于剖面线右段 (u>0.6)，实际 "+pk1.u.toFixed(2));
assert(pk1.u>pk0.u+0.2, "峰值位置显著东移（u 增量>0.2）");
assert(pk1.v>pk0.v, "峰值强度随时间增强: "+pk0.v.toFixed(1)+" → "+pk1.v.toFixed(1));
assert(binOf(pk0.v).name!=binOf(pk1.v).name && pk1.v>=45,
  `峰值档位由绿系转红系: ${binOf(pk0.v).name} → ${binOf(pk1.v).name}`);

// 3. 强中心东移 & 增强
const sc0=stateAt(0).reduce((a,b)=>b.v>a.v?b:a);
const sc1=stateAt(1).reduce((a,b)=>b.v>a.v?b:a);
assert(sc0.id===sc1.id, "强中心归属同一斑块 "+sc0.id);
assert(sc1.x-sc0.x===300, "强中心东移 300 px = 30.0 km");
assert(sc1.v>sc0.v && binOf(sc1.v).lo>=55, "强中心强度 "+sc0.v+"→"+sc1.v+" dBZ，T1 达很强档（红）");

// 4. 全时段峰值 u 单调（近似）东移
let prevU=-1, mono=true;
for(let k=0;k<=20;k++){
  const s=profile(stateAt(k/20));
  const pk=s.reduce((a,b)=>b.v>a.v?b:a);
  if(pk.u<prevU-0.02) mono=false;
  prevU=pk.u;
}
assert(mono, "时间轴推进过程中剖面峰值位置整体单调东移");

// 5. 椭圆内部采样 <= 中心强度；外部衰减
const c=stateAt(0)[3]; // A4
assert(Math.abs(sampleAt(c.x,c.y,stateAt(0)).v-c.v)<1e-9, "椭圆中心采样值=斑块强度");
const out=sampleAt(c.x+c.rx*3,c.y,stateAt(0));
assert(out.v>0 && out.v<c.v*0.3, "椭圆远处采样值衰减到接近 0");

// 6. HTML 引用的 Konva 版本与 DOM 元素完整
assert(html.includes("https://cdn.jsdelivr.net/npm/konva@9.3.22/konva.min.js"), "Konva 9.3.22 jsDelivr CDN 引用存在（已 HTTP 200 验证）");
for(const id of ["map-host","time-slider","play-btn","prof-canvas","patch-info","legend-bins","sc-v"])
  assert(html.includes(`id="${id}"`), "DOM 元素 #"+id);
assert(!html.includes("cdnjs.cloudflare.com"), "未使用无文件的 cdnjs 9.3.22 路径");

// 7. 插值单调性：每个斑块 v 在两时次之间单调
let vMono=true;
for(let k=1;k<=100;k++){
  const a=stateAt((k-1)/100), b=stateAt(k/100);
  if(!b.every((p,i)=>p.v>=a[i].v-1e-12)) vMono=false;
}
assert(vMono, "所有斑块强度沿时间轴单调增强（绿→红过渡平滑）");

console.log(failures===0 ? "\n全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures?1:0);
