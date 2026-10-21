# CLAUDE.md — VEX3D

VEX V5 **Override**（2026-2027 赛季）3D 战术分析演示器。浏览器里摆弄得分物、实时算分。

本文件是**给改这个仓库的人（或 AI）看的参考**：事实、约定、模型。功能介绍在 README。

## 运行

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # tsc -b + vite build → dist/
npm test           # 计分引擎回归测试（node 直接跑 .ts，需 Node 22.18+/24）
C:/Users/liuzhen/miniconda3/python.exe tools/verify_ui.py   # 端到端（需先起 dev）
```

`python` 在 PATH 上指向 MSYS2 的（没 playwright），要用 miniconda3 那个。

## 目录

```
fieldcad/            官方场地 CAD（126 MB STEP，AP214，毫米）——源文件，不入库
public/assets/       CAD 管线产物（不入库）
tools/               离线 Python 管线（OCP）+ 验证脚本（extract_field / verify_ui / shot_*）
src/
  data/terms.ts      ★ 统一词表（颜色 / 区域名 / 零件名），**不 import 任何东西**
  data/fieldSpec.ts  场地规格 + 坐标系换算 + 兜底几何
  state/scoring.ts   ★ 计分引擎（全部规则逻辑都在这一个文件里）
  state/store.ts     zustand store
  state/drag.ts      拖拽指针状态（放在 React 之外，避免每帧重渲染）
  scene/stackLayout.ts ★ 堆叠几何：半体摆放 + 嵌套落点（3D / 幽灵件 / 测试共用）
  scene/             R3F 场景：场地 / goal / 得分物 / toggle / 区域染色 / 拖拽幽灵件
  ui/                左侧面板（调色板 / toggle 设置）、计分板、规则说明、垃圾桶
