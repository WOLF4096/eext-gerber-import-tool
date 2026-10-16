# 项目长期记忆 — eext-gerber-import（Gerber 转 PCB）

## 项目本质
嘉立创EDA专业版扩展。真正产品是 `iframe/` 下的单页应用；`src/index.ts` 只是壳
（`eda.sys_IFrame.openIFrame('/iframe/ImportGerber.html', …)`）。改功能只改 `iframe/`，
`npm run build` 只负责打包（`.edaignore` 排除 src/ build/ config/ .workbuddy/ Temp/）。

## iframe 结构（数字前缀=加载顺序，不可调；用经典 <script>，禁止 type=module）
`ImportGerber.html` 骨架 / `css/style.css` / `js/`：
01-templates(模板) 02-config(DEBUG/图层定义) 03-state(状态+画布+协议弹窗) 04-gerber-parser(GerberParser)
05-pad-tool(PadTool 逆向还原) 06-utils(工具) 07-file-io(导入调度) 08-export(导出)
09-ui(渲染交互) 10-init(初始化) + clipper.js(6.4.2 布尔运算) + jszip/jspdf
`processors/`：registry + industry-common + industry-rs274x + jlc-internal。

铁律：脚本放 `</body>` 前；引用用绝对路径 `/iframe/...`；`.js`/`.css` 带 UTF-8 BOM；
不要反缩进（模板字面量对空白敏感）；新功能别内联回 HTML。

## 版本与打包
版本以 `extension.json` 为准（`package.json` 同步），打包 `npm run build` → `build/dist/*.eext`。
临时文件一律放 `Temp/`（gitignore + edaignore）。

## 处理模式（仅两项）
下拉 `#cfg-source-type`：`easyedapro`（嘉立创内部）/ `rs274x`（通用）。
X2 / X3 / RS-274D / 兼容 / 保底 已删。新增处理器要同步改三处（HTML option+script、resetConfig）。

## 业务铁律（踩过的坑）
- 坐标 vs 光圈参数单位不同：坐标用 `mmOf()`，光圈/宏参数用 `toMM()`；混用英寸文件偏 25.4 倍。
- `extractRawData` 依赖嘉立创私有 `G04` 段标记；无标记来源靠 `hasSectionMarkers` 分支按层+指令推断。
- 无 D 码坐标行沿用模态操作码 `state.dCode`；位置未定义的裸 `D2*` 不写包围盒。
- 跨文件配点必须容差（0.05mm 栅格归并）；`toFixed(3)` 精确键会让过孔/钻孔大面积配不上。
- 焊盘去重必须带 `layerId` 限定（`rawPads` 是所有层公共数组）。
- 过孔 vs 插件盘：钻孔≥0.6mm 且铜环≥0.25mm → 插件焊盘（THT_DRILL_MIN/THT_RING_MIN）。
- LPC（清除极性）不能整体丢：负片覆铜 = 暗区 + 清区（区域/闪绘/线段都要收集）。
- 负片转正片：Clipper 差集 → 对残留孔洞开 0.01mm keyhole 缝 → 只输出外边界，每块一个 FILL。
  （`createComplexPolygon` 是「多块独立多边形」，不做布尔差。）
- FILL 创建 API：单环用平铺 `createPolygon(平铺)`；`createComplexPolygon` 入参是「多块数组」，
  单元素嵌套 `[[ring]]` 会被当平铺解析 → 返回 undefined → 填充静默消失。用「平铺优先+多重兜底」。
- 整圆：CIRCLE 导出成起点=终点 360° 弧；画布先 moveTo 再画 0~2π，导出拆两段 180° 半圆。
- 宏光圈焊盘 w=h=0，`calcExp` 用 path 包围盒算阻焊扩展。

## 嘉立创标准版导出格式（08-export.js）
1 单位 = 10 mil = 0.254 mm；`X=4020+mmX/0.254`，`Y=3560.5-mmY/0.254`。
字段：PAD 20 / VIA 8 / HOLE 6 / TRACK 7 / ARC 8 / CIRCLE 10 / SOLIDREGION 10。
区域类一律 SOLIDREGION（不要 COPPERAREA）。槽孔必须同时给 `holeLength` + `slotPointArr`。
图层 ID 与内部编号顺序不同（阻焊/锡膏/装配需换算）。
标准版**不导出**文字、元件位号、埋盲孔；矢量图片轮廓以 SOLIDREGION 导出，钻孔层默认不勾选。

