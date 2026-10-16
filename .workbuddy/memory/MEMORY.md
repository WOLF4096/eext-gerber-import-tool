# 项目长期记忆 — pro-api-sdk / eext-gerber-import

## 项目本质

嘉立创EDA 专业版扩展「Gerber 转 PCB」。**真正的产品是单页应用，不是 TS 脚手架**：

- `src/index.ts`（758 B）只是入口壳，`ImportGerber()` 调
  `eda.sys_IFrame.openIFrame('/iframe/ImportGerber.html', 1280, 800, 'ImportGerber')`。
- 全部业务逻辑在 `iframe/` 下，**与 `src/` 无关**；构建时 `.edaignore` 会把 `src/`、`build/`、`config/` 排除，
  只把 `iframe/`、`dist/index.js`、`extension.json`、`locales/`、`images/` 等打进 `.eext`。
- 因此改功能基本都在改 `iframe/`，`npm run build` 只负责打包，不参与 iframe 的构建。

## iframe 目录结构（2026-10-14 从单文件拆分而来）

原 `iframe/ImportGerber.html` 为 315 KB 单文件（内联 CSS + 内联 JS）。现已拆为：

| 文件 | 职责 |
|---|---|
| `iframe/ImportGerber.html` | 界面骨架：head + body 标记 + 资源引用 |
| `iframe/css/style.css` | 全部样式（dark 主题） |
| `iframe/js/jszip.min.js`、`jspdf.umd.min.js` | 第三方库 |
| `iframe/js/01-templates.js` | 工程文件头模板常量（STD / V2 / V3） |
| `iframe/js/02-config.js` | DEBUG、全局变量、图层定义与文件名识别规则 |
| `iframe/js/03-state.js` | 运行时状态、画布上下文、免责声明弹窗 |
| `iframe/js/04-gerber-parser.js` | `class GerberParser`（RS-274X 解析） |
| `iframe/js/05-pad-tool.js` | `PadTool` 逆向还原引擎（提取→聚合→生成图元） |
| `iframe/js/06-utils.js` | 通用工具函数 |
| `iframe/js/07-file-io.js` | 文件导入与解析调度 |
| `iframe/js/08-export.js` | 导出控制器（画布注入 / .epcb / .epro2 / PDF） |
| `iframe/js/09-ui.js` | UI 渲染与交互 |
| `iframe/js/10-init.js` | 初始化与全局事件 |

## 维护铁律

1. **`iframe/js/0X-*.js` 的数字前缀 = 加载顺序，不可调整**。
   用经典 `<script src>`（**禁止 `type="module"`**）——多个经典脚本共享同一全局词法作用域，
   顶层 `const`/`let`/`class` 跨文件可见，所以不需要 import/export。
2. **脚本必须放在 `</body>` 之前**：`03-state.js` 与 `10-init.js` 在**加载时**就访问 DOM
   （`getElementById('main-canvas')`、`resizeCanvas()`、`drawCanvas()`）。
3. **所有脚本引用用绝对路径 `/iframe/...`**（与原文件活动配置一致），保证 EDA 环境零回归；
   需用浏览器直接打开时才改成相对路径 `css/`、`js/`。
4. **不要对内联脚本做反缩进**：顶层 4 空格缩进是刻意保留的，
   模板字面量（工程头模板、innerHTML 片段）对空白敏感。
5. **`.js` / `.css` 一律带 UTF-8 BOM**：内容含中文，防服务端不下发 charset 时乱码。
6. 新增功能放对应职责文件，**不要重新内联回 HTML**。

## 已知空缺 / 技术债

- ⚠️ **`iframe/js/processors/` 未被 git 跟踪**（`git status` 里是 `?? iframe/js/processors/`），
  而 `ImportGerber.html` 已引用其中脚本。提交前必须 `git add iframe/js/processors`，
  否则别人克隆后 404、页面打不开。`.eext` 打包走文件系统 + `.edaignore`，不受影响。
