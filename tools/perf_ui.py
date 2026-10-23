#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
VEX3D 性能基线（无头 Chromium + WebGL/SwiftShader）。

用法:
    C:/Users/liuzhen/miniconda3/python.exe tools/perf_ui.py                # 默认：摆场后的重场景
    C:/Users/liuzhen/miniconda3/python.exe tools/perf_ui.py --no-setup     # 轻量模式（几秒跑完）
    C:/Users/liuzhen/miniconda3/python.exe tools/perf_ui.py --repeat 5     # 多采几轮
    C:/Users/liuzhen/miniconda3/python.exe tools/perf_ui.py --json > p.json

⚠️⚠️⚠️ 读这些数字之前，先记住这几件事 ⚠️⚠️⚠️

1. **这个环境没有 GPU**：Chromium 跑的是 **SwiftShader 软件光栅化**。
   摆场之后场上 455 个 mesh、~470 次 draw call、~380 万三角形。
   同一份代码在真机 GPU 上会快一到两个数量级。
   → 这里的绝对值**只适合做 before/after 对比**，别当"产品性能"报出去。

2. **"慢"到底慢在哪 —— 脚本分开报**：
   · `交互·JS 提交`   —— 改一次 store 状态到 React 提交完成。**纯 JS，跟 GL 无关**。
   · `Profiler·JS`    —— 整段交互里所有 JS（React / R3F / three / 本仓库）。
   · `Profiler·原生`  —— 主线程卡在 WebGL 调用上（等 GPU 进程）。
   · `Profiler·空闲`  —— 主线程闲着（等 vsync / 等浏览器出帧）。
   ★ 所以「软件渲染慢」**不代表 React 慢** —— 这两件事脚本是分开量的。

3. **headless Chromium 不会因为 GPU 忙就卡住主线程**：gl.render() 只是把命令
   塞进 command buffer 就返回，真正的光栅化在 GPU 进程里干。
   → 所以「帧间隔」量的是**主线程的节奏**；想看 GPU 的账要用 `gl.finish()`
   （脚本的「同步帧」和「含 GPU」的端到端就是这么量的）。

4. **e2e 里真正卡住的是截图**：`page.screenshot()` 要等一整帧合成，
   比 WebGL 本身还贵。脚本单独量了它。

5. **中位数比均值稳**：软件渲染下偶发 GC / 资源加载尖峰，所以每项都给中位数。

6. **要对比两个版本**：用**完全相同的命令行**、同样的 `--repeat`、同样的机器，
   而且**别在同一个浏览器实例里连着跑两遍**（V8 JIT / 资源缓存会让第二遍偏快）。
   ★ 顺便：跑的时候别让别的 agent 同时改 `src/**` —— Vite 会热更新，
     场景规模会跟着变，两次数字就没法比了。

产出:
    · 一张「场景规模」表（mesh / 材质 / 几何 / 贴图 / shader program 数）
    · 一张「每轮采样」表（帧时间、交互延迟、Profiler 拆分），最后一行是各列中位数
    · `--json` 时把同样的数据以 JSON 打到 stdout（表格转 stderr，方便管道）
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import tempfile
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))

# 跟 verify_ui.py 一样的启动参数：强制走 SwiftShader 软件渲染
LAUNCH_ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
]


# ──────────────────────────────────────────────────────────────
# 页面里跑的 JS
# ──────────────────────────────────────────────────────────────

# 给 renderer.render 套一层计时外壳：每次出帧都记下起止时间和这一帧的 draw call。
# 另外把 requestAnimationFrame 也包一层 —— 记下每个回调在主线程上占了多久，
# 这样才能把「帧间隔」拆成「主线程真在干活」和「主线程在等 GPU 光栅化」两段。
INSTALL_KIT_JS = r"""
() => {
  const b = window.__bridge;
  if (!b || !b.renderer || !b.scene) return { ok: false, why: 'bridge-not-ready' };
  if (window.__perf && window.__perf.installed) return { ok: true, already: true };

  const p = { installed: true, inflight: false, renders: [], rafs: [] };
  window.__perf = p;

  // 包装 rAF：记下每个回调进入/退出主线程的时刻
  if (!window.__perfRafPatched) {
    window.__perfRafPatched = true;
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return origRaf(function (t) {
        const enter = performance.now();
        try { cb(t); }
        finally {
          const w = window.__perf;
          if (w) {
            w.rafs.push({ enter, exit: performance.now() });
            if (w.rafs.length > 4000) w.rafs.splice(0, w.rafs.length - 4000);
          }
        }
      });
    };
  }

  const r = b.renderer;
  const orig = r.render.bind(r);
  r.render = function (scene, camera) {
    p.inflight = true;
    const start = performance.now();
    let out;
    try {
      out = orig(scene, camera);
    } finally {
      const end = performance.now();
      p.inflight = false;
      // three 在 render() 开头会 info.reset()，所以 render() 返回后
      // info.render.* 就是**这一帧**的数字 ✓
      p.renders.push({
        start, end,
        calls: r.info.render.calls,
        triangles: r.info.render.triangles,
        programs: r.info.programs ? r.info.programs.length : 0,
      });
      if (p.renders.length > 4000) p.renders.splice(0, p.renders.length - 4000);
    }
    return out;
  };
  return { ok: true };
}
"""

