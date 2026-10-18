// ====================================================================================
// 05-pad-tool.js  —  逆向还原引擎（Reverse Engineering Tool）
// ------------------------------------------------------------------------------------
// 职责：const PadTool —— 本项目技术核心，将 Gerber 矢量图形「智能聚合」为 EDA 逻辑图元。
//   · extractRawData      从各图层提取 焊盘/过孔/导线/多边形/填充/钻孔/图片/文字
//   · consolidate         聚合归并，把零散矢量图元还原为逻辑图元
//   · generatePrimitives  生成 V2 数组格式 或 V3 "元信息||内容" 图元字符串
//   · toMil / calcRadiusRatio  单位与圆角换算工具
// 依赖：rawFilesCache（03-state.js）在运行时读取；被 08-export.js 调用。
// 加载顺序：第 5 个
// ====================================================================================

// ====================================================================================
// 4. 逆向工程工具 (Reverse Engineering Tool)
// ====================================================================================

    const PadTool = {
        // --- 工具：单位转换 (mm -> mil) ---
        toMil: (mm) => {
            if (mm === null || mm === undefined || isNaN(mm)) return null;
            // 1 mm = 39.3700787 mil
            return parseFloat((mm * 39.3700787).toFixed(4));
        },

        // --- 工具：计算圆角比例 (0-100) ---
        calcRadiusRatio: (radius, width, height) => {
            if (!radius || radius <= 0) return 0;
            const minSide = Math.min(Math.abs(width), Math.abs(height));
            if (minSide === 0) return 0;
            const maxRadius = minSide / 2;
            if (Math.abs(radius - maxRadius) < 0.002) return 100;
            let ratio = Math.round(Math.abs(radius / maxRadius) * 100);
            return Math.max(0, Math.min(100, ratio));
        },

        
        // --- 1. 提取阶段 (修改：钻孔图层数据强制转换为 Image 图元) ---
        // opts.textAsPoly：把「G04 Text Start…Text End」段里的 G01（02/01 位移+绘制）
        // 当作 PolygonModel 段处理 —— 标准版没有折线/笔画文字图元，文字笔画只能是
        // 带线宽的折线（TRACK），不留神就会被整段丢掉。专业版仍按文字折线（TEXT）走，
        // 所以这个开关**只由标准版导出传入**，画布与专业版导出保持原样。
        extractRawData: (files, opts) => {
            const textAsPoly = !!(opts && opts.textAsPoly);
            const rawPads = []; 
            const rawVias = []; 
            const rawTracks = []; 
            const rawPolys = [];    
            const rawFills = []; 
            // LPC（清除极性）区域/闪绘/线段：覆铜的"挖空"。收集起来在提取结束后挂到包含它的暗区上。
            const rawClearRegions = [];
            const rawClearRings = [];
            const rawImages = []; 
            const rawTextLines = []; 
            const drills = []; 
            const slotOccupiedPoints = []; 

            const getRawContent = (fileName) => {
                const f = rawFilesCache.find(r => r.name === fileName);
                return f ? f.content : "";
            };

            // 1. 宏解析函数（兜底：正常情况下直接用 file.data.macros）
            //    只拆成基元块，不求值 —— $n 要等 %ADDnn 的光圈参数才知道
            const parseGerberMacros = (content) => {
                const macros = {};
                if (!content) return macros;
                const regex = /%AM(\w+)\*([^%]+)%/g;
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const blocks = String(match[2]).split('*').map(s => s.trim()).filter(Boolean);
                    const out = [];
                    for (const block of blocks) {
                        if (/^G0?4/.test(block)) continue;
                        const m = block.match(/^(\d+)\s*,\s*(.*)$/s);
                        if (!m) continue;
                        const code = parseInt(m[1], 10);
                        if (!isFinite(code)) continue;
                        const args = m[2].split(',').map(s => s.trim()).filter(s => s !== '');
                        if (args.length) out.push({ code: code, args: args });
                    }
                    if (out.length) macros[match[1]] = { type: 'MACRO_DEF', blocks: out };
                }
                return macros;
            };

            // 2. 辅助：将光圈(宏或标准形状)转换为路径数据
            const getAperturePath = (ap, cx, cy, toMM, macroDefs) => {
                const pathData = [];
                // A. 优先检查是否为宏定义 (IconRect / IconStar / 参数化宏 …)
                const macroShape = macroDefs[ap.type] ? resolveApertureMacro(macroDefs[ap.type], ap.params || []) : null;
                if (macroShape) {
                    if (macroShape.type === 'POLYGON' && macroShape.points && macroShape.points.length) {
                        const start = macroShape.points[0];
                        pathData.push({ cmd: 'M', x: cx + toMM(start.x), y: cy + toMM(start.y) });
                        for (let i = 1; i < macroShape.points.length; i++) {
                            const pt = macroShape.points[i];
                            pathData.push({ cmd: 'L', x: cx + toMM(pt.x), y: cy + toMM(pt.y) });
                        }
                        pathData.push({ cmd: 'L', x: cx + toMM(start.x), y: cy + toMM(start.y) }); // Close
                        return pathData;
                    }
                    const primPath = macroPrimsToPath(macroShape, cx, cy, toMM(1),
                        ap.type + '|' + (ap.params || []).join(','));
                    if (primPath.length > 0) return primPath;
                }

                // B. 标准形状处理 (C, R, RECT, O)
                const p = ap.params || [];
                const type = ap.type.toUpperCase();
                
                if (type === 'C' || type === 'CIRCLE') {
                    // 圆形模拟 (用两个半圆弧)
                    const r = toMM(p[0]) / 2;
                    pathData.push({ cmd: 'M', x: cx - r, y: cy });
                    pathData.push({ cmd: 'A', x: cx + r, y: cy, i: r, j: 0, mode: 3, startX: cx - r, startY: cy }); // 上半圆
                    pathData.push({ cmd: 'A', x: cx - r, y: cy, i: -r, j: 0, mode: 3, startX: cx + r, startY: cy }); // 下半圆
                } 
                else if (type === 'R' || type === 'RECT' || type === 'RECTANGLE') {
                    // 矩形
                    const w = toMM(p[0]);
                    const h = toMM(p[1] || p[0]); // 如果只有一个参数则为正方形
                    const hw = w / 2;
                    const hh = h / 2;
                    pathData.push({ cmd: 'M', x: cx - hw, y: cy - hh });
                    pathData.push({ cmd: 'L', x: cx + hw, y: cy - hh });
                    pathData.push({ cmd: 'L', x: cx + hw, y: cy + hh });
                    pathData.push({ cmd: 'L', x: cx - hw, y: cy + hh });
                    pathData.push({ cmd: 'L', x: cx - hw, y: cy - hh });
                }
                else if (type === 'O' || type.includes('OBROUND') || type.includes('OVAL')) {
                    // 长圆（跑道形）：按圆角矩形近似，避免 obround 焊盘整块丢失
                    const w = toMM(p[0]);
                    const h = toMM(p[1] !== undefined ? p[1] : p[0]);
                    const hw = w / 2, hh = h / 2;
                    const r = Math.min(hw, hh);
                    const rot = (p.length >= 3 && p[2]) ? parseFloat(p[2]) * Math.PI / 180 : 0;
                    const cos = Math.cos(rot), sin = Math.sin(rot);
                    const corners = [
                        [-hw + r, -hh], [hw - r, -hh], [hw, -hh + r], [hw, hh - r],
                        [hw - r, hh], [-hw + r, hh], [-hw, hh - r], [-hw, -hh + r]
                    ];
                    corners.forEach(([x, y], i) => {
                        const X = cx + x * cos - y * sin, Y = cy + x * sin + y * cos;
                        pathData.push(i === 0 ? { cmd: 'M', x: X, y: Y } : { cmd: 'L', x: X, y: Y });
                    });
                    pathData.push({ cmd: 'L', x: pathData[0].x, y: pathData[0].y });
                }
                
                return pathData.length > 0 ? pathData : null;
            };

            // 3. 路径合并算法
            // ⚠️ 性能铁律：旧实现是「pool 数组 + 每次取走再全表重扫」，
            //    单条折线 n 段就是 O(n²)，遇到长轮廓（上万段）会退化到 O(n³)，
            //    实测一张多层板要吃掉 3s+（V3.3.0 根本没有这一步，所以显得"飞快"）。
            //    这里换成「端点栅格索引 + 两向贪心生长」：每个端点只登记一次，
            //    连接时只查 3×3 邻格，整体 O(n)。语义与旧实现一致：
            //    · 同一条链只合并线宽差 < 0.05mm 的段；
            //    · 端点判定容差 0.02mm（isEq）；
            //    · 反向接入 ARC 时扫角取负；
            //    · 结果仍按「段在输入数组里的先后」输出，保证图层内绘制顺序不变。
            const mergeSegments = (segments) => {
                const n = segments.length;
                if (n === 0) return [];
                const TOL = 0.02;          // 端点匹配容差（原 isEq）
                const WTOL = 0.05;         // 线宽匹配容差（原逻辑）
                const CELL = 0.05;         // 栅格边长 > TOL，保证 3×3 邻域一定覆盖
                const used = new Uint8Array(n);

                // 端点索引：键 = 格坐标（数字键，比字符串键快一个量级）
                const CELL_SHIFT = 65536;
                const index = new Map();
                const cellOf = (v) => Math.floor(v / CELL);
                const putEnd = (i, which) => {
                    const s = segments[i];
                    const x = which ? s.x2 : s.x1;
                    const y = which ? s.y2 : s.y1;
                    if (typeof x !== 'number' || typeof y !== 'number') return;
                    const k = cellOf(x) * CELL_SHIFT + cellOf(y);
                    let arr = index.get(k);
                    if (!arr) index.set(k, arr = []);
                    arr.push(i * 2 + which);
                };
                for (let i = 0; i < n; i++) { putEnd(i, 0); putEnd(i, 1); }

                // 在 (x,y) 附近找一条「未使用且线宽匹配」的段，返回 code = i*2+which
                // preferWhich：优先「正向衔接」的段（0=接在段起点，1=接在段终点）。
                // 旧实现就是先试 tail≈seg.x1、再试 tail≈seg.x2，这里保持一致，
                // 否则分叉点的成链顺序会变（几何一样，但折线条数会不同）。
                const findAt = (x, y, width, preferWhich) => {
                    const cx = cellOf(x), cy = cellOf(y);
                    for (let pass = 0; pass < 2; pass++) {
                        const want = (pass === 0) ? preferWhich : (1 - preferWhich);
                        for (let gx = cx - 1; gx <= cx + 1; gx++) {
                            for (let gy = cy - 1; gy <= cy + 1; gy++) {
                                const arr = index.get(gx * CELL_SHIFT + gy);
                                if (!arr) continue;
                                for (let t = 0; t < arr.length; t++) {
                                    const code = arr[t];
                                    if ((code & 1) !== want) continue;
                                    const i = code >> 1;
                                    if (used[i]) continue;
                                    const s = segments[i];
                                    if (Math.abs(s.width - width) > WTOL) continue;
                                    const px = want ? s.x2 : s.x1;
                                    const py = want ? s.y2 : s.y1;
                                    if (Math.abs(px - x) <= TOL && Math.abs(py - y) <= TOL) return code;
                                }
                            }
                        }
                    }
                    return -1;
                };

                const mergedPaths = [];
                for (let s0 = 0; s0 < n; s0++) {
                    if (used[s0]) continue;
                    const first = segments[s0];
                    used[s0] = 1;
                    const pathWidth = first.width;
                    const firstStroke = !!first.stroke;

                    // 前向：从 first 的终点继续走
                    const fwd = [];       // [{x,y,sweep|null}]
                    let tx = first.x2, ty = first.y2;
                    for (;;) {
                        const code = findAt(tx, ty, pathWidth, 0);
                        if (code < 0) break;
                        const i = code >> 1, which = code & 1;
                        used[i] = 1;
                        const s = segments[i];
                        // which=0：当前点接在段起点上 → 走向段的终点（扫角不改）
                        // which=1：当前点接在段终点上 → 反向走回段起点（扫角取负）
                        const nx = which ? s.x1 : s.x2;
                        const ny = which ? s.y1 : s.y2;
                        fwd.push({ x: nx, y: ny, sweep: s.type === 'ARC' ? (which ? -s.angle : s.angle) : null });
                        tx = nx; ty = ny;
                    }

                    // 反向：从 first 的起点往回走
                    const back = [];      // [{fx,fy,tx,ty,sweep}] 按「tip → 另一端」记录
                    let hx = first.x1, hy = first.y1;
                    for (;;) {
                        const code = findAt(hx, hy, pathWidth, 1);
                        if (code < 0) break;
                        const i = code >> 1, which = code & 1;
                        used[i] = 1;
                        const s = segments[i];
                        const nx = which ? s.x1 : s.x2;
                        const ny = which ? s.y1 : s.y2;
                        back.push({ fx: hx, fy: hy, tx: nx, ty: ny,
                            sweep: s.type === 'ARC' ? (which ? -s.angle : s.angle) : null });
                        hx = nx; hy = ny;
                    }

                    // 输出：back 逆序接在 first 前面，再接 fwd
                    const currentPath = [];
                    let startX = hx, startY = hy;   // back 走完后的真正起点
                    currentPath.push({ cmd: 'M', x: startX, y: startY });
                    for (let b = back.length - 1; b >= 0; b--) {
                        const op = back[b];
                        // 反向输出：从 op.tx 回到 op.fx，扫角取负
                        if (op.sweep === null) currentPath.push({ cmd: 'L', x: op.fx, y: op.fy });
                        else currentPath.push({ cmd: 'A', x: op.fx, y: op.fy, sweep: -op.sweep });
                    }
                    // 起始段本身（它被 used 标记掉，但没有出现在 back/fwd 里）
                    if (first.type === 'ARC') currentPath.push({ cmd: 'A', x: first.x2, y: first.y2, sweep: first.angle });
                    else currentPath.push({ cmd: 'L', x: first.x2, y: first.y2 });
                    for (let f = 0; f < fwd.length; f++) {
                        const op = fwd[f];
                        if (op.sweep === null) currentPath.push({ cmd: 'L', x: op.x, y: op.y });
                        else currentPath.push({ cmd: 'A', x: op.x, y: op.y, sweep: op.sweep });
                    }
                    mergedPaths.push({ path: currentPath, width: pathWidth, stroke: firstStroke });
                }
                return mergedPaths;
            };

            // ---- 无段标记来源：过孔 / 焊盘 区分的预扫描 ----
            // Gerber 不含网络信息，无法 100% 区分过孔与插件焊盘。这里用可验证的特征组合：
            // 圆形光圈 + 同坐标存在钻孔 + 出现在 >=2 个铜层 → 过孔；其余一律焊盘。
            // 矩形等非圆 Flash 永远不会被判成过孔（避免"矩形焊盘变成过孔"）。
            // 注意：同一物理点在不同文件/图层间常有几微米浮点差（实测 0.004~0.014mm），
            // 所以一律按 0.05mm 容差「就近归并」，绝不能用字符串精确相等。
            const CLUSTER_TOL = 0.05;
            const copperLayerIds = new Set();
            const flashGroups = [];
            const flashGrid = new Map();
            const drillGroups = [];
            const drillGrid = new Map();

            // 在 0.05mm 栅格里就近查找分组，找不到就新建（顺带兼容边界跨格）
            const _findOrPush = (groups, grid, x, y) => {
                const cx = Math.floor(x / CLUSTER_TOL), cy = Math.floor(y / CLUSTER_TOL);
                for (let gx = cx - 1; gx <= cx + 1; gx++) {
                    for (let gy = cy - 1; gy <= cy + 1; gy++) {
                        const idx = grid.get(gx + '_' + gy);
                        if (idx === undefined) continue;
                        const g = groups[idx];
                        if (Math.abs(g.x - x) <= CLUSTER_TOL && Math.abs(g.y - y) <= CLUSTER_TOL) return idx;
                    }
                }
                groups.push({ x: x, y: y, layers: new Set() });
                const idx = groups.length - 1;
                grid.set(cx + '_' + cy, idx);
                return idx;
            };
            const _nearestDrill = (x, y) => {
                const cx = Math.floor(x / CLUSTER_TOL), cy = Math.floor(y / CLUSTER_TOL);
                for (let gx = cx - 1; gx <= cx + 1; gx++) {
                    for (let gy = cy - 1; gy <= cy + 1; gy++) {
                        const idx = drillGrid.get(gx + '_' + gy);
                        if (idx === undefined) continue;
                        const g = drillGroups[idx];
                        if (Math.abs(g.x - x) <= CLUSTER_TOL && Math.abs(g.y - y) <= CLUSTER_TOL) return g;
                    }
                }
                return null;
            };
            const _hasDrillNear = (x, y) => !!_nearestDrill(x, y);

            // 过孔 vs 插件焊盘（THT）的补充判据 —— Gerber 里两者都是「圆形闪绘 + 钻孔」，
            // 只靠「多层 + 有钻孔」会把插件脚（例如 1.5mm 孔 / 4.0mm 盘）也判成过孔，
            // 导入 EDA 后器件脚就"变成过孔"了。真实板子的经验规律：
            //   过孔：孔径小(常见 0.2~0.5mm)、铜环窄(0.15mm 左右)
            //   插件焊盘：孔径大(≥0.6mm)、铜环宽(≥0.25mm)
            // 两个条件**同时**满足才改判为焊盘（保守：宁可少改，不误伤大过孔/电源过孔）。
            const THT_DRILL_MIN = 0.6;    // mm
            const THT_RING_MIN = 0.25;    // mm
            const _isThruHolePad = (flashDia, drill) => {
                if (!drill) return false;
                const drillDia = Number(drill.dia || Math.min(drill.w, drill.h) || 0);
                const ring = (flashDia - drillDia) / 2;
                return drillDia >= THT_DRILL_MIN && ring >= THT_RING_MIN;
            };

            files.forEach((_f) => {
                const _lid = _f.layerId;
                const _isCu = (_lid === 1 || _lid === 2 || (_lid >= 15 && _lid <= 46));
                const _isDrill = (_lid === 47 || _lid === 500 || _lid === 501 || _lid === 502
                    || /\.(drl|xln|nc|ncd)$/i.test(_f.name || ''));
                if (!_isCu && !_isDrill) return;
                const _cmds = (_f.data && _f.data.commands) ? _f.data.commands : [];
                for (let _i = 0; _i < _cmds.length; _i++) {
                    const _c = _cmds[_i];
                    if (_c.type !== 3) continue;
                    if (typeof _c.x !== 'number' || !isFinite(_c.x)) continue;
                    if (typeof _c.y !== 'number' || !isFinite(_c.y)) continue;
                    if (_isDrill) {
                        // 记录钻孔孔径（mm）：解析阶段已把钻孔刀具换算成 mm
                        const _ap = _f.data.apertures ? _f.data.apertures[_c.ap] : null;
                        let _dia = 0;
                        if (_ap && Array.isArray(_ap.params)) {
                            const _p = _ap.params.map(Number).filter(v => isFinite(v) && v > 0);
                            if (_p.length) _dia = Math.min.apply(null, _p);
                        }
                        const _di = _findOrPush(drillGroups, drillGrid, _c.x, _c.y);
                        if (_dia > 0) drillGroups[_di].dia = _dia;
                        continue;
                    }
                    const _idx = _findOrPush(flashGroups, flashGrid, _c.x, _c.y);
                    flashGroups[_idx].layers.add(_lid);
                    copperLayerIds.add(_lid);
                }
            });
            const copperLayerCount = copperLayerIds.size;
            // 判定某个铜层 Flash 是否应作为「过孔」处理
            const isViaFlash = (_lid, _cmd, _ap) => {
                if (_lid >= 15 && _lid <= 46) return true;              // 内层不可能是普通焊盘
                if (copperLayerCount < 2) return false;                 // 单面板无从判断
                const _t = String((_ap && _ap.type) || 'C').toUpperCase();
                if (!(_t === 'C' || _t === 'CIRCLE')) return false;     // 只有圆形才可能是过孔
                const _idx = _findOrPush(flashGroups, flashGrid, _cmd.x, _cmd.y);
                if (flashGroups[_idx].layers.size < 2) return false;    // 只出现在一个铜层 → 表贴焊盘
                const _drill = _nearestDrill(_cmd.x, _cmd.y);
                if (!_drill) return false;                              // 必须有对应钻孔
                // 大孔 + 宽铜环 → 插件焊盘（不是过孔）
                let _flashDia = 0;
                if (_ap && Array.isArray(_ap.params) && isFinite(_ap.params[0])) {
                    _flashDia = _ap.type === 'O' || _ap.type === 'R'
                        ? Math.min(Number(_ap.params[0]) || 0, Number(_ap.params[1]) || Infinity)
                        : Number(_ap.params[0]) || 0;
                }
                if (_isThruHolePad(_flashDia, _drill)) return false;
                return true;
            };

            // ---- POLYGON 焊盘去重索引 ----
            // 旧实现用 `rawPads.some(...)` 对每个宏焊盘全表扫一遍（只看 POLYGON），
            // 宏焊盘上万时是 O(n²)，实测吃掉 0.5s+。这里按「图层 + 0.01mm 栅格」建索引，
            // 判定容差仍是原来的 0.005mm（3×3 邻格覆盖，避免跨格漏判）。
            const POLY_PAD_TOL = 0.005;
            const polyPadIdx = new Map();            // layerId -> Map(cellKey -> [{x,y}])
            const polyCellOf = (v) => Math.floor(v / 0.01);
            const hasPolyPadAt = (layerId, x, y) => {
                const m = polyPadIdx.get(layerId);
                if (!m) return false;
                const cx = polyCellOf(x), cy = polyCellOf(y);
                for (let gx = cx - 1; gx <= cx + 1; gx++) {
                    for (let gy = cy - 1; gy <= cy + 1; gy++) {
                        const arr = m.get(gx * 65536 + gy);
                        if (!arr) continue;
                        for (let i = 0; i < arr.length; i++) {
                            if (Math.abs(arr[i].x - x) < POLY_PAD_TOL && Math.abs(arr[i].y - y) < POLY_PAD_TOL) return true;
                        }
                    }
                }
                return false;
            };
            const addPolyPadAt = (layerId, x, y) => {
                let m = polyPadIdx.get(layerId);
                if (!m) polyPadIdx.set(layerId, m = new Map());
                const k = polyCellOf(x) * 65536 + polyCellOf(y);
                let arr = m.get(k);
                if (!arr) m.set(k, arr = []);
                arr.push({ x: x, y: y });
            };

            files.forEach(file => {
                const layerId = file.layerId;
                const fileUnit = file.data.units; 
                // toMM：把「仍是文件单位」的量换算成 mm —— 光圈参数、宏参数、钻孔原文数值都用它。
                // 注意：cmd.x / cmd.y / cmd.i / cmd.j / cmd.path 里的坐标在解析阶段**已经**换算成 mm，
                // 这里绝不能再乘一次 25.4。历史上就是这么错的：英寸单位文件的焊盘/导线/过孔
                // 位置整体偏大 25.4 倍，导进 EDA 后全部飞出板外，看起来就像"导入失败"。
                const toMM = (val) => (val === null || val === undefined) ? 0 : (fileUnit === 'in' ? val * 25.4 : val);
                // mmOf：读取「解析后已是 mm」的坐标，只做有限性保护
                const mmOf = (val) => (typeof val === 'number' && isFinite(val)) ? val : 0;

                // G36/G37 区域 → 路径操作数组（坐标已是 mm）。暗区（实体）与清区（挖空）共用。
                const regionPathOf = (cmd) => {
                    const regionOps = Array.isArray(cmd.path) ? cmd.path : [];
                    return regionOps.map(op => {
                        if (op.cmd === 'M' || op.cmd === 'L') return { cmd: op.cmd, x: mmOf(op.x), y: mmOf(op.y) };
                        if (op.cmd === 'A') {
                            const sX = mmOf(op.startX); const sY = mmOf(op.startY);
                            const eX = mmOf(op.x); const eY = mmOf(op.y);
                            const cX = sX + mmOf(op.i); const cY = sY + mmOf(op.j);
                            const startAngle = Math.atan2(sY - cY, sX - cX);
                            const endAngle = Math.atan2(eY - cY, eX - cX);
                            let sweep = endAngle - startAngle;
                            if (op.mode === 3) { if (sweep <= 0) sweep += 2 * Math.PI; }
                            else { if (sweep >= 0) sweep -= 2 * Math.PI; }
                            return { cmd: 'ARC', x: eX, y: eY, sweep: sweep * 180 / Math.PI, cx: cX, cy: cY };
                        }
                        return null;
                    }).filter(Boolean);
                };

                // 清区（LPC）闪绘 → 挖空内环。
                // 负片覆铜（KiCad / Altium 的负片平面）会把「焊盘/过孔的间隙」画成 LPC 闪绘，
                // 「走线隔离带」画成 LPC 线段。只丢区域、不管这两类的话，导出的覆铜就是
                // 一整块实心铜（把该隔离的地方全连起来）—— 用户看到的「多块填充变成一整块矩形」。
                const clearFlashRing = (ap, cx, cy) => {
                    if (!ap) return null;
                    const t = String(ap.type || 'C').toUpperCase();
                    const p = ap.params || [];
                    const dia = toMM(p[0] || 0);
                    if (dia <= 0) return null;
                    if (t === 'C' || t === 'CIRCLE') {
                        const r = dia / 2;
                        return [{ cmd: 'M', x: cx - r, y: cy },
                            { cmd: 'ARC', x: cx + r, y: cy, sweep: 180, cx: cx, cy: cy },
                            { cmd: 'ARC', x: cx - r, y: cy, sweep: 180, cx: cx, cy: cy }];
                    }
                    const w = dia, h = toMM(p.length > 1 ? p[1] : p[0]) || dia;
                    if (t === 'O' || t.includes('OVAL') || t.includes('OBROUND')) {
                        const off = Math.max(0, (Math.max(w, h) - Math.min(w, h)) / 2);
                        return w >= h ? clearStrokeRing(cx - off, cy, cx + off, cy, Math.min(w, h))
                            : clearStrokeRing(cx, cy - off, cx, cy + off, Math.min(w, h));
                    }
                    // R / 宏（退化）→ 矩形（宏的精确轮廓交给 PAD 分支处理，这里只用于挖空近似）
                    return rectRing(cx, cy, w, h);
                };
                const rectRing = (cx, cy, w, h) => {
                    const hw = w / 2, hh = h / 2;
                    return [{ cmd: 'M', x: cx - hw, y: cy - hh },
                        { cmd: 'L', x: cx + hw, y: cy - hh }, { cmd: 'L', x: cx + hw, y: cy + hh },
                        { cmd: 'L', x: cx - hw, y: cy + hh }, { cmd: 'L', x: cx - hw, y: cy - hh }];
                };
                // 线段（宽 w）→ 圆头"胶囊"内环：两条边 + 两个 180° 端弧。
                // 【方向铁律】端弧必须**顺时针**(-180)：
                //   路径顺序是 (p1+n) → (p2+n) → 端弧 → (p2-n) → (p1-n) → 端弧，其中 n 是线段方向的
                //   左法线。在 p2 处要从 +n 转到 -n，只有沿「线段前进方向」绕过去（顺时针）才是圆头；
                //   写成 +180（逆时针）会从内侧绕，端头被啃成一个内凹月牙 —— 形状与面积都错
                //   （实测：10×2 的隔离带面积 16.86 而非 23.14，圆头丢失）。
                const clearStrokeRing = (x1, y1, x2, y2, w) => {
                    const dia = w > 0 ? w : 0.1;
                    const dx = x2 - x1, dy = y2 - y1;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len < 1e-6) return clearFlashRing({ type: 'C', params: [dia] }, x1, y1);
                    const nx = -dy / len * dia / 2, ny = dx / len * dia / 2;
                    return [{ cmd: 'M', x: x1 + nx, y: y1 + ny },
                        { cmd: 'L', x: x2 + nx, y: y2 + ny },
                        { cmd: 'ARC', x: x2 - nx, y: y2 - ny, sweep: -180, cx: x2, cy: y2 },
                        { cmd: 'L', x: x1 - nx, y: y1 - ny },
                        { cmd: 'ARC', x: x1 + nx, y: y1 + ny, sweep: -180, cx: x1, cy: y1 }];
                };
                
                const rawContent = getRawContent(file.name);
                // 优先使用解析器已经解析好的宏（含 $n 参数化宏），退化时才自行扫一遍原文
                const macroDefs = (file.data.macros && Object.keys(file.data.macros).length)
                    ? file.data.macros : parseGerberMacros(rawContent);
                // 宏解析结果缓存（键 = 宏名|参数）：同一光圈会被成百上千颗焊盘复用
                const macroShapeCache = new Map();

                // 数据来源是否为「嘉立创专业版」：它会在 G04 里用 Pad/Via/Track/PolygonModel…
                // Start/End 这类私有段标记说明每一段图形的用途。KiCad / Altium / P-CAD /
                // 嘉立创**标准版**导出的 Gerber 没有这些标记，必须按图层与指令类型自行推断，
                // 否则焊盘与导线会被整体丢弃（这正是"只有钻孔导入成功"的原因）。
                const hasSectionMarkers = /G04[^\r\n*]*(?:Pad|Via|Track|PolygonModel|Copper|Image|Text|Rect|Circle|Dimension|Drill Drawing)[^\r\n*]*(?:Start|End)/.test(rawContent || '');
                
                // 铜层：用于判断 Flash 该做焊盘、Drawing 该做导线
                const isCopperLayer = (layerId === 1 || layerId === 2 || (layerId >= 15 && layerId <= 46));

                // A. 钻孔文件处理
                // [修复] 增加 layerId === 502 (埋盲孔)，确保该图层被作为钻孔数据提取
                if (layerId === 47 || layerId === 500 || layerId === 501 || layerId === 502 || file.name.endsWith('.drl') || file.name.endsWith('.txt')) {
                    if (rawContent) {
                        const fileLines = rawContent.split(/\r?\n/);
                        const tools = {}; let currentTool = null;
                        const regexToolDef = /T(\d+)[^C]*C([\d.]+)/; const regexToolSel = /T(\d+)(?!C)/; 
                        // 钻孔原文里的坐标是「无小数点的整数」，必须按文件声明的格式除以 10^dec
                        // 才能得到文件单位。历史上漏了这一步：只有 2.4 英寸（div=1e4）碰巧接近，
                        // 其它精度（例如嘉立创专业版 METRIC,LZ,000.00000 的 1e5）就整体差 10 倍。
                        const fdiv = (file.data.format && file.data.format.divX) ? file.data.format.divX : 10000;
                        const drillUnitMult = (fileUnit === 'in') ? 25.4 : 1;
                        const manualToMM = (raw) => {
                            const v = parseFloat(raw);
                            if (!isFinite(v)) return 0;
                            // 已经带小数点的是绝对值，不再除格式因子
                            const scaled = String(raw).indexOf('.') !== -1 ? v : v / fdiv;
                            return scaled * drillUnitMult;
                        };
                        for (let line of fileLines) {
                            line = line.trim();
                            const matchDef = line.match(regexToolDef); if (matchDef) { tools[matchDef[1]] = matchDef[2]; continue; }
                            const matchSel = line.match(regexToolSel); if (matchSel) { currentTool = matchSel[1]; continue; }
                            if (line.includes('G85') && currentTool) {
                                const coords = line.match(/X([\d.-]+)Y([\d.-]+).*?X([\d.-]+)Y([\d.-]+)/);
                                if (coords) {
                                    const x1 = manualToMM(coords[1]); const y1 = manualToMM(coords[2]);
                                    const x2 = manualToMM(coords[3]); const y2 = manualToMM(coords[4]);
                                    const dia = manualToMM(tools[currentTool]);
                                    const cx = (x1 + x2) / 2; const cy = (y1 + y2) / 2;
                                    const dx = x2 - x1; const dy = y2 - y1;
                                    const len = Math.sqrt(dx*dx + dy*dy);
                                    let rotation = Math.atan2(dy, dx) * 180 / Math.PI;
                                    while (rotation > 90.1) rotation -= 180; while (rotation < -89.9) rotation += 180;
                                    drills.push({ 
                                        x: cx, y: cy, w: len + dia, h: dia, 
                                        rotation: rotation, dia: dia, 
                                        isPlated: layerId !== 501, 
                                        isSlot: true,
                                        pairStart: file.pairStart, // <--- 新增
                                        pairEnd: file.pairEnd      // <--- 新增
                                    });
                                    slotOccupiedPoints.push({x: cx, y: cy}, {x: x1, y: y1}, {x: x2, y: y2});
                                }
                            }
                        }
                    }
                    file.data.commands.forEach(cmd => {
                        if (cmd.type === 3) { 
                            // 坐标已由解析器换算成 mm
                            const cx = mmOf(cmd.x); const cy = mmOf(cmd.y);
                            if (slotOccupiedPoints.some(p => Math.abs(p.x - cx) < 0.05 && Math.abs(p.y - cy) < 0.05)) return;
                            const ap = file.data.apertures[cmd.ap];
                            if (ap) {
                                let w = 0, h = 0; const p = ap.params;
                                // 钻孔刀具的直径在解析阶段也已换算成 mm
                                if (ap.type === 'C') { w = mmOf(p[0]); h = w; } else if (ap.type === 'O' || ap.type === 'R') { w = mmOf(p[0]); h = mmOf(p[1]); }
                                // [修改 2] 在 push 时增加 pairStart 和 pairEnd
                                if (w > 0) drills.push({ 
                                    x: cx, y: cy, w: w, h: h, 
                                    rotation: 0, dia: Math.min(w, h), 
                                    isPlated: layerId !== 501, 
                                    isSlot: Math.abs(w - h) > 0.01,
                                    pairStart: file.pairStart, // <--- 新增
                                    pairEnd: file.pairEnd      // <--- 新增
                                });
                            }
                        }
                    });
                    return; 
                }

                // B. 图层文件解析
                let mode = "NONE"; 
                const cmds = file.data.commands;
                let currX = 0, currY = 0;
                let tempPolySegments = []; 
                let currentWidth = 0.254;

                const flushPoly = () => {
                    if (tempPolySegments.length > 0) {
                        const merged = mergeSegments(tempPolySegments);
                        merged.forEach(m => {
                            if (mode === "IMAGE") {
                                rawImages.push({ layerId, width: m.width, path: m.path });
                            } else if (mode === "TEXT" && !textAsPoly) {
                                rawTextLines.push({ layerId, width: m.width, path: m.path });
                            } else if (mode === "TEXT") {
                                // 标准版：Text 段的 G01 按 PolygonModel 处理 —— 落 rawPolys
                                // （isStroke=true → 标准版导出成带线宽的多点 TRACK）。
                                rawPolys.push({ layerId, width: m.width, path: m.path, isStroke: true, fromText: true });
                            } else {
                                let targetLayer = layerId;
                                // 56 是 DrillDrawing, 导出时通常归类到 Document(13) 或保持 56
                                // 这里保持 56，GeneratePrimitives 中已处理
                                // isStroke：来自 G04 Copper 段的「描边铜」（G36 区域外的 D01/弧）。
                                // 它不是实心多边形，而是一条带线宽的多段线 —— 标准版导出必须按
                                // TRACK 折线写，不能走 SOLIDREGION（后者只写中心线，会把 0.2mm
                                // 的描边铜变成零宽轮廓，几何彻底丢失）。
                                rawPolys.push({ layerId: targetLayer, width: m.width, path: m.path, isStroke: !!m.stroke });
                            }
                        });
                        tempPolySegments = [];
                    }
                };

                for (let i = 0; i < cmds.length; i++) {
                    const cmd = cmds[i];

                    // 无段标记的来源（KiCad / Altium / P-CAD / 嘉立创标准版）：
                    // 按「图层 + 指令类型」推断本段的用途 —— 铜层 Flash 是焊盘、
                    // 铜层 Drawing 是导线、其它层的 Drawing 是折线。不做这层推断，
                    // 焊盘与导线会被整体丢弃（用户看到的就是"只有钻孔导入成功"）。
                    const effMode = hasSectionMarkers ? mode
                        // 区域：铜层 → 覆铜（按需求用「折线闭合轮廓」承载）；其它层 → 填充
                        : (cmd.type === 4) ? (isCopperLayer ? 'POUR' : 'FILL')
                        // Flash：内层 / 圆形+有钻孔+跨层 → 过孔；其余 → 焊盘
                        : (cmd.type === 3) ? (isViaFlash(layerId, cmd, file.data.apertures[cmd.ap]) ? 'VIA' : 'PAD')
                        : (cmd.type === 1 || cmd.type === 2) ? (isCopperLayer ? 'TRACK' : 'POLY')
                        : mode;
                    
                    // 1. G04 状态切换
                    if (cmd.type === 5) { 
                        if (cmd.text.includes("Pad Start")) { flushPoly(); mode = "PAD"; }
                        else if (cmd.text.includes("Pad End")) { mode = "NONE"; }
                        else if (cmd.text.includes("Via Start")) { flushPoly(); mode = "VIA"; }
                        else if (cmd.text.includes("Via End")) { mode = "NONE"; }
                        else if (cmd.text.includes("Track Start")) { flushPoly(); mode = "TRACK"; }
                        else if (cmd.text.includes("Track End")) { mode = "NONE"; }
                        else if (cmd.text.includes("PolygonModel Start") || cmd.text.includes("Rect Start") || cmd.text.includes("Circle Start")) { 
                            flushPoly(); mode = "POLY"; 
                        }
                        else if (cmd.text.includes("PolygonModel End") || cmd.text.includes("Rect End") || cmd.text.includes("Circle End")) { 
                            flushPoly(); mode = "NONE"; 
                        }
                        else if (cmd.text.includes("Image Start")) { flushPoly(); mode = "IMAGE"; }
                        else if (cmd.text.includes("Image End")) { flushPoly(); mode = "NONE"; }
                        else if (cmd.text.includes("Text Start")) { flushPoly(); mode = "TEXT"; }
                        else if (cmd.text.includes("Text End")) { flushPoly(); mode = "NONE"; }
                        // 文档层标注（尺寸线 / 文字笔画 / 箭头）：GDL 里的「Dimension Start…End」
                        // 段既不是 Pad 也不是 PolygonModel/Rect，旧实现没有任何分支匹配它 →
                        // mode 停在 NONE → 这些线段被整段丢弃（画布上只剩 Rect，标注全没了）。
                        // 它们是「带线宽的折线」，与 Rect / Text 一样走 POLY。
                        else if (cmd.text.includes("Dimension Start")) { flushPoly(); mode = "POLY"; }
                        else if (cmd.text.includes("Dimension End")) { flushPoly(); mode = "NONE"; }
                        else if (cmd.text.includes("Copper Start")) { flushPoly(); mode = "COPPER"; }
                        else if (cmd.text.includes("Copper End")) { flushPoly(); mode = "NONE"; }
                        // [新增] 钻孔图支持
                        else if (cmd.text.includes("Drill Drawing Start")) { flushPoly(); mode = "DRILL_SYM"; }
                        else if (cmd.text.includes("Drill Drawing End")) { flushPoly(); mode = "NONE"; }
                        continue;
                    }

                    // 1.5 极性：LPC（清除）是「挖空」而不是实体铜。
                    // 线：Gerber 常见写法是先用 LPC 以较粗的光圈画一遍隔离带（例如 0.85mm），
                    //     再用 LPD 以真实线宽画走线（例如 0.25mm）。若把 LPC 也当实体生成图元，
                    //     就会凭空多出一批粗线（「10mil 变成 33.5mil」就是这个原因）→ 直接跳过。
                    // 区域：**不能跳过**。覆铜的常见表达就是「一整块暗区 + 若干清区挖空」，
                    //     丢掉清区会只剩那块整板大小的暗区 —— 用户看到的就是
                    //     「多块填充变成了一整块矩形填充」。这里先把清区收集起来，
                    //     主循环结束后挂到包含它的暗区上作为内环（复合多边形的孔）。
                    // 注意：仍要推进当前点，否则后续 LPD 段的起点会错。
                    if (cmd.polarity === 'C') {
                        if (cmd.type === 4) {
                            rawClearRegions.push({ layerId, path: regionPathOf(cmd) });
                        } else if (cmd.type === 3) {
                            // 清区闪绘（焊盘/过孔的间隙）→ 挖空内环
                            const ring = clearFlashRing(file.data.apertures[cmd.ap], mmOf(cmd.x), mmOf(cmd.y));
                            if (ring) rawClearRings.push({ layerId, path: ring });
                            currX = mmOf(cmd.x); currY = mmOf(cmd.y);
                        } else if (cmd.type === 1) {
                            // 清区线段（隔离带）→ 胶囊内环；圆弧按弦近似
                            const ap = file.data.apertures[cmd.ap];
                            const w = ap ? toMM((ap.params || [])[0] || 0.1) : 0.1;
                            const tx = mmOf(cmd.x), ty = mmOf(cmd.y);
                            const ring = clearStrokeRing(currX, currY, tx, ty, w);
                            if (ring) rawClearRings.push({ layerId, path: ring });
                            currX = tx; currY = ty;
                        } else if (cmd.type === 2) {
                            currX = mmOf(cmd.x); currY = mmOf(cmd.y);
                        }
                        continue;
                    }

                    // 2. 区域填充 (G36/G37)
                    if (cmd.type === 4) { 
                        const pathData = regionPathOf(cmd);

                        if (effMode === "PAD") {
                            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                            pathData.forEach(pt => {
                                if (pt.x !== undefined && pt.y !== undefined) {
                                    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
                                    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
                                }
                            });
                            const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
                            rawPads.push({ layerId, x: cx, y: cy, shape: 'POLYGON', path: pathData, w: 0, h: 0, rotation: 0 });
                            addPolyPadAt(layerId, cx, cy);
                            continue;
                        }

                        if (effMode === "IMAGE" || effMode === "TEXT") {
                            rawImages.push({ layerId, path: pathData, isRegion: true });
                        } else if (effMode === "POUR" || effMode === "COPPER") {
                            // 覆铜（无段标记来源：嘉立创EDA标准版 / KiCad / Altium / Eagle …）：
                            // 生成「实心填充 (FILL)」，与画布上的渲染保持一致。
                            // 【历史做法】曾把覆铜降级成 0.1mm 细线的「闭合折线轮廓」(POLY)，
                            // 结果导入 EDA 后整块铜只剩一圈发丝线：画布上看得见铜、导入后铜
                            // 却"没有"了 —— 属于图元类型错误。FILL 走的是与其它层区域填充
                            // 完全相同的 createComplexPolygon 通道，已验证可用。
                            rawFills.push({ layerId, path: pathData });
                        } else {
                            let targetLayer = layerId;
                            if (targetLayer === 56) targetLayer = 56; // 显式保留
                            // FPC 补强层（58/59）：材料与厚度来自文件名（file.stiffener），
                            // 挂到填充项上，生成阶段据此输出 FPC_FILL 而不是普通 FILL。
                            rawFills.push({ layerId: targetLayer, path: pathData, stiffener: file.stiffener || null });
                        }
                        continue;
                    }

                    // 3. 线性绘图 (G01/02/03)
                    if (cmd.type === 1 || cmd.type === 2) {
                        // 坐标已是 mm
                        const targetX = mmOf(cmd.x); const targetY = mmOf(cmd.y);
                        
                        if (cmd.type === 1) {
                            const ap = file.data.apertures[cmd.ap];
                            if (ap) currentWidth = toMM(ap.params[0]);   // 光圈参数仍是文件单位
                        }

                        if (effMode === "TRACK") {
                            if (isCopperLayer && cmd.type === 1) {
                                if (cmd.mode === 1) { rawTracks.push({ type: "LINE", layerId, x1: currX, y1: currY, x2: targetX, y2: targetY, width: currentWidth }); } 
                                else { 
                                    const centerX = currX + mmOf(cmd.i); const centerY = currY + mmOf(cmd.j);
                                    const startAngle = Math.atan2(currY - centerY, currX - centerX);
                                    const endAngle = Math.atan2(targetY - centerY, targetX - centerX);
                                    let sweep = endAngle - startAngle;
                                    if (cmd.mode === 3) { if (sweep <= 0) sweep += 2 * Math.PI; } else { if (sweep >= 0) sweep -= 2 * Math.PI; }
                                    // 【整圆修复】起点=终点的 360° 整圆弧（嘉立创EDA标准版导出的 CIRCLE
                                    // 图元就是这样一条铜箔圆弧）。直接导出成 angle=360 的两点圆弧，
                                    // EDA 侧无法还原（两点重合、方向未定义），整圆会丢失或画错。
                                    // 拆成两段 180° 半圆，端点取圆心两侧的对称点，几何完全等价。
                                    const radiusMM = Math.sqrt(cmd.i * cmd.i + cmd.j * cmd.j);
                                    const isFullCircle = radiusMM > 1e-9
                                        && Math.abs(targetX - currX) < 1e-6 && Math.abs(targetY - currY) < 1e-6;
                                    if (isFullCircle) {
                                        const dir = (cmd.mode === 3) ? 1 : -1;   // G03 逆时针为正
                                        const px = centerX - radiusMM, py = centerY;
                                        const qx = centerX + radiusMM, qy = centerY;
                                        rawTracks.push({ type: "ARC", layerId, x1: px, y1: py, x2: qx, y2: qy, angle: 180 * dir, width: currentWidth });
                                        rawTracks.push({ type: "ARC", layerId, x1: qx, y1: qy, x2: px, y2: py, angle: 180 * dir, width: currentWidth });
                                    } else {
                                        rawTracks.push({ type: "ARC", layerId, x1: currX, y1: currY, x2: targetX, y2: targetY, angle: sweep * 180 / Math.PI, width: currentWidth });
                                    }
                                }
                            }
                        }
                        // 折线流程：POLY / IMAGE / TEXT / DRILL_SYM，以及 **Copper 段的描边铜**。
                        // 【2026-10-17】Copper 段里 G36 区域之外的 D01/弧，以前是逐段生成 LINE/ARC
                        // 走 rawTracks（一条轮廓被拆成几十上百个独立图元，接头处靠圆头重叠掩盖缝隙）。
                        // 现在改走与非铜层折线**完全相同**的流程：先累积 tempPolySegments，切段时
                        // flushPoly → mergeSegments 合并成整条多段线 → rawPolys。
                        // 区别只有两点：
                        //   ① 层号仍是铜层（rawPolys 的 layerId 直接用它），参与铜层网络连通；
                        //   ② 打 stroke 标记，标准版导出按「带线宽的多点 TRACK」写，而不是 SOLIDREGION
                        //      —— SOLIDREGION 只写中心线，会把 0.2mm 的描边铜变成零宽轮廓。
                        else if (effMode === "COPPER" || effMode === "POLY" || effMode === "IMAGE" || effMode === "TEXT" || effMode === "DRILL_SYM") { 
                            // 注意：DRILL_SYM 的线段也作为 POLY 处理
                            if (cmd.type !== 2) {
                                const stroke = (effMode === "COPPER");
                                let seg = { x1: currX, y1: currY, x2: targetX, y2: targetY, width: currentWidth };
                                if (stroke) seg.stroke = true;
                                if (cmd.mode === 1) {
                                    seg.type = 'LINE';
                                    tempPolySegments.push(seg);
                                } else {
                                    seg.type = 'ARC';
                                    const centerX = currX + mmOf(cmd.i); const centerY = currY + mmOf(cmd.j);
                                    const startAngle = Math.atan2(currY - centerY, currX - centerX);
                                    const endAngle = Math.atan2(targetY - centerY, targetX - centerX);
                                    let sweep = endAngle - startAngle;
                                    if (cmd.mode === 3) { if (sweep <= 0) sweep += 2 * Math.PI; } else { if (sweep >= 0) sweep -= 2 * Math.PI; }
                                    const radiusMM = Math.sqrt(cmd.i * cmd.i + cmd.j * cmd.j);
                                    const isFullCircle = radiusMM > 1e-9
                                        && Math.abs(targetX - currX) < 1e-6 && Math.abs(targetY - currY) < 1e-6;
                                    if (isFullCircle) {
                                        // POLY 的圆弧只记「终点 + 扫角」，360° 无法被 EDA 还原
                                        // → 从当前点起按对径点拆成两段 180°，几何完全等价且路径连续。
                                        const dir = (cmd.mode === 3) ? 1 : -1;
                                        const ox = 2 * centerX - currX, oy = 2 * centerY - currY;
                                        tempPolySegments.push({ x1: currX, y1: currY, x2: ox, y2: oy, width: currentWidth, type: 'ARC', angle: 180 * dir, stroke: !!stroke });
                                        tempPolySegments.push({ x1: ox, y1: oy, x2: currX, y2: currY, width: currentWidth, type: 'ARC', angle: 180 * dir, stroke: !!stroke });
                                    } else {
                                        seg.angle = sweep * 180 / Math.PI;
                                        tempPolySegments.push(seg);
                                    }
                                }
                            }
                        }

                        currX = targetX; currY = targetY;
                        continue;
                    }

                    // 4. Flash 指令 (Pad/Via/DrillSymbol)
                    if (cmd.type === 3) { 
                        const ap = file.data.apertures[cmd.ap];
                        if (!ap) continue;
                        
                        // 坐标已是 mm
                        currX = mmOf(cmd.x); 
                        currY = mmOf(cmd.y);

                        // [新增] 处理 Drill Drawing 的图标 Flash
                        if (effMode === "DRILL_SYM") {
                            const pathData = getAperturePath(ap, currX, currY, toMM, macroDefs);
                            if (pathData) {
                                // [修改] 钻孔图层不支持 Polygon，改为存入 rawImages 作为图片处理
                                rawImages.push({ layerId: 56, path: pathData });
                            }
                            continue;
                        }

                        if (effMode === "PAD") {
                            // 检查宏定义（支持 P-CAD / 嘉立创 / EasyEDA Pro 的参数化宏）
                            // 宏表达式求值（$n 代入 + 递归下降）每颗焊盘都要跑一遍太贵，
                            // 按「宏名 + 参数」缓存 —— 同一块板上宏光圈种类是个位数，
                            // 缓存后只剩首次求值（实测本板省 0.3s）。
                            const _mk = ap.type + '|' + (ap.params || []).join(',');
                            let macroShape = macroShapeCache.get(_mk);
                            if (macroShape === undefined) {
                                macroShape = macroDefs[ap.type]
                                    ? resolveApertureMacro(macroDefs[ap.type], ap.params || []) : null;
                                macroShapeCache.set(_mk, macroShape || null);
                            }
                            if (macroShape) {
                                let pathData = [];
                                if (macroShape.type === 'POLYGON' && macroShape.points && macroShape.points.length) {
                                    const start = macroShape.points[0];
                                    pathData.push({ cmd: 'M', x: currX + toMM(start.x), y: currY + toMM(start.y) });
                                    for (let k = 1; k < macroShape.points.length; k++) {
                                        const pt = macroShape.points[k];
                                        pathData.push({ cmd: 'L', x: currX + toMM(pt.x), y: currY + toMM(pt.y) });
                                    }
                                    pathData.push({ cmd: 'L', x: currX + toMM(start.x), y: currY + toMM(start.y) });
                                } else {
                                    // toMM(1) 即「文件单位 -> mm」的倍率
                                    pathData = macroPrimsToPath(macroShape, currX, currY, toMM(1),
                                        ap.type + '|' + (ap.params || []).join(','));
                                }
                                if (pathData.length >= 3) {
                                    rawPads.push({ layerId, x: currX, y: currY, shape: 'POLYGON', path: pathData, w: 0, h: 0, rotation: 0 });
                                    addPolyPadAt(layerId, currX, currY);
                                }
                                continue;
                            }

                            // 检查重叠（**同一图层内**才算重复）
                            // ⚠️ 这里必须按 layerId 限定范围：rawPads 是所有图层的公共数组，
                            // 而「顶层阻焊(5) → 底层铜(2) → 内层(15..)」的处理顺序意味着
                            // 阻焊层的宏多边形焊盘会先入队。旧实现不带 layerId 判断，于是
                            // 同一坐标的底层铜焊盘被当成"已有多边形焊盘"直接跳过 —— 通孔矩形
                            // 焊盘就只剩顶层，钻孔再被拆成独立过孔，底层彻底没焊盘。
                            if (hasPolyPadAt(layerId, currX, currY)) continue;

                            // 标准处理
                            const p = ap.params || [];
                            const type = (ap.type || 'C').toUpperCase();
                            let w = toMM(p[0]||0.1); let h = w; if (p.length > 1) h = toMM(p[1]);

                            let shape = 'ELLIPSE'; let rotation = 0; let radiusRatio = 0;
                            if (p.length >= 5 && (type.includes('RECT') || type.includes('OVAL') || type.includes('ROUND'))) {
                                const dia = toMM(p[0]); const p1_x = toMM(p[1]); const p1_y = toMM(p[2]); const p2_x = toMM(p[3]); const p2_y = toMM(p[4]);
                                const dx = p2_x - p1_x; const dy = p2_y - p1_y;
                                const len1 = Math.sqrt(dx*dx + dy*dy); const dx2 = (-p1_x) - p2_x; const dy2 = (-p1_y) - p2_y; const len2 = Math.sqrt(dx2*dx2 + dy2*dy2);
                                let dimX = len1 + dia; let dimY = len2 + dia;
                                let rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
                                w = dimX; h = dimY; rotation = rawAngle;
                                while (rotation > 90.1) { rotation -= 90; [w, h] = [h, w]; } while (rotation < -89.9) { rotation += 90; [w, h] = [h, w]; }
                                rotation = parseFloat(rotation.toFixed(2)); if (Math.abs(rotation) < 0.01) rotation = 0;
                                if (type.includes('OVAL')) shape = 'OVAL'; else { shape = 'RECT'; radiusRatio = PadTool.calcRadiusRatio(dia / 2, w, h); }
                            } else if (type === 'O' || type.includes('OVAL') || type.includes('OBROUND')) {
                                shape = 'OVAL'; w = toMM(p[0]); h = p.length > 1 ? toMM(p[1]) : w; if (p.length >= 3 && p[2]) rotation = parseFloat(p[2]);
                            } else {
                                w = toMM(p[0]||0.1); h = p.length > 1 ? toMM(p[1]) : w; 
                                if (p.length >= 3 && p[2]) rotation = parseFloat(p[2]);
                                if (p.length >= 4 && p[3] > 0) radiusRatio = PadTool.calcRadiusRatio(toMM(p[3]), w, h);
                                if (type === 'C' || type === 'CIRCLE') { shape = 'ELLIPSE'; h = w; } else { shape = 'RECT'; }
                            }
                            if (w > 0 && h > 0) rawPads.push({ layerId, x: currX, y: currY, shape, w, h, rotation, radiusRatio });
                        }
                        else if (effMode === "VIA") {
                            const p = ap.params || [];
                            let dia = toMM(p[0]||0.1);
                            rawVias.push({ layerId, x: currX, y: currY, dia });
                        }
                    }
                }
                flushPoly();
            });

            // ---- 清区（LPC）挂到暗区上作为挖空 ----
            // Gerber 常把一块覆铜写成「暗区(整块) + 清区(挖空)」。丢掉清区就只剩整块铜，
            // 导入 EDA 后表现为「一大块矩形填充」。
            // 【关键】清区要从**所有与它重叠的同层暗区**里挖掉：负片里的一个间隙常常横跨好几块
            // 暗区（主板覆铜 + 补铜块 + 铺铜块），只挂给其中一块，其余块就会留下本该挖掉的铜
            // —— 实测这是残余多铜的主因（0802-2 顶铜多出 1.7M 像素里的大部分）。
            // 例外：整块暗区都落在清区内部时，它是「清区之后再补画的铜」（island），不能挖，
            // 否则会被整块抹掉。
            if ((rawClearRegions.length || rawClearRings.length) && rawFills.length) {
                // 包围盒（**必须先展平圆弧**）
                // ⚠️ 只取圆弧的「终点」算包围盒会得到退化结果：嘉立创负片平面里的隔离孔
                // 绝大多数是「整圆 = 两段半圆」，两段的端点都落在同一条直径上 →
                // 包围盒高/宽为 0 → 被下面的 `x1 > x0 && y1 > y0` 判为无效 → 该清区直接丢弃
                // → 平面保持实心 → 落在平面范围内的所有焊盘/过孔都判成「与平面相连」
                // → 整板并成一个连通块、106 个网络名冲突、整块改名 NET1
                //（实测 Gerber_PCB1_2025-01-11：315 个清区里 250 个因此被丢）。
                const bboxOfPath = (path) => {
                    let pts = path || [];
                    if (typeof fillRingPoints === 'function'
                        && pts.some(pt => pt && (pt.cmd === 'A' || pt.cmd === 'ARC'))) {
                        const flat = fillRingPoints(pts);      // 圆弧按 FILL_ARC_TOL 离散
                        if (flat.length >= 2) pts = flat.map(p => ({ x: p[0], y: p[1] }));
                    }
                    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
                    pts.forEach(pt => {
                        if (typeof pt.x !== 'number' || !isFinite(pt.x)) return;
                        if (typeof pt.y !== 'number' || !isFinite(pt.y)) return;
                        if (pt.x < x0) x0 = pt.x; if (pt.x > x1) x1 = pt.x;
                        if (pt.y < y0) y0 = pt.y; if (pt.y > y1) y1 = pt.y;
                    });
                    return (isFinite(x0) && x1 > x0 && y1 > y0) ? { x0, x1, y0, y1 } : null;
                };
                const bboxCache = new Map();
                rawFills.forEach(f => bboxCache.set(f, bboxOfPath(f.path)));
                // 单块覆铜的挖空数量保护（负片覆铜可能有上千个间隙）
                const MAX_HOLES_PER_FILL = 3000;
                let droppedHoles = 0, attachedTotal = 0, islandSkip = 0, nullBBox = 0, noOverlap = 0;
                const attach = (hole, hb) => {
                    rawFills.forEach(f => {
                        if (f.layerId !== hole.layerId) return;
                        const fb = bboxCache.get(f);
                        if (!fb) return;
                        const ox = Math.min(hb.x1, fb.x1) - Math.max(hb.x0, fb.x0);
                        const oy = Math.min(hb.y1, fb.y1) - Math.max(hb.y0, fb.y0);
                        if (ox <= 1e-6 || oy <= 1e-6) { noOverlap++; return; }   // 包围盒不重叠 → 无关
                        const isIsland = fb.x0 >= hb.x0 - 1e-6 && fb.x1 <= hb.x1 + 1e-6
                            && fb.y0 >= hb.y0 - 1e-6 && fb.y1 <= hb.y1 + 1e-6;
                        if (isIsland) { islandSkip++; return; }          // 清区之后补画的铜 → 保留
                        if (!Array.isArray(f.holes)) f.holes = [];
                        if (f.holes.length >= MAX_HOLES_PER_FILL) { droppedHoles++; return; }
                        f.holes.push(hole.path);
                        attachedTotal++;
                    });
                };
                rawClearRegions.forEach(hole => {
                    const hb = bboxOfPath(hole.path);
                    if (!hb) { nullBBox++; return; }
                    attach(hole, hb);
                });
                rawClearRings.forEach(hole => {
                    const hb = bboxOfPath(hole.path);
                    if (!hb) { nullBBox++; return; }
                    attach(hole, hb);
                });
                // 诊断（DEBUG 打开时输出）：清区收集 vs 实际挖空数量，排查「负片平面被当成实心铜」
                if (typeof DEBUG !== 'undefined' && DEBUG) {
                    console.log(`清区挂载：收集 ${rawClearRegions.length} 区域 + ${rawClearRings.length} 环`
                        + `，挖空 ${attachedTotal}，island 跳过 ${islandSkip}，bbox 无效 ${nullBBox}`
                        + `，无重叠 ${noOverlap}，超限丢弃 ${droppedHoles}`);
                }
                if (droppedHoles > 0) console.warn(`覆铜挖空超过上限，丢弃 ${droppedHoles} 个挖空`);
                if (islandSkip > 0) console.log(`清区挂载：跳过 ${islandSkip} 处「清区后补画的铜(island)」`);
            }

            return { rawPads, rawVias, rawTracks, rawPolys, rawFills, drills, rawImages, rawTextLines }; 
        },

        // --- 2. 聚合阶段 ---
        consolidate: (rawPads, rawVias, rawTracks, rawPolys, rawFills, rawDrills, rawImages, rawTextLines, rawCoppers) => {
            const map = new Map(); 
            const getKey = (x, y) => `${x.toFixed(3)}_${y.toFixed(3)}`;

            // 1. 聚合所有层的焊盘到节点
            rawPads.forEach(p => {
                const key = getKey(p.x, p.y);
                if (!map.has(key)) map.set(key, { x: p.x, y: p.y, top: null, bottom: null, maskTop: null, maskBot: null, pasteTop: null, pasteBot: null, inners: [], drill: null });
                const node = map.get(key);
                if (p.layerId === 1) node.top = p; else if (p.layerId === 2) node.bottom = p; else if (p.layerId === 5) node.maskTop = p; else if (p.layerId === 6) node.maskBot = p; else if (p.layerId === 7) node.pasteTop = p; else if (p.layerId === 8) node.pasteBot = p; else if (p.layerId >= 15 && p.layerId <= 46) node.inners.push(p);
            });
            
            // 过孔铜盘 / 阻焊盘的聚合：**不能**用 toFixed(3) 的精确键。
            // 实测同一个物理点在 Gerber 与钻孔文件之间常差 0.003~0.015mm（还有整块
            // 板子的坐标被四舍五入到不同小数位的情况），精确键会让绝大多数过孔匹配失败，
            // 结果就是 padDia 退化成钻孔直径（过孔没有铜环 → 「焊盘变过孔 / 圆形轮廓丢失」）
            // 并且算不出阻焊扩展（「阻焊丢失」）。这里统一按 0.05mm 容差就近归并。
            const VIA_CLUSTER_TOL = 0.05;
            const viaNodes = [];
            const viaGrid = new Map();
            const _viaCell = (v) => Math.floor(v / VIA_CLUSTER_TOL);
            const _searchViaNode = (x, y) => {
                const gx = _viaCell(x), gy = _viaCell(y);
                let best = null, bestDist = VIA_CLUSTER_TOL;
                for (let i = gx - 1; i <= gx + 1; i++) {
                    for (let j = gy - 1; j <= gy + 1; j++) {
                        const arr = viaGrid.get(i + '_' + j);
                        if (!arr) continue;
                        for (let k = 0; k < arr.length; k++) {
                            const n = arr[k];
                            const dd = Math.sqrt((n.x - x) * (n.x - x) + (n.y - y) * (n.y - y));
                            if (dd <= bestDist) { bestDist = dd; best = n; }
                        }
                    }
                }
                return best;
            };
            const findViaNode = (x, y) => _searchViaNode(x, y);
            const viaNodeAt = (x, y) => {
                const hit = _searchViaNode(x, y);
                if (hit) return hit;
                const node = { x: x, y: y, top: null, maskTop: null, maskBot: null, layers: {} };
                viaNodes.push(node);
                const ck = _viaCell(x) + '_' + _viaCell(y);
                const bucket = viaGrid.get(ck);
                if (bucket) bucket.push(node); else viaGrid.set(ck, [node]);
                return node;
            };
            if (rawVias) {
                rawVias.forEach(v => {
                    const node = viaNodeAt(v.x, v.y);

                    // 将该过孔数据存入对应的 layerId 中
                    if (node.layers) node.layers[v.layerId] = v;

                    if (v.layerId === 1) node.top = v; 
                    else if (v.layerId === 5) node.maskTop = v; 
                    else if (v.layerId === 6) node.maskBot = v; 
                });
            }

            // 2. 匹配钻孔 (修复核心：增加模糊匹配)
            const processedDrills = new Set();
            // 先去重（0.02mm 容差）
            // ⚠️ 旧实现是 findIndex 全表线性扫，n 个钻孔就是 O(n²)（本板 ~1.4 万孔，
            //    实测吃掉 0.2s）。改成 0.02mm 栅格索引 + 3×3 邻格，判定语义不变。
            const uniqueDrills = [];
            const DRILL_TOL = 0.02;
            const drillGrid2 = new Map();
            const dCell = (v) => Math.floor(v / DRILL_TOL);
            rawDrills.forEach(newD => {
                const cx = dCell(newD.x), cy = dCell(newD.y);
                let existingIdx = -1;
                for (let gx = cx - 1; gx <= cx + 1 && existingIdx < 0; gx++) {
                    for (let gy = cy - 1; gy <= cy + 1; gy++) {
                        const arr = drillGrid2.get(gx * 65536 + gy);
                        if (!arr) continue;
                        for (let t = 0; t < arr.length; t++) {
                            const exD = uniqueDrills[arr[t]];
                            if (Math.abs(exD.x - newD.x) < DRILL_TOL && Math.abs(exD.y - newD.y) < DRILL_TOL) {
                                existingIdx = arr[t];
                                break;
                            }
                        }
                        if (existingIdx >= 0) break;
                    }
                }
                if (existingIdx === -1) {
                    const idx = uniqueDrills.length;
                    uniqueDrills.push(newD);
                    const k = cx * 65536 + cy;
                    let arr = drillGrid2.get(k);
                    if (!arr) drillGrid2.set(k, arr = []);
                    arr.push(idx);
                } else {
                    const exD = uniqueDrills[existingIdx];
                    if (newD.isSlot && !exD.isSlot) {
                        // 覆盖同格索引：位置几乎相同，索引仍然指向这条记录
                        uniqueDrills[existingIdx] = newD;
                    }
                }
            });
            
            const drills = uniqueDrills;

            // [辅助] 获取总层数 (上一轮添加的代码，保持不变)
            const copperCountEl = document.getElementById('cfg-copper-layers');
            const totalLayers = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;
            const getLyrIdx = (id) => {
                if (id === 1) return 1;
                if (id === 2) return totalLayers;
                if (id >= 15 && id <= 46) return (id - 15) + 2;
                return null;
            };

            drills.forEach((d, idx) => {
                // 1. 埋盲孔跳过逻辑 (保持不变)
                if (d.pairStart && d.pairEnd) {
                    const s = getLyrIdx(d.pairStart);
                    const e = getLyrIdx(d.pairEnd);
                    if (s !== null && e !== null) {
                        const min = Math.min(s, e);
                        const max = Math.max(s, e);
                        if (min !== 1 || max !== totalLayers) return; 
                    }
                }

                // [新增] 合并检查函数
                const tryMergeDrillToPad = (node, drill) => {
                    // 核心修复：
                    // 如果不是槽孔(Slot)，且该位置并没有同时具备 Top 和 Bottom 焊盘
                    // (即：它是一个单面焊盘，比如只有 Bottom)，
                    // 那么强行合并会导致它变成 Layer12 多层焊盘，从而错误地增加顶层铜环。
                    // 这里的策略是：不合并。让 Pad 保持单层，让 Drill 变成独立的 Via。
                    const isSingleSide = (!node.top || !node.bottom);
                    
                    if (!drill.isSlot && isSingleSide) {
                        return; // 跳过合并 -> 结果：单层焊盘 + 独立过孔 (Visual效果正确)
                    }

                    // 执行合并
                    if (!node.drill || drill.isSlot) node.drill = drill;
                    processedDrills.add(drill);
                    drill.isConsumed = true;
                };

                const key = getKey(d.x, d.y);
                
                // 2.1 尝试精确匹配
                if (map.has(key)) { 
                    tryMergeDrillToPad(map.get(key), d);
                } 
                else {
                    // 2.2 模糊匹配
                    let minDist = 0.05; 
                    let matchedKey = null;
                    for (const [k, node] of map) { 
                        const dist = Math.sqrt(Math.pow(node.x - d.x, 2) + Math.pow(node.y - d.y, 2)); 
                        if (dist < minDist) { 
                            minDist = dist; 
                            matchedKey = k; 
                        } 
                    }
                    if (matchedKey) { 
                        tryMergeDrillToPad(map.get(matchedKey), d);
                    }
                }
            });

            // 3. 生成最终对象
            // 焊盘的实际尺寸：普通焊盘直接取 w/h；**宏光圈多边形**（shape === 'POLYGON'，
            // 例如嘉立创EDA标准版 / P-CAD 用 %AM 宏做出来的阻焊开窗）的 w/h 恒为 0，
            // 真实尺寸只存在于 path 的包围盒里。旧实现只看 w/h，于是这类焊盘的
            // 阻焊/助焊扩展被判为「无法计算」而整块丢掉 —— 导入 EDA 后焊盘被阻焊盖住。
            const effWH = (prim) => {
                if (!prim) return null;
                let w = prim.w, h = prim.h;
                if ((!(w > 0) || !(h > 0)) && prim.shape === 'POLYGON'
                    && Array.isArray(prim.path) && prim.path.length) {
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    prim.path.forEach(pt => {
                        if (typeof pt.x !== 'number' || !isFinite(pt.x)) return;
                        if (pt.x < minX) minX = pt.x;
                        if (pt.x > maxX) maxX = pt.x;
                        if (pt.y < minY) minY = pt.y;
                        if (pt.y > maxY) maxY = pt.y;
                    });
                    if (isFinite(minX) && isFinite(maxX) && maxX > minX) { w = maxX - minX; h = maxY - minY; }
                }
                if (!(w > 0) || !(h > 0)) return null;
                return { w: w, h: h };
            };
            const unifiedPads = [];
            map.forEach(node => {
                const calcExp = (mask, copper) => {
                    const m = effWH(mask), c = effWH(copper);
                    if (!m || !c) return null;
                    const mMin = Math.min(m.w, m.h); const cMin = Math.min(c.w, c.h);
                    const exp = (mMin - cMin) / 2;
                    if (exp > 1.0 || exp < -0.05) return null;
                    if (Math.abs(exp) < 0.002) return 0;
                    return exp;
                };
                let innerRep = null; if (node.inners.length > 0) { innerRep = node.inners.reduce((prev, curr) => (curr.w < prev.w) ? curr : prev); innerRep = { ...innerRep }; }
                // [修改] 增加 inners: node.inners，将所有内层数据透传
                unifiedPads.push({ 
                    x: node.x, y: node.y, 
                    top: node.top, 
                    bottom: node.bottom, 
                    innerRep: innerRep, 
                    inners: node.inners, // <--- 关键修改：保留所有内层焊盘列表
                    drill: node.drill, 
                    exps: { 
                        mt: calcExp(node.maskTop, node.top), 
                        mb: calcExp(node.maskBot, node.bottom), 
                        pt: calcExp(node.pasteTop, node.top), 
                        pb: calcExp(node.pasteBot, node.bottom) 
                    } 
                });
            });
            
            const remainingVias = drills.filter(d => !d.isConsumed).map(d => {
                // 就近（0.05mm）找该钻孔对应的过孔铜盘 / 阻焊盘节点
                const viaNode = findViaNode(d.x, d.y);
                
                // 默认外径 (如果没有找到对应的Gerber定义)
                let padDia = d.dia; 
                let topExp = null; let botExp = null;
                
                if (viaNode) { 
                    // [修改 3] 优先根据埋盲孔的起始层获取外径
                    if (d.pairStart && viaNode.layers && viaNode.layers[d.pairStart]) {
                        padDia = viaNode.layers[d.pairStart].dia;
                    }
                    // 如果不是埋盲孔或没找到起始层定义，尝试使用顶层定义
                    else if (viaNode.top) {
                        padDia = viaNode.top.dia; 
                    }

                    if (viaNode.maskTop && viaNode.top) { const exp = (viaNode.maskTop.dia - viaNode.top.dia) / 2; if (exp >= -0.05) topExp = exp; } 
                    if (viaNode.maskBot && viaNode.top) { const exp = (viaNode.maskBot.dia - viaNode.top.dia) / 2; if (exp >= -0.05) botExp = exp; } 
                }
                
                return { 
                    x: d.x, y: d.y, w: d.w, h: d.h, 
                    dia: d.dia, padDia: padDia, 
                    topExp: topExp, botExp: botExp, 
                    isPlated: d.isPlated, 
                    isSlot: d.isSlot, 
                    rotation: d.rotation,
                    pairStart: d.pairStart,
                    pairEnd: d.pairEnd
                };
            });

            // ---- 负片转正片：把「外环 + 挖空环」拆成多个**无孔洞**的填充区域 ----
            // 嘉立创EDA专业版 pcb_MathPolygon.createComplexPolygon() 的语义是「多块互相独立
            // 的多边形」（官方示例：矩形 + 圆形两块），**不做布尔差**。若把挖空环一起塞进去，
            // 挖空区会被当成又一块实体铜 —— 导入后看到的就是「一整块矩形铜」（负片平面）。
            // 所以这里先把每个带挖空的覆铜转成若干无孔洞的简单多边形，再逐个当普通填充导入。
            const fillsOut = [];
            let negFillCount = 0, negHoles = 0, negPieces = 0, splitFailed = false, fullyCleared = 0;
            rawFills.forEach(f => {
                if (f && Array.isArray(f.holes) && f.holes.length) {
                    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
                    const pieces = (typeof fillSplitNegativeRegion === 'function')
                        ? fillSplitNegativeRegion(f.path, f.holes) : null;
                    // 注意 pieces 可能是**空数组**：整块铜被清区完全挖掉（合法结果）——
                    // 此时必须整块丢弃，不能退回成「实心填充」（那会凭空多出一块铜）。
                    if (Array.isArray(pieces)) {
                        negFillCount++;
                        negHoles += f.holes.length;
                        negPieces += pieces.length;
                        if (!pieces.length) fullyCleared++;
                        // 拆分出来的每一块都挂回**原始填充对象**（src: f）：
                        // 它们在电气上就是同一块铜（同一块负片平面被挖空后剩下的部分）。
                        // 网络生成用 src 判「同源即连通」，没有这个标记的话，一块 52mm 平面
                        // 拆出的上百块之间还要两两做几何求交（实测 1 万多顶点的两块 437ms/对）。
                        pieces.forEach(p => fillsOut.push({ layerId: f.layerId, path: p, src: f }));
                        if (t0) {
                            const dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
                            if (dt > 400) console.log(`负片拆分耗时 ${dt.toFixed(0)}ms（挖空 ${f.holes.length} 个 → ${pieces.length} 块）`);
                        }
                        return;
                    }
                    if (!splitFailed) { console.warn('负片拆分失败，该块退回整块填充'); splitFailed = true; }
                }
                fillsOut.push(f);
            });
            if (negFillCount) {
                console.log(`负片转正片：${negFillCount} 块覆铜的 ${negHoles} 个挖空 → 拆分为 ${negPieces} 个无孔洞填充区域`
                    + (fullyCleared ? `（其中 ${fullyCleared} 块被完全挖空，已丢弃）` : ''));
            }

            // [修改] 返回对象增加 coppers
            return { 
                unifiedPads, remainingVias, 
                tracks: rawTracks, polys: rawPolys, fills: fillsOut,
                images: rawImages, textLines: rawTextLines, coppers: rawCoppers 
            };
        },

        // --- 3. 生成阶段 (修改：移除特殊的 RECT/CIRCLE 逻辑，统一用 path) ---
        generatePrimitives: (data, versionObj, config) => { 
            const { unifiedPads, remainingVias } = data;
            const isV3 = versionObj.isV3;
            const output = [];
            
            let ticket = versionObj.ticket || 1;
            let idCounter = versionObj.id || 1;
            const nextIds = () => { ticket++; idCounter++; return { t: ticket, id: `e${idCounter}` }; };

            // ... (A. Netlist Data 构建) ...
            // 飞针引脚索引：与「导出标准版」「画布标注」共用同一套两级匹配
            // （① 引脚与焊盘中心 2.5mil 内含；② 否则取落在焊盘包围盒内、离中心最近的引脚）。
            // ⚠️ 只用「中心 ±2.5mil」匹配时，异形/多边形焊盘的引脚锚点常偏在一侧
            // （开关类焊盘实测偏 27mil），会整批匹配不上 → 焊盘编号退化成 "1"、
            // 组合（groupId）丢失。这就是「异形焊盘在有飞针文件时丢失组合和编号」的原因。
            // 【2026-10-18】索引与「尝试生成网络」开关**无关**：焊盘编号、元件位号（以及
            // 焊盘所属元件组合 groupId）都来自飞针文件，只有**网络名**才受该开关控制。
            // 之前把整个索引挂在 config.tryNetlist 上 → 一取消勾选，编号全退化成 "1"、
            // 组合全丢、位号一条都不导（用户看到的「关了网络，编号和位号也没了」）。
            const flyIndex = (typeof flyingProbeData !== 'undefined' && flyingProbeData)
                ? buildFlyingPinIndex(flyingProbeData) : { pins: [], comps: [] };
            /** 是否采用飞针文件里的 NET_NAME（仅勾选「尝试生成网络」时采用） */
            const useFlyingNet = !!(config && config.tryNetlist);
            const compCounts = {};
            const hasNetlist = flyIndex.pins.length > 0;
            if (hasNetlist) {
                flyIndex.pins.forEach(p => {
                    if (p.isPadOnly || !p.comp) return;   // 孤立焊盘占位（PAD/PAD1…）不算元件引脚
                    compCounts[p.comp] = (compCounts[p.comp] || 0) + 1;
                });
                console.log(`已加载 ${flyIndex.pins.length} 个飞针引脚用于匹配`);
            }

            // --- 物理网络生成（勾选「生成网络」时生效）--------------------------------
            // 对铜层图元做连通分量分析，给每个图元分配网络名；**有飞针文件时优先沿用其
            // NET_NAME**（飞针网络名 > 其余已有名 > 新分配的 NET{n}）。算法见 06-utils.js
            // 的 buildNetAssignments（移植自 Temp/生成网络/GenerateNet.html）。
            let netOf = null;
            /** 因「两个不同网络名被连在一起」而整块改名的图元（见 buildNetAssignments 注释） */
            let netRenamed = null;
            if (config && config.tryNetlist) {
                try {
                    const padNet = new Map();
                    if (hasNetlist) {
                        unifiedPads.forEach(p => {
                            const p0 = p.top || p.bottom || p.innerRep || (p.inners && p.inners[0]);
                            const m = flyingPinAt(flyIndex, p.x, p.y, padMatchBoxMM(p0));
                            if (m && m.net) padNet.set(p, String(m.net));
                        });
                    }
                    const innerCopper = [...new Set(loadedFiles.map(f => f.layerId).filter(id => id >= 15 && id <= 46))];
                    const res = buildNetAssignments(data, { padNet, innerCopperLayers: innerCopper });
                    netOf = res.netOf;
                    netRenamed = res.renamed || null;
                    const st = res.stats;
                    console.log(`物理网络：铜层图元 ${st.prims} → 连通分量 ${st.clusters}`
                        + `（沿用已有网络名 ${st.reused} 个 / 新分配 NET 名 ${st.generated} 个 / 共命名 ${st.named}）`
                        + (st.renamedClusters ? `，其中 ${st.renamedClusters} 个分量因「两个不同网络名被连在一起」已改名为 NET*` : '')
                        + (padNet.size ? `，其中 ${padNet.size} 个焊盘来自飞针文件` : ''));
                    appLog(`生成网络：${st.clusters} 个连通分量，命名 ${st.named} 个`
                        + (st.renamedClusters ? `，其中 ${st.renamedClusters} 个冲突改名` : ''));
                } catch (e) {
                    console.error('物理网络生成失败：', e);
                    netOf = null;
                    netRenamed = null;
                }
            }
            /** 取图元对应的网络名（未生成网络时恒为空串） */
            const netNameOf = (obj) => (netOf && obj) ? (netOf.get(obj) || '') : '';
            /** 该图元所在分量是否因「两个不同网络名被连在一起」而整块改名 */
            const isNetRenamed = (obj) => !!(netRenamed && obj && netRenamed.has(obj));

            const getCornerObj = (prim) => {
                if (prim && prim.shape === 'RECT' && prim.radiusRatio > 0) return ["ROUND", prim.radiusRatio, prim.radiusRatio];
                return null;
            };

            // [新增] 路径生成函数引用，确保 generatePathStr 在此处可用
            // (通常它定义在 generatePrimitives 内部或作为 PadTool 的方法)
            const generatePathStr = (pathArr) => {
                if (!pathArr || pathArr.length === 0) return [];
                const res = [];
                const startPt = pathArr[0];
                const startX = (startPt.x !== undefined) ? startPt.x : 0;
                const startY = (startPt.y !== undefined) ? startPt.y : 0;
                
                res.push(PadTool.toMil(startX)); 
                res.push(PadTool.toMil(startY)); 

                for (let i = 1; i < pathArr.length; i++) {
                    const pt = pathArr[i];
                    if (pt.cmd === 'L') { 
                        res.push("L"); 
                        res.push(PadTool.toMil(pt.x)); 
                        res.push(PadTool.toMil(pt.y)); 
                    } 
                    else if (pt.cmd === 'A' || pt.cmd === 'ARC') { 
                        res.push("ARC"); 
                        let val = 0;
                        if (pt.sweep !== undefined) val = pt.sweep;
                        else if (pt.angle !== undefined) val = pt.angle;
                        if (typeof val !== 'number') val = 0;

                        res.push(parseFloat(val.toFixed(2))); 
                        res.push(PadTool.toMil(pt.x)); 
                        res.push(PadTool.toMil(pt.y)); 
                    }
                }
                return res;
            };

            // --- 物理层索引计算辅助函数 ---
            const copperCountVal = document.getElementById('cfg-copper-layers') ? parseInt(document.getElementById('cfg-copper-layers').value) : 2;
            
            const getPhysLayerIndex = (layerId) => {
                if (!layerId) return null;
                // 顶层总是 1
                if (layerId === 1) return 1;
                // 底层总是等于总层数
                if (layerId === 2) return copperCountVal;
                // 内层转换: Inner1(15) -> 2, Inner2(16) -> 3 ...
                if (layerId >= 15 && layerId <= 46) {
                    return (layerId - 15) + 2;
                }
                return null;
            };


            // ... (B. Pads 生成 - 修改版) ...
            unifiedPads.forEach(pad => {
                // 1. 公共计算
                const padXMil = PadTool.toMil(pad.x); 
                const padYMil = PadTool.toMil(pad.y);
                let netName = ""; let pinNumber = "1"; let groupId = 0; 

                if (hasNetlist) {
                    // 两级匹配（见上）：中心 → 焊盘包围盒。异形焊盘靠包围盒才匹配得上，
                    // 否则编号会退化成 "1"、组合丢失。
                    const prim0 = pad.top || pad.bottom || pad.innerRep || (pad.inners && pad.inners[0]);
                    const match = flyingPinAt(flyIndex, pad.x, pad.y, padMatchBoxMM(prim0));
                    if (match && !match.isPadOnly) {
                        // 网络名：不勾选「尝试生成网络」时**不用**飞针文件的 NET_NAME
                        // （编号 / 位号 / 组合照旧取用，见上面的 useFlyingNet 注释）
                        if (useFlyingNet && match.net) netName = String(match.net);
                        pinNumber = match.num || "1";
                        const cName = match.comp;
                        if (cName && compCounts[cName] > 1) groupId = cName;
                    }
                }
                // 焊盘名的优先级：
                //   ① 所在分量被判为「两个不同网络名被连在一起」→ **以连通分量结果为准**
                //      （两个原名都已作废，整块改成了新的 NET*）。此时若还沿用飞针名，
                //      就会出现「焊盘 NET_4 / 焊盘 NET_2 / 中间导线 NET1」——
                //      同一个网络三个名字，导入 EDA 后网络表直接错乱。
                //   ② 其余情况飞针名优先（飞针文件才是名称来源，连通分量只做补名）。
                //   ③ 都没有时退回连通分量算出来的名字。
                const geoNet = netNameOf(pad);
                if (isNetRenamed(pad) && geoNet) netName = geoNet;
                else if (!netName) netName = geoNet;

                const targets = [];
                
                if (pad.drill) {
                    let holeShape = null; let holeRotation = 0;
                    const holeW = PadTool.toMil(pad.drill.w); 
                    const holeH = PadTool.toMil(pad.drill.h);
                    
                    if (pad.drill.isSlot) { 
                        const maxSide = Math.max(holeW, holeH); 
                        const minSide = Math.min(holeW, holeH); 
                        holeShape = ["SLOT", maxSide, minSide]; 
                        holeRotation = pad.drill.rotation || 0; 
                    } else { 
                        holeShape = ["ROUND", holeW, holeW]; 
                    }
                    const mainPrim = pad.top || pad.bottom || pad.innerRep;
                    if (mainPrim) {
                        targets.push({ layerId: 12, prim: mainPrim, holeShape: holeShape, holeRotation: holeRotation, isPlated: pad.drill.isPlated });
                    }
                } else {
                    // === 无钻孔的情况 (Surface Mount / SMT / Blind Inner) ===
                    
                    // 1. 顶层焊盘 (保持原逻辑，生成 PAD)
                    if (pad.top) {
                        targets.push({ layerId: 1, prim: pad.top, isPlated: true });
                    }
                    
                    // 2. 底层焊盘 (保持原逻辑，生成 PAD)
                    if (pad.bottom) {
                        targets.push({ layerId: 2, prim: pad.bottom, isPlated: true });
                    }
                    
                    // 3. 内层处理 (修改：遍历 pad.inners，为每个存在的内层生成 FILL)
                    if (pad.inners && pad.inners.length > 0) {
                        // 遍历该位置下所有的内层焊盘数据
                        pad.inners.forEach(prim => {
                            const ids = nextIds(); 
                            
                            // 准备几何数据
                            const x = PadTool.toMil(prim.x);
                            const y = PadTool.toMil(prim.y);
                            const w = PadTool.toMil(prim.w);
                            const h = PadTool.toMil(prim.h);
                            const rotation = prim.rotation || 0;
                            
                            let pathContent = [];

                            if (prim.shape === 'POLYGON') {
                                // 异形：直接转换路径
                                pathContent = generatePathStr(prim.path);
                            } else if (prim.shape === 'OVAL') {
                                // === 长圆形 (Obround) 逻辑 ===
                                if (Math.abs(w - h) < 0.01) {
                                    // 宽高接近，视为圆形
                                    pathContent = ["CIRCLE", x, y, w / 2];
                                } else {
                                    // 计算旋转参数
                                    const rad = -rotation * Math.PI / 180;
                                    const cos = Math.cos(rad);
                                    const sin = Math.sin(rad);
                                    const rotate = (px, py) => ({
                                        x: parseFloat((x + px * cos - py * sin).toFixed(4)),
                                        y: parseFloat((y + px * sin + py * cos).toFixed(4))
                                    });

                                    const r = Math.min(w, h) / 2;
                                    const dist = (Math.max(w, h) / 2) - r; 
                                    const isHorizontal = w > h;

                                    let p1, p2, p3, p4;
                                    
                                    if (isHorizontal) {
                                        p1 = {x: -dist, y: r};
                                        p2 = {x: dist, y: r};
                                        p3 = {x: dist, y: -r};
                                        p4 = {x: -dist, y: -r};
                                    } else {
                                        p1 = {x: -r, y: dist};
                                        p2 = {x: r, y: dist};
                                        p3 = {x: r, y: -dist};
                                        p4 = {x: -r, y: -dist};
                                    }

                                    const P1 = rotate(p1.x, p1.y);
                                    const P2 = rotate(p2.x, p2.y);
                                    const P3 = rotate(p3.x, p3.y);
                                    const P4 = rotate(p4.x, p4.y);

                                    if (isHorizontal) {
                                        pathContent = [
                                            P1.x, P1.y, "L",
                                            P2.x, P2.y, "ARC", -180, // 右侧半圆
                                            P3.x, P3.y, "L",
                                            P4.x, P4.y, "ARC", -180, // 左侧半圆
                                            P1.x, P1.y
                                        ];
                                    } else {
                                        pathContent = [
                                            P1.x, P1.y, "ARC", -180, // 顶部半圆
                                            P2.x, P2.y, "L",
                                            P3.x, P3.y, "ARC", -180, // 底部半圆
                                            P4.x, P4.y, "L",
                                            P1.x, P1.y
                                        ];
                                    }
                                }
                            } else if (prim.shape === 'RECT' || prim.shape === 'ROUNDRECT') {
                                // === 矩形/圆角矩形逻辑 (修正版：修复旋转方向) ===
                                const dx = w / 2;
                                const dy = h / 2;
                                
                                // [关键修改]：移除负号。
                                // EDA 坐标系通常 Y 轴向上，正角度为逆时针旋转。
                                // 原代码的 -rotation 导致了顺时针旋转，视觉上产生水平翻转的效果。
                                const rad = rotation * Math.PI / 180; 
                                
                                const cos = Math.cos(rad);
                                const sin = Math.sin(rad);
                                
                                // 旋转变换函数 (标准笛卡尔坐标系旋转)
                                // x' = x*cos - y*sin
                                // y' = x*sin + y*cos
                                const rotate = (px, py) => ({
                                    x: parseFloat((x + px * cos - py * sin).toFixed(4)),
                                    y: parseFloat((y + px * sin + py * cos).toFixed(4))
                                });

                                // 计算圆角半径
                                let r = 0;
                                if (prim.radiusRatio && prim.radiusRatio > 0) {
                                    r = Math.min(w, h) / 2 * (prim.radiusRatio / 100);
                                }

                                if (r > 0.001) {
                                    // --- 生成圆角填充路径 (Line + Arc) ---
                                    // 逆时针顺序绘制：上边 -> 左边 -> 下边 -> 右边 (或反之)
                                    // 这里保持顺时针点序绘制，配合 -90 的 Arc Sweep (顺时针弧)
                                    // 点的定义基于未旋转的矩形，然后应用 rotate 函数变换到世界坐标
                                    
                                    const pt_top_l = rotate(-dx + r, dy); // 顶左
                                    const pt_top_r = rotate(dx - r, dy);  // 顶右
                                    
                                    const pt_right_t = rotate(dx, dy - r); // 右上
                                    const pt_right_b = rotate(dx, -dy + r);// 右下
                                    
                                    const pt_bottom_r = rotate(dx - r, -dy); // 底右
                                    const pt_bottom_l = rotate(-dx + r, -dy);// 底左
                                    
                                    const pt_left_b = rotate(-dx, -dy + r); // 左下
                                    const pt_left_t = rotate(-dx, dy - r);  // 左上

                                    pathContent = [
                                        pt_top_l.x, pt_top_l.y, "L",
                                        pt_top_r.x, pt_top_r.y, "ARC", -90, pt_right_t.x, pt_right_t.y,
                                        "L",
                                        pt_right_b.x, pt_right_b.y, "ARC", -90, pt_bottom_r.x, pt_bottom_r.y,
                                        "L",
                                        pt_bottom_l.x, pt_bottom_l.y, "ARC", -90, pt_left_b.x, pt_left_b.y,
                                        "L",
                                        pt_left_t.x, pt_left_t.y, "ARC", -90, pt_top_l.x, pt_top_l.y
                                    ];

                                } else {
                                    // --- 直角矩形逻辑 ---
                                    const p1 = rotate(-dx, -dy);
                                    const p2 = rotate(dx, -dy);
                                    const p3 = rotate(dx, dy);
                                    const p4 = rotate(-dx, dy);

                                    pathContent = [
                                        p1.x, p1.y, "L",
                                        p2.x, p2.y, "L",
                                        p3.x, p3.y, "L",
                                        p4.x, p4.y, "L",
                                        p1.x, p1.y
                                    ];
                                }
                            } else {
                                // 圆形
                                const r = Math.min(w, h) / 2;
                                pathContent = ["CIRCLE", x, y, r];
                            }

                            // 生成图元 JSON
                            // 注意：这里的 layerId 使用的是当前遍历到的 prim.layerId
                            // 这样就能分别生成 Inner1, Inner2, Inner3 等层的填充
                            if (isV3) {
                                const obj = { "type": "FILL", "ticket": ids.t, "id": ids.id };
                                const content = {
                                    "partitionId": "", "groupId": groupId, "netName": netName, 
                                    "layerId": prim.layerId, 
                                    "width": 0, 
                                    "fillStyle": "SOLID", 
                                    "path": [pathContent], 
                                    "locked": false, "zIndex": -1, "isBridgingCopper": false, "networkList": [], "refs": null
                                };
                                output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                            } else {
                                const arr = ["FILL", ids.id, groupId, netName, prim.layerId, 0, 0, [pathContent], 0];
                                output.push(JSON.stringify(arr));
                            }
                        });
                    }
                }

                targets.forEach(tgt => {
                    const ids = nextIds();
                    const layerId = tgt.layerId;
                    const mainPrim = tgt.prim;

                    let rotation = mainPrim.rotation || 0;
                    if (tgt.holeShape && tgt.holeShape[0] === "SLOT" && Math.abs(rotation) < 0.1 && Math.abs(tgt.holeRotation) > 0.1) {
                        rotation = tgt.holeRotation;
                    }
                    
                    let primW = PadTool.toMil(mainPrim.w); 
                    let primH = PadTool.toMil(mainPrim.h);
                    const originalRot = mainPrim.rotation || 0;
                    
                    const rotDiff = Math.abs(rotation - originalRot) % 180;
                    if (Math.abs(rotDiff - 90) < 1.0) { const temp = primW; primW = primH; primH = temp; }

                    const makeShapeArr = (s, w, h, rr) => {
                        let shapeName = s;
                        if (shapeName === 'ROUND') shapeName = 'ELLIPSE';
                        if (shapeName === 'ELLIPSE' || shapeName === 'OVAL') return [shapeName, w, h];
                        
                        // [修改处] 强制保留第4位参数，即使是 0
                        if (shapeName === 'RECT') return ["RECT", w, h, rr || 0];
                        
                        return [shapeName, w, h];
                    };
                    
                    // --- [新增/修改] 对异形焊盘的处理 ---
                    let defaultShape;
                    if (mainPrim.shape === 'POLYGON') {
                        // 异形焊盘：["POLYGON", [path...]]
                        const pathArr = generatePathStr(mainPrim.path);
                        defaultShape = ["POLYGON", pathArr];
                    } else {
                        // 普通焊盘
                        defaultShape = makeShapeArr(mainPrim.shape, primW, primH, mainPrim.radiusRatio || 0);
                    }
                    // ------------------------------------

                    let cornerObj = getCornerObj(mainPrim);
                    
                    let specialPads = []; 
                    if (layerId === 12) {
                        const t = pad.top; const b = pad.bottom; const i = pad.innerRep;
                        const isEq = (o1, o2) => {
                            if (!o1 && !o2) return true;
                            if (!o1 || !o2) return false;
                            // 异形焊盘暂时不支持作为 specialPads 的比较逻辑，因为 path 太复杂
                            if (o1.shape === 'POLYGON' || o2.shape === 'POLYGON') return false;

                            return Math.abs(o1.w - o2.w) < 0.005 && Math.abs(o1.h - o2.h) < 0.005 && Math.abs((o1.rotation||0) - (o2.rotation||0)) < 0.1 && (o1.radiusRatio||0) === (o2.radiusRatio||0) && o1.shape === o2.shape;
                        };
                        
                        if (!(isEq(t, b) && (i ? isEq(t, i) : true))) {
                            const processInner = (p) => {
                                // 简单处理：如果是 Polygon，这里暂不支持转为内层特殊焊盘形状，回退到 Rect
                                if (p.shape === 'POLYGON') return ["RECT", 10, 10]; 

                                let pw = PadTool.toMil(p.w); let ph = PadTool.toMil(p.h);
                                const innerRot = p.rotation || 0; const innerDiff = Math.abs(rotation - innerRot) % 180;
                                if (Math.abs(innerDiff - 90) < 1.0) [pw, ph] = [ph, pw];
                                return makeShapeArr(p.shape, pw, ph, p.radiusRatio);
                            };
                            if (t) specialPads.push([1, 1, processInner(t)]);
                            if (i) specialPads.push([1, 2, processInner(i)]); 
                            if (b) specialPads.push([2, 2, processInner(b)]);
                        }
                    }

                    let mt = null, mb = null, pt = null, pb = null;
                    if (layerId === 12) {
                         mt = PadTool.toMil(pad.exps.mt); mb = PadTool.toMil(pad.exps.mb);
                         pt = PadTool.toMil(pad.exps.pt); pb = PadTool.toMil(pad.exps.pb);
                    } else if (layerId === 1) { 
                         mt = PadTool.toMil(pad.exps.mt); 
                         pt = PadTool.toMil(pad.exps.pt);
                    } else if (layerId === 2) { 
                         mb = PadTool.toMil(pad.exps.mb); 
                         pb = PadTool.toMil(pad.exps.pb);
                    }

                    let relRotation = 0;
                    if (tgt.holeShape && tgt.holeShape[0] === 'SLOT') { 
                        if (Math.abs(rotation - tgt.holeRotation) > 0.1) relRotation = tgt.holeRotation - rotation; 
                    }

                    if (isV3) {
                        const obj = { "type": "PAD", "ticket": ids.t, "id": ids.id };
                        // [修复代码]：增加 radius 字段，支持圆角矩形
                        const padInfoObj = (defaultShape[0] === 'POLYGON') 
                            ? { "padType": "POLYGON", "path": defaultShape[1] } 
                            : { 
                                "padType": defaultShape[0], 
                                "width": defaultShape[1], 
                                "height": defaultShape[2], 
                                "radius": defaultShape[3] || 0  // <--- 核心修复：取出数组第4位的圆角参数
                            };
                        const content = { 
                            "partitionId": "", "groupId": groupId, "netName": netName, "layerId": layerId, "num": pinNumber, 
                            "centerX": padXMil, "centerY": padYMil, "padAngle": rotation, 
                            "hole": tgt.holeShape ? { "holeType": tgt.holeShape[0], "width": tgt.holeShape[1], "height": tgt.holeShape[2] } : null, 
                            "defaultPad": padInfoObj, 
                            "specialPad": specialPads.map(sp => ({ "startLayer": sp[0], "endLayer": sp[1], "pad": { "padType": sp[2][0], "width": sp[2][1], "height": sp[2][2], "radius": sp[2][3]||0 } })), 
                            "padOffsetX": 0, "padOffsetY": 0, "relativeAngle": relRotation, 
                            "plated": tgt.isPlated !== undefined ? tgt.isPlated : true, 
                            "padType": "NORMAL", 
                            "topSolderExpansion": mt, "bottomSolderExpansion": mb, "topPasteExpansion": pt, "bottomPasteExpansion": pb, 
                            "locked": false, "zIndex": null, "connectMode": null, "spokeSpace": null, "spokeWidth": null, "spokeAngle": null, "unusedInnerLayers": [], "padLen": 0, "attrsMap": {} 
                        };
                        output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                    } else {
                        const arr = [ 
                            "PAD", ids.id, groupId, netName, layerId, pinNumber, 
                            padXMil, padYMil, rotation, 
                            tgt.holeShape, 
                            defaultShape, 
                            specialPads, 
                            0, 0, relRotation, 
                            tgt.isPlated ? 1 : 0, 
                            0, 
                            mt, mb, pt, pb, 
                            0, cornerObj, null, null, null, null, [] 
                        ];
                        output.push(JSON.stringify(arr));
                    }
                });
            });

            // ... (C. Vias 生成 - 保持不变) ...
             remainingVias.forEach(v => {
                const ids = nextIds();
                const diaMil = PadTool.toMil(v.w);
                // --- [新增 2] 计算过孔的层范围字符串 ---
                let layerRangeStr = ""; 
                if (v.pairStart && v.pairEnd) {
                    const startIdx = getPhysLayerIndex(v.pairStart);
                    const endIdx = getPhysLayerIndex(v.pairEnd);
                    
                    // 只有当两个都是有效的物理层，且不构通孔(1-Max)时才写入
                    // 当然，如果用户显式选了 Top-Bottom，写 "1-N" 也是合法的，或者是空字符串表示通孔
                    // 这里为了严谨，只要有定义且有效，就生成字符串
                    if (startIdx !== null && endIdx !== null) {
                        // 确保小的在前，大的在后 (例如 "1-2")
                        const s = Math.min(startIdx, endIdx);
                        const e = Math.max(startIdx, endIdx);
                        
                        // 如果是全通孔 (Top -> Bottom)，标准格式通常为空字符串，也可以是 "1-N"
                        // 为了兼容性，如果是全层，保持空字符串；如果是埋盲孔，则输出
                        if (s === 1 && e === copperCountVal) {
                            layerRangeStr = ""; 
                        } else {
                            layerRangeStr = `${s}-${e}`;
                        }
                    }
                }
                // ------------------------------------
                
                // 遍历处理剩余的独立钻孔数据 v
                if (!v.isPlated) {
                    // === 分支 1：非金属化孔 (NPTH) ===
                    // 计算半径和 mil 单位的坐标
                    const radius = diaMil / 2;
                    const x = PadTool.toMil(v.x);
                    const y = PadTool.toMil(v.y);

                    if (isV3) {
                        // --- [修改] V3 格式处理：使用 FILL (实心填充) 替代 VIA ---
                        const obj = { "type": "FILL", "ticket": ids.t, "id": ids.id };
                        const content = { 
                            "partitionId": "", 
                            "groupId": 0, 
                            "netName": netNameOf(v), 
                            "layerId": 12,      // 12 = Multi-Layer
                            "width": 1,         // 线宽，保留示例中的 1
                            "fillStyle": "SOLID", // 填充模式：实心
                            "path": [["CIRCLE", x, y, radius]], // 路径定义：[类型, x, y, 半径]
                            "locked": false, 
                            "zIndex": null, 
                            "isBridgingCopper": false, 
                            "networkList": [], 
                            "refs": null 
                        };
                        output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                    } else {
                        // --- V2 格式处理 ---
                        // V2 中通常使用 "FILL" (填充区域) 或 "HOLE" (挖孔) 来表示非金属化孔
                        // 此处生成一个圆形挖孔区域 (CIRCLE)，layerId 12 (Multi-Layer)
                        // 格式: ["FILL", id, group, net, layerId, type(1=solid), 0, path, rot]
                        const arr = ["FILL", ids.id, 0, netNameOf(v), 12, 1, 0, [["CIRCLE", x, y, radius]], 0];
                        output.push(JSON.stringify(arr));
                    }
                } else {
                    // === 分支 2：金属化孔 (PTH) ===
                    
                    if (v.isSlot) {
                        // --- 情况 2.1：槽孔 (Slot) ---
                        // 转换槽孔尺寸到 mil
                        const w = PadTool.toMil(v.w);
                        const h = PadTool.toMil(v.h);
                        // 确定长边和短边
                        const maxS = Math.max(w, h);
                        const minS = Math.min(w, h);

                        // 生成 V2 格式的 PAD (V2 对槽孔通常作为 PAD 处理)
                        // 格式: ["PAD", id, group, net, layerId, pinNum, x, y, rot, holeShape, padShape, ...]
                        // holeShape: ["ROUND", 圆头直径(短边), 高度(长边)]
                        //   官方 EPCB_PrimitivePadHoleType 只有 ROUND(长圆形) / RECT，没有 SLOT —— 用 SLOT 会被判为非法
                        // padShape: ["OVAL", 长+5mil, 宽+5mil] (默认加一点铜环宽度)
                        const arr = [
                            "PAD", ids.id, 0, netNameOf(v), 12, "1",
                            PadTool.toMil(v.x), PadTool.toMil(v.y),
                            v.rotation || 0,
                            ["ROUND", minS, maxS],
                            ["OVAL", maxS + 5, minS + 5], // 自动生成椭圆焊盘形状
                            [], 0, 0, 0, 1, 0, null, null, null, null, 0, null, null, null, null, []
                        ];
                        output.push(JSON.stringify(arr));
                    } else {
                        // --- 情况 2.2：圆形钻孔 (Standard Via) ---
                        const padMil = PadTool.toMil(v.padDia); // 过孔外径
                        const mt = PadTool.toMil(v.topExp);     // 顶层阻焊扩展
                        const mb = PadTool.toMil(v.botExp);     // 底层阻焊扩展

                        if (isV3) {
                            // --- V3 格式处理 ---
                            const obj = { "type": "VIA", "ticket": ids.t, "id": ids.id };
                            
                            const content = {
                                "partitionId": "",
                                "groupId": 0,
                                "netName": netNameOf(v),
                                "ruleName": layerRangeStr,
                                "centerX": PadTool.toMil(v.x),
                                "centerY": PadTool.toMil(v.y),
                                
                                // [修改] 使用 Diameter (直径) 替代 Radius (半径)
                                "holeDiameter": diaMil,   // 钻孔直径
                                "viaDiameter": padMil,    // 过孔直径
                                
                                // [修改] 类型设为 NORMAL (参考你提供的正常源码)
                                "viaType": "NORMAL",      
                                
                                "topSolderExpansion": mt,
                                "bottomSolderExpansion": mb,
                                "locked": false,
                                "unusedInnerLayers": []   // 补充空数组，保持格式一致
                            };
                            output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                        } else {
                            // --- V2 格式处理 ---
                            // --- [修改 3] V2 格式导出逻辑 ---
                            // 格式: ["VIA", id, group, net, layerRangeStr, x, y, drillDia, padDia, rot, topExp, botExp, 0]
                            // layerRangeStr: 用于表示盲埋孔层对 (如 "1-2")，若是通孔则为空字符串 ""
                            const arr = [
                                "VIA", ids.id, 0, netNameOf(v),
                                layerRangeStr,         // 之前计算好的层对字符串
                                PadTool.toMil(v.x),
                                PadTool.toMil(v.y),
                                diaMil,                // 钻孔直径
                                padMil,                // 过孔直径
                                0,                     // 旋转角度
                                mt,                    // 顶层阻焊扩展
                                mb,                    // 底层阻焊扩展
                                0
                            ];
                            output.push(JSON.stringify(arr));
                        }
                    }
                }
            });

            // ... (D. Text 生成：元件位号) ...
            // 「元件位号」是新增的标注层：**勾选后**才用飞针文件的元件表把位号写成装配层文字，
            // 未勾选时只做画布标注、不产生任何图元（该层的显隐/勾选状态见 03-state.js）。
            // 位号现在按面拆成两个图层（顶层 / 底层元件位号），各自只管自己那一面：
            // 任一层勾选就生成，但每一行还要按飞针文件的 LAYER 再过滤一次。
            // 位号只跟「位号图层是否勾选」有关，与「尝试生成网络」无关
            // （勾掉网络只是不写网络名，位号本身仍要导出）。
            if ((isRefdesLayerOn('T') || isRefdesLayerOn('B'))
                && typeof flyingProbeData !== 'undefined' && flyingProbeData) {
                try {
                    const rows = flyingProbeData.components.rows;
                    const fields = flyingProbeData.components.fields;
                    const idxName = fields.indexOf("COMPONENT_NAME"); 
                    const idxLayer = fields.indexOf("LAYER"); 
                    const idxX = fields.indexOf("X_COORDINATE"); 
                    const idxY = fields.indexOf("Y_COORDINATE"); 
                    const idxAngle = fields.indexOf("ANGLE");

                    if (idxName >= 0 && idxX >= 0) {
                        let textCount = 0;
                        // 飞针文件的坐标单位（lengthUnit，实测 mil）→ 专业版源码坐标（mil）。
                        // 不换算时 mm 单位的飞针文件会把位号缩小 39.37 倍挤在原点附近。
                        const fpScaleMM = (typeof flyingLengthScaleMM === 'function')
                            ? flyingLengthScaleMM(flyingProbeData) : 1;
                        const fpScaleMil = fpScaleMM / 0.0254;
                        rows.forEach(row => {
                            const name = row[idxName];
                            // 飞针文件会把孤立焊盘登记成 PAD / PAD1 / PAD23… 这类占位元件，
                            // 它们不是真正的位号，与画布标注保持一致：一律跳过。
                            if (!name || isFlyingPadPlaceholder(name)) {
                                return; 
                            }
                            const layerStr = row[idxLayer]; 
                            const x = parseFloat(row[idxX]) * fpScaleMil; 
                            const y = parseFloat(row[idxY]) * fpScaleMil; 
                            const angle = parseFloat(row[idxAngle] || 0);

                            // 【2026-10-17】专业版一律写**装配层**，按元件所在面分开：
                            //   顶层位号 → 顶层装配(9)，底层位号 → 底层装配(10) + 镜像。
                            // 不再统一写文档层（文档层不分正反面，装配图/钢网图按面看时看不到）。
                            // 标准版走的是另一条通道（08-export.js 的 TEXT），仍是文档层。
                            const isBottom = /^b/i.test(String(layerStr || ''));
                            // 该面的位号图层没勾选 → 这一行不导出
                            if (!isRefdesLayerOn(isBottom ? 'B' : 'T')) return;
                            const layerId = isBottom
                                ? ((typeof FLYING_REFDES_LAYER_BOTTOM === 'number') ? FLYING_REFDES_LAYER_BOTTOM : 10)
                                : ((typeof FLYING_REFDES_LAYER_TOP === 'number') ? FLYING_REFDES_LAYER_TOP : 9);
                            const isMirror = isBottom ? 1 : 0;

                            let groupId = 0; 
                            if (compCounts[name] && compCounts[name] > 1) { 
                                groupId = name; 
                            }

                            const ids = nextIds();
                            
                            if (isV3) {
                                // --- [修改] V3 格式处理：使用 STRING (字符串) ---
                                const obj = { "type": "STRING", "ticket": ids.t, "id": ids.id };
                                
                                const content = { 
                                    "partitionId": "", 
                                    "groupId": groupId, 
                                    "layerId": layerId, 
                                    "x": x,                       // 位置 X
                                    "y": y,                       // 位置 Y
                                    "text": name,                 // 内容 (元件位号)
                                    "fontFamily": "default2",     // 字体名称
                                    "fontSize": FLYING_REFDES_HEIGHT_MIL,  // 字号 (mil)，与画布显示一致
                                    "strokeWidth": 4,             // 粗细 (mil)
                                    "bold": false,                // 是否加粗 (示例为0, 定义为boolean, 使用false)
                                    "italic": false,              // 是否斜体
                                    // [注意] 对齐模式：原 V2 代码使用的 5 代表 CENTER-CENTER。
                                    // 即使示例给了 LEFT_BOTTOM，为了保证导入位置不偏移，这里建议使用 "CENTER"。
                                    // 如果你确定坐标是左下角坐标，可以改为 "LEFT_BOTTOM"。
                                    "origin": "CENTER_MIDDLE",           
                                    "angle": angle,               // 旋转角度
                                    "reverse": false,             // 是否反相扩展
                                    "expansion": 0,               // 反相扩展尺寸
                                    "mirror": !!isMirror,         // 是否镜像
                                    "locked": false,              // 是否锁定
                                    "zIndex": null,               // Z 轴高度
                                    "specialColor": null          // 特殊颜色
                                };
                                output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                            } else {
                                const arr = ["STRING", ids.id, groupId, layerId, x, y, name, "default2", FLYING_REFDES_HEIGHT_MIL, 4, 0, 0, 5, angle, 0, 0, isMirror, 0];
                                output.push(JSON.stringify(arr));
                            }
                            textCount++;
                        });
                        console.log(`生成了 ${textCount} 个位号标记`);
                    }
                } catch (e) { console.error("生成位号标记失败:", e); }
            }

            // ... (E. Tracks 生成 - 保持不变) ...
            if (data.tracks) {
                data.tracks.forEach(t => {
                    const ids = nextIds();
                    const x1 = PadTool.toMil(t.x1); const y1 = PadTool.toMil(t.y1);
                    const x2 = PadTool.toMil(t.x2); const y2 = PadTool.toMil(t.y2);
                    const width = PadTool.toMil(t.width);
                    if (isV3) {
                        // --- [修改] V3 格式处理 ---
                        
                        // 1. 确定图元类型
                        // 原逻辑将 LINE 转为 TRACK，根据新定义，LINE 对应的 type 就是 "LINE"
                        const objType = t.type; 
                        const obj = { "type": objType, "ticket": ids.t, "id": ids.id };

                        // 2. 构建通用 Content (LINE 和 ARC 共有的字段)
                        const content = { 
                            "partitionId": "", 
                            "groupId": 0, 
                            "netName": netNameOf(t), 
                            "layerId": t.layerId, 
                            "locked": false, 
                            "zIndex": null, 
                            "width": width,        // [修改] 线宽属性名为 width (原为 strokeWidth)
                            "startX": x1,          // [修改] 起始 X
                            "startY": y1,          // [修改] 起始 Y
                            "endX": x2,            // [修改] 结束 X
                            "endY": y2             // [修改] 结束 Y
                        };

                        // 3. 针对 ARC (圆弧) 的特殊处理
                        if (objType === 'ARC') {
                            content.angle = t.angle; // 圆弧角
                            content.arcType = "DOT"; // [新增] 圆弧类型：DOT (两点圆弧)
                        }

                        output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                    } else {
                        // --- V2 格式处理 (保持不变) ---
                        if (t.type === 'LINE') { 
                            const arr = ["LINE", ids.id, 0, netNameOf(t), t.layerId, x1, y1, x2, y2, width, 0]; 
                            output.push(JSON.stringify(arr)); 
                        } else { 
                            const angle = parseFloat(t.angle.toFixed(4)); 
                            const arr = ["ARC", ids.id, 0, netNameOf(t), t.layerId, x1, y1, x2, y2, angle, width, 0]; 
                            output.push(JSON.stringify(arr)); 
                        }
                    }
                });
                console.log(`生成了 ${data.tracks.length} 条导线`);
            }

            // ... (F. Polys 生成 - 保持不变) ...
            if (data.polys) {
                data.polys.forEach(p => {
                    const ids = nextIds();
                    const width = PadTool.toMil(p.width);
                    const pathObj = generatePathStr(p.path);

                    if (isV3) {
                    // --- [修改] V3 格式处理：使用 POLY (折线) 替代 REGION ---
                    const obj = { "type": "POLY", "ticket": ids.t, "id": ids.id };
                    
                    const content = {
                        "partitionId": "",
                        "groupId": 0,
                        "netName": netNameOf(p),
                        "layerId": p.layerId,
                        "locked": false,
                        "zIndex": null,
                        "width": width,          // [修改] 线宽属性名为 width (原为 strokeWidth)
                        "path": pathObj,         // 路径数组 [x, y, "L", x, y...]
                        "polyType": "NORMAL"     // [新增] 折线类型：NORMAL (普通)
                    };
                    
                    output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                } else {
                    // --- V2 格式处理 (保持不变) ---
                    // ["POLY", id, group, net, layer, width, path, type]
                    const arr = ["POLY", ids.id, 0, netNameOf(p), p.layerId, width, pathObj, 0];
                    output.push(JSON.stringify(arr));
                }
                });
                console.log(`生成了 ${data.polys.length} 个折线`);
            }

            // ... (G. Fills 生成) ...
            // 覆铜的「挖空」（LPC 清区）会作为额外分块一起交给 createComplexPolygon，
            // 由 EDA 按复合多边形处理（与画布上的 destination-out 挖空一致）。
            // --- FPC 补强：矩形判定 ---
            // FPC_FILL 的 path 有两种等价写法（都是「路径对象数组」）：
            //   ① 矩形快捷式：[["R", x, y, w, h, 0, 0]]，只能表达轴对齐矩形；
            //   ② 通用路径式：[[x0, y0, "L", x1, y1, … , "ARC", sweep, x, y, …]]，可表达任意多边形，
            //      与 generatePathStr() 的输出完全同构（见下方 officialPath）。
            //      ⚠️ 早期只认 ①，把非矩形补强降级成普通 FILL —— 图元导入时普通 FILL 的
            //      补强层号（58/59）拿不到 FPC 层，会落到顶层，表现为「补强变成顶层填充」。
            //      现在非矩形一律走 ②，不再降级。
            // 坐标单位 mil；① 的 x 取左边界、y 取**上边界**（已用 Temp/FPC 的源码与导出 Gerber 反算验证）。
            const fpcRectOf = (pathArr) => {
                if (!Array.isArray(pathArr)) return null;
                const pts = [];
                pathArr.forEach(op => {
                    if (!op || (op.cmd !== 'M' && op.cmd !== 'L')) return;
                    if (typeof op.x !== 'number' || !isFinite(op.x) ||
                        typeof op.y !== 'number' || !isFinite(op.y)) return;
                    const q = pts[pts.length - 1];
                    if (q && Math.abs(q.x - op.x) < 1e-6 && Math.abs(q.y - op.y) < 1e-6) return;
                    pts.push(op);
                });
                // 闭合路径的末点与首点重复，去掉
                while (pts.length > 1) {
                    const a = pts[0], b = pts[pts.length - 1];
                    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
                    else break;
                }
                if (pts.length !== 4) return null;
                const xs = [...new Set(pts.map(p => Math.round(p.x * 1000) / 1000))];
                const ys = [...new Set(pts.map(p => Math.round(p.y * 1000) / 1000))];
                if (xs.length !== 2 || ys.length !== 2) return null;
                const x0 = Math.min(...xs), x1 = Math.max(...xs);
                const y0 = Math.min(...ys), y1 = Math.max(...ys);
                if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) return null;
                return {
                    x: PadTool.toMil(x0),
                    y: PadTool.toMil(y1),
                    w: PadTool.toMil(x1 - x0),
                    h: PadTool.toMil(y1 - y0)
                };
            };

            if (data.fills) {
                // FPC 补强的叠层序号：普通图元 zIndex 都是 null、不占号，这里从 1 起顺序递增。
                let fpcZ = 0, fpcMade = 0, fpcFallback = 0;
                data.fills.forEach(f => {
                    const ids = nextIds();

                    // --- FPC 补强层（58 / 59）：输出 FPC_FILL，而不是普通填充 ---
                    // 三种源码格式（Temp/FPC：V2/V3/V4 图元完全一致，仅行格式不同）：
                    //   V2    ["FPC_FILL", id, 0, layerId, material, thickness, path, 0]
                    //   V3/V4 {"type":"FPC_FILL"}||{layerId, material, thickness, path, locked, zIndex}
                    // thickness 单位 mm（0.2 / 0.018），与文件名里的数字一致。
                    if (f.stiffener && (f.layerId === 58 || f.layerId === 59)) {
                        // ① 矩形 → R 快捷式（最简，EDA 直接识别为矩形补强）
                        // ② 其它形状 → 通用路径式（内部路径直接转 mil 后的扁平数组，
                        //    与官方多边形补强源码 path 同构：[[x,y,"L",x,y,"ARC",sweep,x,y,...]]）
                        const rect = fpcRectOf(f.path);
                        const flat = rect ? null : generatePathStr(f.path);
                        // 有效路径至少 起点(2) + "L" + 一个点(2)；不足则无法成面
                        const body = rect
                            ? [["R", rect.x, rect.y, rect.w, rect.h, 0, 0]]
                            : (Array.isArray(flat) && flat.length >= 5 ? [flat] : null);
                        if (body) {
                            fpcZ++;
                            if (isV3) {
                                const obj = { "type": "FPC_FILL", "ticket": ids.t, "id": ids.id };
                                const content = {
                                    "partitionId": "",
                                    "groupId": 0,
                                    "layerId": f.layerId,
                                    "material": f.stiffener.material,
                                    "thickness": f.stiffener.thickness,
                                    "path": body,
                                    "locked": false,
                                    "zIndex": fpcZ
                                };
                                output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                            } else {
                                output.push(JSON.stringify(["FPC_FILL", ids.id, 0, f.layerId,
                                    f.stiffener.material, f.stiffener.thickness, body, 0]));
                            }
                            fpcMade++;
                            return;
                        }
                        fpcFallback++;   // 连路径都拼不出来（空/退化）→ 落到下面的普通 FILL
                    }
                    // 环规整（去零长线段 + 显式闭合）：嘉立创EDA **标准版** 导出的区域路径
                    // 常带「M 起点 → L 起点」的零长首段且不闭合，未规整时 EDA 会拒绝整块填充
                    // —— 表现为「画布渲染正常、导入 EDA 后填充区域丢失」（见 06-utils.js
                    // fillNormalizeFlatRing 的说明）。专业版来源本就是干净闭合的，此处为空操作。
                    const normalize = (typeof fillNormalizeFlatRing === 'function')
                        ? fillNormalizeFlatRing : (a => a);
                    const singlePath = normalize(generatePathStr(f.path));
                    if (!singlePath || !singlePath.length) return;
                    const holePaths = (f.holes || [])
                        .map(h => normalize(generatePathStr(h)))
                        .filter(hp => hp && hp.length >= 3);
                    const rings = [singlePath].concat(holePaths);
                    if (isV3) {
                        // --- [修改] V3 格式处理 ---
                        const obj = { "type": "FILL", "ticket": ids.t, "id": ids.id };
                        
                        const content = {
                            "partitionId": "",
                            "groupId": 0,
                            "netName": netNameOf(f),
                            "layerId": f.layerId,
                            // ⚠️ 线宽必须 0：EDA 会按线宽把实心填充整体内缩（写 0.2 时
                            //    相邻填充各缩一半 → 缝宽再 +0.2 mil，铜皮连不上）。
                            "width": 0,
                            "fillStyle": "SOLID",   // [新增] 填充模式：SOLID (实心填充)
                            "path": rings,          // 首环为外框，其余为挖空内环
                            "locked": false,
                            "zIndex": null,
                            "isBridgingCopper": false, // 是否是桥接铜
                            "networkList": [],
                            "refs": null            // 关联图元
                        };
                        
                        output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                    } else {
                        // --- V2 格式处理 ---
                        // ["FILL", id, group, net, layer, width, type(0=solid), path, rot]
                        // width 必须 0（同上：写 0.2 会让填充内缩，相邻块之间又多一条 0.2 mil 缝）
                        const arr = ["FILL", ids.id, 0, netNameOf(f), f.layerId, 0, 0, rings, 0];
                        output.push(JSON.stringify(arr));
                    }
                });
                console.log(`生成了 ${data.fills.length} 个填充区域`);
                if (fpcMade || fpcFallback) {
                    console.log(`FPC 补强：${fpcMade} 个 FPC_FILL`
                        + (fpcFallback ? `，${fpcFallback} 个非矩形补强退回普通填充（材料信息未写）` : ''));
                }
            }

            // ... (H. Image 生成 - 保持不变) ...
            if (data.images) {
                data.images.forEach(img => {
                    const ids = nextIds();
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    
                    const processPt = (xMM, yMM) => {
                        const x = PadTool.toMil(xMM);
                        const y = PadTool.toMil(yMM);
                        if (x < minX) minX = x; if (x > maxX) maxX = x;
                        if (y < minY) minY = y; if (y > maxY) maxY = y;
                        return { x, y };
                    };
                    const rawPath = img.path;
                    if (!rawPath || rawPath.length === 0) return;
                    const pathArr = [];
                    if (rawPath[0].cmd === 'M') {
                        const p = processPt(rawPath[0].x, rawPath[0].y);
                        pathArr.push(p.x, p.y); 
                    } else {
                        const p = processPt(rawPath[0].x, rawPath[0].y);
                        pathArr.push(p.x, p.y);
                    }
                    for (let i = 1; i < rawPath.length; i++) {
                        const op = rawPath[i];
                        if (op.cmd === 'L') {
                            const p = processPt(op.x, op.y);
                            pathArr.push("L", p.x, p.y);
                        } else if (op.cmd === 'A') {
                            const p = processPt(op.x, op.y);
                            pathArr.push("L", p.x, p.y); 
                        }
                    }
                    // --- [修改开始] 计算宽高并进行非零校验 ---
                    const width = maxX - minX;
                    const height = maxY - minY;

                    // 如果尺寸无效 (<= 0.001 mil)，则剔除
                    if (width <= 0.001 || height <= 0.001) return; 
                    // --- [修改结束] ---
                    // const width = maxX - minX;
                    // const height = maxY - minY;
                    const tlX = minX;
                    const tlY = maxY;
                    let imgRot = 0;
                    let imgMirror = 0;
                    // (前置逻辑：判断是否为底层，设置旋转和镜像)
                    if ([2, 4, 6, 8, 10].includes(img.layerId)) {
                        imgRot = 360;  
                        imgMirror = 1; 
                    }

                    if (isV3) {
                        // --- [修改] V3 格式处理：IMAGE 图元 ---
                        const obj = { "type": "IMAGE", "ticket": ids.t, "id": ids.id };
                        
                        const content = {
                            "partitionId": "",
                            "groupId": 0,
                            "layerId": img.layerId,
                            
                            // 坐标与尺寸
                            "startX": tlX,          // 左上 X
                            "startY": tlY,          // 左上 Y
                            "width": width,         // 宽
                            "height": height,       // 高
                            
                            // 变换属性
                            "angle": imgRot,        // 旋转角度 (通常底层为 360)
                            "mirror": !!imgMirror,  // 镜像 (将 0/1 转为 false/true)
                            
                            // 路径数据：需注意 V3 图片路径是二维数组 [[path...]]
                            "path": [pathArr],      
                            
                            // 通用属性
                            "locked": false,
                            "zIndex": -1,
                            "specialColor": null
                        };

                        output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                    } else {
                        // --- V2 格式处理 (保持不变) ---
                        // ["IMAGE", id, group, layer, x, y, w, h, rot, mirror, [path], locked]
                        const arr = ["IMAGE", ids.id, 0, img.layerId, tlX, tlY, width, height, imgRot, imgMirror, [pathArr], 0];
                        output.push(JSON.stringify(arr));
                    }
                });
                console.log(`生成了 ${data.images.length} 个图片图元`);
            }

            // ... (I. Text Lines 生成 - 保持不变) ...
            if (data.textLines) {
                data.textLines.forEach(t => {
                    const ids = nextIds();
                    const width = PadTool.toMil(t.width);
                    const pathObj = generatePathStr(t.path);
                    if (isV3) {
                    // --- [修改] V3 格式处理：文字折线使用 POLY 图元 ---
                    const obj = { "type": "POLY", "ticket": ids.t, "id": ids.id };
                    
                    const content = { 
                        "partitionId": "", 
                        "groupId": 0, 
                        "netName": "", 
                        "layerId": t.layerId, 
                        "locked": false, 
                        "zIndex": null, 
                        "width": width,          // [修改] 线宽属性名为 width (原为 strokeWidth)
                        "path": pathObj,         // 路径数组
                        "polyType": "NORMAL"     // [新增] 折线类型：普通
                    };
                    
                    output.push(JSON.stringify(obj) + "||" + JSON.stringify(content));
                } else {
                    // --- V2 格式处理 (保持不变) ---
                    // ["POLY", id, group, net, layer, width, path, type]
                    const arr = ["POLY", ids.id, 0, "", t.layerId, width, pathObj, 0];
                    output.push(JSON.stringify(arr));
                }
                });
                console.log(`生成了 ${data.textLines.length} 条文字折线`);
            }

            return output;
        }
    };