- `exportForStandard()` 是空实现（只 `alert('待后续更新')`），但 UI 仍暴露入口。
- `importPrimitivesAPI` 里 `pcb_Primitive*.create()` 返回 Promise 但**既未 await 也未 catch**，
  失败会变成静默的 unhandled rejection；且只支持 V2 图元数组格式
  （`handleExportToCanvas('api')` 会强制把 clientVer 设为 `pro_v2`，所以当前没问题）。
- 光圈宏现已支持基元 1/4/5/20/21/22 与 `$n` 参数化运算（`resolveApertureMacro()`）；
  6(Moiré)/7(Thermal) 仍未绘制。
- `LCEDA_STD_Head_Source` 声明了但从未使用。
- `src/index.ts` 里 `import * as extensionConfig from '../extension.json'` 导入后未使用。
- `DEBUG` 硬编码为 `false`（true 那行被注释），调试面板/「生成」按钮等于死功能。
- 版本号三处不一致：`extension.json` 3.4.0 / `package.json` 1.1.1 / CHANGELOG 缺 3.4.0 条目。
- `exportForEasyEDA_Pro` 用 `LCEDA_V3_Head_Source` / `LCEDA_V2_Head_Source` 作模板，
  `configureHeader()` 在其上按铜层数（layerId 15–46）与埋盲孔规则打补丁。
- V3 工程文件 = JSZip 打包 `{name}.epru` + `project2.json` → 改名 `.epro2`。

## 几个容易踩的业务坑（已在代码里注释）

- **坐标 vs 光圈参数的单位不同**：解析阶段 `X/Y/I/J` 已换算成 mm，但**光圈/宏参数仍是文件单位**。
  `PadTool` 里坐标必须用 `mmOf()`（仅有限性保护），光圈参数才用 `toMM()`。
  混用会让英寸文件的元件位置整体偏 25.4 倍（历史上就是这么错的）。
- **`PadTool.extractRawData` 依赖 `G04` 段标记**（嘉立创专业版私有）：`Pad Start` / `Via Start` /
  `Track Start` / `PolygonModel Start` / `Copper Start` / `Image Start` / `Text Start` /
  `Drill Drawing Start`。没有这些标记的来源必须靠 `hasSectionMarkers` 分支按图层+指令类型推断。
- **无 D 码的坐标行要沿用模态操作码**（`state.dCode`）；位置未定义时的裸 `D2*` 不要写进包围盒，
  否则 (0,0) 会毁掉 `autoFitView`。
- **`isGerberText` 必须传 content**：只给文件名时会退回旧的扩展名判断。


## 处理模式（2026-10-16 精简为两项）

`processors/` 只保留 `registry.js` + `industry-common.js` + `industry-rs274x.js`（RS-274X 通用）
+ `jlc-internal.js`（嘉立创专业版）。X2 / X3 / RS-274D / 兼容 / 保底 **已全部删除**，
下拉框 `#cfg-source-type` 只有两个 option。新增处理器记得同步改三处：
`ImportGerber.html` 的 option + script 标签、`10-init.js` 的 resetConfig 默认值。
（`processors/` 目录**已被 git 跟踪**，早期「未被跟踪」的记录已过期。）

## 嘉立创EDA 标准版源码格式（导出标准版时必读）

- **1 单位 = 10 mil = 0.254 mm**；`X = 4020 + mmX/0.254`，`Y = 3560.5 - mmY/0.254`（X 右正 Y 上正）。
- 字段数必须逐位对齐：PAD 20 / VIA 8 / HOLE 6 / TRACK 7 / ARC 8 / CIRCLE 10 / SOLIDREGION 10。
- **区域类图元一律用 SOLIDREGION（填充区域），不要输出 COPPERAREA**：后者要求附带
  「铺铜压缩数据 + 网络」等 19 字段附属信息，SOLIDREGION 是纯几何、打开即见实心铜。
  这是用户明确要求（2026-10-16）。
