"""齿形精度核验:仿真扫描齿廓 vs 解析渐开线齿廓。
对每个齿的右齿面,取若干半径层,比较仿真命中角与渐开线理论角。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = Path(r"D:\ccfb\runs\17347\workspace\gear-shaper.html").as_uri()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(1000)

    # 页面内:在右齿面渐开线角位置上,比较理论半径与 profR 命中半径
    res = pg.evaluate("""() => {
      const g = geom();
      const N = profR.length;
      const inv = t => Math.tan(t)-t;
      const beta = Math.PI/(2*S.z), al = S.alpha, pitch = 2*Math.PI/S.z;
      const rows = [];
      // 取 5 个齿、每齿 6 个半径层(节圆到齿顶之间的渐开线段)
      for (let tooth=0; tooth<5; tooth++){
        const c = tooth*pitch;
        for (const frac of [0.05,0.25,0.45,0.65,0.85,0.98]){
          const rho = g.r1 + frac*(g.ra1-g.r1);
          const t = Math.sqrt((rho/g.rb1)**2-1);
          const phiTheory = c + beta + inv(al) - inv(t);   // 右齿面理论角
          // 扫描:在理论角附近 ±1° 找材料边界(profR 为各射线外半径)
          let best=null;
          for (let d=-20; d<=20; d++){
            const idx = ((Math.round(phiTheory*N/(2*Math.PI))+d)%N+N)%N;
            const phi = idx*2*Math.PI/N;
            const r = profR[idx];
            // 齿面处:理论半径应落在材料内(ρ< profR),齿槽处 profR≈外圆
            if (best===null || Math.abs(r-rho)<Math.abs(best.r-rho)) best={phi,r,d};
          }
          rows.push({tooth, frac:+frac.toFixed(2), rho:+rho.toFixed(2),
                     simR:+best.r.toFixed(2), diff:+(best.r-rho).toFixed(2)});
        }
      }
      // 更直接的度量:对每条射线,若其外半径处于渐开线段(r1~ra1),
      // 它对应的半径与该角理论渐开线半径之差
      const errs=[];
      for (let i=0;i<N;i++){
        const phi=i*2*Math.PI/N;
        const r=profR[i];
        if (r>g.r1+0.3 && r<g.ra1-0.3){
          // 反算最近的齿号与右齿面理论角,求理论半径
          const tooth=Math.round(phi/pitch);
          const c=tooth*pitch;
          // 数值反解 t: beta+inv(al)-inv(t) = phi-c
          const target=c+beta+inv(al)-phi;
          let lo=0,hi=Math.sqrt((g.ra1/g.rb1)**2-1);
          for(let it=0;it<40;it++){const mid=(lo+hi)/2; if(inv(mid)>target)hi=mid;else lo=mid;}
          const t=(lo+hi)/2;
          const rTh=g.rb1*Math.sqrt(1+t*t);
          errs.push(Math.abs(r-rTh));
        }
      }
      errs.sort((a,b)=>a-b);
      return {
        nFlankRays: errs.length,
        medianErr: +errs[Math.floor(errs.length/2)].toFixed(3),
        p95Err: +errs[Math.floor(errs.length*0.95)].toFixed(3),
        maxErr: +errs[errs.length-1].toFixed(3),
        module: S.m,
      };
    }""")
    print(json.dumps(res, ensure_ascii=False, indent=1))
    assert not errs, errs
    # 渐开线段射线中位误差应远小于模数(扫描步长约 0.5~0.75px,换算 mm 约 0.1)
    assert res["nFlankRays"] > 200
    assert res["medianErr"] < 0.25, res
    assert res["p95Err"] < 0.6, res
    print("齿形渐开线精度核验通过")
    b.close()
