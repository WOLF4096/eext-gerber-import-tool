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
                polarity: 'D' 
            };
            this.bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        }

        parse(content, configOverride) {
            this.reset();
            
            if (content.indexOf('M48') !== -1 || (content.indexOf('T0') !== -1 && content.indexOf('D0') === -1)) {
                this.state.isDrill = true;
            }

            if (configOverride) {
                if (this.state.isDrill) {
                    // 如果是钻孔文件，且设置了钻孔单位，则应用
                    if (configOverride.drillUnits && configOverride.drillUnits !== 'auto') {
                        this.state.units = configOverride.drillUnits;
                    }
                } else {
                    // 否则应用图形单位
                    if (configOverride.units && configOverride.units !== 'auto') {
                        this.state.units = configOverride.units;
                    }
                }
                
                let intVal = 2;
                let decVal = 4;

                if (this.state.isDrill) {
                    // 如果是钻孔文件，应用钻孔参数
                    if (configOverride.dInt) intVal = configOverride.dInt;
                    if (configOverride.dDec) decVal = configOverride.dDec;
                } else {
                    // 如果是图形文件，应用图形参数
                    if (configOverride.gInt) intVal = configOverride.gInt;
                    if (configOverride.gDec) decVal = configOverride.gDec;
                }

                const div = Math.pow(10, decVal);
                this.state.format.xInt = intVal; this.state.format.yInt = intVal;
                this.state.format.xDec = decVal; this.state.format.yDec = decVal;
                this.state.format.divX = div; this.state.format.divY = div;
            }

            let cleanContent = content.replace(/[\r\n]+/g, '\n');
            // 匹配 %AMName*Content*% 格式，非贪婪匹配
            const amRegex = /%AM(\w+)\*([^%]+)%/g;
            let amMatch;
            while ((amMatch = amRegex.exec(cleanContent)) !== null) {
                const macroName = amMatch[1];
                const macroBody = amMatch[2]; // 获取 * 和 * 之间的内容
                
                // 处理数据：将换行去掉，将星号转为逗号（有些Gerber用*分隔参数）
                const cleanBody = macroBody.replace(/[\n\r]/g, '').replace(/\*/g, ',');
                const params = cleanBody.split(',').map(Number);
                
                // 仅处理 Primitive 4 (Polygon)
                // 格式: 4, Exposure, PointCount, x1, y1, ...
                if (params[0] === 4) {
                    const count = params[2];
                    const points = [];
                    for (let i = 0; i < count; i++) {
                        const idx = 3 + (i * 2);
                        if (idx + 1 < params.length) {
                            points.push({ x: params[idx], y: params[idx+1] });
                        }
                    }
                    // 存入 macros
                    this.macros[macroName] = { type: 'POLYGON', points: points };
                }
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
                units: this.state.units 
            };
        }

        handleExt(line, config) {
            line = line.replace(/%/g, '');
            
            // --- [核心修复] ---
            // 旧代码检查的是 config.int，但实际上传入的是 config.gInt 或 config.dInt
            // 只要 config 中存在任意一种手动指定的参数，就忽略文件内部的格式定义
            const ignoreFileFormat = config && (
                config.gInt !== undefined || 
                config.gDec !== undefined || 
                config.dInt !== undefined || 
                config.dDec !== undefined
            );
            
            if (line.startsWith('LPD')) this.state.polarity = 'D'; 
            if (line.startsWith('LPC')) this.state.polarity = 'C'; 

            // 如果 ignoreFileFormat 为 true，则跳过 %FS 解析，保留手动设置的参数
            if (line.startsWith('FS') && !ignoreFileFormat) {
                const mX = line.match(/X(\d)(\d)/), mY = line.match(/Y(\d)(\d)/);
                if (mX) { this.state.format.xDec = parseInt(mX[2]); this.state.format.divX = Math.pow(10, this.state.format.xDec); }
                if (mY) { this.state.format.yDec = parseInt(mY[2]); this.state.format.divY = Math.pow(10, this.state.format.yDec); }
            }
            if (line.startsWith('MO')) {
                // 如果 config 指定了 units (非 auto)，则忽略文件内部单位设置
                if (!config || config.units === 'auto') {
                    this.state.units = line.includes('IN') ? 'in' : 'mm';
                }
            }
            // --- [新增] 解析 AM (Aperture Macro) ---
            if (line.startsWith('AM')) {
                // 格式示例: AMPolygonMacro1*4,1,6,x1,y1,x2,y2...
                const parts = line.split('*');
                if (parts.length >= 2) {
                    const macroName = parts[0].substring(2); // 去掉 'AM'
                    const macroBody = parts[1]; // 获取数据部分 "4,1,6,..."
                    
                    // 解析数据
                    const params = macroBody.split(',').map(Number);
                    
                    // 仅处理 Primitive 4 (Polygon)
                    // 格式: 4, Exposure, NumPoints, x1, y1, ...
                    if (params[0] === 4) {
                        const count = params[2];
                        const points = [];
                        for (let i = 0; i < count; i++) {
                            // 点坐标从索引 3 开始，每两个一组 (x, y)
                            const idx = 3 + (i * 2);
                            if (idx + 1 < params.length) {
                                points.push({ x: params[idx], y: params[idx+1] });
                            }
                        }
                        // 存入 macros 字典
                        this.macros[macroName] = {
                            type: 'POLYGON',
                            points: points
                        };
                    }
                }
            }
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
            if (line.startsWith('G37')) { this.state.isRegion = false; if (this.state.regionPath.length > 0) { this.commands.push({ type: 4, path: this.state.regionPath, polarity: this.state.polarity }); } this.state.regionPath = []; return; }

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
                    case 'X': this.state.x = val; hasCoord = true; break;
                    case 'Y': this.state.y = val; hasCoord = true; break;
                    case 'I': this.state.i = val; break;
                    case 'J': this.state.j = val; break;
                    case 'D': tempD = parseInt(val); break;
                    case 'T': tempT = parseInt(val); break;
                }
            }

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
                if (tempD === 2) { 
                    this.state.regionPath.push({ cmd: 'M', x: this.state.x, y: this.state.y });
                } else if (hasCoord || tempD === 1 || foundG) {
                    this.updateBounds(this.state.x, this.state.y);
                    if (this.state.regionPath.length === 0) {
                         this.state.regionPath.push({ cmd: 'M', x: prevX, y: prevY });
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
                else this.record(tempD, prevX, prevY);
            } else if (hasCoord) {
                if (this.state.isDrill) this.record(3, prevX, prevY);
                else this.record(1, prevX, prevY);
            }
            this.state.i = 0; this.state.j = 0;
        }

        updateBounds(x, y) {
            if (x < this.bounds.minX) this.bounds.minX = x;
            if (x > this.bounds.maxX) this.bounds.maxX = x;
            if (y < this.bounds.minY) this.bounds.minY = y;
            if (y > this.bounds.maxY) this.bounds.maxY = y;
        }

        record(dCode, prevX, prevY) {
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

