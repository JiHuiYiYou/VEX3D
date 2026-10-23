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

**CAD 资产（`public/assets/`，17 MB）已经入库** → clone 下来直接 `npm install && npm run dev`
就能跑，**不用**装 `cadquery-ocp`、不用下 126 MB 的 STEP、不用等 8 分钟的缓存。
要重新生成才需要那套管线（见下）。

**发布**（GitHub Pages）：推 main → `.github/workflows/deploy.yml` 自动构建并发布到
https://jihuiyiyou.github.io/VEX3D/ 。仓库挂在 `/VEX3D/` 子路径下，所以
`vite.config.ts` 用 `base: './'`（相对路径）—— 同一份 `dist/` 换到任何路径都能跑。
验证**发布产物**：`tools/verify_ui.py --url "http://127.0.0.1:8000/VEX3D/?quality=low&debug=1"`
（同一套 61 条断言跑在生产构建上；`?debug=1` 才会把 `__vex3d` / `__bridge` 挂到 window，
平时不开 —— 见 `src/devTools.ts`）。

## 摆场预设（官方开局布局）

顶栏「摆场」= 重置 + 灌一份预设：一键把场地摆成**官方开局布局**。

- **数据**在 `src/data/presets.ts`，由 `tools/extract_setup.py` 从**官方 Field CAD**
  导出的 `public/assets/field.json` → `startObjects` 转出来（CAD 里那 63 根 pin +
  56 个 cup 的开局摆法 ✓）。
- **对账**：这份摆法跟官方 **VEXcode VR Playground** 的两处公开资料逐项吻合 ——
  ① GPS 坐标表的 20 个 pin/cup 落位，每个都有东西（最大偏差 **5.5 mm**）；
  ② 得分物清单：场上 37 根 pin + 36 个 cup，红蓝装填区 26 根 pin + 20 个 cup，
  配色数量（红黄 20 / 蓝黄 20 / 黄黄 19 / 红蓝 4）与 cup 朝向（场上 24 个灰在上、
  12 个透明在上）全部一致 ✓。脚本每次都会校验，对不上直接报错退出 ✓。
  手册俯视示意图（`study/VEX/image/2D俯视示意图.png` = FO-2）跟它是同一份布局 ✓
  （图里 4 个「风车」= 4 组各 4 根**侧躺**的 pin ✓）。
- **内容**：4 个中立 goal + 中场 goal 各一根黄/黄 pin（4 个联盟 goal 空着）；
  场上 16 个落位各一组 cup + 插在 cup 里的 pin；四面墙各 2 组 (cup, pin, cup)；
  4 个斜角落位周围各躺着 4 根 pin；红/蓝装填区各 10 组 (cup + pin) + 2 根预装 ——
  共 114 个散件 ✓。
- **散件**（`store.loose` / `LooseItem`）是**新概念**：场上不在 goal 里的得分物。
  它们**不参与计分**（手册只算 goal 里的 pin 和中场的机器人）。
- **散件能拖能删**：拖到画布边缘 → 垃圾桶删掉；拖到某个 goal 上 → 进那个 goal 的摞
  （非法组合照常拒绝）；拖到别处 → 挪位置。
- **散件也能「端起来」**：单击场上的散件 = 把它端起来（`store.pending`，`looseId` 记着它是谁），
  接着点一个 goal 就放进去（放进去后它从散件列表里删掉）；再点一次这个散件 = 放下。
- **散件的三种形态**（`LooseItem`）：
  | 形态 | 字段 | 落点 |
  |---|---|---|
  | 站在垫子上 | — | 底端 0 |
  | 插在 cup 里 | `nested: true` | 底端 = cup 底 + `NEST_ON_CUP`（针尖探进 cup 的腰） |
  | 侧躺着 | `axis: [x,y,z]`（场地系，下半→上半） | `restingBaseY()` 按轴向算，落在垫子上 |
- 摆场后自动切到 `setup` 视角（俯视拉远到 6600 mm，红/蓝装填区也进得来）。

## 目录

