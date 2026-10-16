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
| `iframe/js/clipper.js` | Clipper 6.4.2（Boost License）整数多边形布尔运算，负片转正片用 |
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

## RS-274X（无段标记）导入的四条铁律（2026-10-16 修复的坑，V3.6.0）

用户真机反馈「渲染对、导入错」，全部出在 `hasSectionMarkers === false` 那条分支
（嘉立创内部格式走段标记分支，不受影响）：

1. **跨文件坐标必须容差匹配**：同一物理点在 Gerber 与钻孔文件之间实测差 0.003~0.015mm。
   `toFixed(3)` 精确键会让「钻孔 ↔ 过孔铜盘/阻焊盘」大面积配不上 → `padDia` 退化成钻孔直径
   （过孔没铜环）、阻焊扩展算不出。`consolidate` 已改为 0.05mm 栅格就近归并。
2. **过孔 vs 插件焊盘**：光靠「圆形 + ≥2 铜层 + 附近有钻孔」会把插件脚判成过孔。
   补充判据：**钻孔 ≥0.6mm 且铜环 ≥0.25mm → 插件焊盘**（`THT_DRILL_MIN` / `THT_RING_MIN`）。
   官方标准版参考源码可作 ground truth 校验 PAD/VIA 分类。
3. **飞针引脚匹配要两级**（中心 2.5mil → 焊盘包围盒）：异形焊盘引脚锚点偏在一侧（实测 27mil），
   只按中心匹配会丢编号与组合。`generatePrimitives` 已改共用 `flyingPinAt`。
4. **LPC（清除极性）不能整体丢弃**：负片覆铜 = 整板暗区 + 清区挖空。
   区域 / 闪绘（间隙盘）/ 线段（隔离带）都要收集成 ring → 见下节「负片转正片」。

## 负片转正片：拆成多个无孔洞填充（2026-10-16 定稿，V3.6.1）

⚠️ **`pcb_MathPolygon.createComplexPolygon()` 的语义是「多块互相独立的多边形」**
（官方示例：矩形 + 圆形两块），**不做布尔差** —— 把挖空环当内环塞进去 = 挖空区也变成实体铜，
导入后就是「一整块实心矩形铜」（用户截图现象）。所以负片必须**先转正片再拆**：

- 实现：`06-utils.js` 的 `fillSplitNegativeRegion(outerOps, holeOpsList)`（唯一入口），
  由 `05-pad-tool.js` 的 `consolidate` 收尾处调用（`fillsOut`），专业版 `generatePrimitives`
  与标准版 `buildStandardSource` 共用 → 标准版导出的挖空也一并修好了（原来只写外环）。
- 依赖 **`js/clipper.js`（Clipper 6.4.2，Boost Software License，整数布尔运算）**，
  已加入 `ImportGerber.html`（与 jszip/jspdf 同区）。比例 `FILL_SCALE=1e5`（0.00001mm）。
- 三步：① `ctDifference` 算 `外环 − 挖空并集`（**必须并集**，负片间隙互相重叠：
  0802-2 顶层 5912 对重叠、重叠面积 2568mm²；奇偶规则会把重叠处变回铜 → 短路）；
  ② 对残留**闭合孔洞**开一条 0.01mm 宽的 keyhole 缝（`FILL_SLIT_HALF`）接到区域外，
  孔洞变开口凹槽；③ 只输出正向（外边界）路径，每块一个填充。
- 清区挂载：清区要挖掉**所有与它重叠的同层暗区**（原来只挂一个宿主 → 残余多铜），
  仅当暗区**整体落在清区内部**时跳过（那是清区后补画的 island，不能挖）。
- 整块被完全挖空时 `fillSplitNegativeRegion` 返回**空数组** → 该块必须整块丢弃，
  不能退回「实心填充」（曾有此 bug）。
- 代价：每块残留孔洞会割掉一条 0.01mm 宽的铜（keyhole 的标准做法，面积损失 0.1~0.8%）。

## 隔离带胶囊环方向铁律（2026-10-16 修复）

`clearStrokeRing`（LPC 线段 → 胶囊环）的端弧必须写 **`sweep: -180`（顺时针）**：
路径是 `(p1+n) → (p2+n) → 端弧 → (p2-n) → (p1-n) → 端弧`（n = 线段方向左法线），
在端头要从 `+n` 转到 `-n`，只有沿线段前进方向绕过去才是圆头；写成 `+180` 会从内侧绕，
端头被啃成内凹月牙（10×2 的隔离带面积 16.86 而非 23.14，圆头丢失）。

## ⚠️ FILL 图元创建的 API 语义铁律（2026-10-16，V3.6.2 修复的坑）

**症状**：负片拆分后「导入 EDA 后一块填充都没有」（渲染正常），日志里"生成填充 100 个"却没东西。

**根因**：`pcb_MathPolygon.createComplexPolygon()` 的入参是「**多块**多边形的数组」
（官方示例 `createComplexPolygon([['R',…],['CIRCLE',…]])`；单块要用**平铺源数组**
`createComplexPolygon(['R',…])`）。**单元素嵌套 `[[ring]]` 会被当成平铺数组解析**
（首元素是数组不是数字）→ 返回 `undefined` → 填充**静默消失**。
而 `createPolygon()` 只接受平铺源数组 ✓（官方填充示例的写法）。

