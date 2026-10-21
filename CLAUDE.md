# CLAUDE.md — VEX3D

VEX V5 **Override**（2026-2027 赛季）3D 战术分析演示器。

## 这是什么

一个浏览器里的 3D 场地分析工具：摆弄 Pin / Cup、算分、看 Toggle 归属。

- 场地尺寸 12 ft × 12 ft，坐标**原点 = 场地中心，X = 东，Y = 北，Z = 上**，单位 **毫米**。
- 9 个 Goal（4 中立矮桩 5.8″、1 中立高桩 8.7″ 在中场、2 红方桩 + 2 蓝方桩 3.25″）。
- 4 个象限，每象限 **1 个联盟桩 + 1 个中立桩 + 1 个 Toggle**。
  象限用**场地方向**命名（不是画面上下左右，因为默认视角是朝西看的）：
  **西 = 红近、南 = 红远、东 = 蓝近、北 = 蓝远。**
  内部 id 仍是 `left/bottom/right/top`（= 西/南/东/北）。
- 4 个 Toggle 贴在**围栏每条边的中点**。
- 63 个 Pin（红蓝 4 / 红黄 20 / 蓝黄 20 / 黄黄 19）、56 个 Cup（透明半 + 灰半）。

## 运行

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # 产物在 dist/
npm run preview
npm test           # 计分引擎回归测试（node 直接跑 TS）
```

端到端验证（无头 Chromium + WebGL，产出截图到 `tools/shots/`）：

```bash
C:/Users/liuzhen/miniconda3/python.exe tools/verify_ui.py
```

> 需要先 `npm run dev` 起服务。Python 用 miniconda3 的那个（自带 playwright）；
> `python` 在 PATH 上指向 MSYS2 的那个，没有 playwright。

## CAD 资产现状

`tools/extract_field.py` 产出到 `public/assets/`（不入库）。管线约 15 s（已缓存 STEP 解析结果；
首次要 `tools/build_cache.py` 约 8 min）。

| 文件 | 状态 | 说明 |
|---|---|---|
| `field.json` | ✅ | **9 个 Goal**、4 个 Toggle、半体尺寸、socket、63 Pin + 56 Cup 的开局位姿 |
| `goal_neutral-tall/short.glb` | ✅ | 原点 = socket 轴，+Z 向上，Z 0…222.7 / 0…146.5，**按 PRODUCT 拆成多个节点**（可分别上色） |
| `goal_alliance-red/blue.glb` | ✅ | Z 0…82.6，同样拆成多节点 |
| `half_red/blue/yellow/clear/gray.glb` | ✅ | 翻边在原点，尖端朝 **-Y**；**一个半体 = 一个零件**（不是复合体） |
| `field.glb` | ✅ | 用 `--with-wall-trim` 导出才有完整围挡：地面垫 `276-6904-001`（36 块 618.06 mm 地砖）、4 面围栏 `276-9250-120_*`、围栏底边条 `276-7596-350_*/351_*`、3 组胶带、4 个 Loader、4 个 Toggle、角柱 `276-7596-316/317_Corner`、联盟站墙。**不含**任何得分物。 |

**CAD 几何的颜色全是 SolidWorks 默认值**（0.792/0.820/0.933），没有可用信息 →
颜色一律由 `src/scene/materials.ts` 的 `materialFor(name, goalColor)` 按零件名指派。

### ⚠️ 一个待用户裁定的分歧：桩位

- **CAD 实测**：桩在 **598.06 / 1196.12 mm**（23.545 in / 47.09 in），比 25 in 网格**小 82.6 mm**；
  中场菱形半对角 611.49 mm（手册 635 mm），Goal 环半径 1337.3 mm（手册 1420 mm）。
  管线已验证**方位角与手册吻合到 1e-10°**、9 个桩的角色（中立/红/蓝/中场）也都落在手册对应的格位上，
  所以**变换是对的**，是 CAD 布局本身比「25 in 网格」紧 ~5%。
- **现场照片反解**：桩在 **635 / 1270 mm**（正好 25 in / 50 in）。
- 手册正文没有桩位数字（Appendix A 是图片），无法用文字仲裁。
- **当前取 CAD 值**（应用是「CAD 驱动」的）。对**计分/象限归属毫无影响**，
  但对**机器人走位**有 3.25 in 的差别 —— 需要用户按自己实际场地裁定。

### 中立桩的黄色花纹

CAD 里**没有独立的黄色零件**。中立桩上的黄纹其实是 Goal 子树里的
`SBT0832_276-5007-001` 角柱（联盟桩用 `SBT0832_276-5006-001`，跟桩同色）。
`materials.ts` 里 `276-5007-001` → 黄色，`276-5006-001` → 桩色。

### Toggle

CAD 已确认：零件是 `276-9250-023_GREY`，**长 656.2 mm**、宽 51.59、高 55.65，
中心离地 331.6 mm，位于 (0, ±1817.04) 与 (±1817.04, 0) —— **每条围栏边中点一个**，
与手册的 25.8 in 吻合 ✓。场角那 4 个三色「风车」是**另一个零件**，不是 Toggle。

## 几何（以官方 CAD 实测为准，`public/assets/field.json`）

- 9 个 Goal 的桩位 **不是** 25 in 整数网格，而是 598.06 / 1196.12 mm（23.545 in / 47.09 in）。
- Goal 高度：222.73 / 146.53 / 82.59 mm（手册 222.7 / 146.5 / 82.5，误差 < 0.1 mm）。
- **Goal socket**：顶面圆孔 半径 39.61 / 深 82.03 mm，孔口下方有 **喉口 半径 17.72 mm**。
  → Pin 的尖端（Ø35.6）落进喉口、翻边（Ø80.3）架在孔沿；Cup（Ø80.2）整个坐进孔口。
- **半体**：Pin 半 87.5 mm 高（Ø35.6→Ø59.6 锥体 + Ø80.3 翻边）；Cup 半 86.0 mm 高。
- **两种件的拼法不一样（CAD 装配树实测，别搞混）**：
  - **Pin = 翻边对翻边** → **线轴**：两个尖端朝外，腰（Ø80.3 翻边）在中间，高 **165.0**。
  - **Cup = 杯口对杯口** → **沙漏**：两端都是敞口宽沿（Ø80.2），中间是 Ø59 的细腰，高 **164.5**。
    （CAD 里 Cup 的 Clear 半在 −85 不旋转、Dark Gray 半在 +85 且绕 Z 转 180° → 两个杯口在中间接合。）
- **嵌套（决定了摞的高度和计分）**：
  - **Cup 放在 Pin 上**：Cup 的下沿坐在 Pin 的腰上 → `cupBase = pinBase + 82.5`；
    Cup 的**下半**（薄壁套筒）罩住 Pin 的**上半**锥体，Pin 的上尖端正好探进 Cup 的腰（杯口）。
  - **Pin 放在 Cup 上**：Pin 的腰坐在 Cup 的上沿上 → `pinBase = cupBase + 82.0`；
    Pin 的**下半**锥体插进 Cup 的**上半**。
  - **Pin 直接放在 Goal 上**：`pinBase = max(socket.z − 82.5, socket.z − socket.depth)`（腰架在孔沿、尖端进喉口）。
  - 接触面留 **0.3 mm** 的缝（`SEAT_EPS`）：Cup 的下沿和 Pin 的腰几乎同径且共面，不留缝会闪 z-fighting。
  - 落点计算在 `src/scene/stackLayout.ts`（3D 渲染、拖拽幽灵、端到端脚本共用一份）。
- **半体的局部约定**（CAD 导出与程序化几何一致）：翻边在原点，尖端在 **-Y**。
  摆放时「尖端朝下」= 旋转 0、位置 baseY+h；「尖端朝上」= 绕 X 轴 180°、位置 baseY+h−overlap。
  **Cup 的两半要反过来拼**（口对口），见 `stackLayout.ts` 的 `halfTransform`。

## 统一话术（全 app 只用这一套）

| 概念 | 叫法 | 别再叫 |
|---|---|---|
| 得分物 | **pin** / **cup** | 端子、半体（UI 里） |
| pin 的两半 | **pin 上半 / pin 下半** | 端子 |
| 场上的 9 个桩 | **goal**（红方 goal / 蓝方 goal / 中立 goal / 中立高 goal） | 桩 |
| 四个区域 | **红近 / 红远 / 蓝近 / 蓝远** | 象限、上象限、西·红近 |
| 围栏上的开关 | **toggle** | Toggle（大小写随意，但别跟中文混） |

- 词表放在 **`src/data/terms.ts`**（不 import 任何东西）——
  因为 `src/state/scoring.ts` 要能被 `node tools/test_scoring.ts` 直接加载，
  那边不能用别名 `'@/...'` 运行时 import。`fieldSpec.ts` 再把它 re-export 出去。
- 区域的「近/远」是相对**该联盟自己**说的：红方的近端在西侧 → 西=红近、南=红远、
  东=蓝近、北=蓝远。`QUADRANT_ALLIANCE_TAG` 就是这张表。

## 视角约定

- **按钮名 = 镜头朝着的方向**（不是镜头站在哪一边）。
- 默认视角（45°）和「正西」都**朝西看** —— 相机在东侧（蓝方），画面左边是南、右边是北。
- 俯视图保持「北在上」。

## 区域染色 + Toggle 的颜色

每个区域（四分之一场地）按它那个 **toggle 的当前状态**染色，一眼看出这个区域的黄色 pin 归谁：
红 / 蓝 / 黄。左边面板（选中某个 toggle 时）有「区域染色」开关。

染色块的边界用的是场地真实几何：外角（±1804 垫子角）→ 胶带臂内端（±299）→ 中场菱形顶点（±598），
所以正好落在两条对角胶带臂之间，不会盖住胶带。

**场上的 toggle 本体也有颜色**（红 / 蓝 / 黄）：

- **CAD 路径（常态）**：4 个 toggle 是 `field.glb` 里的静态零件 `276-9250-023_GREY`，
  4 个**同名** → 只能靠**位置**认是哪个区域：`bakeRoot` 把变换烘进几何了，
  包围盒中心就在 three 系里 —— `|x| > |z|` → 东/西（按 x 正负），否则 → 南/北（z<0 是北）。
  上色在 `src/scene/CadField.tsx` 的一个 `useEffect` 里做，**必须改 clone 上的 mesh**
  （`clone(true)` 复制的是材质引用，在 root 上换 material 不影响已建好的 clone）。
- **程序化兜底路径**：`src/scene/Toggles.tsx` 直接按状态上色。

## Toggle 的交互：点它 → 左边弹设置

- 3D 里的 toggle 零件**没有事件处理**，R3F 就不会去射线检测它 → 看不见也点不着。
  所以另有一层**隐形点击代理**（`src/scene/ToggleHandles.tsx`，一直挂载）。
- 点中 → `selectToggle(区域)` → **左侧面板**换成那个 toggle 的设置
  （三个大色块按钮 红 / 蓝 / 黄，**直接设值**不是循环）。
  左边一次只显示一样东西：选 toggle 会收起 goal 调色板，选 goal 会收起 toggle 面板。
- 右栏只剩 **实时计分 + 规则说明**。

## Toggle 的 3 个状态（没有第四个「中立」）

手册 `<SC4>` 只承认 **红 / 蓝 / 黄** 三个有效朝向；没就位（不是有效朝向）按规则同样不得分，
所以 UI 里**不单拎一个「中立」状态**出来，
`ToggleState = 'red' | 'blue' | 'yellow'`（`src/data/terms.ts`）。

## 删除手势：四周红光 + 红色垃圾桶

拖动**已经放好**的得分物（`dragging.kind === 'stack'`）时：

- 画布四周浮起一层**红光**：统一暗红晕（`box-shadow: inset`）+ 最近那条边的方向性高光，
  越靠近边缘越亮（`src/ui/TrashZone.tsx` + `.trash-glow`）。
- 离 3D 画布边缘 < 90 px（`TRASH_EDGE`）时，最近的那条边中央弹出**红色垃圾桶**，松手即删除。
- 强度用 CSS 变量直接写进 DOM，**不走 React state** —— 指针每帧都在动，走 state 会重渲染整棵树。
- 「边缘」以**画布**（`.stage`）的矩形为基准，不是窗口：窗口左右两块面板会盖住窗口边缘，
  用窗口当基准的话垃圾桶根本露不出来（`stageRect()` in `src/scene/bridge.ts`）。
- 从面板拖**新**件是放置手势，不出现红光；靠边时照常放置，不会被误删。

## 目录

```
fieldcad/            官方场地 CAD（126 MB STEP，AP214，毫米）——源文件，不入库
tools/               离线 Python 管线（OCP）+ 验证脚本
  extract_field.py   STEP → public/assets/（field.glb + 半体模板 + field.json）
  inspect_step.py    快速探针：装配树、包围盒、每个实例的世界变换
  test_scoring.ts    计分引擎回归测试
  verify_ui.py       Playwright 端到端验证