# 场景规模：数 mesh / 材质实例 / 几何实例，以及 renderer.info 的三个计数
SCENE_STATS_JS = r"""
() => {
  const b = window.__bridge;
  const s = b.scene;
  const r = b.renderer;
  let meshes = 0, visibleMeshes = 0, instanced = 0, lights = 0;
  let points = 0, lines = 0, groups = 0, sprites = 0;
  const mats = new Set(), geos = new Set();
  let matSlots = 0, geoSlots = 0, sceneTris = 0;

  s.traverse((o) => {
    if (o.isGroup) groups++;
    if (o.isSprite) sprites++;
    if (o.isPoints) points++;
    if (o.isLine) lines++;
    if (o.isLight) lights++;
    if (o.isMesh) {
      meshes++;
      if (o.isInstancedMesh) instanced++;
      if (o.visible) visibleMeshes++;
      const m = o.material;
      if (Array.isArray(m)) {
        matSlots += m.length;
        for (const x of m) if (x) mats.add(x.uuid);
      } else if (m) {
        matSlots++;
        mats.add(m.uuid);
      }
      const g = o.geometry;
      if (g) {
        geoSlots++;
        geos.add(g.uuid);
        const n = g.index ? g.index.count
                : (g.attributes && g.attributes.position ? g.attributes.position.count : 0);
        sceneTris += Math.floor(n / 3);
      }
    }
  });

  const info = r.info;
  return {
    meshes, visibleMeshes, instanced, lights, points, lines, groups, sprites,
    materials: mats.size, materialSlots: matSlots,
    geometries: geos.size, geometrySlots: geoSlots,
    sceneTriangles: sceneTris,
    memGeometries: info.memory.geometries,
    memTextures: info.memory.textures,
    programs: info.programs ? info.programs.length : 0,
    lastCalls: info.render.calls,
    lastTriangles: info.render.triangles,
    canvasW: r.domElement.width,
    canvasH: r.domElement.height,
    pixelRatio: r.getPixelRatio(),
  };
}
"""

# 连着量 K 帧：每帧 rAF 打点，并保证每帧都真的渲染一次（frameloop="demand"）
#
# ★ 注意：headless Chromium **不会**因为 GPU 忙就卡住主线程 ——
#   gl.render() 只是把命令塞进 command buffer 就返回了，真正的光栅化在
#   GPU 进程里干。所以这一轮量到的「帧间隔」是**主线程的节奏**，
#   GPU 那边欠的账看不到。要看真账用下面那个 MEASURE_FRAMES_SYNC_JS（带 gl.finish）。
MEASURE_FRAMES_JS = r"""
async (k) => {
  const b = window.__bridge;
  const perf = window.__perf;
  if (!b || !b.invalidate) return { error: 'no-invalidate' };
  const frames = [];
  const rafMark0 = perf.rafs.length;

  await new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const n0 = perf.renders.length;
      b.invalidate();                       // 请求下一帧
      requestAnimationFrame((rafTs) => {    // R3F 的 loop 先注册 → 同帧里它先跑
        const tCb = performance.now();
        const rec = perf.renders.length > n0 ? perf.renders[perf.renders.length - 1] : null;
        frames.push({ rafTs, tCb, render: rec });
        if (++i >= k) resolve();
        else step();
      });
    };
    step();
  });

  // 找一帧对应的 rAF 回调（R3F 的 loop 回调包着 gl.render）
  const rafs = perf.rafs.slice(rafMark0);
  const enclosing = (rec) => {
    for (const q of rafs) if (q.enter <= rec.start && q.exit >= rec.end) return q;
    return null;
  };
  for (const f of frames) {
    if (!f.render) continue;
    const q = enclosing(f.render);
    f.busyMs = q ? q.exit - q.enter : null;   // 这一帧主线程一共干了多久
  }
  return { frames };
}
"""