## 飞针标注层
虚拟层 id 2001 引脚编号 / 2002 网络名称 / 2003 元件位号（有 `FlyingProbeTesting.json` 才出现）。
匹配统一在 06-utils（`buildFlyingPinIndex`/`padMatchBoxMM`/`flyingPinAt`），画布与导出共用。
单位 mil。引脚编号/网络名称仅显示不导出；位号勾选后写装配层文字（24mil）。

## 已知缺口
网络生成未实现（`netName=""`；「尝试生成网络」只驱动飞针编号/位号）；
标准版不导出文字/位号/埋盲孔；宏基元 6/7 未绘制；`%SR` 未处理；`DEBUG` 硬编码 false；
`setBoardType()` 空壳；`exportForOther_Pro()` 不可达；`LCEDA_STD_Head_Source` 未使用。

## 标准版 Gerber 的区域环「零长首段 + 未闭合」（2026-10-16 修复）
嘉立创EDA**标准版**（EasyEDA v6.x）导出的 Gerber，其 G36/G37 区域路径常写成
「M 起点 → L 起点」的**零长首段**，且**不闭合**（实测 stm32 板 1153 块填充里
879 块带零长首段、仅 24% 闭合；`Gerber_上.pcbdoc` 11/11 全中）。
专业版（EasyEDA Pro）导出的区域本就干净闭合 → 所以只有标准版来源会「渲染对、导入错」。
**症状：画布渲染正常，但导入 EDA 后填充区域全丢。**

- 修复①（导入通道 / PRO 图元）：`06-utils.js` 新增 `fillNormalizeFlatRing(flat, tol)`——
  去零长线段 + 末点未回首点时补一段闭合；在 `05-pad-tool.js` 的 FILL 生成处调用
  （`singlePath` 与每个 `holes` 环都要过）。已是干净闭合的环**原样返回**（空操作）。
- 修复②（标准版导出通道）：`08-export.js` 的 `stdFlattenPath()` 出口去掉相邻重复点
  （闭合交给 `stdPathStr(pts, true)` 的 `Z`）。
- 判据：填充环必须**无退化边（相邻点重合）+ 显式闭合**，否则 EDA 端多边形校验会拒绝整块图元。
- 验证：严格 mock（复刻上述两条校验）下 stm32 的 FILL 由 **280 → 1159（全部）**；
  7 个样本**丢弃 0 块**；专业版样本图元串**逐条完全一致**；标准版参考样本 ground truth
  仍 9 图元逐字段一致。校验脚本：`Temp/fill_ring_check.js`、`Temp/fill_drop_check.js`、
  `Temp/std_export_dump.js`。

## 前端交互约定（2026-10-16）
- 用户协议确认 = 「处理模式」下方的复选框 `#cfg-agree`（容器 `#agree-row`）；点击
  《用户协议与免责声明》文本弹窗查看，弹窗底部只有「关闭」。导入 / 导出嘉立创EDA 五个按钮
  带 `agree-gated` 类，未勾选时 `is-locked` **只做灰显、不加 disabled 属性**
  （加了就点不到、无法触发震动）；`confirmAction()` 统一校验，未勾选 → `shakeAgreement()`
  让复选框左右震动（动画类 `agree-shake`，`animationend` 后移除以支持连点重放）。
- 飞针标注三层并入「自定义/特殊」分组（不建独立分组标题），行内标签用 `.col-name` 与
  「文件名」列对齐，不带「仅显示」「24mil」等后缀；颜色：引脚编号 / 网络名称 `#ffffff`、
  元件位号 `#00ffff`；**三层默认全部勾选**（`flyingOverlayVisible` 全 true，
  意味着位号默认会随导出写进装配层文字）。
- 「导入参数 → 板子属性」新增 **软件名称 / 导出时间**（`prop-soft` / `prop-time`，行
  `row-prop-soft` / `row-prop-time`）：由 `06-utils.js detectEasyEdaSource()` 从
  `rawFilesCache` 头部注释解析 `G04|; EasyEDA[ Pro][ Client] v<ver>, YYYY-MM-DD HH:MM:SS`；
  EasyEDA = 标准版、EasyEDA Pro = 专业版；版本尾部哈希段（`.832e02bb.70b181`）由
  `trimVersionTail()` 去掉；识别不到则隐藏两行。刷新点在 `09-ui.js updateBoardStats()`。
- `.modal-box` max-height = 72vh（协议 7 节，太矮要频繁滚动）。