```
fieldcad/            官方场地 CAD（126 MB STEP，AP214，毫米）——源文件，不入库
public/assets/       CAD 管线产物（不入库）
tools/               离线 Python 管线（OCP）+ 验证脚本（extract_field / verify_ui / shot_*）
  perf_ui.py         ★ 性能基线（Playwright 量 draw call / 三角形 / 帧时间 / 交互延迟）
  decimate.py        QEM 边塌缩减面（半体几何，误差预算 0.05 mm）
src/
  data/terms.ts      ★ 统一词表（颜色 / 区域名 / 零件名），**不 import 任何东西**
  data/fieldSpec.ts  场地规格 + 坐标系换算 + CAD 实测常量
  state/scoring.ts   ★ 计分引擎（全部规则逻辑都在这一个文件里）
  state/store.ts     zustand store
  state/drag.ts      拖拽指针状态（放在 React 之外，避免每帧重渲染）
  scene/stackLayout.ts ★ 堆叠几何：半体摆放 + 嵌套落点（3D / 幽灵件 / 测试共用）
  scene/fieldLook.ts  ★ 场地「长相」：配色表 / 垫子贴图 / 环境贴图 / 围栏条纹
  scene/LooseItems.tsx  场上不在 goal 里的得分物（散件）
  data/presets.ts      ★ 官方开局布局（摆场预设，由 tools/extract_setup.py 生成）
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

### ★ 场地的几何只有 CAD 一份来源（2026-10 改）

- **没有程序化兜底**：手搓的场地/胶带/围栏/goal/半体几何已经全部删掉
  （`scene/geometry.ts`、`scene/Field.tsx`、`scene/Toggles.tsx`）。
  少一个 CAD 资产 → app **启动时整屏报错**并给出生成命令，不画一个「像但不是」的场地 ✓。
  （转换出来的资产 `public/assets/` **是入库的** —— 这样 clone 下来就能跑、
  Pages 能直接发版；管线本身仍然是唯一来源，改了管线要重新生成并一起提交。）
- `fieldSpec.ts` 里只剩**实测常量**（半体尺寸、goal 位置、pin/cup 高度）；
  运行期的 goal 规格一律取 `field.json`（`loadFieldSpec()` 会顺手把 JSON 里的 goal
  写回 `GOAL_BY_ID`，并检查和常量差了多少毫米）。
- **`bakeRoot()` 只能调用一次**（已加 `userData.baked` 保护）：
  glb 的 root 是**共享**的，而 React StrictMode 在 dev 下会把 effect 跑两遍 ——
  转第二次就会**再转一次 -90°**，整块场地躺下，完整性检查判定「没有地面垫」，
  于是悄悄退回手搓场地（这个坑真的踩过）。改导出逻辑时注意这一点 ✓。

| 产物 | 内容 |
|---|---|
| `field.json` | 9 个 goal、4 个 toggle、半体尺寸、socket、**119 条开局位姿**（= 官方摆法 ✓） |
| `goal_*.glb` | 4 种 goal，原点 = socket 轴，+Z 向上，**按 PRODUCT 拆多节点**（可分别上色） |
| `half_*.glb` | 翻边在原点、尖端朝 −Y；**一个半体 = 一个零件** |
| `field.glb` | 静态场地（地砖 / 围栏 / 胶带 / Loader / toggle / 角柱 / 联盟站墙），**不含得分物**。导出要带 `--with-wall-trim` |

**CAD 里的颜色全是 SolidWorks 默认值**（0.792/0.820/0.933），没有可用信息 → 颜色一律由
`scene/materials.ts` 的 `materialFor(name, goalColor)` 按零件名指派。

### 场地「长相」层（`scene/fieldLook.ts`）

CAD 导出的 glb **既没有材质也没有 UV** → 颜色、贴图、光照全靠前端这一层：

| 东西 | 怎么做 |
|---|---|
| 垫子贴图 | `makeMatTexture()` 程序生成 canvas 贴图（底色 + 中心冷 / 外圈暖的分层 + 竞技场大圆 + 角弧 + 颗粒）；**UV 是前端补的**（`planarUV()` 按 x/z 平面投影，CAD 没给 UV） |
| 围栏顶压条 | `stripedMaterial(axis)` —— 用 `onBeforeCompile` 在片元着色器里按**世界坐标**画黑白条纹（CAD 没 UV 也没法贴图）；长边方向由包围盒判断（`dx >= dz ? 'x' : 'z'`） |
| 围栏 / 角柱 / 胶带 / 联盟站墙 | 按零件名在 `materialFor()` 里指派（`LOOK` 配色表） |
| 环境光照 | `buildEnvironment(renderer)` → PMREM 环境贴图（一个自建的小场景：天穹 + 太阳 + 冷色反弹）；`scene.environmentIntensity = 1.15` |
| 背景 / 舞台 | `makeSkyTexture()` 贴一个 r=15000 的穹顶；`makeApronTexture()` 给围栏外一圈「舞台」地面 |
| 灯光 | 暖主光（投影）+ 冷补光 + 暖轮廓光，**环境光压到 0.24** —— 亮度主要来自环境贴图，画面才有明暗和冷暖，不是均匀的灰 |

⚠️ 这一层只管**长什么样**，不改几何 —— 形状永远只有官方 CAD 那一份 ✓。
新增零件时：先在 `field.glb` 里查它的 PRODUCT 名，再在 `materialFor()` 里加一条。

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
- **CAD 里那 63 根 pin + 56 个 cup 就是官方开局摆法**（不是「摆货」状态）：
  场上 37 pin + 36 cup、装填区 26 pin + 20 cup —— 跟官方 VEXcode VR Playground 的
  得分物清单逐项一致 ✓；20 个落位跟它的 GPS 坐标表差 ≤ 5.5 mm ✓。
  `startObjects` 里每条 = `{kind, halves[下,上], position[x,y,底高], axis}` ✓
  （`halves` 的上下按**物理高度**排，靠导出矩阵算的，不靠 CAD 装配树顺序 ✗；
  `axis` = 下半→上半的轴向，侧躺的 16 根靠它画 ✓）。
- **toggle 位置**：CAD 1817.04 vs 官方 VR 表 1780（差 37 mm）→ 摆场以 CAD 为准 ✓
  （app 的 3D 就是 CAD 画的 ✓）。

## 得分物模型

- **pin = 翻边对翻边** → 线轴：两端 Ø35.6 尖端，腰是 Ø80.3 翻边，高 **165.0**。
- **cup = 杯口对杯口** → 沙漏：两端 Ø80.2 敞口宽沿，腰是 Ø59 细腰，高 **164.5**。
  （CAD 里 Clear 半在 −85 不旋转、Dark Gray 半在 +85 且绕 Z 转 180° → 两个杯口在中间接合。）
  **两种件拼法不同，别按同一种画。**
- 半体局部约定：翻边在原点、本体沿 −Y、尖端/杯口在 −height。
- **半体几何按颜色共用一份**（`assets.ts` 的 `halfGeoCache`）：`bake()` 是**克隆**几何的，
  不缓存的话每个 `HalfMesh` 组件都拿一份自己的拷贝（摆场一次 = 114 散件 × 2 半体 = 228 份），
  几百个 GPU buffer 传上去，换个选中态就卡十几秒 ✗。R3F 不会 dispose 作为 prop 传的几何 ✓。
- **哪个半体在上**：pin 的**领口**（翻边）相接、cup 的**细腰**相接 →
  pin 的下半 = 领口高的那个，cup 的下半 = 杯口低的那个 ✓（`tools/extract_field.py`
  里用导出矩阵算 ✗ 别用 CAD 装配树的顺序 ✗）。
- **侧躺**：官方摆法里有 16 根 pin 侧躺（4 个斜角落位各 4 根，躺成手册图里的「风车」✓），
  轴向与水平面差 15°，一头着地。渲染用 `axis` + `restingBaseY()` ✓。
- **嵌套**（`scene/stackLayout.ts`）：
  - cup 放 pin → `cupBase = pinBase + 82.5`（cup 下沿坐在 pin 腰上；cup 下半的薄壁套筒罩住 pin 上半锥体）
  - pin 放 cup → `pinBase = cupBase + 82.0`（pin 腰坐在 cup 上沿上；pin 下半插进 cup 上半）
  - pin 放 goal → `pinBase = max(socket.z − 82.5, socket.z − socket.depth)`
  - 接触面留 `SEAT_EPS = 0.3 mm`（cup 下沿与 pin 腰几乎同径且共面，不留缝会闪 z-fighting）。
- **罩住关系**：cup 的**下半**罩住它下面那个 pin 的**上半**；cup 的**上半**罩住它上面那个
  pin 的**下半**。罩住的那一半透明 → 照常计分；灰色 → 不得分。

## 性能（2026-10 优化）

摆场之后是**最重的场景**：114 个散件 + 5 个 goal 的摞 = 455 个 mesh。
量法：`C:/Users/liuzhen/miniconda3/python.exe tools/perf_ui.py`（要 dev server 起着）。

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 材质实例（去重） | 437 | **44** |
| shader program | 17 | **9** |
| 每帧 draw call | 917 | **418** |
| 每帧三角形 | 7.53 M | **0.98 M** |
| 一次交互的纯 JS 开销（GL 摘掉后） | 24–201 ms | **4–5 ms** |
| 一帧的墙钟（无头软件渲染） | ~8.8 s | **~13 ms** |

> 无头环境是 SwiftShader 软件渲染，数字比真机 GPU 慢一到两个数量级 ——
> 这里的数字只用于 **before/after 对比**。

改了什么（都是「不改观感」的前提下）：

- ★ **半体几何做了 QEM 减面**（`tools/decimate.py`，误差预算 **0.05 mm**）。
  CAD 里 pin 半体有 742 个面（模出来的圆角/凸字/筋），OCCT 逐面三角化 →
  一个半体 9000~12000 个三角形。**调 deflection 没用**（0.3 → 2.0 mm 只省 13%，
  三角形数是面数决定的）。减面后观感对比过，近景看不出差别 ✓。
  场地本体（地砖/围栏/胶带）**没减**（`SIMPLIFY["field"] = None`）—— 那些面看得见。
- ★ **不能用 `transmission`**：场景里只要有一个 `transmission > 0` 的材质，
  three.js 每帧就把整个场景**额外渲染一遍**（transmission backdrop pass）
  → draw call 直接翻倍（968 ≈ 455 × 2）。透明杯改用「普通透明 + clearcoat +
  环境反射」，看起来一样是玻璃的，只是没有折射 ✓。
  透明 + 双面的材质还要加 `forceSinglePass: true`，否则 three.js 默认画两遍。
- **材质按「规格」共享**（`scene/materials.ts` 的 `shared()`）——CAD 里同一个 PRODUCT
  会导出成很多节点（`_1` `_2` …），之前每调一次 `materialFor()` 就 new 一份。
  ⚠️ 共享的代价：**不能再单独改某个 mesh 的材质属性**（会串到所有同类的件上）。
- **半体几何按颜色共用一份**（`scene/assets.ts` 的 `halfGeoCache`）——
  `bake()` 是克隆几何的，不缓存的话 228 个半体各有各的拷贝。
- **散件按 id 逐个订阅 + `React.memo`**（`scene/LooseItems.tsx`）：
  以前任何一次 store 变化都让 114 个散件整批重渲染（456 次半体渲染 → 0 次）。
- **隐形拾取体不渲染**：`opacity: 0` 的点击热区 / 放置目标 / 碰撞体改成
  `visible={false}` —— **three.js 的 Raycaster 不看 `visible`**，照样点得中、拖得动 ✓。
- **9 个 goal 是 `memo` 的**（`scene/Goals.tsx`）：`Goals` 订阅了 7 个 store 切片，
  任一个变都会重算 9 个 goal 的 props → memo 之后只有**真变了的那几个**会重渲染。
  ⚠️ 空栈要用模块级的 `EMPTY_STACK`（`stacks[id] ?? []` 每次都造新数组 → memo 白做）。

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
- **三种放法**（都守同一套叠放规则，非法一律拒绝 + 弹提示）：
  1. **拖**：左边的得分物拖到场上的任意 goal；场上的散件也能拖进 goal 的摞。
  2. **先选 goal 再选件**：先点中一个 goal（3D 里高亮：地面双环 + 一柱光 + **摞顶的落点环**），
     再**单击**左边的得分物 → 直接落在它上面。
  3. **先选件再选 goal**（`store.pending`，「端着」）：**单击**一个得分物 = 把它端起来
     （面板里那个件会高亮，左边出现提示），接着点场上的一个 goal → 放上去。
     合法落点的 goal 会亮**绿环**（`Goals.tsx` 的 `pendingOk`），不用拖也知道能放哪。
     非法会拒绝并弹提示，件还端着（可以换个 goal 再点）。
     点空白处 / 按 Esc = 把手里的件放下（取消）。
- ★ **「端着」的件有两种来源**：左侧面板的件、**场上的散件**（摆场摆出来的那些也一样）——
  单击场上的散件 = 把它端起来（再点一次 = 放下），跟面板上的件完全一样。
- ★ **点 goal 的第一反应是「放上去」，不是「选中 goal」**（`store.placePending`）：
  手里端着东西时，点 goal（**包括摞上那几件**）→ 把它叠在摞顶；goal 上已经有东西也一样放。
  只有**没端着东西**时，点 goal 才是「选中它」。
  摞里的件**不端起来**（点它只是选中它和它所在的 goal；要挪位置请拖）。
- **「端着」的件**（`store.pending`）：`{item, variantId?, looseId?}`
  · `variantId` = 来自左侧面板（面板的「翻转 pin」开关会跟着重建手里那个件）
  · `looseId` = 来自场上的散件（放上 goal 之后它从散件列表里删掉）
  · 一次成功的 `placeItem` 会清掉它；被拆掉的件也会把手里的清空
- **选中的 goal 要一眼看得出来**：CAD 路径下 goal 的材质是不变的（没有程序化几何可改 emissive），
  所以高亮靠 `Goals.tsx` 里叠加的环和光柱。
- **区域染色**：每个区域按它那个 toggle 的状态染色，边界用真实几何
  （外角 ±1804 → 胶带臂内端 ±299 → 中场菱形顶点 ±598），不盖胶带。
  围栏上那 4 根条也按状态上色。
  **中场（中心的菱形）也染色**：颜色 = 谁拥有中场（按机器人数），平局=没人拥有=黄色。
- **删除手势**：拖动已放好的件 → 画布四周红光（越靠边越亮）+ 最近的边弹出红色垃圾桶，
  丢进去即删。强度用 CSS 变量直写 DOM，**不进 React state**。
  「边缘」以**画布**（`.stage`）为基准，不是窗口（窗口左右有面板，会把窗口边缘盖住）。
- 拖面板里**新**件是放置手势，不出现红光。
- ★ **点击 ≠ 拖动**（`dragPointer.moved`，阈值 4 px）：
  - **点击**（指针没挪过）→ 只选中，**什么都不改**（不挪位置、不放上 goal、不删）。
    少了这个判断：单击一个散件会被当成「丢到地面」，而落点是用射线打 y=0 平面算的
    —— 斜视角下偏差能到好几米，件会飞到天边，看起来像凭空消失 ✗
  - **拖动**（挪过了）→ 才挪位置 / 放上 goal / 丢进垃圾桶。
  - 幽灵件的投影平面必须和松手时的落点**用同一个**（都是 y=0），否则件会「跳」一下。
  - 拖拽开始时要把 `overTrash` 清零 —— 否则上一次停在垃圾桶边的状态会连累下一次点击。

## UI 约定（`src/styles.css`）

- **一套冷灰蓝表面**：底色 / 面板 / 描边都从 `--bg → --panel-3` 一条线上来；
  阴影一律染成底色相（`--shadow-sm/md/lg`），别用纯黑 rgba。
- **只有一个强调色** `--accent`（青）：选中、焦点、可点的东西。
  红/蓝/黄只出现在**语义位置**（得分物颜色、分数、toggle 状态），别拿它们当装饰色。
- **字体**：拉丁字母和数字用 Outfit（Google Fonts；离线自动回落系统字体，不影响使用），
  中文回落系统黑体。数字一律 `font-variant-numeric: tabular-nums`。
- **每个可交互元素都要有** hover、`:active`（压下 1px）、`:focus-visible`（2px 青色焦点环）——
  焦点环是硬要求（键盘可达性），别删。
- 深色界面的层次靠两样东西：**面板顶部一道极淡高光**（`.panel::before`）+ **全局细颗粒**
  （`.app::after` 的 SVG 噪点）—— 别再靠堆边框制造层次。
- 视角 / 画质用 `.view-group` 的「轨道 + 药丸」分段控件样式，不是普通按钮。
- 提示统一用「!」小圆徽标（`.place-hint-icon` / `.warn-dot`），**别用 ⚠ emoji**（各平台长得不一样）。

## 硬约定（照做就行，别改回去）

- **别用 `transmission`**：场景里只要有一个 `transmission > 0` 的材质，three.js 每帧就把
  整个场景**额外渲染一遍** → draw call 翻倍。透明件用「普通 transparent + clearcoat +
  环境反射」，双面透明还要加 `forceSinglePass: true`（否则默认画两遍）。
- **材质一律共享**（`scene/materials.ts` 的 `shared()` / `halfMaterial()`）：
  摆场后 455 个 mesh，共享前是 437 份材质。
  ⚠️ 共享的代价：不能再单独改某个 mesh 的材质属性（会串到所有同类的件上）。
- **别用 React state 订阅「拖拽中」**（`useApp((s) => s.dragging)`）：
  订阅它 = `App` 重渲染 → `<Canvas>` 重渲染 → R3F 的**整棵树**重渲染
  （一次拖拽开始 80 ms，每个 3D 组件都白渲染一遍）。
  要知道拖拽态，就 `useApp.subscribe()`（不进 React）或者在场景里用
  **叶子组件**自己订阅（`FieldScene.tsx` 的 `Controls` 就是这么写的 ✓）。
- **别在 `map` 出来的列表里插条件子节点**：`{cond && <X/>}` 会在 children 数组里留一个
  `false` **空洞** → React 只能走慢路径 → 匹配不上没 key 的兄弟 → **每次重渲染都把整份列表
  重挂一遍**（几百个新 mesh + 新材质，卡十几秒，而且旧 mesh 会漏在场景里）。
  条件渲染要么放到列表**外面**，要么拆成**独立组件**自己订阅状态
  （`LooseItems.tsx` 的 `LooseSelectionRing` 就是这么写的 ✓）。
- **资产下载要能重试**（`scene/assets.ts` 的 `loadGlb`）：`field.glb` 有 8.5 MB，
  弱网（比赛现场的 wifi！）传到一半断了是常事 → 断了要**重试**（现在 3 次），
  而且**失败不能留在缓存里**（否则一次抖动 = 整个会话都出不来那张报错页）。
  报错页上有「重新加载」按钮 ✓。
  - 探测文件大小用 `?__size=1` 的**独立 URL** + `cache: 'no-store'`：
    CDN（GitHub Pages）支持 Range，`bytes=0-0` 会回 **206 + 1 字节**，
    浏览器可能把这个 206 缓存下来，把紧接着的整取请求变成「只拿到 1 字节」✗。
  - 本地复现：`tools/serve_range.py 8014 dist --flaky=1`（真支持 Range + 会掐断下载）。
- **Service worker 只在生产构建注册**（`src/main.tsx`）：dev 下注册会把开发中的代码
  缓存住 —— 改一行代码刷新了还是旧的 ✗。改了 `public/sw.js` 的策略要**把 `CACHE`
  的版本号 +1**，否则老用户拿到的还是旧缓存。
  缓存的坑（都踩过）：
  - 存进 Cache API 之前要**去掉 `content-length` / `content-encoding`** ——
    浏览器给的 body 是解压后的，长度对不上，Cache API 会直接拒绝写入 ✗
  - **第一次访问时 SW 还没接管**，那次导航不会被拦截 → 外壳不会进缓存 →
    断网后打不开。所以页面要在 SW active 之后把「自己用到的 URL」postMessage 给它
    去缓存（`main.tsx` 的 precache 交接）✓
  - app 启动前的 11 个 **HEAD** 探针要**从缓存里答**（`checkAssets`），
    否则离线时会被判成「缺资产」✗
  - 回归测试：`tools/verify_offline.py`（真的断网重开，6 项断言）
- **坐标系**：场地 X 东 / Y 北 / Z 上，原点 = 场地中心，毫米。three.js 是 Y-up，
  换算 `toThree(x, y, z) = [x, z, −y]`（绕 X 轴 −90°）。
  - **`toThree()` 必须取满三个分量**：只取前两个会静默丢掉南北方向。
  - **别写 (X, Z, Y)** —— 那样会左右镜像。
- **CAD 的 glb 全在同一个归一化系**（x=东 / y=北 / z=上，原点在垫子平面），几何已烘好、
  节点矩阵是单位阵 → 前端统一施加 `CAD_TO_THREE` 即可，不用按文件猜坐标系。
- **不要给场地加程序化兜底**：CAD 资产缺失 = 报错退出，不是画个「差不多的」场地。
  手搓的几何跟官方 CAD 一定会漂（位置、尺寸、颜色全对不上），画出来反而误导人。
- **`bakeRoot()` 对同一个 root 只能调一次**：它会把变换烘进几何（原地改），
  第二次调用 = 再转一次 -90°。glb 的 root 是共享的 + StrictMode 会跑两遍 effect → 必须幂等
  （已用 `userData.baked` 保护）✓。
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
- 静态场地合成 1 个 mesh；`frameloop="demand"`；画质档位「高/中/低」，**默认「中」**
  （`?quality=low|medium|high` 可覆盖）。阴影用 `shadows="percentage"`（PCF）——
  three 0.186 里 `PCFSoftShadowMap` 已经没了，用 `true` 会被降级并打警告。