- **槽孔焊盘必须同时给 `holeLength`(idx13) 与 `slotPointArr`(idx14)**：只给 holeLength 时
  标准版会把槽从原点拉到焊盘中心，槽长被撑到 1000mm+。约定：
  `holeR = 槽宽/2`、`holeLength = 槽全长（含圆头）= 中心线长 + 2*holeR`、
  `slotPointArr = 中心 ± (全长-槽宽)/2 · (cos(钻刀rotation), sin(钻刀rotation))`。
- **飞针文件给焊盘编号**：`FlyingProbeTesting.json` 的 `lengthUnit = "mil"`；
  fields 里取 PIN_NAME(末段下划线后是引脚号)/PIN_X/PIN_Y。⚠️ 引脚坐标不一定是焊盘几何中心
  （异形/多边形焊盘实测可偏 27mil）→ 两级匹配：中心 2.5mil 内含 → 否则「引脚落在焊盘包围盒内」。
- 图层 ID 顺序与内部编号**不同**：内部 5/6(阻焊)↔标准 7/8、内部 7/8(锡膏)↔标准 5/6、
  内部 9/10(装配)↔标准 13/14、11→10(BoardOutLine)、12→11(Multi)、13→12(Document)、14→15、
  内层 15..46 → 21..52。
- ARC 的 `d`：`M sx,sy A r,r 0 <largeArc> <sweep> ex,ey`；**G03(逆时针)→sweep=0，G02→1**；
  half-circle 判 largeArc 用 `> 180.0001` 容差（浮点会给出 180.00000000000003）。
- 参考素材 `Temp/标准版格式参考/` 里的 json 与 zip **是同一块板的源码↔Gerber 配对**，
  可互为 ground truth 逐图元比对。

## Gerber 两个通用坑（2026-10-16 修复）

- **整圆**：标准版把 `CIRCLE` 导出成「起点=终点」的 360° 圆弧。
  ① 画布 `ctx.arc(sa==ea)` 会画空路径 → 整圆消失，必须先 `moveTo(圆周点)` 再画 0~2π；
  ② 导出 EDA 时 angle=360 的两点弧无法还原 → 拆成两段对向 180° 半圆。
- **宏光圈焊盘**：`%AM` 做出来的掩膜/锡膏焊盘 `w=h=0`（尺寸只在 path 里），
  `calcExp` 必须用 path 包围盒算，否则阻焊开窗扩展整块丢掉。

## 覆铜图元类型（2026-10-16 变更）

无私有段标记来源（标准版 / KiCad / Altium）的铜层区域**不再**降级成 0.1mm 细线折线，
改为实心填充 FILL —— 与画布渲染一致，导入 EDA 才是真铜。判定：`effMode === 'POUR'` 走 `rawFills`。

## 飞针标注层（2026-10-16 新增）

- 三个虚拟层（不对应任何 Gerber 文件）：id **2001 引脚编号 / 2002 网络名称 / 2003 元件位号**，
  定义在 `02-config.js`（`rawLayerData` + `FLYING_LAYER`），状态在 `03-state.js`
  （`flyingOverlayVisible`、`flyingLabelCache`）。有 `FlyingProbeTesting.json` 时图层表才出现。
- 匹配逻辑统一在 `06-utils.js`：`buildFlyingPinIndex` / `padMatchBoxMM` / `flyingPinAt`，
  **08-export.js 的焊盘编号与 09-ui.js 的画布标注共用同一套**（画布所见＝导出所写）。
- 单位：`lengthUnit` 实测 `mil`。索引里 **pins 保持 mil**（配合 `PadTool.toMil`），
  **comps 归一化成 mm**（画布直接用）。两处别搞混，否则位号画到板外。