public/assets/       生成的资产（不入库）
src/
  data/terms.ts      ★ 统一词表（颜色 / 区域名 / 零件名），不 import 任何东西
  data/fieldSpec.ts  场地规格 + 坐标系换算 + 兜底几何
  state/scoring.ts   ★ 计分引擎（全部规则逻辑都在这一个文件里）
  state/store.ts     zustand store
  state/drag.ts      拖拽指针状态（放在 React 之外，避免每帧重渲染）
  scene/             R3F 场景：场地 / goal / 得分物 / toggle / 拖拽幽灵件
  scene/stackLayout.ts ★ 堆叠几何：半体摆放 + 嵌套落点（3D / 幽灵件 / 测试共用）
  ui/                左侧面板（调色板 / toggle 设置）、计分板、规则说明、垃圾桶
```

## 关键约定

- **坐标系**：场地用地理习惯的右手系（X 东 / Y 北 / Z 上）。three.js 是 Y-up，
  换算用 `fieldSpec.toThree(x, y, z) = [x, z, -y]`（绕 X 轴 −90° 的纯旋转）。
  **直接写 (X, Z, Y) 会左右镜像**，别改回去。
- **所有 CAD 导出的 glb 都在同一个归一化系**（x=东 / y=北 / z=上，原点在垫子平面），
  几何**预先烘好**、节点矩阵全是单位阵。因此前端**统一施加 `CAD_TO_THREE`（绕 X 轴 −90°）**即可，
  不需要按文件猜坐标系（之前的 `detectFrame()` 已删除 —— 靠包围盒最短轴来猜是脆的）。
  **如果 CAD 侧改动导出约定，这里要同步改。**
- **深度精度**：相机 `near` 必须是 50 而不是 1。near=1 时在 5000 mm 处深度精度约
  1.6 mm，胶带（离地 2 mm）会和地面垫 z-fighting。改 near 时连带检查 `polygonOffset`。
- **性能**：静态场地合并为 1 个 mesh；得分物用 instanced mesh；`frameloop="demand"`，
  拖拽时靠 `sceneBridge.invalidate()` 要帧；指针坐标放在普通对象里，**不要**进 React state。
- **画质档位**：顶栏「高 / 中 / 低」（或网址 `?quality=low`）—— 关阴影、降低像素比、关抗锯齿。
  机器吃力时用「中」或「低」。
- **`frameloop="demand"` 下异步载入的几何不会自动出帧**：`assets.ts` 的 hook 在 setState 之后
  必须调 `sceneBridge.invalidate?.()`，否则 CAD 资产永远显示不出来。
- **规则改动只改 `src/state/scoring.ts`**，并且要给每个判定留 `reason` 字符串，
  计分板上 hover 任意端子就能看到判定理由，方便按官方口径核对。

## 比赛规则要点（已与官方手册 v0.1 中英文逐条核对）

- 联盟色 Pin 端子 **5 分**，被拥有的黄色 Pin 端子 **10 分**，中场机器人 8 分/台，
  自动时段奖励 12 分。
- `<SC2>`：Pin 成为 placed 的条件 = 与 Goal 有嵌套，或与「一个已 placed 的 Pin 啮合的 Cup」
  有嵌套；一个 Cup 半体里最多放 1 个 Pin。
- `<SC3>`：端子 **嵌在 Cup 的透明半体里** 或 **未被 Cup 覆盖** 时计分；
  被不透明（灰）杯挡住不计分。一个 placed 的 Pin 有 1 个或 2 个得分的端子。
- `<SC3> a/b/c` + 中文手册 图 SC5-1/2：**按 pin 半自身的颜色判联盟**——红半→红方，
  蓝半→蓝方，黄半→拥有方。**联盟 goal 的颜色不改变归属**。
- `<SC5> a`：区域内的黄色 pin 归该区域 toggle 的颜色；toggle 设为黄色（或没就位）则不得分。
- `<SC5> b`：中场高 goal 里的黄色 pin 归**中场机器人数量多的一方**，相等则都不拥有。
  → 左侧面板选中中场 goal 时有一组「中场机器人数量」计数器（`midfieldCounts`），
  引擎的 `scoreField({midfieldCounts})` 早就支持，只是以前没有 UI 入口。
- `<SG9>/<SG10>`：不能碰/取走对方联盟 goal 里的得分物。
- **goal 也挡分（本工具采用的解读）**：直接插在 goal 孔里的那个 pin，
  **下半整个埋在 socket 里 → 不计分**。由 `scoring.ts` 的 `GOAL_COVERS_PIN_LOWER` 控制（默认 `true`）。
  ⚠️ **官方手册图 SC5-1/2 是相反的**：中间板（toggle=蓝）里插在 goal 里的黄半明确标 **+10**，
  左板（toggle=黄）同一个件标 +0（只差 toggle 颜色）→ 按手册这半是**计分**的；
  `<SC3>` 原文也只提 cup、不提 goal。要切回手册口径把那个常量改成 `false` 即可。

### 摆放规则（用户给定口径，不是手册原文）

```
Goal ──▶ Pin ──▶ Cup ──▶ Pin ──▶ Cup …
```

- **pin 只能放在 cup 上，或直接放在 goal 上**（作为摞的最底下一个）。
- **cup 只能放在 pin 上**。
- pin 压 pin、cup 压 cup、cup 放 goal → **非法**：UI 直接拒绝（`placeItem` 返回 false），
  并弹一句中文提示（`src/ui/PlaceHint.tsx`）；拖拽时目标不高亮、幽灵染红。
- 判定函数在 `src/state/scoring.ts` 的 `checkPlacement`（只能 type-only import，因为
  `node tools/test_scoring.ts` 直接加载那个文件）。

### 拆卸的连坐规则

得分物**不能悬空**：拆掉一个，**它上面的 pin / cup 一并拆掉**（`store.removeItem` 只保留
被拆那个**下面**的那些）。垃圾桶删除、Delete 键都走这里。

> 这跟「叠放规则」是配套的：既然 Cup 只能放在 Pin 上、Pin 只能放在 Cup 或桩上，
> 那么底下那个被抽走，上面那些就没有依附的对象了 → 一起掉。

### 曾经踩过的坑（别再踩）

- **`tools/gltfwriter.py` 写出的索引缓冲曾经是坏的**（已修）：① BIN 块是「所有顶点 + 所有索引」，
  但索引 bufferView 的 `byteOffset` 在循环里用**当时**的 `len(vbytes)` 算，指向了顶点数据；
  ② `g.indices` 被就地改成全局索引，而每个 mesh 的 POSITION accessor 只覆盖**本组**顶点 → 越界；
  ③ 同一批 group 被 `write_glb` 调用两次（field.glb / field_slim.glb）时偏移会累加溢出。
  症状：三角形提交了却画不出来，`Raycaster` 返回 `distance: NaN`。
  **前端现在会校验索引缓冲**（`assets.ts` 的 `isGeometrySane`），坏了就回退程序化几何。
- **three.js 的 `Object3D` 只能有一个父节点**：同一个 glb 的 root 被 9 个 Goal 共用时，
  必须每个实例 `clone(true)` 一份（几何体共享、节点独立）。
- **Pin 和 Cup 的拼法不一样**：Pin 是**翻边对翻边**（线轴），Cup 是**杯口对杯口**（沙漏）。
  早先按同一种拼法画 Cup，结果形状、翻转效果、遮挡判定全错 —— 一次改三处，别只改一处。
- **`OrbitControls` 有阻尼**：直接改 `camera.position` 会被它拽回自己的轨道。
  脚本里挪相机必须同时改 `sceneBridge.controls.target` 并 `update()`（见 `tools/shot_stack.py`）。
- **`toThree()` 一定要取满三个分量**：`toThree(x, y, z) = [x, z, −y]`，
  只取前两个（`const [gx, gy] = toThree(...)`）会把**南北方向搞丢** ——
  拖拽幽灵件会镜像到中线另一边（**但放置结果是对的**，因为落点走的是射线命中的 goal id，
  不看幽灵件的位置）。这个坑很隐蔽：东西照放不误，只是预览看着歪。
  `src/scene/DragGhost.tsx` 就栽在这（已修），端到端里有断言守着。

### 仍然开放的问题

1. **桩位分歧**（见上「CAD 资产现状」）—— CAD 的 598.06/1196.12 vs 照片反解的 635/1270，
   差 82.6 mm。对计分无影响，对走位有影响，**等用户裁定**。
2. ~~**Pin 套在 Cup 里 / Cup 罩在 Pin 上**在真实几何上怎么嵌套~~ —— **已解决**（见上「几何」）：
   用 CAD 装配树 + 官方手册图 SC5-1/2 + 官方 3D 渲染图三方对表确认：
   Cup 的**下半**罩住它**下面**那个 Pin 的**上半**；Cup 的**上半**罩住它**上面**那个 Pin 的**下半**；
   罩住的那一半透明则计分、灰色则不计分。计分板 hover 任意端子会显示判定理由，
   方便按官方 Q&A 口径校正。**改口径只改 `scoring.ts`。**
3. **照片里中场菱形西北顶点的那个红/蓝/黄三色风车，**这份 CAD 里**根本没有**对应零件** ——
   CAD 侧在 500 mm 范围内反复搜过：只有中场高桩、胶带、地砖和摆好的得分物。
   全场唯一的红/蓝/黄「产品」就是三个 Pin 半体。要还原它只能程序化画，或者等更新版 CAD。
4. **`field.glb` 里没有得分物**（早先看到的「铺满全场的板」是围栏底边的 `276-7596-350_*/351_*`，
   1187.79 mm 长的墙条，不是 Pin 半体）。应用自己生成得分物，没有重复问题。
   `field.json` 的 `startObjects` 有 119 条开局位姿（CAD 里是「摆货」状态，不是比赛开局），要做
   「开局摆位」图层可以用。
