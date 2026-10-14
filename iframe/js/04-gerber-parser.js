// ====================================================================================
// 04-gerber-parser.js  —  RS-274X 解析器
// ------------------------------------------------------------------------------------
// 职责：class GerberParser（parse / handleExt / handleStd / updateBounds / record）。
//       把 Gerber 图形文件与钻孔文件文本解析为统一的指令数组 commands 与光圈表 apertures。
//       支持 %FS %MO %ADD %AM、G36/G37 区域填充、G85 槽孔、LPD/LPC 极性、
//       M48 钻孔刀具表、G01/G02/G03 直线与圆弧插补。
// 依赖：无。产出由 05-pad-tool.js 消费。
// 加载顺序：第 4 个
// ====================================================================================

// ====================================================================================
// 3. 核心解析器 (Parser)
// ====================================================================================

    // Gerber 解析器核心 (支持 EasyEDA Pro 宏名称与 Drill Drawing)
    class GerberParser {
        constructor() { this.reset(); }
        
        reset() {
            this.features = {}; // 处理模式特性开关，load 期默认为空
            this.apertures = {}; 
            this.macros = {}; // <--- [新增] 用于存储宏定义
            this.commands = [];
            this.state = { 
                x: 0, y: 0, 
                dCode: null, apertureCode: null, 
                format: { xInt:2, xDec:4, divX:10000, yInt:2, yDec:4, divY:10000 }, 
                units: 'mm',
                isRegion: false,
                regionPath: [], 
                interpolationMode: 1, 
                isDrill: false,
                polarity: 'D',
                // 是否已经有过「当前点」。Gerber 允许文件第一段直接 D01 而没有前置 D02，
                // 此时当前点未定义，不能拿初始的 (0,0) 当起点用。
                hasPoint: false,
                // 模态操作码：无 D 码的坐标行要沿用上一次的 D01/D02/D03
                dCode: null
            };
            this.bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        }

        parse(content, configOverride, features) {
            this.reset();
            // 处理模式带来的解析特性开关（由 processors/*.js 的 parserFeatures 提供）：
            //   x2Attributes / x3Components  是否解析 %TF/%TA/%TO/%TD 属性
            //   legacy274d                   是否启用 G70/G71、G90/G91、G54Dnn 等老式指令
            //   apertureTable                外部孔径表（RS-274D 没有内嵌光圈定义时使用）
            this.features = features || {};
            
            if (content.indexOf('M48') !== -1 || (content.indexOf('T0') !== -1 && content.indexOf('D0') === -1)) {
                this.state.isDrill = true;
            }

            // 先读出「文件自己声明了什么」：%FS / G04 注释 / 钻孔文件头的格式与单位。
            // 文件自带声明优先于界面默认值，否则像 P-CAD「Numeric Format: 4.4」、
            // 钻孔头「METRIC,LZ,000.00000」这类声明会被默认精度覆盖，坐标整体差 10 倍。
            const decl = (typeof detectGerberDeclarations === 'function')
                ? detectGerberDeclarations(content) : null;
            this.decl = decl;

            // 只有界面「手动改过」单位/精度时才强制覆盖文件声明（forceUnits / forceFormat）
            const forceUnits = !!(configOverride && configOverride.forceUnits === true);
            const forceFormat = !!(configOverride && configOverride.forceFormat === true);

            let intVal = 2;
            let decVal = 4;

            if (configOverride) {
                if (this.state.isDrill) {
                    if (configOverride.dInt) intVal = configOverride.dInt;
                    if (configOverride.dDec) decVal = configOverride.dDec;
                } else {
                    if (configOverride.gInt) intVal = configOverride.gInt;
                    if (configOverride.gDec) decVal = configOverride.gDec;
                }
            }

            const fileUnit = decl ? (this.state.isDrill ? decl.dUnits : decl.gUnits) : null;
            const fileInt = decl ? (this.state.isDrill ? decl.dInt : decl.gInt) : null;
            const fileDec = decl ? (this.state.isDrill ? decl.dDec : decl.gDec) : null;

            // --- 单位：文件自带声明优先 ---
            if (!forceUnits && fileUnit) {
                this.state.units = fileUnit;
            } else if (configOverride) {
                if (this.state.isDrill) {
                    if (configOverride.drillUnits && configOverride.drillUnits !== 'auto') this.state.units = configOverride.drillUnits;
                } else {
                    if (configOverride.units && configOverride.units !== 'auto') this.state.units = configOverride.units;
                }
            }

            // --- 精度：文件自带声明优先 ---
            if (!forceFormat && fileDec != null && isFinite(fileDec)) {
                if (fileInt != null && isFinite(fileInt)) intVal = fileInt;
                decVal = fileDec;
                this.usingFileFormat = true;
            }

            const div = Math.pow(10, decVal);
            this.state.format.xInt = intVal; this.state.format.yInt = intVal;
            this.state.format.xDec = decVal; this.state.format.yDec = decVal;
            this.state.format.divX = div; this.state.format.divY = div;

            let cleanContent = content.replace(/[\r\n]+/g, '\n');
            // 匹配 %AMName*Content*% 格式，非贪婪匹配
            const amRegex = /%AM(\w+)\*([^%]+)%/g;
            let amMatch;
            while ((amMatch = amRegex.exec(cleanContent)) !== null) {
                const macro = this.buildMacro(amMatch[2]);
                if (macro) this.macros[amMatch[1]] = macro;
            }
            cleanContent = cleanContent.replace(/(G36|G37)/g, '\n$1\n'); 
            const lines = cleanContent.split(/[*\n]/); 

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;
                if (line.startsWith('%')) this.handleExt(line, configOverride); 
                else this.handleStd(line, configOverride);
            }
            return { 
                commands: this.commands, 
                apertures: this.apertures, 
                macros: this.macros, // <--- [新增]
                bounds: this.bounds, 
                units: this.state.units,
                // 供上层（PadTool）复用同一套换算：坐标已是 mm，光圈/宏参数仍是文件单位
                isDrill: this.state.isDrill,
                format: {
                    xInt: this.state.format.xInt, xDec: this.state.format.xDec, divX: this.state.format.divX,
                    yInt: this.state.format.yInt, yDec: this.state.format.yDec, divY: this.state.format.divY
                },
                decl: this.decl || null
            };
        }

        /**
         * 把 %AM<name>*<body>% 的宏体拆成基元块，但**不求值** ——
         * 因为宏体里通常写的是 $1/$2 变量，真正的数值要等 %ADDnn 的光圈参数才知道。
         * 求值交给 resolveApertureMacro()（06-utils.js），它同时支持 + - * / 与 X（乘号）。
         *
         * 支持的光圈宏基元：1 圆 / 4 多边形轮廓 / 5 正多边形 / 20 矢量线 / 21 中心矩形 / 22 中心圆角矩形
         */
        buildMacro(body) {
            const blocks = String(body).split('*').map(s => s.trim()).filter(Boolean);
            const out = [];
            for (const block of blocks) {
                if (!block || /^G0?4/.test(block)) continue;      // 宏体内允许夹注释
                const m = block.match(/^(\d+)\s*,\s*(.*)$/s);
                if (!m) continue;
                const code = parseInt(m[1], 10);
                if (!isFinite(code)) continue;
                const args = m[2].split(',').map(s => s.trim()).filter(s => s !== '');
                if (!args.length) continue;
                out.push({ code: code, args: args });
            }
            return out.length ? { type: 'MACRO_DEF', blocks: out } : null;
        }

        handleExt(line, config) {
            line = line.replace(/%/g, '');
            
            // 精度与单位已在 parse() 里依据「文件自身声明」定好（%FS / G04 注释 / 钻孔文件头）。
            // 这里只做兜底：文件里没有可识别声明时，才按 %FS / %MO 逐条补。
            const decl = this.decl;
            const keepFormat = !!(decl && (this.state.isDrill ? decl.dDeclared : decl.gDeclared));
            const keepUnits = !!(decl && (this.state.isDrill ? decl.dUnits : decl.gUnits));
            const forceFormat = !!(config && config.forceFormat === true);
            const forceUnits = !!(config && config.forceUnits === true);

            if (line.startsWith('LPD')) this.state.polarity = 'D'; 
            if (line.startsWith('LPC')) this.state.polarity = 'C'; 

            if (line.startsWith('FS') && !keepFormat && !forceFormat) {
                const mX = line.match(/X(\d)(\d)/), mY = line.match(/Y(\d)(\d)/);
                if (mX) { this.state.format.xDec = parseInt(mX[2]); this.state.format.divX = Math.pow(10, this.state.format.xDec); }
                if (mY) { this.state.format.yDec = parseInt(mY[2]); this.state.format.divY = Math.pow(10, this.state.format.yDec); }
            }
            if (line.startsWith('MO') && !keepUnits && !forceUnits) {
                // 如果 config 指定了 units (非 auto)，则忽略文件内部单位设置
                if (!config || config.units === 'auto') {
                    this.state.units = line.includes('IN') ? 'in' : 'mm';
                }
            }
            // 说明：光圈宏（%AM）的解析在 parse() 里用 buildMacro() 统一完成，
            // 因为这里拿到的 token 已经在 * 处被切开，看不到完整宏体。
            if (line.startsWith('ADD')) {
                const m = line.match(/ADD(\d+)([^,]+),?(.+)?/);
                if (m) {
                    const code = parseInt(m[1]);
                    const type = m[2];
                    let paramsStr = m[3] || "";
                    let params = [];
                    if (paramsStr) {
                        params = paramsStr.indexOf('X') !== -1 ? paramsStr.split('X').map(Number) : paramsStr.split(',').map(Number);
                    }
                    this.apertures[code] = { type: type, params: params };
                }
            }
        }


        handleStd(line, configOverride) {
            // ... (前置 G04 处理代码保持不变) ...
            if (line.startsWith('G04')) {
                if (line.includes('Start') || line.includes('End')) {
                    this.commands.push({ type: 5, text: line }); 
                }
                return; 
            }

            // ... (前置 Drill 头部处理代码保持不变) ...
            if (this.state.isDrill) {
                const ignoreFileUnits = configOverride && configOverride.drillUnits && configOverride.drillUnits !== 'auto';
                if (!ignoreFileUnits) {
                    if (line.includes('METRIC')) this.state.units = 'mm';
                    else if (line.includes('INCH')) this.state.units = 'in';
                }
                const toolDef = line.match(/^T(\d+).*?C([\d.]+)/i);
                if (toolDef) {
                    const code = parseInt(toolDef[1]);
                    let diameter = parseFloat(toolDef[2]);
                    if (this.state.units === 'in') diameter *= 25.4;
                    this.apertures[code] = { type: 'C', params: [diameter] };
                }
            }

            // ... (G36/G37 处理保持不变) ...
            if (line.startsWith('G36')) { this.state.isRegion = true; this.state.regionPath = []; return; }
            if (line.startsWith('G37')) {
                this.state.isRegion = false;
                // 保证 path 一定是数组：渲染器会无条件遍历 cmd.path
                const regionPath = Array.isArray(this.state.regionPath) ? this.state.regionPath.slice() : [];
                if (regionPath.length > 0) {
                    this.commands.push({ type: 4, path: regionPath, polarity: this.state.polarity });
                }
                this.state.regionPath = [];
                return;
            }

            const prevX = this.state.x;
            const prevY = this.state.y;
            const regex = /([GXYDGTIJ])([\-\+]?\d*\.?\d*)/g;
            let match, tempD = null, hasCoord = false, tempT = null;
            let foundG = false;
            
            // --- [修改 1] 新增槽孔状态变量 ---
            let isSlot = false;
            let slotStart = null; 

            while ((match = regex.exec(line)) !== null) {
                const type = match[1];
                let valStr = match[2];
                let val = parseFloat(valStr);

                if (!valStr.includes('.') && ['X','Y','I','J'].includes(type)) {
                    if (type === 'X' || type === 'I') val = val / this.state.format.divX;
                    else if (type === 'Y' || type === 'J') val = val / this.state.format.divY;
                }
                if (this.state.units === 'in' && ['X','Y','I','J'].includes(type)) val *= 25.4;

                switch(type) {
                    case 'G':
                        if (val === 1) this.state.interpolationMode = 1;
                        else if (val === 2) this.state.interpolationMode = 2; 
                        else if (val === 3) this.state.interpolationMode = 3; 
                        // --- [修改 2] 捕获 G85 槽孔指令 ---
                        else if (val === 85) {
                            isSlot = true;
                            // G85 后面的 X/Y 是终点，当前 state.x/y 是起点，先保存起点
                            slotStart = { x: this.state.x, y: this.state.y };
                        }
                        foundG = true;
                        break;
                    case 'X': if (isFinite(val)) { this.state.x = val; hasCoord = true; } break;
                    case 'Y': if (isFinite(val)) { this.state.y = val; hasCoord = true; } break;
                    case 'I': if (isFinite(val)) this.state.i = val; break;
                    case 'J': if (isFinite(val)) this.state.j = val; break;
                    // 注意：注释行里的裸字母（例如 "; Drill file" 里的 D）会让 valStr 为空、
                    // parseFloat 得到 NaN。必须忽略，否则会产生 type:NaN 的假指令，
                    // 并把 (0,0) 混进包围盒（钻孔/板框整体被撑大、自动适配失灵）。
                    case 'D': tempD = isFinite(val) ? Math.round(val) : null; break;
                    case 'T': tempT = isFinite(val) ? Math.round(val) : null; break;
                }
            }

            if (!isFinite(this.state.x) || !isFinite(this.state.y)) { this.state.i = 0; this.state.j = 0; return; }

            if (tempT !== null) {
                this.state.apertureCode = tempT;
                if (!this.apertures[tempT]) this.apertures[tempT] = { type: 'C', params: [0.1] };
            }

            // --- [修改 3] 如果检测到槽孔，生成 Type 6 指令并直接返回 ---
            if (isSlot && slotStart) {
                this.updateBounds(this.state.x, this.state.y);
                this.commands.push({
                    type: 6, // Type 6 定义为槽孔 (Slot)
                    x: this.state.x, 
                    y: this.state.y,
                    startX: slotStart.x,
                    startY: slotStart.y,
                    ap: this.state.apertureCode,
                    polarity: this.state.polarity
                });
                return; // 结束，防止被下方逻辑识别为普通钻孔
            }

            if (this.state.isRegion) {
                // 区域填充逻辑 
                const regionHadPoint = this.state.hasPoint;
                this.state.hasPoint = true;
                if (tempD === 2) { 
                    this.state.regionPath.push({ cmd: 'M', x: this.state.x, y: this.state.y });
                } else if (hasCoord || tempD === 1 || foundG) {
                    this.updateBounds(this.state.x, this.state.y);
                    if (this.state.regionPath.length === 0) {
                         // 没有起笔点时就以当前点为多边形起点，避免从 (0,0) 多拉一条边
                         const sx = regionHadPoint ? prevX : this.state.x;
                         const sy = regionHadPoint ? prevY : this.state.y;
                         this.state.regionPath.push({ cmd: 'M', x: sx, y: sy });
                    }
                    if (this.state.interpolationMode === 1) {
                        this.state.regionPath.push({ cmd: 'L', x: this.state.x, y: this.state.y });
                    } else {
                        this.state.regionPath.push({ 
                            cmd: 'A', x: this.state.x, y: this.state.y, 
                            i: this.state.i || 0, j: this.state.j || 0, mode: this.state.interpolationMode,
                            startX: prevX, startY: prevY
                        });
                    }
                }
                this.state.i = 0; this.state.j = 0;
                return; 
            }

            if (tempD !== null) {
                if (tempD >= 10) this.state.apertureCode = tempD;
                else if (tempD >= 1 && tempD <= 3) {
                    this.state.dCode = tempD;   // 记录模态操作码，供后续「无 D 码」的坐标行沿用
                    if (tempD === 3) {
                        // 位置未定义时的裸 D03 没有意义，忽略
                        if (hasCoord || this.state.hasPoint) {
                            this.state.hasPoint = true;
                            this.record(3, prevX, prevY);
                        }
                    } else if (tempD === 2) {
                        // 只有「带坐标的 D02」才真正确定了当前点。
                        // 位置未定义时的裸 D2* 必须忽略，否则会把初始的 (0,0)
                        // 当成一个真实坐标写进包围盒 —— 板在 x∈[590,688] 这类
                        // 大偏移布局上，一个 (0,0) 就能把适配范围撑大近一倍。
                        if (hasCoord) {
                            this.state.hasPoint = true;
                            this.record(2, prevX, prevY);
                        } else if (this.state.hasPoint) {
                            this.record(2, prevX, prevY);   // 重复移动到当前位置，无害
                        }
                    } else {
                        // tempD === 1
                        if (!this.state.hasPoint) {
                            // 首段直接 D01：当前点未定义，按惯例当作起笔(Move)
                            this.state.hasPoint = true;
                            this.record(2, prevX, prevY);
                        } else {
                            this.record(1, prevX, prevY);
                        }
                    }
                }
                // D00 / D04~D09 不是合法操作码：忽略，绝不能产生 type>=4 或 NaN 的指令
            } else if (hasCoord) {
                // 无 D 码的坐标行：Gerber 的语义是「沿用上一个模态操作码」。
                // 老实现一律当成绘制，于是 "D2*" 之后的 X/Y 行会被画成一条
                // 从 (0,0) 拉到板上的假直线（P-CAD 的 GKO/GML 就是这样）。
                const modal = this.state.dCode;
                if (this.state.isDrill) {
                    this.state.hasPoint = true;
                    this.record(3, prevX, prevY);
                } else if (modal === 2) {
                    this.state.hasPoint = true;
                    this.record(2, prevX, prevY);
                } else if (modal === 3) {
                    this.state.hasPoint = true;
                    this.record(3, prevX, prevY);
                } else if (!this.state.hasPoint) {
                    this.state.hasPoint = true;
                    this.record(2, prevX, prevY);
                } else {
                    this.record(1, prevX, prevY);
                }
            }
            this.state.i = 0; this.state.j = 0;
        }

        updateBounds(x, y) {
            if (!isFinite(x) || !isFinite(y)) return;
            if (x < this.bounds.minX) this.bounds.minX = x;
            if (x > this.bounds.maxX) this.bounds.maxX = x;
            if (y < this.bounds.minY) this.bounds.minY = y;
            if (y > this.bounds.maxY) this.bounds.maxY = y;
        }

        record(dCode, prevX, prevY) {
            // 只允许 D01/D02/D03 三种操作码。
            // 历史缺陷：任何 dCode < 10 都会被记录，于是 D04~D09 甚至 NaN 都被存成指令，
            // 其中 type:4 会被渲染器当成「区域填充」去读 cmd.path，直接崩溃。
            if (dCode !== 1 && dCode !== 2 && dCode !== 3) return;
            if (!isFinite(this.state.x) || !isFinite(this.state.y)) return;
            this.updateBounds(this.state.x, this.state.y);
            const cmd = {
                type: dCode, x: this.state.x, y: this.state.y, ap: this.state.apertureCode,
                polarity: this.state.polarity
            };
            if (dCode === 1) {
                cmd.mode = this.state.interpolationMode;
                if (cmd.mode === 2 || cmd.mode === 3) {
                    cmd.i = this.state.i || 0; cmd.j = this.state.j || 0;
                    cmd.prevX = prevX; cmd.prevY = prevY;
                }
            }
            this.commands.push(cmd);
        }
    }

    const parser = new GerberParser();