# 同步版：每帧渲染完立刻 gl.finish()，**逼** GPU 进程把这一帧真的画完。
# 这才是「一帧到底要多久」的真实答案（SwiftShader 下就是 ~10 秒那个数）。
MEASURE_FRAMES_SYNC_JS = r"""
async (k) => {
  const b = window.__bridge;
  const perf = window.__perf;
  const r = b.renderer;
  if (!b || !b.invalidate) return { error: 'no-invalidate' };
  const gl = r.getContext();
  const frames = [];

  await new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const n0 = perf.renders.length;
      b.invalidate();
      requestAnimationFrame(() => {
        const rec = perf.renders.length > n0 ? perf.renders[perf.renders.length - 1] : null;
        const tBefore = performance.now();
        gl.finish();                       // 阻塞到 GPU 把这一帧真的画完
        const tFinish = performance.now();
        frames.push({ tCb: performance.now(), finishMs: tFinish - tBefore, render: rec });
        if (++i >= k) resolve();
        else step();
      });
    };
    step();
  });
  return { frames };
}
"""

# 交互①：改一次 store 状态 → 等 React 提交完成
#   「React 提交完成」用 MessageChannel 的排队顺序判定：
#   React 的调度消息是在 set() 里同步 post 的，我们的消息后 post → 我们的回调
#   一定在 React 提交**之后**跑（React 用同步 lane 时提交在微任务里，也更早）。
ACTION_JS = r"""
async (kind) => {
  const st = window.__vex3d.getState();
  let target = null;
  if (kind === 'item') {
    if (!st.loose.length) return { error: 'no-loose-items' };
    const id = st.loose[0].id;
    target = st.selectedItemId === id ? null : id;   // 来回切，制造真实变化
  } else {
    target = st.selectedGoalId === 'g-n1' ? null : 'g-n1';
  }
  const t0 = performance.now();
  if (kind === 'item') window.__vex3d.getState().selectItem(target);
  else window.__vex3d.getState().selectGoal(target);
  const tAction = performance.now();

  const tCommit = await new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve(performance.now());
    ch.port2.postMessage(0);
  });

  const perf = window.__perf;
  return {
    kind, target, t0, tAction, tCommit,
    renderMark: perf ? perf.renders.length : 0,
    selectedItemId: window.__vex3d.getState().selectedItemId,
    selectedGoalId: window.__vex3d.getState().selectedGoalId,
  };
}
"""

# 交互②：等提交之后那一帧渲染完
#
# ⚠ 无头 Chromium **不一定自发地产生帧**（没有合成器在要 BeginFrame），
#   所以等待期间要持续 invalidate()，否则"下一帧"可能要等几十秒才来 ——
#   那是浏览器的行为，不是这个 app 的性能。脚本会照实把等待时间算进端到端延迟。
AWAIT_FRAME_JS = r"""
async (arg) => {
  const perf = window.__perf;
  const b = window.__bridge;
  const deadline = performance.now() + arg.timeout;
  const pump = setInterval(() => { try { b.invalidate(); } catch (e) {} }, 30);
  try {
    while (performance.now() < deadline) {
      const n = perf.renders.length;
      for (let i = Math.max(0, arg.mark); i < n; i++) {
        const rec = perf.renders[i];
        if (rec.start >= arg.tCommit) {
          // gl.finish()：逼 GPU 进程把这一帧真的画完 ——
          // 不然「端到端」只算到主线程把命令塞进 command buffer 就完事了。
          let tFinish = null, finishMs = null;
          try {
            const gl = b.renderer.getContext();
            const t0 = performance.now();
            gl.finish();
            tFinish = performance.now();
            finishMs = tFinish - t0;
          } catch (e) {}
          return { ok: true, tRenderStart: rec.start, tRenderEnd: rec.end,
                   tFinish, finishMs,
                   glMs: rec.end - rec.start,
                   calls: rec.calls, triangles: rec.triangles };
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    clearInterval(pump);
  }
  return { ok: false, error: 'timeout-waiting-for-frame' };
}
"""


# ──────────────────────────────────────────────────────────────
# Python 侧的小工具
# ──────────────────────────────────────────────────────────────