```

## 统一话术

| 概念 | 叫法 | 别再叫 |
|---|---|---|
| 得分物 | **pin** / **cup** | 端子、半体 |
| pin 的两半 | **pin 上半 / pin 下半** | 端子 |
| 场上的 9 个桩 | **goal**（红方 / 蓝方 / 中立 / 中立高 goal） | 桩 |
| 四个区域 | **红近 / 红远 / 蓝近 / 蓝远** | 象限、上象限、西·红近 |
| 围栏上的开关 | **toggle** | Toggle |

「近/远」相对**该联盟自己**说：红方近端在西 → 西=红近、南=红远、东=蓝近、北=蓝远
（`fieldSpec.QUADRANT_ALLIANCE_TAG`）。

词表放在 `data/terms.ts` 的原因：`state/scoring.ts` 要能被 `node tools/test_scoring.ts`
直接加载，那边**不能用别名 `'@/...'` 做运行时 import**。

## 场地事实（以官方 CAD 实测为准）

`tools/extract_field.py` → `public/assets/`（约 15 s；首次 `tools/build_cache.py` 约 8 min）。

| 产物 | 内容 |
|---|---|
| `field.json` | 9 个 goal、4 个 toggle、半体尺寸、socket、119 条开局位姿 |
| `goal_*.glb` | 4 种 goal，原点 = socket 轴，+Z 向上，**按 PRODUCT 拆多节点**（可分别上色） |
| `half_*.glb` | 翻边在原点、尖端朝 −Y；**一个半体 = 一个零件** |
| `field.glb` | 静态场地（地砖 / 围栏 / 胶带 / Loader / toggle / 角柱 / 联盟站墙），**不含得分物**。导出要带 `--with-wall-trim` |

**CAD 里的颜色全是 SolidWorks 默认值**（0.792/0.820/0.933），没有可用信息 → 颜色一律由
`scene/materials.ts` 的 `materialFor(name, goalColor)` 按零件名指派。

- **goal 位置**：598.06 / 1196.12 mm（**不是** 25 in 网格，比手册的 635/1270 小 82.6 mm；
  中场菱形半对角 611.49 vs 手册 635，goal 环半径 1337.3 vs 1420）。
  方位角与手册吻合到 1e-10°，是 CAD 布局本身偏紧。**当前取 CAD 值**；
  对计分无影响，对机器人走位有影响 → 待按实际场地裁定。
- **照片里中场菱形西北顶点的三色「风车」，这份 CAD 里没有对应零件**（CAD 侧在 500 mm 内搜过，
  只有中场高 goal、胶带、地砖和摆好的得分物）。要还原只能程序化画，或等更新版 CAD。
- **socket**：顶面圆孔 r=39.61 / 深 82.03，下方有**喉口 r=17.72**。
  → pin 尖端（Ø35.6）进喉口、翻边（Ø80.3）架在孔沿。
- **中立 goal 的黄纹**不是独立零件，是 Goal 子树里的 `SBT0832_276-5007-001` 角柱
  （联盟 goal 用 `276-5006-001`，跟 goal 同色）。
- **toggle** 零件 = `276-9250-023_GREY`，656.2 × 51.59 × 55.65，中心离地 331.6，
  在 (0, ±1817.04) 与 (±1817.04, 0)。场角那 4 个三色「风车」是别的零件。

## 得分物模型

- **pin = 翻边对翻边** → 线轴：两端 Ø35.6 尖端，腰是 Ø80.3 翻边，高 **165.0**。
- **cup = 杯口对杯口** → 沙漏：两端 Ø80.2 敞口宽沿，腰是 Ø59 细腰，高 **164.5**。
  （CAD 里 Clear 半在 −85 不旋转、Dark Gray 半在 +85 且绕 Z 转 180° → 两个杯口在中间接合。）
  **两种件拼法不同，别按同一种画。**
- 半体局部约定：翻边在原点、本体沿 −Y、尖端/杯口在 −height。
- **嵌套**（`scene/stackLayout.ts`）：
  - cup 放 pin → `cupBase = pinBase + 82.5`（cup 下沿坐在 pin 腰上；cup 下半的薄壁套筒罩住 pin 上半锥体）
  - pin 放 cup → `pinBase = cupBase + 82.0`（pin 腰坐在 cup 上沿上；pin 下半插进 cup 上半）
  - pin 放 goal → `pinBase = max(socket.z − 82.5, socket.z − socket.depth)`
  - 接触面留 `SEAT_EPS = 0.3 mm`（cup 下沿与 pin 腰几乎同径且共面，不留缝会闪 z-fighting）。
- **罩住关系**：cup 的**下半**罩住它下面那个 pin 的**上半**；cup 的**上半**罩住它上面那个
  pin 的**下半**。罩住的那一半透明 → 照常计分；灰色 → 不得分。

## 应用采用的规则

- 联盟色 pin 半 **5 分**，被拥有的黄色 pin 半 **10 分**；
  **每台位于中场的机器人 8 分**（赛局结束时在中场区域）；自动时段奖励 12 分。
- `<SC2>` pin 与 goal 嵌套、或与「一个已 placed 的 pin 啮合的 cup」嵌套，才算 placed。
- `<SC3>` pin 半嵌在**透明**杯半里、或**未被 cup 覆盖**时计分；被不透明（灰）杯挡住不得分。
- `<SC3> a/b/c` 按 **pin 半自身的颜色**判联盟（红→红方、蓝→蓝方、黄→拥有方）；
  **联盟 goal 的颜色不改变归属**。
- `<SC4>` toggle 只有 **红 / 蓝 / 黄** 三个有效朝向，没有第四个「中立」。
- `<SC5> a` 区域内的黄色 pin 归该区域 toggle 的颜色。
- `<SC5> b` 中场高 goal 里的黄色 pin 归**中场机器人数多的一方**（相等则都不拥有）
  → 左侧面板选中中场 goal 时有「中场机器人数量」计数器（`midfieldCounts`）。
  同一批机器人数还按**每台 8 分**计入总分（`scoreField` 的 `robotPoints`）。
  每方只有 2 台机器人 → 计数封顶在 2（`store.MAX_ROBOTS_PER_ALLIANCE`，`setMidfieldCounts` 里夹紧）。
- **摆放规则**（用户口径，非手册原文）：`goal → pin → cup → pin → cup …`
  —— pin 只能放 cup 上或直接放 goal 上，cup 只能放 pin 上；其它组合**直接拒绝**并弹提示
  （`scoring.ts` 的 `checkPlacement`）。
- **拆卸连坐**：得分物不能悬空，拆掉一个 → 它上面的 pin/cup 一并拆掉（`store.removeItem`）。
- **goal 也挡分**（本工具口径）：插在 goal 孔里的 pin 下半被 goal 挡住 → 不计分。
  由 `scoring.ts` 的 `GOAL_COVERS_PIN_LOWER` 控制（默认 `true`）。
  ⚠️ 官方手册图 SC5-1/2 相反（插在 goal 里的黄半标 +10），`<SC3>` 原文也只提 cup 不提 goal；
  要切回手册口径把那个常量改成 `false` 即可。

**规则改动只改 `src/state/scoring.ts`**，且每个判定都要留 `reason` 字符串（计分板上 hover 可见）。

## 交互约定

- **视角**：按钮名 = 镜头朝着的方向。默认 45° 和「正西」都**朝西看**（相机在东侧，
  画面左=南、右=北）；俯视保持北在上。
- **左栏一次只显示一样东西**：点 goal → 调色板；点 toggle → 那个 toggle 的红/蓝/黄。
  右栏只有「实时计分 + 规则说明」。
- **调色板 = 4 种 pin + 正反 2 个 cup**（`CUP_VARIANTS`）。cup 的朝向决定用哪一半罩住谁，
  所以是两个独立选项，**不受「翻转 pin」开关影响**（那个开关只对调 pin 的上下两半）。
- **两种放法**：左边的得分物可以**拖**到场上任意 goal；也可以先点中一个 goal
  （3D 里高亮：地面双环 + 一柱光 + **摞顶的落点环**），再**单击**左边的得分物 →
  直接落在它上面（走 `store.placeItem`，同样守叠放规则，非法会被拒绝并弹提示）。
- **选中的 goal 要一眼看得出来**：CAD 路径下 goal 的材质是不变的（只有程序化兜底能改 emissive），
  所以高亮靠 `Goals.tsx` 里叠加的环和光柱。
- **区域染色**：每个区域按它那个 toggle 的状态染色，边界用真实几何
  （外角 ±1804 → 胶带臂内端 ±299 → 中场菱形顶点 ±598），不盖胶带。
  围栏上那 4 根条也按状态上色。
  **中场（中心的菱形）也染色**：颜色 = 谁拥有中场（按机器人数），平局=没人拥有=黄色。
- **删除手势**：拖动已放好的件 → 画布四周红光（越靠边越亮）+ 最近的边弹出红色垃圾桶，
  丢进去即删。强度用 CSS 变量直写 DOM，**不进 React state**。
  「边缘」以**画布**（`.stage`）为基准，不是窗口（窗口左右有面板，会把窗口边缘盖住）。
- 拖面板里**新**件是放置手势，不出现红光。

## 硬约定（照做就行，别改回去）

- **坐标系**：场地 X 东 / Y 北 / Z 上，原点 = 场地中心，毫米。three.js 是 Y-up，
  换算 `toThree(x, y, z) = [x, z, −y]`（绕 X 轴 −90°）。
  - **`toThree()` 必须取满三个分量**：只取前两个会静默丢掉南北方向。
  - **别写 (X, Z, Y)** —— 那样会左右镜像。
- **CAD 的 glb 全在同一个归一化系**（x=东 / y=北 / z=上，原点在垫子平面），几何已烘好、
  节点矩阵是单位阵 → 前端统一施加 `CAD_TO_THREE` 即可，不用按文件猜坐标系。
- **相机 `near` 必须是 50**（near=1 时 5000 mm 处深度精度约 1.6 mm，胶带会和地垫 z-fighting）。
- **`frameloop="demand"` 下异步载入的几何不会自动出帧** → `assets.ts` 的 hook 在 setState
  之后必须 `sceneBridge.invalidate?.()`。
- **指针坐标放普通对象**（`state/drag.ts`），**不要**进 React state。
- **three.js 的 `Object3D` 只能有一个父节点**：同一个 glb 的 root 被 9 个 goal 共用时，
  每个实例要 `clone(true)` 一份。`clone(true)` 复制的是**材质引用** —— 要换材质得改
  **clone 上的 mesh**，改 root 不影响已建好的 clone。
- **R3F v9 只把带事件处理的对象放进射线列表** → CAD 里没有 handler 的零件（toggle、围栏…）
  点不着，要自己加隐形代理（`scene/ToggleHandles.tsx` 就是这么做的）。
- **`OrbitControls` 有阻尼**：脚本里挪相机要同时改 `sceneBridge.controls.target` 并 `update()`。
- 静态场地合成 1 个 mesh；`frameloop="demand"`；画质档位「高/中/低」（或 `?quality=low`）。