**修复**（`08-export.js` 的 FILL 分支）：按「平铺优先 + 多重兜底」依次尝试
`createPolygon(平铺)` → `createComplexPolygon(平铺)` → `createComplexPolygon(嵌套)`，
第一个返回对象即用；多环历史数据仍优先走 `createComplexPolygon(嵌套)`。
配套：`trackFail()` 跟踪每个 `create()` Promise 的结果，把失败数 + 首个错误写进运行日志
（否则 `create()` 的失败是看不见的 unhandled rejection）。

**推论（实测归纳，别再踩）**：EDA 的填充用**非零环绕规则**（JLC 样本的挖空环与外环方向相反 → 挖空生效；
0802-2 的清区环与外环同向 → 挖空被填实，即早期"一整块实心矩形"）。**奇偶规则不成立**。

**辅助手法**：验证 EDA 行为不能只靠 mock（宽松 mock 永远返回成功）。用**严格 mock** 复现可疑行为
（如"单元素嵌套 → undefined"）才能验证调用链是否选对分支：见 `Temp/fill_api_probe.js`。

**格式参考（权威）**：EDA 自己的工程文件在 `D://Program Data\LCEDA\项目\*.epro|*.eprj`
（zip → `PCB/*.epcb`，行式源码）。里面 FILL 的 `path` 是**嵌套** `[["CIRCLE", …]]` ✓
（那是 *源码* 格式；API 调用要按上面的语义拆平/兜底）。

**几何洁净度**（同样会被 EDA 端多边形校验拒）：输出必须**显式闭合**（补回首点，与源区域路径一致），
且不能有退化短边 —— 圆弧离散化的采样末点与弧声明末点不重合会产生 0.2~0.7µm 短边，
现在 `fillArcPoints` 不输出末点、由精确端点收尾，输出前再经 `fillCleanRing()`
（合并 0.5µm 内重复点 + 去共线点）。

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

## 已知缺口（2026-10-16 完成度审计，报告见 Temp/项目完成度报告.md）

- ~~标准版导出不支持挖空~~ → **V3.6.1 已修**：负片在 `consolidate` 阶段就拆成无孔洞填充，
  标准版与专业版共用同一份结果。
- **标准版导出不消费 `uni.textLines` / `uni.images`**：`buildStandardSource()` 只迭代
  unifiedPads / remainingVias / tracks / polys / fills / images… 实际 `textLines` 与 `images`
  都没接（12层PCB 样本有 181 条文字折线 + 101 张 IMAGE）。PRO 路径有（`05-pad-tool.js`）。
  标准版也不写位号 STRING、不支持埋盲孔（VIA 8 字段无层对）。
- **`layerId 56`（钻孔图层）默认不勾选**（`07-file-io.js:218`），GDD 的钻孔符号/文字默认既不上画布
  也不进标准版导出；`probe5.js` 等按 `f.visible` 过滤的统计会看不到这部分数据。
- **`setBoardType()` 是空壳**：只写 `cfg-board-type` 隐藏 input，无人读取 → UI 的 PCB/FPC 开关无效。
- **`exportForOther_Pro()` 空实现且不可达**（两个处理器 `exportTarget` 都是 `'jlc'`）。
- **网络生成未实现**：`05-pad-tool.js:979 netName = ""`；「尝试生成网络」复选框实际只驱动飞针引脚号/位号。
- 光圈宏仅支持基元 1/4/5/20/21/22；`%SR`（步进重复）、X2/X3 属性均未处理。
- UI 前端资源会被编辑器按 `.editorconfig`（tab）重排（`.prettierignore` 已排除 `/iframe/`，不是 prettier），
  **验证结论要对着最新 HEAD 复核**。

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
- 版本号以 `extension.json` 为准（当前 **3.6.1**），`package.json` 已同步；`CHANGELOG.md` 记到 V3.6.1。

## 可用工具（均在 Temp/）

- `verify.py`（字节级等价校验）、`split.py`（拆分器）、`smoke.js`（真实 Chrome 前后对比）、
  `guard_test.js`、`processor_test.js`、`render_test.js`、`repro_full.js`、`probe5.js`（多样本回归，产出 `probe5_result.json`）。
- **标准版/渲染系列**：`std_check.js`（单图层筛选+截图）、`std_each.js`（逐层截图+导出 commands）、
  `std_each_cmp.py`（逐层 recall/precision + 差异掩码）、`std_verify.js`（一次性验收）、
  `std_validate.py`（标准版导出结构与几何校验）、
  **`raster_exact.py`（独立精确光栅化，支持圆弧/宏光圈/圆头线端，可作任何 Gerber 渲染的 ground truth）**。
- **负片/填充系列（V3.6.1 新增）**：`dump_fills.js`（导出 rawFills+挖空 → `fills_dump_<tag>.json`）、
  `neg_verify.js`（拆分块数/面积/自交/耗时 → `neg_split_<tag>.json`）、
  `neg_check.py`（与 **shapely** 对账：面积/块数，容忍度 = 开缝预算）、
  `neg_canvas_cmp.py`（把「导入会得到的填充掩膜」与 `std_each` 的画布逐层截图做像素比对：
  多出的铜 / IoU）。**判定标准**：残余「多出的铜」必须 100% 落在画布铜边界 1~3 设备像素内
  （抗锯齿+二值阈值），否则说明还有真实几何错误。
- 运行 JS 测试需设 `NODE_PATH=C:/Users/狼黑/.workbuddy/binaries/node/workspace/node_modules`（内含 playwright-core），
  Chrome 路径 `C:/Program Files/Google/Chrome/Application/chrome.exe`；
  托管 Python（`binaries/python/versions/3.13.12`）已装 **shapely 2.1.2 / PIL / numpy**，可做几何 ground truth。