def median(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def fmt(v, digits=1):
    if v is None:
        return "-"
    if isinstance(v, int):
        return str(v)
    return f"{v:,.{digits}f}"


def check_server(url):
    """dev server 没起来的话给一句人话提示，而不是一堆 traceback。"""
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            r.read(64)
        return True
    except urllib.error.HTTPError:
        return True          # 有服务在（哪怕返回 404）
    except Exception as e:  # noqa: BLE001
        print(f"\n✗ 连不上 {url}（{e}）\n", file=sys.stderr)
        print("  看起来 Vite dev server 没起来。先在项目目录里起一个：\n", file=sys.stderr)
        print("      npm run dev\n", file=sys.stderr)
        print("  然后重跑本脚本。\n", file=sys.stderr)
        return False


def wait_idle(page, quiet_ms=400, timeout=180.0):
    """等到没有正在渲染的帧、且最后一帧已经结束 quiet_ms 毫秒。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = page.evaluate(
            """() => {
              const p = window.__perf;
              if (!p) return null;
              const l = p.renders[p.renders.length - 1];
              return { inflight: p.inflight, lastEnd: l ? l.end : 0, now: performance.now() };
            }"""
        )
        if st and not st["inflight"] and st["lastEnd"] and (st["now"] - st["lastEnd"]) > quiet_ms:
            return True
        time.sleep(0.15)
    return False


def wait_render_after(page, mark, timeout=300.0):
    """等到 mark 之后至少又出了一帧，并且那一帧已经画完。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = page.evaluate(
            """(m) => {
              const p = window.__perf;
              if (!p) return null;
              const l = p.renders[p.renders.length - 1];
              return { n: p.renders.length, inflight: p.inflight,
                       lastEnd: l ? l.end : 0, now: performance.now() };
            }""",
            mark,
        )
        if st and st["n"] > mark and not st["inflight"] and st["lastEnd"] \
                and (st["now"] - st["lastEnd"]) > 600:
            return True
        time.sleep(0.2)
    return False


def mesh_count(page):
    return page.evaluate(
        """() => {
          const s = window.__bridge && window.__bridge.scene;
          if (!s) return -1;
          let m = 0;
          s.traverse((o) => { if (o.isMesh) m++; });
          return m;
        }"""
    )


def wait_scene_stable(page, timeout=180.0, quiet=1.5):
    """等 mesh 数连续 quiet 秒不变 —— 说明 CAD 资产都加载完了。

    不等的话可能量到「场地还没加载完」的半截场景，数字会偏小。
    """
    deadline = time.time() + timeout
    last = None
    changed_at = time.time()
    while time.time() < deadline:
        n = mesh_count(page)
        if n != last:
            last = n
            changed_at = time.time()
        elif time.time() - changed_at >= quiet:
            return last
        time.sleep(0.4)
    return last


# ──────────────────────────────────────────────────────────────
# CDP Profiler：把主线程时间拆成 JS / 原生 / 空闲
# ──────────────────────────────────────────────────────────────

def module_of(url):
    """把 CPU profile 里的 URL 归到 react / r3f / three / 本仓库。

    Vite dev server 优化过的依赖，URL 长这样（文件名是包名 + hash）：
        /node_modules/.vite/deps/react_jsx-dev-runtime.js?v=xxx   → react
        /node_modules/.vite/deps/client-DAbJOLh2.js?v=xxx          → react（react-dom 被 Vite 打成 client.js）
        /node_modules/.vite/deps/react-three-fiber.esm-Bb1vE0v6.js → r3f
        /node_modules/.vite/deps/three.module-dSlfew9g.js?v=xxx   → three
        /src/scene/Goals.tsx?t=...                                → 本仓库
    """
    u = url.replace("\\", "/").lower()
    base = u.rsplit("/", 1)[-1]
    if "react-three" in u or "react-reconciler" in u or "@react-three" in u:
        return "r3f"
    if "react" in base or "react-dom" in u or "scheduler" in u:
        return "react"
    if "/.vite/deps/client-" in u:
        return "react"          # Vite 把 react-dom 打包成 deps/client.js
    if "three" in base:
        return "three"
    if "/src/" in u:
        return "app"
    return "other-js"


def parse_profile(profile):
    """CPU profile → {js, native, idle, gc} 四个桶（毫秒）+ 按模块分。"""
    nodes = {n["id"]: n for n in profile.get("nodes", [])}
    samples = profile.get("samples", [])
    deltas = profile.get("timeDeltas", [])
    buckets = {"js": 0.0, "native": 0.0, "idle": 0.0, "gc": 0.0}
    per_module = {}
    for sid, dt in zip(samples, deltas):
        node = nodes.get(sid)
        if not node:
            continue
        cf = node.get("callFrame", {})
        fn = cf.get("functionName", "")
        url = cf.get("url", "")
        ms = dt / 1000.0
        if fn == "(idle)":
            buckets["idle"] += ms
        elif fn == "(garbage collector)":
            buckets["gc"] += ms
        elif url == "":
            buckets["native"] += ms
        else:
            buckets["js"] += ms
            key = module_of(url)
            per_module[key] = per_module.get(key, 0.0) + ms
    buckets["total"] = sum(buckets[k] for k in ("js", "native", "idle", "gc"))
    buckets["modules"] = per_module
    return buckets


# ──────────────────────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────────────────────

def ensure_kit(page):
    """探针还在不在？不在就重装。

    Vite 热更新可能会整页刷新（别的 agent 改了 src/**），
    刷新后 window.__perf 就没了 —— 这时候重新装一遍，别让整个脚本挂掉。
    """
    alive = page.evaluate(
        "() => !!(window.__perf && window.__perf.installed && window.__bridge && window.__bridge.renderer)"
    )
    if alive:
        return True
    page.wait_for_function(
        "() => !!(window.__bridge && window.__bridge.renderer && window.__vex3d)", timeout=120000
    )
    page.evaluate(INSTALL_KIT_JS)
    return True


def run_round(page, cdp, kind, frame_count, profile_on, timeout_ms):
    """一轮采样：量 K 帧 + 做一次状态切换交互。"""
    wait_idle(page)

    # ── 帧时间 ────────────────────────────────────────────
    res = page.evaluate(MEASURE_FRAMES_JS, frame_count)
    if "error" in res:
        return {"error": res["error"]}
    frames = res["frames"]

    intervals, gl_calls, busy, gpu_wait = [], [], [], []
    calls, tris = [], []
    for i in range(1, len(frames)):
        prev, cur = frames[i - 1], frames[i]
        rec = cur.get("render")
        if not rec:
            continue
        interval = cur["tCb"] - prev["tCb"]                 # 帧间隔（墙钟）
        intervals.append(interval)
        gl_calls.append(rec["end"] - rec["start"])          # 主线程里的 gl.render 耗时
        calls.append(rec.get("calls"))
        tris.append(rec.get("triangles"))
        if cur.get("busyMs") is not None:
            busy.append(cur["busyMs"])                      # 这一帧主线程一共干了多久
            # 主线程之外的时间 = 等 GPU 光栅化 + 浏览器调度
            gpu_wait.append(max(0.0, interval - cur["busyMs"]))

    # ── 交互延迟 ──────────────────────────────────────────
    # Profiler 覆盖**整个**交互（动作 → 提交 → 那一帧画完）：
    #   · JS      —— React 提交 + R3F 每帧的 JS（我们自己的代码）
    #   · 原生     —— 主线程上调 WebGL 的时间
    #   · 空闲     —— 主线程闲着、等 GPU 进程光栅化
    # （Profiler.stop 是 CDP 命令，要等主线程有空才处理得到，
    #   所以这个窗口天然会把「提交之后的那一帧」也包进去 ✓）
    prof = None
    if profile_on:
        cdp.send("Profiler.enable")
        cdp.send("Profiler.setSamplingInterval", {"interval": 200})
        cdp.send("Profiler.start")

    act = page.evaluate(ACTION_JS, kind)
    if "error" in act:
        if profile_on:
            try:
                cdp.send("Profiler.stop")
            except Exception:  # noqa: BLE001
                pass
        return {"error": act["error"]}

    fr = page.evaluate(
        AWAIT_FRAME_JS,
        {"tCommit": act["tCommit"], "mark": act["renderMark"], "timeout": timeout_ms},
    )

    if profile_on:
        try:
            prof = parse_profile(cdp.send("Profiler.stop")["profile"])
        except Exception as e:  # noqa: BLE001
            prof = {"error": str(e)}

    out = {
        "actionKind": act["kind"],
        "actionTarget": act["target"],
        "commitMs": act["tCommit"] - act["t0"],            # JS/React：状态变化 → 提交完成
        "actionSyncMs": act["tAction"] - act["t0"],        # set() 本身（同步部分）
        "frameIntervalMs": median(intervals),
        "glCallMs": median(gl_calls),
        "mainThreadMs": median(busy),
        "schedGapMs": median(gpu_wait),
        "frameCalls": median(calls),
        "frameTriangles": median(tris),
        "frameSamples": len(intervals),
    }
    if fr.get("ok"):
        out["e2eMs"] = fr["tRenderEnd"] - act["t0"]        # 端到端（到主线程画完）
        out["commitToFrameMs"] = fr["tRenderEnd"] - act["tCommit"]
        out["e2eGlMs"] = fr["glMs"]
        out["e2eCalls"] = fr.get("calls")
        out["e2eTriangles"] = fr.get("triangles")
        if fr.get("tFinish") is not None:
            out["e2eWithGpuMs"] = fr["tFinish"] - act["t0"]   # 端到端（含 GPU 真的画完）
            out["gpuFinishMs"] = fr["finishMs"]
    else:
        out["e2eMs"] = None
        out["e2eError"] = fr.get("error")
    if prof:
        out["profile"] = prof
    return out


def measure_sync_frames(page, k):
    """同步量帧：每帧后面 gl.finish()，量出**这一帧真正要多久**（含 GPU 光栅化）。"""
    res = page.evaluate(MEASURE_FRAMES_SYNC_JS, k)
    if "error" in res:
        return {"error": res["error"]}
    frames = res["frames"]
    intervals = [frames[i]["tCb"] - frames[i - 1]["tCb"] for i in range(1, len(frames))]
    finish = [f["finishMs"] for f in frames if f.get("finishMs") is not None]
    gl = [f["render"]["end"] - f["render"]["start"] for f in frames if f.get("render")]
    return {
        "syncFrameMs": median(intervals),     # 一帧的完整周期（含 GPU）
        "gpuRasterMs": median(finish),        # gl.finish() 等了多久 = GPU 光栅化耗时
        "glCallMs": median(gl),
        "samples": len(intervals),
    }


def print_table(title, rows, headers, out=sys.stderr):
    """rows: [(label, unit, [values...])]"""
    print(f"\n{title}", file=out)
    w = max(len(r[0]) for r in rows) + 2
    head = "指标".ljust(w) + "单位".ljust(8) + "".join(h.rjust(13) for h in headers)
    print(head, file=out)
    print("─" * len(head), file=out)
    for label, unit, vals in rows:
        cells = "".join(fmt(v).rjust(13) for v in vals)
        print(label.ljust(w) + unit.ljust(8) + cells, file=out)


def main():
    ap = argparse.ArgumentParser(
        description="VEX3D 性能基线（SwiftShader 软件渲染下的 before/after 对比）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--url", default="http://127.0.0.1:5173/?quality=low",
                    help="页面地址（默认 %(default)s）")
    ap.add_argument("--setup", dest="setup", action="store_true", default=True,
                    help="点顶栏「摆场」，量官方开局的重场景（默认开）")
    ap.add_argument("--no-setup", dest="setup", action="store_false",
                    help="不摆场，量空场（轻量，几秒跑完）")
    ap.add_argument("--repeat", type=int, default=3, help="采样轮数（默认 %(default)s）")
    ap.add_argument("--frames", type=int, default=3, help="每轮量几帧（默认 %(default)s）")
    ap.add_argument("--sync-frames", type=int, default=2,
                    help="同步量几帧（每帧后 gl.finish，量出含 GPU 光栅化的真实帧时间；0 = 不量）")
    ap.add_argument("--shots", type=int, default=1,
                    help="量几次截图的耗时（verify_ui.py 里最容易卡住的一步；0 = 不量）")
    ap.add_argument("--json", action="store_true", help="输出 JSON（表格转 stderr）")
    ap.add_argument("--headed", action="store_true", help="开有头浏览器（调试用）")
    ap.add_argument("--no-profile", dest="profile", action="store_false", default=True,
                    help="不跑 CDP Profiler（JS / 原生 / 空闲 的拆分就没了）")
    ap.add_argument("--timeout", type=float, default=300.0,
                    help="单个长步骤的超时秒数（默认 %(default)s）")
    args = ap.parse_args()

    if args.repeat < 1:
        print("✗ --repeat 至少要 1", file=sys.stderr)
        return 2

    if not check_server(args.url):
        return 2

    # 人读的输出一律走 stderr —— --json 时 stdout 必须是干净的 JSON
    out = sys.stderr
    t_start = time.time()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed, args=LAUNCH_ARGS)
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        # 软渲染一帧 ~10 秒，默认 30 s 超时根本不够
        page.set_default_timeout(int(args.timeout * 1000))

        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        print(f"→ 打开 {args.url}", file=out)
        # 用 "commit" 而不是 "domcontentloaded"：dev server 冷启动时要现转译
        # 几百个模块，domcontentloaded 可能要等几十秒（后面的 wait_for_function
        # 才是真正该等的信号 —— 场景挂好了没）。
        page.goto(args.url, wait_until="commit", timeout=int(args.timeout * 1000))
        page.wait_for_function(
            "() => !!(window.__bridge && window.__bridge.renderer && window.__bridge.scene && window.__vex3d)",
            timeout=60000,
        )
        kit = page.evaluate(INSTALL_KIT_JS)
        if not kit.get("ok"):
            print(f"✗ 装不上测量探针：{kit}", file=sys.stderr)
            browser.close()
            return 2
        wait_idle(page)
        wait_scene_stable(page)

        # ── 摆场 ───────────────────────────────────────────
        setup_ms = None
        if args.setup:
            mark = page.evaluate("() => window.__perf.renders.length")
            print("→ 点「摆场」（官方开局布局，400+ mesh）…", file=out)
            # 用页面自己的 performance.now()，好跟渲染记录的时间戳对上
            t_page = page.evaluate("() => performance.now()")
            page.locator(".topbar button", has_text="摆场").click()
            if not wait_render_after(page, mark, timeout=args.timeout):
                print("✗ 摆场之后没等到新的一帧（超时）", file=sys.stderr)
                browser.close()
                return 2
            rec = page.evaluate(
                "(m) => { const p = window.__perf; const r = p.renders[p.renders.length - 1];"
                " return r ? { start: r.start, end: r.end, calls: r.calls } : null; }",
                mark,
            )
            if rec:
                setup_ms = rec["end"] - t_page      # 点「摆场」→ 新场景画完
            wait_idle(page)
            wait_scene_stable(page)
        else:
            print("→ 跳过摆场（空场）", file=out)

        scene = page.evaluate(SCENE_STATS_JS)

        # 交互用哪种状态切换：有散件就切「选中散件」，没有就切「选中 goal」
        kind = "item" if page.evaluate("() => window.__vex3d.getState().loose.length") else "goal"
        print(f"→ 交互动作：{'切换选中散件' if kind == 'item' else '切换选中 goal'}", file=out)

        cdp = page.context.new_cdp_session(page)
        rounds = []
        for i in range(args.repeat):
            print(f"→ 第 {i + 1}/{args.repeat} 轮…", file=out)
            try:
                ensure_kit(page)
                r = run_round(page, cdp, kind, args.frames, args.profile, args.timeout * 1000)
            except Exception as e:  # noqa: BLE001
                print(f"  ! 这一轮炸了：{type(e).__name__}: {str(e)[:160]}", file=out)
                r = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
                try:
                    ensure_kit(page)
                except Exception:  # noqa: BLE001
                    pass
            rounds.append(r)
            if r.get("error"):
                print(f"  ! 这一轮出错：{r['error']}", file=out)

        # ── 同步帧：量「一帧真正要多久」（含 GPU 光栅化）────────
        sync = {}
        if args.sync_frames > 0:
            print(f"→ 同步帧（每帧 gl.finish，{args.sync_frames} 帧）…", file=out)
            wait_idle(page)
            sync = measure_sync_frames(page, args.sync_frames)
            if sync.get("error"):
                print(f"  ! 同步帧测量出错：{sync['error']}", file=out)

        # ── 截图耗时：verify_ui.py 每次截图都要等一整帧合成 ──────
        #   这是 e2e 真正会卡住的地方（比 WebGL 本身还贵），所以单独量出来。
        shots = []
        for i in range(args.shots):
            t0 = time.time()
            try:
                page.screenshot(path=os.path.join(tempfile.gettempdir(), f"vex3d_perf_{i}.png"))
            except Exception as e:  # noqa: BLE001
                print(f"  ! 截图失败：{type(e).__name__}", file=out)
                continue
            shots.append((time.time() - t0) * 1000.0)

        browser.close()

    real_errors = [e for e in console_errors if "favicon" not in e.lower()]

    # ── 汇总 ──────────────────────────────────────────────
    def col(key, sub=None):
        vals = []
        for r in rounds:
            v = r.get(key)
            if v is None and sub:
                v = r.get(sub)
            vals.append(v)
        return vals

    prof_js = [r.get("profile", {}).get("js") for r in rounds if isinstance(r.get("profile"), dict)]
    prof_native = [r.get("profile", {}).get("native") for r in rounds if isinstance(r.get("profile"), dict)]
    prof_idle = [r.get("profile", {}).get("idle") for r in rounds if isinstance(r.get("profile"), dict)]
    prof_gc = [r.get("profile", {}).get("gc") for r in rounds if isinstance(r.get("profile"), dict)]
    prof_total = [r.get("profile", {}).get("total") for r in rounds if isinstance(r.get("profile"), dict)]

    # JS 自耗时再按模块拆一层：react / r3f / three / 本仓库的代码
    def prof_mod(name):
        vals = []
        for r in rounds:
            p = r.get("profile")
            if isinstance(p, dict) and isinstance(p.get("modules"), dict):
                vals.append(p["modules"].get(name, 0.0))
        return vals

    headers = [f"#{i + 1}" for i in range(args.repeat)] + ["中位数"]
    scene_rows = [
        ("mesh 数（场景里）", "个", [scene["meshes"]]),
        ("可见 mesh", "个", [scene["visibleMeshes"]]),
        ("材质实例（去重）", "个", [scene["materials"]]),
        ("材质引用槽位", "个", [scene["materialSlots"]]),
        ("几何实例（去重）", "个", [scene["geometries"]]),
        ("几何引用槽位", "个", [scene["geometrySlots"]]),
        ("info.memory.geometries", "个", [scene["memGeometries"]]),
        ("info.memory.textures", "张", [scene["memTextures"]]),
        ("info.programs.length", "个", [scene["programs"]]),
        ("draw calls（上一帧）", "次", [scene["lastCalls"]]),
        ("三角形（上一帧）", "个", [scene["lastTriangles"]]),
        ("场景三角形合计", "个", [scene["sceneTriangles"]]),
    ]
    # 场景规模只测一次 → 表格里就一列，"中位数"列留空
    print_table("■ 场景规模（测一次）", scene_rows, ["值"], out)

    round_rows = [
        ("帧间隔（主线程节奏）", "ms", col("frameIntervalMs") + [median(col("frameIntervalMs"))]),
        ("gl.render（主线程）", "ms", col("glCallMs") + [median(col("glCallMs"))]),
        ("主线程占用", "ms", col("mainThreadMs") + [median(col("mainThreadMs"))]),
        ("主线程之外(调度空档)", "ms", col("schedGapMs") + [median(col("schedGapMs"))]),
        ("每帧 draw calls", "次", col("frameCalls") + [median(col("frameCalls"))]),
        ("每帧三角形", "个", col("frameTriangles") + [median(col("frameTriangles"))]),
        ("交互·JS 提交", "ms", col("commitMs") + [median(col("commitMs"))]),
        ("交互·端到端(主线程)", "ms", col("e2eMs") + [median(col("e2eMs"))]),
        ("交互·端到端(含 GPU)", "ms", col("e2eWithGpuMs") + [median(col("e2eWithGpuMs"))]),
        ("交互·提交→出帧", "ms", col("commitToFrameMs") + [median(col("commitToFrameMs"))]),
        ("交互·该帧 gl.render", "ms", col("e2eGlMs") + [median(col("e2eGlMs"))]),
        ("交互·GPU 光栅等待", "ms", col("gpuFinishMs") + [median(col("gpuFinishMs"))]),
    ]
    if args.profile:
        round_rows += [
            ("Profiler·JS(我们的代码)", "ms", prof_js + [median(prof_js)]),
            ("  └ react", "ms", prof_mod("react") + [median(prof_mod("react"))]),
            ("  └ r3f", "ms", prof_mod("r3f") + [median(prof_mod("r3f"))]),
            ("  └ three", "ms", prof_mod("three") + [median(prof_mod("three"))]),
            ("  └ 本仓库", "ms", prof_mod("app") + [median(prof_mod("app"))]),
            ("Profiler·原生(布局/绘制/GL)", "ms", prof_native + [median(prof_native)]),
            ("Profiler·空闲(等合成/GPU)", "ms", prof_idle + [median(prof_idle)]),
            ("Profiler·GC", "ms", prof_gc + [median(prof_gc)]),
            ("Profiler·合计", "ms", prof_total + [median(prof_total)]),
        ]
    print_table("■ 每轮采样", round_rows, headers, out)

    if sync and not sync.get("error"):
        print_table("■ 同步帧（每帧后 gl.finish → 含 GPU 光栅化的真实帧时间）", [
            ("一帧完整周期", "ms", [sync["syncFrameMs"]]),
            ("GPU 光栅化耗时", "ms", [sync["gpuRasterMs"]]),
            ("gl.render（主线程）", "ms", [sync["glCallMs"]]),
        ], ["值"], out)

    if shots:
        print_table("■ 截图耗时（合成一整帧 —— e2e 最容易卡住的一步）", [
            ("page.screenshot", "ms", shots + [median(shots)]),
        ], [f"#{i + 1}" for i in range(len(shots))] + ["中位数"], out)

    if setup_ms is not None:
        print_table("■ 摆场（最重的一次交互）", [
            ("点「摆场」→ 新场景画完", "ms", [setup_ms]),
        ], ["值"], out)

    print("\n※ 以上数字测于 **SwiftShader 软件渲染**（无 GPU）。", file=out)
    print("  headless Chromium 不会因为 GPU 忙就卡住主线程 ——", file=out)
    print("  「帧间隔」量的是**主线程节奏**；GPU 的账看「同步帧」和「含 GPU」的端到端。", file=out)
    print("  真机 GPU 上会快一到两个数量级。这些数字只用于 before/after 对比。", file=out)
    if real_errors:
        print(f"\n⚠ 控制台有 {len(real_errors)} 条错误：", file=out)
        for e in real_errors[:5]:
            print(f"   {e}", file=out)

    if args.json:
        payload = {
            "meta": {
                "url": args.url,
                "setup": args.setup,
                "repeat": args.repeat,
                "framesPerRound": args.frames,
                "renderer": "SwiftShader (software)",
                "elapsedSec": round(time.time() - t_start, 1),
                "consoleErrors": real_errors,
            },
            "scene": scene,
            "rounds": rounds,
            "syncFrames": sync,
            "screenshotMs": shots,
            "setupMs": setup_ms,
            "median": {
                "frameIntervalMs": median(col("frameIntervalMs")),
                "glCallMs": median(col("glCallMs")),
                "mainThreadMs": median(col("mainThreadMs")),
                "schedGapMs": median(col("schedGapMs")),
                "commitMs": median(col("commitMs")),
                "e2eMs": median(col("e2eMs")),
                "e2eWithGpuMs": median(col("e2eWithGpuMs")),
                "commitToFrameMs": median(col("commitToFrameMs")),
                "e2eGlMs": median(col("e2eGlMs")),
                "gpuFinishMs": median(col("gpuFinishMs")),
            },
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