- 画布写字必须 `ctx.setTransform(dpr,0,0,dpr,0,0)` —— 世界坐标被 `scale(s,-s)` 翻转，否则文字镜像。
- 「引脚编号 / 网络名称」**仅显示不导出**；「元件位号」勾选后 `05-pad-tool.js` 才写装配层文字。
- **文字规则（2026-10-16 定稿）**：
  ① 一律纯 `fillText`，**不描边**（描边会在密脚区发糊）；
  ② 引脚编号/网络名称的**字号上限 = 所在焊盘包围盒**（`ensureFlyingLabels` 缓存焊盘 `bw/bh`；
  两行各占半高 → 放不下退化为「单行只画编号」→ 连编号都放不下才隐藏；常量
  `FLYING_LABEL_MAX_FONT=12` / `FLYING_LABEL_MIN_FONT=4`）；旧的「锚点过近整类跳过」门限已删，
  与「优先显示编号」冲突；
  ③ 元件位号字高 `FLYING_REFDES_HEIGHT_MIL=24`（画布 `24*0.0254*scale` px，下限 6px；
  导出 `STRING` 的 fontSize 同为 24）；
  ④ 飞针文件里形如 `PAD`/`PAD1`/`PAD23` 的**占位元件/引脚一律不显示**
  （`isFlyingPadPlaceholder()`，画布三层与导出共用）。

## 焊盘去重铁律（2026-10-16 修复的坑）

`05-pad-tool.js` 里 `hasPolygonAlready` 这类去重**必须带 `layerId` 限定**：
`rawPads` 是所有图层的公共数组，处理顺序是 顶铜(1)→顶丝印(3)→**顶阻焊(5)**→顶锡膏(7)→**底铜(2)**→内层，
阻焊层的宏多边形焊盘先入队，会把同坐标的底层/内层铜焊盘整批吃掉
（症状：矩形通孔焊盘只剩顶层 + 独立过孔，底层没焊盘）。

## 目录约定（重要）

- **所有临时文件放根目录 `Temp/`**，它同时被 `.gitignore` 与 `.edaignore` 排除（不进 git、不进 `.eext`）：
  回归测试脚本、测试样本 `Temp/测试gerber/`、截图、报告 md、原始单文件备份 `Temp/ImportGerber.html.orig`。
- `.workbuddy/` 只保留 `memory/`（记忆，跟踪进 git）；`.workbuddy/tmp/` 已废弃。
- 脚本路径：`.workbuddy/tmp` → `Temp`，`测试gerber` → `Temp/测试gerber`；
  `verify.py`/`split.py` 的 ROOT 已由三级 `dirname` 改为两级。

## 打包与版本

- `.edaignore` 决定 `.eext` 内容：排除 `.workbuddy/`、`Temp/`、`/images/Test.png`（仅 README 演示图）。
  运行期必需 = `dist/index.js`、`iframe/**`（含 `js/processors/`）、`extension.json`、
  `images/logo.png`、`locales/**`；`README/CHANGELOG/LICENSE` 作为元数据保留。
- 打包：`npm run build` → `build/dist/eext-gerber-import_v<version>.eext`（已 gitignore）。
- 版本号以 `extension.json` 为准（当前 **3.4.0**），`package.json` 已同步；`CHANGELOG.md` 记到 V3.4.0。

## 可用工具（均在 Temp/）

- `verify.py`（字节级等价校验）、`split.py`（拆分器）、`smoke.js`（真实 Chrome 前后对比）、
  `guard_test.js`、`processor_test.js`、`render_test.js`、`repro_full.js`、`probe5.js`（多样本回归，产出 `probe5_result.json`）。
- **标准版/渲染系列**：`std_check.js`（单图层筛选+截图）、`std_each.js`（逐层截图+导出 commands）、
  `std_each_cmp.py`（逐层 recall/precision + 差异掩码）、`std_verify.js`（一次性验收）、
  `std_validate.py`（标准版导出结构与几何校验）、
  **`raster_exact.py`（独立精确光栅化，支持圆弧/宏光圈/圆头线端，可作任何 Gerber 渲染的 ground truth）**。
- 运行 JS 测试需设 `NODE_PATH=C:/Users/狼黑/.workbuddy/binaries/node/workspace/node_modules`（内含 playwright-core），
  Chrome 路径 `C:/Program Files/Google/Chrome/Application/chrome.exe`。
