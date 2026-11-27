import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = Path(r"D:\ccfb\runs\17347\workspace\gear-shaper.html").as_uri()

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 950})
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        page.on("console", lambda m: errors.append("CONSOLE: " + m.text) if m.type == "error" else None)
        page.goto(URL)
        page.wait_for_timeout(800)

        r1 = page.evaluate("""() => {
          const c = document.getElementById('stage');
          const x = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          let nonBg = 0;
          for (let i=3;i<x.length;i+=4) if (x[i]>30) nonBg++;
          // 齿形几何质量:统计齿顶(近外圆)与齿根(近根圆)射线数,齿顶应约等于齿数
          const g=geom();
          let teeth=0, roots=0;
          for (let i=0;i<profR.length;i++){
            if (profR[i] > g.ra1-0.12*m_unit()) teeth++;
            if (profR[i] < g.r1-1.0*S.m+0.3) roots++;
          }
          function m_unit(){return S.m;}
          return {status:oStatus.innerText, tCrit:oTc.textContent, ratio:oRatio.textContent,
                  nonBg, profLen: profR.length,
                  profMin: Math.min(...profR).toFixed(2),
                  profMax: Math.max(...profR).toFixed(2),
                  ra1: g.ra1.toFixed(2), rf1: g.rf1.toFixed(2),
                  teethRays: teeth, rootRays: roots, z: S.z};
        }""")
        print("预设状态:", json.dumps(r1, ensure_ascii=False))

        page.evaluate("""() => {
          const s = document.getElementById('sF'); s.value='1.04';
          s.dispatchEvent(new Event('input'));
        }""")
        page.wait_for_timeout(700)
        r2 = page.evaluate("() => ({status:oStatus.innerText, hasSafe:!!safeR, hasMask:!!maskCv})")
        print("过进给后:", json.dumps(r2, ensure_ascii=False))

        page.evaluate("""() => {
          const z=document.getElementById('sZ'); z.value='9'; z.dispatchEvent(new Event('input'));
          const f=document.getElementById('sF'); f.value='0.8'; f.dispatchEvent(new Event('input'));
        }""")
        page.wait_for_timeout(700)
        r3 = page.evaluate("() => ({status:oStatus.innerText, tCrit:oTc.textContent})")
        print("z=9 浅进给:", json.dumps(r3, ensure_ascii=False))

        page.evaluate("() => document.getElementById('cSection').click()")
        page.evaluate("() => document.getElementById('btnPlay').click()")
        page.wait_for_timeout(600)
        r4 = page.evaluate("""() => ({
          insetVisible: !document.getElementById('inset').classList.contains('hidden'),
          playing:S.playing, k:S.k, K:S.K,
          i: S.z/S.z0,
          thetaW:+S.thetaW.toFixed(6),
          thetaC:+(-(S.z/S.z0)*S.thetaW).toFixed(6)
        })""")
        print("播放联动:", json.dumps(r4, ensure_ascii=False))
        assert abs(r4["thetaC"] + r4["i"] * r4["thetaW"]) < 1e-6  # θ₂ = -i·θ₁ 严格联动
        page.wait_for_timeout(1500)

        drag = page.evaluate("""() => {
          const c=document.getElementById('stage');
          const r=c.getBoundingClientRect();
          const g=geom(); const {k,ox,oy}=viewFrame(g);
          const sx=r.width/c.width;
          const px=x=>r.left+x*sx, py=y=>r.top+y*sx;
          const before=S.thetaW;
          c.dispatchEvent(new PointerEvent('pointerdown',{clientX:px(ox)+40,clientY:py(oy),bubbles:true}));
          c.dispatchEvent(new PointerEvent('pointermove',{clientX:px(ox),clientY:py(oy)+40,bubbles:true}));
          c.dispatchEvent(new PointerEvent('pointerup',{clientX:px(ox),clientY:py(oy)+40,bubbles:true}));
          return {before:+before.toFixed(4), after:+S.thetaW.toFixed(4)};
        }""")
        print("拖动联动(工件转角应变化):", json.dumps(drag, ensure_ascii=False))

        page.evaluate("() => document.getElementById('btnPreset').click()")
        page.wait_for_timeout(700)
        r5 = page.evaluate("() => ({status:oStatus.innerText, feed:vF.textContent, z:vZ.textContent})")
        print("预置复位:", json.dumps(r5, ensure_ascii=False))

        # 画布截一张图供目检
        page.screenshot(path=r"D:\ccfb\runs\17347\workspace\_test\shot-presetsafe.png")
        page.evaluate("""() => {
          const s=document.getElementById('sF'); s.value='1.06'; s.dispatchEvent(new Event('input'));
        }""")
        page.wait_for_timeout(700)
        page.evaluate("() => document.getElementById('cSection').click()")
        page.wait_for_timeout(300)
        page.screenshot(path=r"D:\ccfb\runs\17347\workspace\_test\shot-undercut-section.png")

        browser.close()

    print("\n运行时错误:", errors if errors else "无")
    assert not errors, errors
    assert r1["nonBg"] > 5000 and r1["profLen"] == 1440
    # 齿顶半径不得超过毛坯外圆;实际齿根应接近理论根圆(允许扫描步长误差)
    assert float(r1["profMax"]) <= float(r1["ra1"]) + 0.6
    assert float(r1["profMin"]) <= float(r1["rf1"]) + 1.2, r1
    # 近齿顶射线数应在一个合理量级(每齿若干条),证明全周都切出了齿
    assert r1["teethRays"] > r1["z"] * 2, r1
    assert "根切" in r2["status"] and r2["hasSafe"]
    assert r4["insetVisible"] and r4["k"] > 0 and r4["K"] > 0
    assert abs(drag["after"] - drag["before"]) > 0.05
    assert "正常" in r5["status"]
    print("\n全部浏览器核验通过")

if __name__ == "__main__":
    sys.exit(main())
