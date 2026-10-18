// ====================================================================================
// 08-export.js  —  导出控制器
// ------------------------------------------------------------------------------------
// 职责：全部导出入口与实现。
//   · window.exportPDF            位图 PDF 导出（DPI 300/600/900/1200）
//   · window.handleExportToCanvas 注入当前 PCB 画布（源码注入 / 图元注入）
//   · window.handleExportProV2 / handleExportProV3   导出工程文件（.epcb / .epro2）
//   · window.handleExportStandard 导出标准版（生成嘉立创EDA标准版 PCB 源码 .json）
//   · configureHeader / configureBlindViasAPI        按板层与埋盲孔规则给模板头打补丁
//   · exportForEasyEDA_Pro / exportForOther_Pro / importPrimitivesAPI / exportForStandard
//   · window.generateDebugSource  生成调试源码（输出到文本框）
// 依赖：01-templates.js（模板常量）、05-pad-tool.js（图元生成）、
//       06-utils.js、03-state.js。
// 加载顺序：第 8 个
// ====================================================================================

    /**
     * --- 6. PDF 导出功能模块 (逻辑修正版) ---
     */
    window.exportPDF = async (mode) => {
        if (loadedFiles.length === 0) {
            alert("请先加载 Gerber 文件");
            return;
        }

        // [新增] 计时
        const startTime = performance.now();

        const overlay = document.getElementById('loading-overlay');
        overlay.textContent = "正在准备 PDF 0%...";
        overlay.style.display = 'flex';

        // 给 UI 一点渲染时间
        await new Promise(r => setTimeout(r, 50));

        let savedState = null;

        try {
            // 1. 确定要导出的目标图层列表 & 用于计算尺寸的图层列表
            let targetLayers = []; // 实际要渲染的层
            let boundsLayers = []; // 用于计算包围盒的层

            if (mode === 'single') {
                // [当前内容]：合成渲染，只计算可见层尺寸
                targetLayers = null; // 特殊标记：不需要循环单独渲染
                boundsLayers = loadedFiles.filter(f => f.visible);
            } 
            else if (mode === 'multi') {
                // [启用图层]：只导出可见层，每层一页
                targetLayers = loadedFiles.filter(f => f.visible);
                boundsLayers = targetLayers;
            } 
            else if (mode === 'all') {
                // [全部图层]：导出所有层，每层一页
                targetLayers = loadedFiles;
                boundsLayers = loadedFiles; // 必须计算所有层的尺寸，防止隐藏的大层被裁切
            }

            if (boundsLayers.length === 0) {
                throw new Error("没有可导出的图层 (请至少启用一个图层)");
            }

            // 2. 备份当前视图状态 (用于导出后恢复)
            savedState = {
                w: mainCanvas.width, 
                h: mainCanvas.height,
                scale: viewState.scale,
                offsetX: viewState.offsetX, 
                offsetY: viewState.offsetY,
                visibility: loadedFiles.map(f => f.visible) // 备份可见性状态
            };

            // 3. 计算包围盒 (基于 boundsLayers)
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            
            boundsLayers.forEach(f => {
                const b = f.data.bounds;
                if (b.minX !== Infinity) {
                    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
                    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
                }
            });

            if (minX === Infinity) throw new Error("无法获取板子尺寸");

            
            // 4. 定义 PDF 物理尺寸 (英寸)
            const paddingInches = 0.7; // 固定 0.7 英寸边距
            
            // 将板子尺寸从 mm 转换为 inch
            const boardW_in = (maxX - minX) / 25.4;
            const boardH_in = (maxY - minY) / 25.4;
            
            // 加上边距的预期尺寸
            const raw_pdfW_in = boardW_in + (paddingInches * 2);
            const raw_pdfH_in = boardH_in + (paddingInches * 2);

            // 5. 读取 DPI 并计算画布像素
            const uiDpiVal = document.getElementById('cfg-dpi') ? document.getElementById('cfg-dpi').value : '1200';
            const targetDPI = parseInt(uiDpiVal) || 1200;

            // 像素 = 原始英寸 * DPI (向上取整)
            const canvasW = Math.ceil(raw_pdfW_in * targetDPI);
            const canvasH = Math.ceil(raw_pdfH_in * targetDPI);

            // 反向计算最终精确的 PDF 英寸尺寸 (避免像素取整误差导致比例不对)
            const final_pdfW_in = canvasW / targetDPI;
            const final_pdfH_in = canvasH / targetDPI;

            // 调整 Canvas 大小以匹配高分辨率
            mainCanvas.width = canvasW;
            mainCanvas.height = canvasH;
            bufferCanvas.width = canvasW;
            bufferCanvas.height = canvasH;

            // CSS 视觉缩放 (防止页面布局被撑大)
            const container = document.getElementById('canvas-container');
            const contW = container.clientWidth;
            const contH = container.clientHeight;
            // 保持比例居中显示
            const displayRatio = Math.min(contW / canvasW, contH / canvasH);
            
            mainCanvas.style.width = `${canvasW * displayRatio}px`;
            mainCanvas.style.height = `${canvasH * displayRatio}px`;
            mainCanvas.style.marginLeft = `${(contW - canvasW * displayRatio) / 2}px`;
            mainCanvas.style.marginTop = `${(contH - canvasH * displayRatio) / 2}px`;

            // 6. 计算渲染参数 (视图变换)
            const pixelScale = targetDPI / 25.4; 
            // 计算居中偏移
            const effectivePaddingW_Px = (canvasW - ((maxX - minX) * pixelScale)) / 2;
            const effectivePaddingH_Px = (canvasH - ((maxY - minY) * pixelScale)) / 2;

            // 应用到 ViewState
            viewState.scale = pixelScale;
            viewState.offsetX = effectivePaddingW_Px - (minX * pixelScale);
            viewState.offsetY = effectivePaddingH_Px + (maxY * pixelScale);

            // 7. 初始化 PDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: final_pdfW_in > final_pdfH_in ? 'l' : 'p',
                unit: 'in', 
                format: [final_pdfW_in, final_pdfH_in]
            });

            // 辅助：黑底绘图函数 (接收 forceSolid 参数并透传)
            const drawWithBlackBg = (forceSolid = false) => {
                drawCanvas(true, forceSolid); 
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0); 
                ctx.globalCompositeOperation = 'destination-over'; 
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvasW, canvasH);
                ctx.restore();
            };
            
            // --- 8. 开始渲染 ---
            
            if (mode === 'single') {
                appLog(`正在生成当前视图...`);
                // === 模式 A: 单页合成 (当前可视内容) ===
                overlay.textContent = "正在渲染视图...";
                await new Promise(r => setTimeout(r, 10));

                drawWithBlackBg(false);
                overlay.textContent = "正在生成 PDF...";
                await new Promise(r => setTimeout(r, 10));

                const imgData = mainCanvas.toDataURL('image/jpeg', 1.0);
                doc.addImage(imgData, 'JPEG', 0, 0, final_pdfW_in, final_pdfH_in);
            
            } else {
                // === 模式 B & C: 多页分页 (启用图层 或 全部图层) ===
                const total = targetLayers.length;
                
                for (let i = 0; i < total; i++) {
                    const file = targetLayers[i];
                    appLog(`正在生成 ${file.name}`); // 或者 appLog(`正在生成第 ${i+1} 层`);
                    const percent = Math.round(((i) / total) * 100);
                    overlay.textContent = `正在处理图层 ${percent}% (${i + 1}/${total})`;
                    await new Promise(r => setTimeout(r, 0));

                    // 1. 隔离显示当前图层
                    loadedFiles.forEach(f => f.visible = false);
                    file.visible = true;

                    // 2. 绘制：强制 100% 不透明 (传 true)
                    drawWithBlackBg(true);

                    // 3. 绘制水印标签 (黄色文字)
                    ctx.setTransform(1, 0, 0, 1, 0, 0); 
                    ctx.fillStyle = '#FFFF00'; 
                    ctx.font = `bold ${3 * pixelScale}px "Segoe UI", sans-serif`; 
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';
                    const label = `[${i+1}] ${file.name}  (${layerIdMap[file.layerId] || 'Unknown Layer'})`;
                    ctx.fillText(label, 5 * pixelScale, 3 * pixelScale);

                    // 4. 添加到 PDF
                    const imgData = mainCanvas.toDataURL('image/jpeg', 1.0);
                    if (i > 0) doc.addPage([final_pdfW_in, final_pdfH_in]); 
                    doc.addImage(imgData, 'JPEG', 0, 0, final_pdfW_in, final_pdfH_in);
                }
            }
            
            overlay.textContent = "正在保存文件...";
            await new Promise(r => setTimeout(r, 10));
            
            // --- [修改] 文件名生成逻辑 ---
            let fileName = "";
            const timestamp = new Date().getTime();
            
            if (currentZipName) {
                // 如果是 ZIP 导入，使用：压缩包名_模式_时间戳.pdf
                fileName = `${currentZipName}_${mode}_${timestamp}.pdf`;
            } else {
                // 否则使用默认：Gerber_Export_模式_时间戳.pdf
                fileName = `Gerber_Export_${mode}_${timestamp}.pdf`;
            }

            // [新增] 结束计时日志
            const endTime = performance.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            appLog(`数据生成完毕，耗时${duration}秒`);

            doc.save(fileName);

        } catch (e) {
            console.error(e);
            appLog(`PDF生成失败: ${e.message}`);
            alert("导出 PDF 失败: " + e.message);
        } finally {
            // 9. 恢复现场 (非常重要)
            if (savedState) {
                // 恢复画布尺寸
                mainCanvas.width = savedState.w;
                mainCanvas.height = savedState.h;
                bufferCanvas.width = savedState.w;
                bufferCanvas.height = savedState.h;
                
                // 清除 CSS 样式
                mainCanvas.style.width = '';
                mainCanvas.style.height = '';
                mainCanvas.style.marginLeft = '';
                mainCanvas.style.marginTop = '';

                // 恢复视图参数
                viewState.scale = savedState.scale;
                viewState.offsetX = savedState.offsetX;
                viewState.offsetY = savedState.offsetY;
                
                // 恢复图层可见性
                loadedFiles.forEach((f, i) => f.visible = savedState.visibility[i]);

                // 恢复画布尺寸 + 重绘。
                // ⚠️ 必须走 resizeCanvas()，不能只赋 width/height：给 canvas.width 赋值会
                //    把 context 变换重置成单位矩阵，dpr 缩放随之丢失。实测后果是「导出过 PDF
                //    之后，高 DPI 屏上图形按设备像素绘制（缩小 dpr 倍、偏左上），而标注文字
                //    仍按绝对 dpr 绘制」—— 即用户看到的图形与文字 DPI 不一致。
                //    resizeCanvas 会重新按 dpr 设置尺寸、scale 并 requestDraw。
                resizeCanvas();
            }
            overlay.style.display = 'none';
        }
    };



    // --- 1.1 按钮：导出至当前 PCB 画布 (修改版) ---
    // ====================================================================================
    // 写入画布前的安全检查：确认当前文档是空白 PCB
    // ------------------------------------------------------------------------------------
    // 本工具通过 eda.sys_FileManager.setDocumentSource() 整体替换当前文档源码，
    // 若文档中已有设计数据，这些数据会被覆盖且难以恢复。
    // 免责声明里写了「务必在空白 PCB 文档中使用」，但那只能靠用户自觉；
    // 这里补一道程序化校验：读取当前文档源码，统计其中的图元记录数，非空则强提示。
    // 任何一步失败都放行（不拦路）—— 免责声明已经提示过，这里只是多一层保险，
    // 不能因为它自身异常而让本来可用的功能失效。
    // ====================================================================================

    // 文档源码中「图元」记录的类型白名单（DOCHEAD / LAYER / RULE 等属于元信息，不计入）
    const PRIMITIVE_SOURCE_TYPES = new Set([
        'PAD', 'VIA', 'TRACK', 'ARC', 'LINE', 'POLY', 'POLYLINE', 'FILL', 'REGION',
        'POUR', 'POURED', 'STRING', 'TEXT', 'HOLE', 'IMAGE', 'DIMENSION', 'COMPONENT', 'OBJECT'
    ]);

    /**
     * 统计文档源码里已有多少个图元记录。
     * 兼容 V3（每行 {"type":"XXX",...}||{...}）与 V2（每行 ["XXX",...]）两种行格式。
     * 采用「白名单」而非「黑名单」：识别不出的类型一律不算图元，
     * 最坏情况只是少提示一次，不会误报。
     *
     * @param source - 文档源码
     * @returns 图元记录数量
     */
    function countPrimitivesInDocumentSource(source) {
        if (!source) return 0;
        let count = 0;
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            let type = null;
            if (line.charAt(0) === '{') {
                const end = line.indexOf('}');
                if (end > 0) {
                    const m = /"type"\s*:\s*"([A-Za-z_]+)"/.exec(line.slice(0, end + 1));
                    if (m) type = m[1].toUpperCase();
                }
            } else if (line.charAt(0) === '[') {
                const m = /^\[\s*"([A-Za-z_]+)"/.exec(line);
                if (m) type = m[1].toUpperCase();
            }
            if (type && PRIMITIVE_SOURCE_TYPES.has(type)) count++;
        }
        return count;
    }

    /**
     * 弹出「当前文档非空」的确认框。
     * 优先使用 EDA 原生确认框 SYS_Dialog.showConfirmationMessage，退回浏览器 confirm。
     *
     * @param count - 检测到的图元数量
     * @returns 用户是否选择继续
     */
    function askOverwriteConfirm(count) {
        const content =
            '⚠️ 当前 PCB 文档中已存在 ' + count + ' 个图元。\n\n' +
            '继续导入会替换当前文档的源码，原有图元可能丢失，且无法撤销。\n\n' +
            '强烈建议：先新建一个空白 PCB 文档，或先备份并关闭当前文档，再重新导入。\n\n' +
            '确定要继续吗？';

        if (typeof eda !== 'undefined' && eda.sys_Dialog &&
            typeof eda.sys_Dialog.showConfirmationMessage === 'function') {
            return new Promise((resolve) => {
                let settled = false;
                const done = (v) => { if (!settled) { settled = true; resolve(v); } };
                try {
                    eda.sys_Dialog.showConfirmationMessage(
                        content, '数据覆盖警告', '仍然继续', '取消', (ok) => done(!!ok)
                    );
                    // 兜底：万一对话框被关闭而回调未触发，避免流程永久挂起
                    setTimeout(() => done(false), 5 * 60 * 1000);
                } catch (e) {
                    done(false);
                }
            });
        }
        return Promise.resolve(window.confirm(content));
    }

    /**
     * 写入画布前的守卫：当前文档为空（或无法判断）时返回 true 放行。
     *
     * @returns 是否可以继续写入
     */
    async function confirmIfDocumentNotEmpty() {
        try {
            if (typeof eda === 'undefined' || !eda.sys_FileManager ||
                typeof eda.sys_FileManager.getDocumentSource !== 'function') {
                return true; // 非 EDA 环境（例如直接用浏览器打开）无法检查
            }
            const source = await eda.sys_FileManager.getDocumentSource();
            if (!source) return true; // 当前未打开文档，或读取失败

            const n = countPrimitivesInDocumentSource(source);
            if (n <= 0) return true;  // 文档是空的，直接放行

            appLog('检测到当前文档已有 ' + n + ' 个图元，已弹出覆盖确认');
            return await askOverwriteConfirm(n);
        } catch (e) {
            appLog('空文档校验已跳过：' + (e && e.message ? e.message : e));
            return true;
        }
    }

    /**
     * 按当前「处理模式」把导出请求路由到对应后端。
     * 处理模式只决定「怎么解析输入 Gerber、怎么定层」，输出统一走
     * 嘉立创专业版的源码 / 图元生成流程（exportTarget === 'jlc'）。
     * 选中的模式尚未实现时给出明确提示，而不是静默什么都不做。
     *
     * @param config - 导出配置
     * @returns 是否导出成功（用于操作计数；未实现 / 失败 / DEBUG 预览均返回 false）
     */
    async function routeExport(config) {
        const processor = processorRegistry.current();
        if (!processor.ready) {
            const msg = `处理模式「${processor.label}」尚未实现，暂时无法导出。\n请在「处理模式」下拉中改用已实现的模式（嘉立创专业版 / RS-274X）。`;
            appLog(msg.replace(/\n/g, ' '));
            alert(msg);
            return false;
        }
        if (processor.exportTarget === 'other') {
            return await exportForOther_Pro(config);
        }
        return await exportForEasyEDA_Pro(config);
    }

    window.handleExportToCanvas = async (method) => {
        const env = getEnvInfo();
        const sourceType = document.getElementById('cfg-source-type').value;

        // if (!env.isEdaEnv) {
        //     alert("此功能仅在嘉立创 EDA 专业版客户端环境中可用。");
        //     return;
        // }

        // 如果是通过API导入，使用V2版本源码方便提取参数
        if(method === 'api'){
            env.clientVer = 'pro_v2';
        }

        const config = {
            mode: 'canvas',           // 模式：注入画布
            targetVer: env.clientVer, // 目标版本：跟随当前编辑器版本
            sourceType: sourceType,   // 来源
            tryNetlist: document.getElementById('cfg-netlist').checked, // 尝试生成网络
            importMethod: method      // [新增] 导入方式: 'source' 或 'api'
        };

        // --- [数据安全] 写入画布前，校验当前文档是否已有设计数据 ---
        if (!(await confirmIfDocumentNotEmpty())) {
            appLog('已取消导入：当前文档非空，用户选择不覆盖。');
            return;
        }

        // --- [性能保护] 大数据量先提示 ---
        // 实测 1.6MB 的 Gerber：生成图元 + 网络约 8s，编辑器解析源码再卡若干秒。
        // 「通过源码导入」是同步塞给编辑器的，期间界面完全无响应，用户会以为卡死。
        // 超过 500KB 先弹窗说明，让用户自己决定【继续导入】还是改用导出文件。
        const heavyBytes = (typeof loadedGerberBytes === 'function') ? loadedGerberBytes() : 0;
        if (method === 'source' && heavyBytes > HEAVY_IMPORT_BYTES) {
            appLog(`数据量 ${(heavyBytes / 1024).toFixed(0)}KB > 500KB，提示可能卡顿`);
            const goOn = await confirmHeavyImport(heavyBytes);
            if (!goOn) {
                appLog('已取消导入：用户选择关闭（数据量较大）。');
                return;
            }
            appLog('用户确认继续导入（数据量较大）');
        }

        // 按当前处理模式路由到对应导出后端；成功后计入导入次数（PDF 不计）
        const ok = await routeExport(config);
        if (ok && typeof recordImportExportSuccess === 'function') {
            await recordImportExportSuccess(method === 'api' ? '通过图元导入 PCB 画布' : '通过源码导入 PCB 画布');
        }
    };

    // --- 1.2 按钮：导出标准版文件 (下载逻辑) ---
    window.handleExportStandard = async () => {
        const sourceType = document.getElementById('cfg-source-type').value;
        const config = {
            mode: 'file',//导出文件
            targetVer: 'std',//标准版
            sourceType: sourceType, //来源
            tryNetlist: document.getElementById('cfg-netlist').checked // 尝试生成网络
        };

        // 导出成功后计入操作次数（PDF 导出不计）
        const ok = await exportForStandard(config);
        if (ok && typeof recordImportExportSuccess === 'function') {
            await recordImportExportSuccess('导出标准版');
        }
    };

    // --- 1.3 按钮：导出专业版 V2 文件 (下载逻辑) ---
    window.handleExportProV2 = async () => {
        const sourceType = document.getElementById('cfg-source-type').value;
        const config = {
            mode: 'file',//导出文件
            targetVer: 'pro_v2',//专业版V2
            sourceType: sourceType, //来源
            tryNetlist: document.getElementById('cfg-netlist').checked // 尝试生成网络
        };

        // 按当前处理模式路由到对应导出后端；成功后计入操作次数（PDF 导出不计）
        const ok = await routeExport(config);
        if (ok && typeof recordImportExportSuccess === 'function') {
            await recordImportExportSuccess('导出专业版 V2');
        }
    };
    // --- 1.4 按钮：导出专业版 V3 文件 (下载逻辑) ---
    window.handleExportProV3 = async () => {
        const sourceType = document.getElementById('cfg-source-type').value;
        const config = {
            mode: 'file',//导出文件
            targetVer: 'pro_v3',//专业版V3
            sourceType: sourceType, //来源
            tryNetlist: document.getElementById('cfg-netlist').checked // 尝试生成网络
        };

        // 按当前处理模式路由到对应导出后端；成功后计入操作次数（PDF 导出不计）
        const ok = await routeExport(config);
        if (ok && typeof recordImportExportSuccess === 'function') {
            await recordImportExportSuccess('导出专业版 V3');
        }
    };

    // --- [修改] 动态配置头文件函数 ---
    function configureHeader(source, isV3) {
        const copperCountEl = document.getElementById('cfg-copper-layers');
        const copperCount = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;
        const neededInner = Math.max(0, copperCount - 2);

        // 本次导入是否含 FPC 补强层（58 顶部 / 59 底部）。
        // 模板取自「空白 PCB」，这两层默认 use=false / show=false；若不在这里打开，
        // FPC_FILL 图元写进去了也会因为图层被禁用而不可见（对比官方空白 FPC 源码，
        // 它与空白 PCB 源码的唯一结构差异就是这两行的 use/show）。
        const needStiffener = (typeof loadedFiles !== 'undefined' && loadedFiles)
            ? loadedFiles.some(f => f.layerId === 58 || f.layerId === 59)
            : false;

        const getLyrIdx = (id) => {
            if (id === 1) return 1;
            if (id === 2) return copperCount; 
            if (id >= 15 && id <= 46) return (id - 15) + 2; 
            return null;
        };

        // 2. 提取埋盲孔规则
        const blindFiles = loadedFiles.filter(f => f.layerId === 502 && f.pairStart && f.pairEnd);
        const blindRules = [];
        const seenRules = new Set();

        blindFiles.forEach(f => {
            const sId = f.pairStart;
            const eId = f.pairEnd;
            const sIdx = getLyrIdx(sId);
            const eIdx = getLyrIdx(eId);

            if (sIdx !== null && eIdx !== null) {
                const startPhys = Math.min(sIdx, eIdx);
                const endPhys = Math.max(sIdx, eIdx);
                const startID = (sIdx < eIdx) ? sId : eId;
                const endID   = (sIdx < eIdx) ? eId : sId;
                const ruleName = `${startPhys}-${endPhys}`;
                const uniqueKey = `${startID}-${endID}`;

                if (!seenRules.has(uniqueKey)) {
                    seenRules.add(uniqueKey);
                    blindRules.push({ name: ruleName, start: startID, end: endID });
                }
            }
        });
        
        if (isV3) {
            console.log(`[V3 Config] 1. 盲埋孔规则准备就绪: ${blindRules.length} 条`, blindRules);
        }

        const lines = source.split('\n');
        
        const newLines = lines.map((line, lineIdx) => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return line;

            // === V3 处理逻辑 ===
            if (isV3) {
                const parts = trimmedLine.split("||");
                if (parts.length < 2) return line;

                let meta, content;
                try {
                    meta = JSON.parse(parts[0]);
                    
                    // [修复] 更安全的去尾逻辑
                    let contentStr = parts[1];
                    // 去除末尾所有空白和竖线
                    contentStr = contentStr.trim();
                    if (contentStr.endsWith('|')) {
                        contentStr = contentStr.substring(0, contentStr.length - 1);
                    }
                    content = JSON.parse(contentStr);
                    
                } catch (e) {
                    // [调试] 如果解析失败，打印出来
                    console.error(`[V3 Config] 解析错误 (行 ${lineIdx}):`, e.message, line.substring(0, 50) + "...");
                    return line; 
                }

                let isModified = false;

                try {
                    // A. 修改图层启用状态
                    if (meta.type === "LAYER" && typeof content.layerId === 'number') {
                        if (content.layerId >= 15 && content.layerId <= 46) {
                            const innerIndex = content.layerId - 14; 
                            const isEnabled = innerIndex <= neededInner;
                            if (content.use !== isEnabled) {
                                content.use = isEnabled;
                                content.show = isEnabled;
                                isModified = true;
                            }
                        }
                        // FPC 补强层：含补强数据时强制启用（模板里默认是禁用的）
                        if (needStiffener && (content.layerId === 58 || content.layerId === 59)) {
                            if (content.use !== true || content.show !== true) {
                                content.use = true;
                                content.show = true;
                                isModified = true;
                            }
                        }
                    }

                    // B. 修改埋盲孔规则
                    if (meta.type === "RULE") {
                        const idStr = JSON.stringify(meta.id || "");
                        
                        // [调试] 打印遇到的每一个规则 ID，确认是否扫描到了 blindVia
                        // console.log(`[V3 Config] 扫描规则: ${idStr}`);

                        // 宽松匹配：ID包含 blind，或者内容里有 blinds 字段
                        const isBlindRule = idStr.toLowerCase().includes("blind") || (content.ruleContext && content.ruleContext.blinds);

                        if (isBlindRule) {
                            console.log(`[V3 Config] 2. 命中盲埋孔规则行! ID: ${idStr}`);
                            
                            const v3BlindContent = blindRules.map(r => ({
                                "name": r.name,
                                "staLayerId": r.start,
                                "endLayerId": r.end,
                                "viaSizeRule": ""
                            }));
                            
                            // 确保结构路径存在 (防御性编程)
                            if (!content.ruleContext) content.ruleContext = {};
                            if (!content.ruleContext.blinds) content.ruleContext.blinds = {};
                            
                            console.log(`[V3 Config] 3. 注入数据:`, JSON.stringify(v3BlindContent));
                            
                            content.ruleContext.blinds.content = v3BlindContent;
                            isModified = true;
                        }
                    }

                } catch (err) {
                    console.error(`[V3 Config] 逻辑处理异常 (行 ${lineIdx}):`, err);
                    return line; // 发生逻辑错误返回原行
                }

                if (isModified) {
                    // [调试] 确认修改
                    if (meta.type === "RULE") {
                        console.log(`[V3 Config] 4. 规则行修改成功，重新打包`);
                    }
                    return JSON.stringify(meta) + "||" + JSON.stringify(content) + "|";
                } else {
                    return line;
                }

            } else {
                // === V2 处理逻辑 (保持不变) ===
                let arr;
                try { arr = JSON.parse(line); } catch (e) { return line; }

                if (arr[0] === "LAYER" && typeof arr[1] === 'number') {
                    const id = arr[1];
                    if (id >= 15 && id <= 46) {
                        const innerIndex = id - 14;
                        const isEnabled = innerIndex <= neededInner;
                        arr[4] = isEnabled ? 3 : 0; 
                        return JSON.stringify(arr);
                    }
                    // FPC 补强层（58/59）：V2 的 LAYER[4] 是启用标记，0=禁用 / 3=启用
                    if (needStiffener && (id === 58 || id === 59)) {
                        if (arr[4] !== 3) { arr[4] = 3; return JSON.stringify(arr); }
                    }
                }

                if (arr[0] === "RULE" && arr[2] === "blindVia") {
                    const v2BlindContent = blindRules.map(r => [r.name, r.start, r.end]);
                    arr[4] = v2BlindContent;
                    return JSON.stringify(arr);
                }
                return line;
            }
        });

        return newLines.join('\n');
    }

    // --- [新增] 通过 API 配置盲埋孔规则 ---
    async function configureBlindViasAPI() {
        // 1. 检查是否有需要配置的盲埋孔文件
        const blindFiles = loadedFiles.filter(f => f.layerId === 502 && f.pairStart && f.pairEnd);
        if (blindFiles.length === 0) return;

        appLog("正在检测设计规则配置...");

        try {
            // 2. 获取当前设计规则
            const currentConfigObj = await eda.pcb_Drc.getCurrentRuleConfiguration();
            
            if (!currentConfigObj || !currentConfigObj.config) {
                console.warn("无法获取设计规则配置");
                return;
            }

            // 定位到 Blind/Buried Via 节点
            // 路径: config -> Physics -> "Blind/Buried Via" -> blindVia -> table
            const physics = currentConfigObj.config.Physics;
            if (!physics || !physics["Blind/Buried Via"] || !physics["Blind/Buried Via"].blindVia) {
                console.warn("设计规则中未找到盲埋孔配置节点");
                return;
            }

            const targetNode = physics["Blind/Buried Via"].blindVia;
            
            // 3. 构建新的规则表
            // 获取总层数用于计算物理层名称 (如 "1-2")
            const copperCountEl = document.getElementById('cfg-copper-layers');
            const totalLayers = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;

            const getPhysIdx = (id) => {
                if (id === 1) return 1;
                if (id === 2) return totalLayers;
                if (id >= 15 && id <= 46) return (id - 15) + 2;
                return 0;
            };

            const newTable = [];
            const seenKeys = new Set();

            blindFiles.forEach((f, idx) => {
                const sId = f.pairStart;
                const eId = f.pairEnd;
                
                // 确保层 ID 有效
                if (!sId || !eId) return;

                // 简单的去重键
                const uniqueId = `${Math.min(sId, eId)}-${Math.max(sId, eId)}`;
                
                if (!seenKeys.has(uniqueId)) {
                    seenKeys.add(uniqueId);

                    // 计算物理层名称 (例如 "1-2")
                    const sPhys = getPhysIdx(sId);
                    const ePhys = getPhysIdx(eId);
                    const name = `${Math.min(sPhys, ePhys)}-${Math.max(sPhys, ePhys)}`;

                    // 构造符合 API 定义的对象
                    newTable.push({
                        "name": name,
                        "startLayer": sId, // API 需要 layerId
                        "endLayer": eId,   // API 需要 layerId
                        "used": true,      // 标记为使用
                        "key": `generated_blind_${Date.now()}_${idx}`, // 生成唯一 Key 防止冲突
                        "viaSizeRule": ""  // 默认无特定尺寸规则
                    });
                }
            });

            // 4. 应用修改
            // 策略：保留原有的规则？还是覆盖？
            // 考虑到这是导入操作，建议将新规则追加到现有规则中，或者如果完全确信是新板子则覆盖。
            // 这里采用：追加并去重（根据 name）
            
            const existingTable = targetNode.table || [];
            // 过滤掉名字冲突的旧规则，保留我们的新规则
            const mergedTable = [
                ...existingTable.filter(old => !newTable.some(nw => nw.name === old.name)),
                ...newTable
            ];

            targetNode.table = mergedTable;

            // 5. 保存配置
            const configName = currentConfigObj.name || "自定义配置";
            appLog(`正在更新盲埋孔规则 (${newTable.length} 组新增)...`);
            
            // 调用 saveRuleConfiguration
            // 参数3 allowOverwrite = true
            const success = await eda.pcb_Drc.saveRuleConfiguration(currentConfigObj, configName, true);
            
            if (success) {
                appLog("设计规则更新成功");
            } else {
                appLog("设计规则更新被拒绝");
            }

        } catch (e) {
            console.error("配置盲埋孔规则异常:", e);
            appLog(`配置规则失败: ${e.message}`);
        }
    }


    // 来源：嘉立创EDA -> 目标：专业版 (支持 V2 和 V3)
    async function exportForEasyEDA_Pro(config) {
        console.log("开始导出处理...", config);
        const startTime = performance.now(); // 开始计时
        
        const isV4 = config.targetVer === 'pro_v4';
        const isV3 = config.targetVer === 'pro_v3';
        // V3 与 V4 的**图元行格式完全相同**（{"type":...}||{...}|），只有文档头不同
        // （V4 多 LAYER_PHYS / D3_ATTRIBUTE / 一批显示配置 PRIMITIVE）。
        // 因此除"选哪份模板"以外，分隔符、configureHeader、图元生成、拼接全部共用。
        const isLineFormat = isV3 || isV4;
        const separator = isLineFormat ? "|\n" : "\n"; // 提前定义分隔符
        
        stepBegin('准备源码头');
        // 1. 准备源码头 (移除 !DEBUG 判断，始终生成头文件)
        let rawTemplate = isV4 ? LCEDA_V4_Head_Source
            : (isV3 ? LCEDA_V3_Head_Source : LCEDA_V2_Head_Source);
        // 调用配置函数，动态修改图层和规则
        let finalSource = configureHeader(rawTemplate, isLineFormat);
        
        // 仅在非Debug或Debug但未显示日志时记录，避免刷屏，但此处为了逻辑简单保留
        // appLog(`已根据设置动态更新文件头配置`);

        stepEnd('准备源码头');

        // 2. 提取数据（仅导出勾选的图层）
        stepBegin('提取图层数据');
        const rawData = PadTool.extractRawData(loadedFiles.filter(f => f.visible));
        stepEnd('提取图层数据');
        
        // 3. 聚合数据
        stepBegin('聚合焊盘 / 导线');
        const unifiedData = PadTool.consolidate(
            rawData.rawPads || [], 
            rawData.rawVias || [], 
            rawData.rawTracks || [], 
            rawData.rawPolys || [], 
            rawData.rawFills || [], 
            rawData.drills || [],
            rawData.rawImages || [],
            rawData.rawTextLines || [],
            rawData.rawCoppers || []
        );
        
        // 4. 获取 ID 起始值
        const startIds = (typeof DEBUG !== 'undefined' && DEBUG) 
            ? { ticket: 200, id: 200 } 
            : calculateMaxId(finalSource, config.targetVer);

        stepEnd('聚合焊盘 / 导线');

        // 5. 生成图元字符串 (这一步才真正决定了最终有多少个图元)
        //    这一步最慢（含物理网络生成），耗时大约随数据量线性增长：
        //    实测 1.6MB / 3.6k 焊盘 / 6.8k 导线 ≈ 8s。先按体量给出预计值，
        //    让用户在「界面无响应」之前就知道要等多久。
        const _estMs = estimateExportMs();
        stepBegin(`生成图元（含网络，预计约 ${Math.max(1, Math.round(_estMs / 1000))}s）`);
        const primitives = PadTool.generatePrimitives(unifiedData, {
            isV3: isLineFormat,
            ticket: startIds.ticket || 10000,
            id: startIds.id || 10000
        }, config); 

        // --- 统计生成的图元数量 ---
        let stat_pads = 0;
        let stat_vias = 0;
        let stat_tracks = 0;
        let stat_polys = 0;
        let stat_fills = 0; 
        let stat_holes = 0;
        let stat_texts = 0;

        primitives.forEach(str => {
            if (isLineFormat) {
                try {
                    const parts = str.split("||");
                    if(parts.length > 1) {
                        const meta = JSON.parse(parts[0]);
                        const content = JSON.parse(parts[1]);
                        const type = meta.type;
                        if (type === 'PAD') stat_pads++;
                        else if (type === 'VIA') stat_vias++;
                        else if (type === 'TRACK' || type === 'ARC' || type === 'LINE') stat_tracks++;
                        else if (type === 'STRING' || type === 'TEXT') stat_texts++;
                        else if (type === 'HOLE') stat_holes++;
                        else if (type === 'REGION' || type === 'FILL') {
                            if (content.fill || type === 'FILL') stat_fills++;
                            else stat_polys++;
                        } else if (type === 'POLY') stat_polys++;
                        else if (type === 'IMAGE') stat_fills++;
                    }
                } catch(e) {}
            } else {
                try {
                    const match = str.match(/^\["([A-Z_]+)"/);
                    if (match) {
                        const type = match[1];
                        if (type === 'PAD') stat_pads++;
                        else if (type === 'VIA') stat_vias++;
                        else if (type === 'LINE' || type === 'ARC') stat_tracks++;
                        else if (type === 'POLY') stat_polys++;
                        else if (type === 'FILL' || type === 'POURED' || type === 'IMAGE') stat_fills++;
                        else if (type === 'STRING') stat_texts++;
                        else if (type === 'HOLE') stat_holes++;
                    }
                } catch(e) {}
            }
        });

        // 输出日志（只列数量，不加装饰线）
        appLog(`生成焊盘 ${stat_pads} 个`);
        appLog(`生成过孔 ${stat_vias} 个`);
        appLog(`生成导线 ${stat_tracks} 条`);
        appLog(`生成折线 ${stat_polys} 条`);
        appLog(`生成填充 ${stat_fills} 个`);
        appLog(`生成文本 ${stat_texts} 个`);

        stepEnd('生成图元');

        // 6. 处理 DEBUG 输出 (修改点：拼接完整源码)
        if (typeof DEBUG !== 'undefined' && DEBUG) {
            if (config.mode === 'debug') {
                 const textArea = document.getElementById('debug-source-area');
                 if(textArea) {
                     // 拼接：头文件 + 分隔符 + 图元
                     let debugFullSource = finalSource;
                     if (primitives.length > 0) {
                         debugFullSource += separator + primitives.join(separator);
                     }
                     textArea.value = debugFullSource;
                 }
                 // Debug 模式下生成完源码直接返回，不进行后续的文件下载或API写入
                 // （DEBUG 预览不计入导入/导出操作次数）
                 return false;
            }
        }

        // 7. 正式输出拼接 (非 Debug 模式，或者 Debug 模式下的文件导出)
        stepBegin('拼装源码');
        if (primitives.length > 0) {
            // 注意：V3 格式如果直接拼接在头文件后，需要补一个分隔符
            if (isLineFormat) finalSource += separator + primitives.join(separator);
            else finalSource += "\n" + primitives.join("\n");
        }

        stepEnd('拼装源码');

        const endTime = performance.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        appLog(`数据生成完毕，耗时${duration}秒`);

        // --- 文件导出逻辑：打包 ZIP ---
        if (config.mode === 'file') {
            const zip = new JSZip();
            const timestamp = new Date().getTime();
            const baseName = currentZipName || `${timestamp}`;
            const outputName = `Gerber_To_PCB_${baseName}`;

            if (isV3) {
                const projectConfig = {
                    "title": outputName,
                    "cbb_project": false,
                    "editorVersion": "",
                    "introduction": "",
                    "description": "",
                    "tags": "[]"
                };
                zip.file(`${outputName}.epru`, finalSource);
                zip.file("project2.json", JSON.stringify(projectConfig, null, 2));
                appLog("正在打包 V3 工程文件...");
                const content = await zip.generateAsync({type:"blob"});
                downloadBlobAsFile(content, `${outputName}.epro2`);
            } else {
                const uuid = generateUUID();
                const projectConfig = {
                    "schematics": {},
                    "pcbs": {}, 
                    "panels": {},
                    "symbols": {},
                    "footprints": {},
                    "devices": {},
                    "boards": {},
                    "config": {
                        "title": "PCB1",
                        "cbbProject": false,
                        "defaultSheet": "",
                        "editorVersion": "2.2.45.5"
                    }
                };
                projectConfig.pcbs[uuid] = "PCB1";
                zip.file("project.json", JSON.stringify(projectConfig, null, 2));
                const pcbFolder = zip.folder("PCB");
                pcbFolder.file(`${uuid}.epcb`, finalSource);
                appLog("正在打包 V2 工程文件...");
                const content = await zip.generateAsync({type:"blob"});
                downloadBlobAsFile(content, `${outputName}.epro`);
            }
            return true; // 文件已下载，计一次成功导出

        } else if (config.mode === 'canvas') {
            
            const writeStartTime = performance.now();
            try {
                // 1. 获取 UI 上设定的层数 (例如 2, 4, 6...)
                const copperCountEl = document.getElementById('cfg-copper-layers');
                const targetLayerCount = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;

                // 2. 调用 API 设置层数
                const setLayerResult = await eda.pcb_Layer.setTheNumberOfCopperLayers(targetLayerCount);

                // 注意：这里**不再** setPcbType(FPC)。实测（真实客户端）图元 API 无法把填充
                // 写到补强层 58/59 —— 即使先切 FPC 让补强层存在，create 仍返回空或落到默认层。
                // 切了板材只会得到「文档是 FPC、但没有补强」的半成品，更容易误导。
                // 补强统一交给「通过源码导入」：源码里的 LAYER 58/59 + FPC_FILL 由 EDA 自己建层解析。
                // console.log("层数设置结果:", setLayerResult);
                
                // 稍微等待一下，确保状态更新
                // await new Promise(r => setTimeout(r, 50));

                appLog(`正在将板子设为${targetLayerCount}层板`);
                
                if (typeof eda !== 'undefined') {
                    if (config.importMethod === 'api') {
                        appLog(`写入画布中 (图元模式)...`);
                        // 补强在图元模式下创建不出来（API 限制，实测），提前说明，
                        // 让用户有机会改用「通过源码导入」，而不是导完才发现补强缺失。
                        const stiffCount = (unifiedData.fills || []).filter(f => f.layerId === 58 || f.layerId === 59).length
                            + (unifiedData.polys || []).filter(p => p.layerId === 58 || p.layerId === 59).length;
                        if (stiffCount > 0) {
                            appLog(`本次含 ${stiffCount} 块 FPC 补强，图元导入会跳过；需要补强请改用「通过源码导入」`);
                        }
                        // 在导入图元之前，先配置设计规则
                        // await configureBlindViasAPI(); // 当前保存设计规划失败，未知原因
                        // V3 / V4 的图元串是同一种行格式，解析器共用；只有 V2 走数组分支
                        await importPrimitivesAPI(primitives, isLineFormat);                        
                        const writeEndTime = performance.now();
                        const writeDuration = ((writeEndTime - writeStartTime) / 1000).toFixed(2);
                        appLog(`参数传递完成，耗时${writeDuration}秒`);
                        appLog(`全部参数已传递至EDA，待EDA绘制完成`);
                        return true; // 图元 API 全部调用完毕（个别图元失败已在日志单独统计）
                    } else {
                        appLog(`正在写入全量数据...`);
                        // 编辑器解析整份源码是同步的，期间界面无响应 —— 先把状态写出来
                        setStepStatus(`写入画布（${(finalSource.length / 1024 / 1024).toFixed(1)}MB，编辑器可能无响应）`, 0, null);
                        const result = await eda.sys_FileManager.setDocumentSource(finalSource);
                        const writeEndTime = performance.now();
                        const writeDuration = ((writeEndTime - writeStartTime) / 1000).toFixed(2);
                        if (result) appLog(`写入完成，耗时${writeDuration}秒`);
                        else appLog(`写入失败 (API返回false)`);
                        return !!result;
                    }
                }
                return false; // 非 EDA 环境，未真正写入画布
            } catch (e) {
                console.error(e);
                appLog(`写入过程出错: ${e.message}`);
                return false;
            }
        }
        return false;
    }

    // 来源：其他 -> 目标：专业版 (支持 V2 和 V3) (保留入口)
    async function exportForOther_Pro(config) {
        // 待完善
        return false;
    }

    // importPrimitivesAPI (API 写入)。
    async function importPrimitivesAPI(primitivesArr, isV3) {
        // console.log("准备通过 API 导入图元...", primitivesArr.length);
        const separator = "\n"; // 提前定义分隔符
        const textArea = document.getElementById('debug-source-area');
        let FullSource = '';
        if (primitivesArr.length > 0) {
            FullSource += separator + primitivesArr.join(separator);
        }

        // 逐行处理：单行 JSON 解析失败不能中断整批导入（否则一个坏图元就全批失败）
        const rawLines = FullSource.trim().split('\n').filter(line => line.trim());
        const lines = [];
        let skippedLines = 0;
        for (const raw of rawLines) {
            try { lines.push(JSON.parse(raw)); } catch (e) { skippedLines++; }
        }
        if (skippedLines > 0) appLog(`图元模式：${skippedLines} 行无法解析，已跳过`);

        // 图元创建失败统计：各 create() 返回 Promise 且本函数不 await（避免导入被拖慢），
        // 失败会变成看不见的 unhandled rejection —— 用户只看到"图元没出来"，无从排查。
        // 这里跟踪每个 Promise 的结果，最后把失败数写进运行日志。
        const failStat = {};
        let firstFailMsg = '';
        let stiffSkipped = 0;       // 被跳过的补强图元数（图元 API 不支持补强层）
        const trackFail = (kind, arg) => {
            const record = (msg) => {
                failStat[kind] = (failStat[kind] || 0) + 1;
                if (!firstFailMsg) firstFailMsg = kind + ': ' + msg;
            };
            if (arg instanceof Error || typeof arg === 'string') { record(String(arg && arg.message || arg)); return null; }
            if (arg && typeof arg.then === 'function') {
                arg.then(r => { if (r === undefined || r === null) record('API 返回空（数据被判定为不合法）'); })
                    .catch(e => record(String(e && e.message ? e.message : e)));
            }
            return arg;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const command = Array.isArray(line) ? line[0] : (line && line.type);
            switch (command) {
                case 'PAD': // 焊盘
                    try {
                        let holeDef = line[9];
                        // 官方孔类型只有 ROUND(长圆形) / RECT；历史数据里的 "SLOT" 一并归一到 ROUND，
                        // 并统一按 (短边, 长边) 排序，避免长短边颠倒。
                        if (Array.isArray(holeDef) && holeDef.length >= 3 && (holeDef[0] === "SLOT" || holeDef[0] === "ROUND")) {
                            const hw = holeDef[1];
                            const hh = holeDef[2];
                            holeDef = ["ROUND", Math.min(hw, hh), Math.max(hw, hh)];
                        }
                        eda.pcb_PrimitivePad.create(
                            line[4],                          // layer: 层编号
                            line[5]?.toString() || "",        // padNumber: 焊盘编号，转为字符串
                            line[6],                          // x: X坐标
                            line[7],                          // y: Y坐标
                            line[8] || 0,                     // rotation: 旋转角度
                            line[10] || null,                 // pad: 默认焊盘形状
                            line[3] || "",                    // net: 网络名称
                            holeDef || null,                  // [修改] 使用处理过的 holeDef
                            line[12] || 0,                    // holeOffsetX: 孔偏移X
                            line[13] || 0,                    // holeOffsetY: 孔偏移Y
                            line[14] || 0,                    // holeRotation: 孔旋转角度
                            !!line[15],                       // metallization: 是否金属化
                            line[16] || 0,                    // padType: 焊盘类型
                            line[11] || [],                   // specialPad: 特殊焊盘
                            // 阻焊和助焊扩展
                            (line[17] !== null || line[18] !== null || line[19] !== null || line[20] !== null) ? {
                                "topSolderMask": line[17],
                                "bottomSolderMask": line[18],
                                "topPasteMask": line[19],
                                "bottomPasteMask": line[20]
                            } : null,
                            // 热焊设置
                            (line[21] !== null || line[22] !== null || line[23] !== null || line[24] !== null) ? {
                                "connectionType": line[21],
                                "divergenceSpacing": line[22],
                                "divergenceLineWidth": line[23],
                                "divergenceAngle": line[24]
                            } : null,
                            !!line[25]                        // primitiveLock: 是否锁定
                        );
                    } catch (error) {
                        console.error('创建PAD失败:', error);
                    }
                    break;
                case 'VIA': // 过孔
                    try {
                        eda.pcb_PrimitiveVia.create(
                            line[3],               // NET名称
                            line[5],               // X坐标
                            line[6],               // Y坐标
                            line[7],               // 孔直径
                            line[8],               // 焊盘直径
                            line[9] || 0,          // 过孔类型，默认普通过孔
                            line[4] || null,       // 设计规则名称（盲埋孔类型）
                            line[10] === null && line[11] === null ? null : { // 阻焊扩展
                                "topSolderMask": line[10],
                                "bottomSolderMask": line[11]
                            },
                            !!line[12]             // 是否锁定
                        );
                    } catch (error) {
                        console.error('创建VIA失败:', error);
                    }
                    break;
                case 'LINE': // 直线
                    try {
                        eda.pcb_PrimitiveLine.create(
                            line[3] || "",    // 网络名称
                            line[4],          // 层编号
                            line[5],          // 开始X坐标
                            line[6],          // 开始Y坐标
                            line[7],          // 结束X坐标
                            line[8],          // 结束Y坐标
                            line[9],          // 线宽
                            !!line[10]        // 是否锁定
                        );
                    } catch (error) {
                        console.error('创建LINE失败:', error);
                    }
                    break;
                case 'ARC': // 弧线
                    try {
                        eda.pcb_PrimitiveArc.create(
                            line[3] || "",    // 网络名称
                            line[4],          // 层编号
                            line[5],          // 起始X坐标
                            line[6],          // 起始Y坐标
                            line[7],          // 结束X坐标
                            line[8],          // 结束Y坐标
                            line[9],          // 圆弧角度
                            line[10],         // 线宽，默认0.5
                            "1",              // 交互模式，固定为"1"（两点圆弧）
                            !!line[11]        // 是否锁定
                        );
                    } catch (error) {
                        console.error('创建ARC失败:', error);
                    }
                    break;
                    
                case 'POLY': // 折线
                    try {
                        // 创建多边形对象，第6项是多边形数据
                        // 同上：兼容平铺 / 嵌套两种源数组
                        const polySrc = line[6];
                        const polygon = (Array.isArray(polySrc) && Array.isArray(polySrc[0]))
                            ? eda.pcb_MathPolygon.createComplexPolygon(polySrc)
                            : eda.pcb_MathPolygon.createPolygon(polySrc);
                        if (!polygon) throw new Error('折线多边形数据不合法');
                        
                        // 调用折线API创建折线图元
                        eda.pcb_PrimitivePolyline.create(
                            line[3] || "",                    // net: 网络名称
                            line[4] || 1,                     // layer: 层编号
                            polygon,                          // polygon: 多边形对象
                            line[5] || 0.5,                   // lineWidth: 线宽
                            !!line[7]                         // primitiveLock: 是否锁定
                        );
                    } catch (error) {
                        console.error('创建POLY失败:', error);
                    }
                    break;
                case 'FPC_FILL': // FPC 补强（V2: ["FPC_FILL", id, group, layer, material, thickness, path, 0]）
                    // ⚠️ 实测结论（真实客户端）：**图元 API 创建不出补强**。
                    //    即便先 setPcbType(FPC) 让补强层（58 / 59）出现在文档里，
                    //    pcb_PrimitiveFill.create() 仍返回空或把图元落到默认层 ——
                    //    补强只能通过「通过源码导入」写入（源码里的 FPC_FILL 带
                    //    layerId + material + thickness，由 EDA 自己解析建层）。
                    //    这里直接跳过并计数，最后统一提示改用源码导入，
                    //    不再尝试（避免把补强画到顶层误导用户）。
                    stiffSkipped++;
                    break;
                case 'FILL': // 填充
                    // 兜底：万一有历史数据把普通 FILL 写到补强层（58/59），直接跳过 ——
                    // create 到不存在的层会落到默认层，表现就是「补强变成顶层一块填充」。
                    if (line[4] === 58 || line[4] === 59) { stiffSkipped++; break; }
                    try {
                        // 第 7 项是多边形数据。**单环填充必须用「平铺源数组」创建**：
                        //   createComplexPolygon 的入参语义是「一个复杂多边形 = 多块源数组」，
                        //   官方示例里单块用的是平铺写法 createComplexPolygon(['R', ...])；
                        //   而双层嵌套 [[ring]]（长度 1）会被当成平铺数组解析（首元素是数组→不合法）
                        //   → 返回 undefined → 填充**静默消失**。
                        //   实测：负片拆分后每块填充都只有一个环，于是所有填充都创建不出来
                        //   （用户看到的就是"导入后完全没有填充区域"）。
                        // 这里按「平铺优先、多重兜底」尝试，第一个返回对象即用。
                        const fillSrc = line[7];
                        const nested = Array.isArray(fillSrc) && Array.isArray(fillSrc[0]);
                        const flat = nested ? fillSrc[0] : fillSrc;
                        const MP = eda.pcb_MathPolygon;
                        let polygon = null;
                        const attempts = [
                            () => (nested && fillSrc.length > 1 ? MP.createComplexPolygon(fillSrc)
                                : (flat ? MP.createPolygon(flat) : null)),
                            () => (flat ? MP.createComplexPolygon(flat) : null),
                            () => (nested ? MP.createComplexPolygon(fillSrc) : null),
                            () => (flat ? MP.createPolygon(flat) : null)
                        ];
                        for (let k = 0; k < attempts.length && !polygon; k++) {
                            try { polygon = attempts[k](); } catch (e) { /* 继续尝试下一种 */ }
                        }
                        if (!polygon) {
                            trackFail('FILL', '多边形数据不合法 ' + JSON.stringify(fillSrc).slice(0, 200));
                            break;
                        }

                        // 调用填充API创建填充图元（create 是 Promise，失败会变成静默的
                        // unhandled rejection，这里跟踪结果，让失败能在运行日志里看到）
                        trackFail('FILL', eda.pcb_PrimitiveFill.create(
                            line[4],                          // layer: 层编号
                            polygon,                          // complexPolygon: 多边形对象
                            line[3] || "",                    // net: 网络名称
                            line[6] || 0,                     // fillMode: 填充模式
                            line[5] || 0.2,                   // lineWidth: 线宽（网格填充时有效）
                            !!line[8]                         // primitiveLock: 是否锁定
                        ));
                    } catch (error) {
                        trackFail('FILL', error);
                        console.error('创建FILL失败:', error);
                    }
                    break;
                case 'IMAGE': // 图片
                    try {
                        // 创建多边形对象，第10项是多边形数据数组
                        const complexPolygon = eda.pcb_MathPolygon.createPolygon(line[10]);
                        
                        // 调用图片API创建图片图元
                        eda.pcb_PrimitiveImage.create(
                            line[4],                          // x: 左上角X坐标
                            line[5],                          // y: 左上角Y坐标
                            complexPolygon,                   // complexPolygon: 多边形对象
                            line[3] || 1,                     // layer: 层编号
                            line[6],                          // width: 宽度
                            line[7],                          // height: 高度
                            line[8] || 0,                     // rotation: 旋转角度
                            !!line[9],                        // horizonMirror: 是否水平镜像
                            !!line[11]                        // primitiveLock: 是否锁定
                        );
                    } catch (error) {
                        console.error('创建IMAGE失败:', error);
                    }
                    break;
                case 'STRING': // 文字
                    try {             
                        // 调用文字API创建文字图元
                        eda.pcb_PrimitiveString.create(
                            line[3] || 1,                 // layer: 层
                            line[4],                      // x: 位置 X
                            line[5],                      // y: 位置 Y
                            line[6] || "",                // text: 内容
                            line[7] || "default2",        // fontFamily: 字体名称
                            line[8],                      // fontSize: 字号
                            line[9],                      // lineWidth: 粗细
                            line[12] || 1,                // alignMode: 对齐模式 (索引13，跳过加粗/斜体)
                            line[13] || 0,                // rotation: 旋转角度
                            !!line[14],                   // reverse: 是否反相扩展 (转为Boolean)
                            line[15] || 0,                // expansion: 反相扩展尺寸
                            !!line[16],                   // mirror: 是否镜像 (转为Boolean)
                            !!line[17]                    // primitiveLock: 是否锁定 (转为Boolean)
                        );
                    } catch (error) {
                        console.error('创建STRING失败:', error);
                    }
                    break;
                default:
                    console.warn(`未知命令: ${command}，数据:`, line.slice(0, 3).concat('...'));
                    break;
            }
        }

        // 汇总创建失败的图元（Promise 稍后才结算，故延迟输出）
        setTimeout(() => {
            const kinds = Object.keys(failStat);
            if (!kinds.length) return;
            const detail = kinds.map(k => `${k} ${failStat[k]} 个`).join('，');
            appLog(`图元创建失败：${detail}` + (firstFailMsg ? `；首个错误：${firstFailMsg}` : ''));
        }, 1500);

        // 补强必须走源码导入：图元 API 无法把填充写到补强层（实测）。
        if (stiffSkipped > 0) {
            const msg = `本次有 ${stiffSkipped} 块 FPC 补强未写入：补强只能通过「通过源码导入」创建，`
                + `图元导入模式会跳过。请改用「通过源码导入」重新导入。`;
            appLog(msg);
            if (typeof showToast === 'function') showToast('补强需用「通过源码导入」', 'warn');
        }
    }

    // ==================================================================================
    // 目标：嘉立创EDA 标准版 —— 导出 PCB 源码（.json）
    // ----------------------------------------------------------------------------------
    // 格式规范取自 Temp/标准版格式参考/标准版PCB源码.json（嘉立创EDA标准版 v6.5.51 导出）。
    // 三条硬约束（错一条标准版就打不开/解析错位）：
    //   1. 全部坐标、长度以「1 单位 = 10 mil = 0.254 mm」存储；
    //   2. 世界坐标 → 画布坐标： X = ORIGIN_X + mmX / 0.254 ， Y = ORIGIN_Y - mmY / 0.254
    //      （X 向右为正，Y 向上为正，与参考文件的正负号一致）；
    //   3. shape 是字符串数组，首字段是图元标识符，字段顺序必须与官方文档一致。
    // 各图元字段顺序（0 基）：
    //   PAD        shape,x,y,w,h,layer,net,num,holeR,points,rot,gId,holeLength,slotPts,
    //              plated,locked,pasteExp,solderExp,holeCenter
    //   VIA        x,y,diameter,net,holeR,gId,locked
    //   HOLE       x,y,holeR,gId,locked
    //   TRACK      strokeWidth,layer,net,points,gId,locked
    //   ARC        strokeWidth,layer,net,d,helperDots,gId,locked
    //   CIRCLE     cx,cy,r,strokeWidth,layer,gId,locked,net,transformArc
    //   SOLIDREGION layer,'',pathStr,fillStyle,gId,'','','',locked
    // 注：所有区域类图元（含覆铜）统一用 SOLIDREGION 承载，不再输出 COPPERAREA
    //     —— 后者需要「铺铜压缩数据 + 网络」附属信息，SOLIDREGION 才是纯几何、
    //     打开即见实心铜，也避免标准版自己去重建铺铜时的各种边界问题。
    // ==================================================================================

    const STD_UNIT = 0.254;          // 1 标准版单位 = 10 mil
    const STD_ORIGIN_X = 4020;       // 画布原点（与官方模板一致）
    const STD_ORIGIN_Y = 3560.5;
    const STD_EDITOR_VER = '6.5.51';

    // 内部图层 ID → 标准版图层 ID（顺序不同！阻焊/锡膏、组装/文档都要换位）
    const STD_LAYER_MAP = {
        1: 1,    // 顶层铜   → TopLayer
        2: 2,    // 底层铜   → BottomLayer
        3: 3,    // 顶层丝印 → TopSilkLayer
        4: 4,    // 底层丝印 → BottomSilkLayer
        5: 7,    // 顶层阻焊 → TopSolderMaskLayer
        6: 8,    // 底层阻焊 → BottomSolderMaskLayer
        7: 5,    // 顶层锡膏 → TopPasteMaskLayer
        8: 6,    // 底层锡膏 → BottomPasteMaskLayer
        9: 13,   // 顶层装配 → TopAssembly
        10: 14,  // 底层装配 → BottomAssembly
        11: 10,  // 板框     → BoardOutLine
        12: 11,  // 多层     → Multi-Layer
        13: 12,  // 文档     → Document
        14: 15,  // 机械     → Mechanical
        47: 11,  // 钻孔     → Multi-Layer
        56: 12,  // 钻孔图   → Document
        57: 12   // 其它     → Document
    };
    const STD_LAYER = (internalId) => {
        if (STD_LAYER_MAP[internalId] !== undefined) return STD_LAYER_MAP[internalId];
        if (internalId >= 15 && internalId <= 46) return internalId + 6;  // Inner1(15) → 21
        return 12;
    };
    const STD_IS_COPPER = (internalId) => internalId === 1 || internalId === 2 || (internalId >= 15 && internalId <= 46);

    // 标准版图层表 / 对象表 / 设计规则（照抄参考文件，保证与官方模板一致）
    //
    // ⚠️「标准版的板子是几层」**完全由这张 layers 表决定**：内层行（21…52）的
    //    visible / config 只要是 false，即使 shape 里写了 21/22 的图元，EDA 打开时
    //    也只当 2 层板 —— 内层铜整片看不见（四层板导出后内层是空的）。
    //    所以内层行不能写死，必须按板子的实际层数动态启用（buildStdLayers）。
    const STD_LAYER_HEAD = [
        '1~TopLayer~#cc6633~true~false~true~',
        '2~BottomLayer~#6699ff~true~false~true~',
        '3~TopSilkLayer~#FFCC00~true~false~true~',
        '4~BottomSilkLayer~#66CC33~true~false~true~',
        '5~TopPasteMaskLayer~#808080~true~false~true~',
        '6~BottomPasteMaskLayer~#800000~true~false~true~',
        '7~TopSolderMaskLayer~#800080~true~false~true~0.3',
        '8~BottomSolderMaskLayer~#AA00FF~true~false~true~0.3',
        '9~Ratlines~#6464FF~true~true~true~',
        '10~BoardOutLine~#FF00FF~true~false~true~',
        '11~Multi-Layer~#C0C0C0~true~false~true~',
        '12~Document~#FFFFFF~true~false~true~',
        '13~TopAssembly~#33CC99~false~false~false~',
        '14~BottomAssembly~#5555FF~false~false~false~',
        '15~Mechanical~#F022F0~false~false~false~',
        '19~3DModel~#ffffff~false~false~false~'
    ];
    // 内层颜色沿用官方模板（21…52 共 32 层）
    const STD_INNER_COLORS = [
        '#999966', '#0099cc', '#339999', '#BC8E00', '#70DBFA', '#00CC66', '#9966FF', '#800080',
        '#008080', '#15935F', '#000080', '#00B400', '#2E4756', '#99842F', '#FFFFAA', '#99842F',
        '#2E4756', '#3535FF', '#8000BC', '#43AE5F', '#C3ECCE', '#728978', '#39503F', '#0C715D',
        '#5A8A80', '#2B937E', '#23999D', '#45B4E3', '#215DA1', '#4564D7', '#6969E9', '#9069E9'
    ];
    const STD_LAYER_TAIL = [
        '99~ComponentShapeLayer~#00CCCC~false~false~false~0.4',
        '100~LeadShapeLayer~#CC9999~false~false~false~',
        '101~ComponentMarkingLayer~#66FFCC~false~false~false~',
        'Hole~Hole~#222222~~false~true~',
        'DRCError~DRCError~#FAD609~~false~true~'
    ];
    /**
     * 生成标准版 layers 表：内层按板子层数启用。
     * 字段：id~名称~颜色~visible~active~config~transparency~type
     * 启用的内层一律写 `type=Signal`（信号层，正片）：导入的 Gerber 内层就是普通铜箔，
     * 用 TRACK / SOLIDREGION 表达；若留空被当成内电层（负片），这些铜反而会变成"挖空"。
     * 未启用的内层保持官方模板原样（`~~`，类型留空）。
     * @param {number} innerCount 内层层数（总铜层数 − 2）
     */
    function buildStdLayers(innerCount) {
        const n = Math.max(0, Math.min(STD_INNER_COLORS.length, innerCount | 0));
        const out = STD_LAYER_HEAD.slice();
        for (let i = 0; i < STD_INNER_COLORS.length; i++) {
            const on = (i < n);
            out.push((21 + i) + '~Inner' + (i + 1) + '~' + STD_INNER_COLORS[i]
                + '~' + (on ? 'true' : 'false') + '~false~' + (on ? 'true' : 'false')
                + (on ? '~0~Signal' : '~~'));
        }
        return out.concat(STD_LAYER_TAIL);
    }
    /**
     * 本次导出要启用几层内层：① UI 的「板层数」（#cfg-copper-layers，与专业版通道同源）；
     * ② Gerber 里真实存在的内层文件（15…46）—— 数据比设置更权威，取大值。
     */
    function stdInnerLayerCount(config) {
        let n = 0;
        if (config && typeof config.copperLayers === 'number' && isFinite(config.copperLayers)) {
            n = config.copperLayers - 2;
        } else if (typeof document !== 'undefined' && document.getElementById('cfg-copper-layers')) {
            n = (parseInt(document.getElementById('cfg-copper-layers').value, 10) || 2) - 2;
        }
        if (typeof loadedFiles !== 'undefined' && loadedFiles) {
            loadedFiles.forEach(f => {
                const id = f && f.layerId;
                if (id >= 15 && id <= 46) n = Math.max(n, id - 14);
            });
        }
        return Math.max(0, Math.min(STD_INNER_COLORS.length, n));
    }

    const STD_OBJECTS = [
        'All~true~false', 'Component~true~true', 'Prefix~true~true', 'Name~true~false',
        'Track~true~true', 'Pad~true~true', 'Via~true~true', 'Hole~true~true',
        'Copper_Area~true~true', 'Circle~true~true', 'Arc~true~true',
        'Solid_Region~true~true', 'Text~true~true', 'Image~true~true', 'Rect~true~true',
        'Dimension~true~true', 'Protractor~true~true'
    ];
    const STD_DRCRULE = {
        "Default": { "trackWidth": 1, "clearance": 0.6, "viaHoleDiameter": 2.4, "viaHoleD": 1.2 },
        "isRealtime": false,
        "isDrcOnRoutingOrPlaceVia": false,
        "checkObjectToCopperarea": true,
        "showDRCRangeLine": true
    };
    const STD_CANVAS = 'CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.5~mm~1~45ARC~~0.5~4020~3560.5~0~yes';

    // 数字格式化：最多 4 位小数，去掉无意义的尾随 0（标准版源码里 1.5000 写作 1.5）
    function stdNum(v) {
        if (typeof v !== 'number' || !isFinite(v)) return '0';
        let s = (Math.round(v * 1e4) / 1e4).toFixed(4);
        if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
        if (s === '' || s === '-0') return '0';
        return s;
    }
    const stdX = (mm) => stdNum(STD_ORIGIN_X + mm / STD_UNIT);
    const stdY = (mm) => stdNum(STD_ORIGIN_Y - mm / STD_UNIT);
    const stdU = (mm) => stdNum(mm / STD_UNIT);

    /**
     * 把内部路径数组（M/L/A/ARC + i,j/sweep/cx,cy 三种弧表示）统一转成折线点列（mm）。
     * 标准版的 TRACK / SOLIDREGION 都只吃点列，圆弧一律采样成短直线。
     */
    function stdFlattenPath(path, stepDeg) {
        const pts = [];
        if (!Array.isArray(path) || path.length === 0) return pts;
        let cur = null;
        const push = (x, y) => { if (typeof x === 'number' && isFinite(x) && typeof y === 'number' && isFinite(y)) { pts.push({ x, y }); cur = { x, y }; } };
        for (let i = 0; i < path.length; i++) {
            const op = path[i];
            if (!op) continue;
            if (op.cmd === 'M' || op.cmd === 'L') { push(op.x, op.y); continue; }
            if (op.cmd !== 'A' && op.cmd !== 'ARC') { continue; }
            if (!cur) continue;
            const ex = op.x, ey = op.y;
            // 1) 直接给了圆心
            let cx = op.cx, cy = op.cy;
            // 2) 给了相对圆心的 i/j
            if (cx === undefined && op.i !== undefined) { cx = cur.x + op.i; cy = cur.y + op.j; }
            // 3) 只给了扫掠角：由弦长 + 扫掠角反算圆心
            let sweepRad = null;
            if (op.sweep !== undefined) sweepRad = op.sweep * Math.PI / 180;
            if (cx === undefined && sweepRad !== null && Math.abs(sweepRad) > 1e-9) {
                const chord = Math.hypot(ex - cur.x, ey - cur.y);
                const r = Math.abs(chord / (2 * Math.sin(sweepRad / 2)));
                const mx = (cur.x + ex) / 2, my = (cur.y + ey) / 2;
                const h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
                const ux = (ex - cur.x) / (chord || 1), uy = (ey - cur.y) / (chord || 1);
                const sgn = sweepRad > 0 ? 1 : -1;
                cx = mx + sgn * h * (-uy); cy = my + sgn * h * ux;
            }
            if (cx === undefined || !isFinite(cx) || !isFinite(cy)) {
                // 圆心未知（含 360° 整圆）：退化为两点直线，至少不丢这一段
                if (Math.abs(ex - cur.x) > 1e-9 || Math.abs(ey - cur.y) > 1e-9) push(ex, ey);
                continue;
            }
            const r = Math.hypot(cur.x - cx, cur.y - cy);
            if (!(r > 1e-9)) { push(ex, ey); continue; }
            let a0 = Math.atan2(cur.y - cy, cur.x - cx);
            let a1 = Math.atan2(ey - cy, ex - cx);
            let d = a1 - a0;
            const ccw = (op.mode === 3) || (sweepRad !== null && sweepRad > 0);
            if (ccw) { while (d <= 1e-9) d += 2 * Math.PI; } else { while (d >= -1e-9) d -= 2 * Math.PI; }
            const isFull = Math.abs(ex - cur.x) < 1e-6 && Math.abs(ey - cur.y) < 1e-6;
            if (isFull) d = ccw ? 2 * Math.PI : -2 * Math.PI;
            const step = (stepDeg || 6) * Math.PI / 180;
            const n = Math.max(2, Math.ceil(Math.abs(d) / step));
            for (let k = 1; k <= n; k++) {
                const a = a0 + d * k / n;
                push(cx + r * Math.cos(a), cy + r * Math.sin(a));
            }
        }
        // 去掉相邻重复点：嘉立创EDA**标准版**导出的区域路径常以「M 起点 → L 起点」这种
        // 零长首段开头（实测某板 1153 块填充里 879 块如此，仅 24% 显式闭合）。退化边会让
        // EDA 端的多边形校验拒绝整块图元 —— 表现为「打开标准版工程后填充区域丢失」。
        // 闭合由 stdPathStr(pts, true) 的 `Z` 负责，这里只做去重（几何不变）。
        const out = [];
        for (const p of pts) {
            const q = out[out.length - 1];
            if (q && Math.abs(q.x - p.x) < 1e-7 && Math.abs(q.y - p.y) < 1e-7) continue;
            out.push(p);
        }
        return out;
    }

    /** 点列 → 标准版路径串 "M x y L x y ... [Z]" */
    function stdPathStr(pts, closed) {
        if (!pts || pts.length === 0) return '';
        let s = 'M ' + stdX(pts[0].x) + ' ' + stdY(pts[0].y);
        for (let i = 1; i < pts.length; i++) s += ' L' + stdX(pts[i].x) + ',' + stdY(pts[i].y);
        if (closed) s += ' Z ';
        return s;
    }

    /** 点列 → 标准版 points 串 "x y x y ..."（TRACK 用） */
    function stdPointStr(pts) {
        return pts.map(p => stdX(p.x) + ' ' + stdY(p.y)).join(' ');
    }

    /**
     * 生成一个 SOLIDREGION 图元串（10 字段，与官方导出的字段布局逐位对齐）：
     * cmdKey, layer, net, pathStr, fillStyle, gId, '', '', '', locked
     * 所有区域类图元（含覆铜）统一用它承载 —— 标准版对 SOLIDREGION 的解析最稳，
     * 不需要 COPPERAREA 那套「压缩数据 + 网络」附属信息，打开即见实心铜。
     * @param {string} [net] 网络名（未生成网络时传空串）
     */
    function stdSolidRegion(layer, pathStr, gid, net) {
        return ['SOLIDREGION', layer, net || '', pathStr, 'solid', gid, '', '', '', 0].join('~');
    }

    /**
     * 生成标准版 PCB 源码对象。
     * @param {object} [config] 导出配置（读 config.tryNetlist 决定是否生成网络）
     * @returns {object} 可直接 JSON.stringify 的标准版 PCB 源码
     */
    function buildStandardSource(config) {
        // textAsPoly：标准版没有文字笔画图元 —— 「G04 Text Start…End」段里的 G01
        // 一律按 PolygonModel 处理（落 rawPolys → 带线宽的 TRACK），否则这些笔画
        // 会跟着 rawTextLines 一起被丢掉（丝印/文档层的文字整片消失）。
        // 只在本通道（标准版）打开，专业版导出与画布仍是文字折线。
        const rawData = PadTool.extractRawData(loadedFiles.filter(f => f.visible), { textAsPoly: true });
        const uni = PadTool.consolidate(
            rawData.rawPads || [], rawData.rawVias || [], rawData.rawTracks || [],
            rawData.rawPolys || [], rawData.rawFills || [], rawData.drills || [],
            rawData.rawImages || [], rawData.rawTextLines || [], rawData.rawCoppers || []
        );

        const shapes = [];
        let gidSeq = 1000;
        const nextGid = () => 'gge' + (++gidSeq);
        // 包围盒（标准版坐标）
        let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
        const grow = (xs, ys) => {
            const x = Number(xs), y = Number(ys);
            if (!isFinite(x) || !isFinite(y)) return;
            if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
            if (y < by0) by0 = y; if (y > by1) by1 = y;
        };

        // ---------- 飞针测试数据（FlyingProbeTesting.json）----------
        // 压缩包里带飞针文件时，用它给焊盘补上「焊盘编号」(PAD 的第 9 个字段)。
        // 索引与两级匹配算法与画布标注完全共用（06-utils.js 的 buildFlyingPinIndex /
        // flyingPinAt / padMatchBoxMM），保证「画布上看到的编号」＝「导出写进去的编号」。
        const flyingIndex = buildFlyingPinIndex(typeof flyingProbeData !== 'undefined' ? flyingProbeData : null);
        if (flyingIndex.pins.length) {
            appLog(`标准版导出：已读取飞针文件，共 ${flyingIndex.pins.length} 个引脚用于匹配焊盘编号`);
        }

        // ---------- 物理网络（与 PRO 通道共用同一份计算结果） ----------
        // 标准版各图元的「网络」字段位置（对照官方导出实测，见各分支注释）：
        //   TRACK[3] / ARC[3] / CIRCLE[8] / SOLIDREGION[2] / PAD[7] / VIA[4]
        // 未勾选「生成网络」时全部写空串 —— 与改动前的输出逐字段一致。
        let netOf = null;
        if (config && config.tryNetlist) {
            try {
                // 焊盘网络优先取飞针文件的 NET_NAME（有飞针文件时命中率最高）
                const padNet = new Map();
                if (flyingIndex.pins.length) {
                    (uni.unifiedPads || []).forEach(p => {
                        const p0 = p.top || p.bottom || p.innerRep || (p.inners && p.inners[0]);
                        const m = flyingPinAt(flyingIndex, p.x, p.y, padMatchBoxMM(p0));
                        if (m && m.net) padNet.set(p, String(m.net));
                    });
                }
                const innerCopper = [...new Set(loadedFiles.map(f => f.layerId).filter(id => id >= 15 && id <= 46))];
                const res = buildNetAssignments(uni, { padNet, innerCopperLayers: innerCopper });
                netOf = res.netOf;
                const st = res.stats;
                appLog(`标准版导出：已生成网络 ${st.named} 个（沿用飞针/已有名 ${st.reused}，新分配 ${st.generated}）`);
            } catch (e) {
                console.error('标准版导出：物理网络生成失败', e);
                appLog(`标准版导出：生成网络失败（${e && e.message ? e.message : e}），本次不写网络`);
                netOf = null;
            }
        }
        /**
         * 取图元对应的网络名（未生成网络时恒为空串）。
         * 标准版图元串用 `~` 分隔，网络名里若混入 `~` 会把整条记录拆错位，
         * 这里统一换成 `_`（实际网络名极少出现，属防御性处理）。
         */
        const stdNet = (obj) => {
            const v = (netOf && obj) ? (netOf.get(obj) || '') : '';
            return (v.indexOf('~') >= 0) ? v.split('~').join('_') : v;
        };

        // ---------- 1. 焊盘 ----------
        (uni.unifiedPads || []).forEach(pad => {
            const prim = pad.top || pad.bottom || pad.innerRep || (pad.inners && pad.inners[0]);
            if (!prim) return;
            const hasDrill = !!pad.drill;
            // 通孔 → 多层(11)；表贴 → 顶层(1) / 底层(2)
            const layer = hasDrill ? 11
                : (pad.top ? 1 : (pad.bottom ? 2 : STD_LAYER(prim.layerId)));

            let w = prim.w, h = prim.h;
            if (prim.shape === 'POLYGON') {
                // 多边形焊盘的 w/h 恒为 0，尺寸取自路径包围盒（匹配用的包围盒统一走 padMatchBoxMM）
                const poly = stdFlattenPath(prim.path, 6);
                if (poly.length < 3) return;
                let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity;
                poly.forEach(p => { lx0 = Math.min(lx0, p.x); lx1 = Math.max(lx1, p.x); ly0 = Math.min(ly0, p.y); ly1 = Math.max(ly1, p.y); });
                w = lx1 - lx0; h = ly1 - ly0;
            }
            if (!(w > 0) || !(h > 0)) return;

            let shapeName = 'ELLIPSE';
            if (prim.shape === 'RECT' || prim.shape === 'ROUNDRECT') shapeName = 'RECT';
            else if (prim.shape === 'OVAL') shapeName = 'OVAL';
            else if (prim.shape === 'POLYGON') shapeName = 'POLYGON';

            const rot = prim.rotation || 0;
            const rad = rot * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            let points = '';
            if (shapeName === 'POLYGON') {
                points = stdFlattenPath(prim.path, 6).map(p => stdX(p.x) + ' ' + stdY(p.y)).join(' ');
            } else if (shapeName === 'RECT') {
                const hw = w / 2, hh = h / 2;
                // 顺序：左上 → 右上 → 右下 → 左下（世界坐标 Y 向上）
                const corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([dx, dy]) => ({
                    x: pad.x + dx * cos - dy * sin,
                    y: pad.y + dx * sin + dy * cos
                }));
                points = corners.map(p => stdX(p.x) + ' ' + stdY(p.y)).join(' ');
            } else if (shapeName === 'OVAL') {
                // 长圆：给中轴线两端点
                const along = w >= h;
                const half = (along ? w : h) / 2 - Math.min(w, h) / 2;
                const a = { x: pad.x - (along ? half : 0), y: pad.y - (along ? 0 : half) };
                const b = { x: pad.x + (along ? half : 0), y: pad.y + (along ? 0 : half) };
                const ra = { x: pad.x + (a.x - pad.x) * cos - (a.y - pad.y) * sin, y: pad.y + (a.x - pad.x) * sin + (a.y - pad.y) * cos };
                const rb = { x: pad.x + (b.x - pad.x) * cos - (b.y - pad.y) * sin, y: pad.y + (b.x - pad.x) * sin + (b.y - pad.y) * cos };
                points = stdX(ra.x) + ' ' + stdY(ra.y) + ' ' + stdX(rb.x) + ' ' + stdY(rb.y);
            }

            let holeR = 0, holeLength = 0, slotPts = '';
            if (hasDrill) {
                if (pad.drill.isSlot) {
                    // === 槽孔 ===
                    // PadTool 里槽孔的 w = 全长（中心距 + 钻刀直径），h = 槽宽；
                    // 标准版的约定（对照官方源码实测）：
                    //   [9]  holeR      = 槽宽 / 2（半径）
                    //   [13] holeLength = 槽孔全长（含两端圆头）
                    //   [14] slotPointArr = 槽中心线两端点（画布绝对坐标）
                    // 【必须给出 slotPointArr】只给 holeLength 时标准版会把槽从原点
                    // 拉到焊盘中心，槽长被撑到 1000mm 以上（实测复现）。
                    const slotW = Math.min(pad.drill.w, pad.drill.h);
                    const slotLen = Math.max(pad.drill.w, pad.drill.h);
                    holeR = stdU(slotW / 2);
                    holeLength = stdU(slotLen);
                    const halfLine = (slotLen - slotW) / 2;      // 中心线半长
                    const slotRad = (pad.drill.rotation || 0) * Math.PI / 180;
                    const ddx = Math.cos(slotRad) * halfLine;
                    const ddy = Math.sin(slotRad) * halfLine;
                    slotPts = stdX(pad.x - ddx) + ' ' + stdY(pad.y - ddy) + ' '
                        + stdX(pad.x + ddx) + ' ' + stdY(pad.y + ddy);
                } else {
                    holeR = stdU(pad.drill.w / 2);
                }
            }
            const plated = hasDrill ? (pad.drill.isPlated ? 'Y' : 'N') : 'Y';
            const solExp = (pad.exps && pad.exps.mt !== null && pad.exps.mt !== undefined) ? stdU(pad.exps.mt) : '';
            const pstExp = (pad.exps && pad.exps.pt !== null && pad.exps.pt !== undefined) ? stdU(pad.exps.pt) : '';
            const hx = stdX(pad.x), hy = stdY(pad.y);
            grow(hx, hy);

            // 焊盘编号：优先取飞针文件里匹配到的引脚号，否则回退 '1'
            const pinHit = flyingPinAt(flyingIndex, pad.x, pad.y, padMatchBoxMM(prim));
            const padNum = (pinHit && pinHit.num) || '1';
            // [7] = 网络名（标准版 PAD 的第 8 个字段）
            const f = ['PAD', shapeName, hx, hy, stdU(w), stdU(h), layer, stdNet(pad), padNum,
                holeR, points, stdNum(rot), nextGid(), holeLength, slotPts, plated, 0,
                pstExp, solExp, hx + ',' + hy];
            shapes.push(f.join('~'));
        });

        // ---------- 2. 过孔 / 非金属化孔 ----------
        (uni.remainingVias || []).forEach(v => {
            const hx = stdX(v.x), hy = stdY(v.y);
            grow(hx, hy);
            if (v.isPlated) {
                // [4] = 网络名（VIA 8 字段布局：VIA~x~y~padDia~net~holeR~gid~locked）
                shapes.push(['VIA', hx, hy, stdU(v.padDia || v.dia), stdNet(v), stdU(v.dia / 2), nextGid(), 0].join('~'));
            } else {
                // HOLE（非金属化孔）没有网络字段
                shapes.push(['HOLE', hx, hy, stdU(v.dia / 2), nextGid(), 0].join('~'));
            }
        });

        // ---------- 3. 导线 / 圆弧 ----------
        const tracks = uni.tracks || [];
        // 合并用收集器：所有「直线段」（导线 + 折线的相邻点）先收进来，
        // 最后按 (层, 线宽, 网络) 做链式合并，输出成一条多点 TRACK。
        // 标准版没有折线图元，相邻导线合并能显著减少图元数（官方导出也是这么做的）。
        const stdTrackSegs = [];
        const pushSeg = (layerId, width, net, ax, ay, bx, by) => {
            if (typeof ax !== 'number' || !isFinite(ax) || typeof ay !== 'number' || !isFinite(ay)) return;
            if (typeof bx !== 'number' || !isFinite(bx) || typeof by !== 'number' || !isFinite(by)) return;
            if (Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9) return;   // 退化段
            stdTrackSegs.push({ layerId: layerId, width: width, net: net, a: [ax, ay], b: [bx, by] });
        };
        // 圆弧 → 标准版 ARC 图元： d = "M sx,sy A r,r 0 <largeArc> <sweep> ex,ey"
        // 扫描方向与参考文件一致：Gerber G03（逆时针，角度为正）→ sweep-flag 0，G02 → 1。
        const svgArcD = (sx, sy, ex, ey, r, sweepDeg) => {
            // 容差：半圆的扫掠角由浮点运算得出，可能是 180.00000000000003，
            // 直接用 > 180 会把半圆误判成优弧（large-arc=1）。
            const largeArc = Math.abs(sweepDeg) > 180.0001 ? 1 : 0;
            const sweepFlag = (sweepDeg > 0) ? 0 : 1;
            return 'M' + stdX(sx) + ',' + stdY(sy) + ' A' + stdU(r) + ',' + stdU(r)
                + ' 0 ' + largeArc + ' ' + sweepFlag + ' ' + stdX(ex) + ',' + stdY(ey);
        };
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            const layer = STD_LAYER(t.layerId);
            const sw = stdU(t.width || 0.15);
            const gid = nextGid();
            if (t.type !== 'ARC') {
                // 直线段：交给链式合并（层 / 线宽 / 网络任一不同都不会并到一起）
                pushSeg(t.layerId, t.width || 0.15, stdNet(t), t.x1, t.y1, t.x2, t.y2);
                continue;
            }
            // 360° 整圆在提取阶段已拆成「两段对向的 180° 半圆」——
            // 这里把它们重新合成标准版的 CIRCLE 图元（与 EDA 官方导出的形态一致）。
            const nxt = tracks[i + 1];
            const isHalf = Math.abs(Math.abs(t.angle) - 180) < 0.01;
            const pairs = isHalf && nxt && nxt.type === 'ARC'
                && Math.abs(nxt.angle - t.angle) < 0.01
                && Math.abs(nxt.x1 - t.x2) < 1e-6 && Math.abs(nxt.y1 - t.y2) < 1e-6
                && Math.abs(nxt.x2 - t.x1) < 1e-6 && Math.abs(nxt.y2 - t.y1) < 1e-6;
            if (pairs) {
                const cx = (t.x1 + t.x2) / 2, cy = (t.y1 + t.y2) / 2;
                const r = Math.hypot(t.x2 - t.x1, t.y2 - t.y1) / 2;
                grow(stdX(cx - r), stdY(cy)); grow(stdX(cx + r), stdY(cy));
                // [8] = 网络名（CIRCLE 10 字段布局：CIRCLE~x~y~r~sw~layer~gid~locked~net~childIds）
                shapes.push(['CIRCLE', stdX(cx), stdY(cy), stdU(r), sw, layer, gid, 0, stdNet(t), ''].join('~'));
                i++;   // 两段半圆已经合成一个整圆
                continue;
            }
            const chord = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
            const srad = (t.angle || 0) * Math.PI / 180;
            if (chord < 1e-9 || Math.abs(Math.sin(srad / 2)) < 1e-9) {
                // 退化圆弧（起点=终点又非整圆）：没有半径信息，按点处理跳过
                grow(stdX(t.x1), stdY(t.y1));
                continue;
            }
            const r = Math.abs(chord / (2 * Math.sin(srad / 2)));
            grow(stdX(t.x1), stdY(t.y1)); grow(stdX(t.x2), stdY(t.y2));
            // [3] = 网络名（ARC 8 字段布局：ARC~sw~layer~net~path~''~gid~locked）
            shapes.push(['ARC', sw, layer, stdNet(t), svgArcD(t.x1, t.y1, t.x2, t.y2, r, t.angle), '', gid, 0].join('~'));
        }

        // ---------- 4. 折线 / 覆铜 / 板框 ----------
        (uni.polys || []).forEach(p => {
            // 标准版没有 FPC 补强层：58/59 的图元一律跳过。
            // （STD_LAYER 对未知 id 会兜底到 Document(12)，不跳过就会把补强轮廓
            //  错误地画到文档层上。）
            if (p.layerId === 58 || p.layerId === 59) return;
            const pts = stdFlattenPath(p.path, 6);
            if (pts.length < 2) return;
            // 标准版**没有折线（POLY）图元**，折线一律转成带线宽的多点 TRACK，
            // 允许落在非铜层（丝印 / 文档 / 机械 / 装配）。
            //
            // 这里把折线**拆成相邻段**交给统一的链式合并（而不是每条折线直接输出一条 TRACK）：
            // 这样「折线接导线」「折线接折线」也能串成一条，与官方导出的形态一致。
            // 不修改几何：合并只按端点拼接，输出的点列就是原来的端点序列。
            // 板框（11）走 BoardOutLine 层、网络为空，也不参与铜层网络。
            const pw = p.width || (p.layerId === 11 ? 0.254 : 0.15);
            const pnet = (p.layerId === 11) ? '' : stdNet(p);
            for (let k = 1; k < pts.length; k++) {
                pushSeg(p.layerId, pw, pnet, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y);
            }
        });

        // ---------- 5. 填充区域（含铜层覆铜，统一走 SOLIDREGION） ----------
        (uni.fills || []).forEach(f => {
            // 标准版不支持 FPC 补强层（58/59），直接跳过
            if (f.layerId === 58 || f.layerId === 59) return;
            const pts = stdFlattenPath(f.path, 6);
            if (pts.length < 3) return;
            pts.forEach(q => grow(stdX(q.x), stdY(q.y)));
            shapes.push(stdSolidRegion(STD_LAYER(f.layerId), stdPathStr(pts, true), nextGid(), stdNet(f)));
        });

        // ---------- 6. 图片（轮廓填充） ----------
        (uni.images || []).forEach(img => {
            // 标准版不支持 FPC 补强层（58/59），直接跳过
            if (img.layerId === 58 || img.layerId === 59) return;
            const pts = stdFlattenPath(img.path, 6);
            if (pts.length < 3) return;
            pts.forEach(q => grow(stdX(q.x), stdY(q.y)));
            shapes.push(stdSolidRegion(STD_LAYER(img.layerId), stdPathStr(pts, true), nextGid(), stdNet(img)));
        });

        // ---------- 6.5 合并相邻导线 → 单条多点 TRACK ----------
        // 规则：同层 + 同线宽 + 同网络 + 端点重合（0.001mm 量化）→ 串成一条链。
        // 链在「端点（度 1）」与「分叉（度 > 2）」处断开 —— 分叉会拆成多条链各自输出，
        // 因此**拓扑与几何都不变**，只是把首尾相接的多段并成一条（图元数显著减少）。
        // 纯环（每个点度都是 2）单独处理，输出首尾闭合的点列。
        // 注意：圆弧（ARC）不参与合并 —— 标准版的 ARC 是曲线图元，并进 TRACK 会变直。
        if (stdTrackSegs.length) {
            const QUANT = (v) => Math.round(v * 1000);          // 0.001 mm
            const pk = (p) => QUANT(p[0]) + ',' + QUANT(p[1]);
            const groups = new Map();
            stdTrackSegs.forEach(s => {
                const k = STD_LAYER(s.layerId) + '|' + s.width.toFixed(4) + '|' + s.net;
                const arr = groups.get(k);
                if (arr) arr.push(s); else groups.set(k, [s]);
            });
            let mergedChains = 0, totalChains = 0;
            groups.forEach((segs, gk) => {
                const parts = String(gk).split('|');
                const layer = parseInt(parts[0], 10);
                const width = parseFloat(parts[1]);
                const net = parts.slice(2).join('|');
                const adj = new Map();
                const addAdj = (p, i, end) => {
                    const k = pk(p);
                    const arr = adj.get(k);
                    if (arr) arr.push({ i: i, end: end });
                    else adj.set(k, [{ i: i, end: end }]);
                };
                segs.forEach((s, i) => { addAdj(s.a, i, 'a'); addAdj(s.b, i, 'b'); });
                const used = new Array(segs.length).fill(false);
                const emit = (pts) => {
                    if (pts.length < 2) return;
                    pts.forEach(q => grow(stdX(q[0]), stdY(q[1])));
                    const ptStr = pts.map(q => stdX(q[0]) + ' ' + stdY(q[1])).join(' ');
                    shapes.push(['TRACK', stdU(width), layer, net, ptStr, nextGid(), 0].join('~'));
                    totalChains++;
                    if (pts.length > 2) mergedChains++;
                };
                const walk = (startIdx, startEnd) => {
                    const pts = [];
                    const pushPt = (p) => {
                        const last = pts[pts.length - 1];
                        // 只跳过「与上一个点重合」的点；环回到起点时要保留，否则闭合链缺一段
                        if (last && pk(last) === pk(p)) return;
                        pts.push(p);
                    };
                    let idx = startIdx, end = startEnd;
                    const s0 = segs[idx];
                    pushPt(end === 'a' ? s0.a : s0.b);
                    while (true) {
                        if (used[idx]) break;
                        used[idx] = true;
                        const s = segs[idx];
                        const far = (end === 'a') ? s.b : s.a;
                        pushPt(far);
                        const cand = (adj.get(pk(far)) || []).filter(e => !used[e.i]);
                        if (cand.length !== 1) break;   // 0 = 到头；>1 = 分叉，都停
                        idx = cand[0].i;
                        end = cand[0].end;
                    }
                    return pts;
                };
                // 先从端点(度 1)与分叉(度 > 2)起步，保证分叉处断开成多条
                adj.forEach((list) => {
                    if (list.length === 2) return;
                    for (const e of list) {
                        if (used[e.i]) continue;
                        emit(walk(e.i, e.end));
                    }
                });
                // 剩下的必然是环
                for (let i = 0; i < segs.length; i++) {
                    if (used[i]) continue;
                    emit(walk(i, 'a'));
                }
            });
            if (mergedChains) {
                console.log(`标准版导线：${stdTrackSegs.length} 段 → ${totalChains} 条 TRACK（其中 ${mergedChains} 条为多段合并）`);
            }
        }

        // ---------- 7. 元件位号 → TEXT 图元（必须自带字形轮廓） ----------
        // 标准版没有「折线文字」这种表达：文字要么是 TEXT 图元（自带轮廓 path），
        // 要么就丢失。这里把飞针元件表的位号写成 TEXT，轮廓来自内置字体
        // （iframe/js/11-font-outline.js，由 tools/font-outline.js 从 NotoSansSC 提取）。
        //
        // 官方样例（Temp/FCTS_解析报告.md 同批板子导出）：
        //   TEXT~L~x~y~0.8~0~0~12~~7.874~文本~M…Z~~gge1161~NotoSansCJKsc-DemiLight~0~pinpart
        // 字段：0 TEXT / 1 对齐 L / 2 x / 3 y / 4 线宽 / 5,6 保留 / 7 图层 /
        //       8 空 / 9 字号(em, 标准版单位) / 10 文本 / 11 轮廓 path / 12 空 /
        //       13 ggeID / 14 字体名 / 15 0 / 16 pinpart
        // 对齐用 L（左 + 基线）而不是让 EDA 自己居中：坐标由我们自己算准，位置才可控。
        const wantRefdesText = (typeof flyingOverlayVisible !== 'undefined')
            && ((typeof isRefdesLayerOn === 'function' && (isRefdesLayerOn('T') || isRefdesLayerOn('B')))
                || flyingOverlayVisible[FLYING_LAYER.REFDES_TOP] || flyingOverlayVisible[FLYING_LAYER.REFDES_BOTTOM])
            && typeof flyingProbeData !== 'undefined' && flyingProbeData
            && flyingProbeData.components && flyingProbeData.components.rows;
        if (wantRefdesText) {
            const canText = (typeof fontTextToPath === 'function') && (typeof fontEmForCapHeight === 'function');
            if (!canText) {
                appLog('内置字体轮廓未加载，标准版不输出位号文字');
            } else {
                const capMil = (typeof FLYING_REFDES_HEIGHT_MIL === 'number') ? FLYING_REFDES_HEIGHT_MIL : 30;
                const emStd = fontEmForCapHeight(capMil) / 10;    // 标准版单位 = 10 mil
                const capStd = capMil / 10;
                // 位号固定在文档层：**只有**标准版导出写文档层
                // （标准版层号 12 = Document Layer）。专业版走 05-pad-tool.js，
                // 位号按元件所在面写顶层/底层装配层。
                const txtLayer = (typeof FLYING_REFDES_LAYER_STD === 'number') ? FLYING_REFDES_LAYER_STD : 12;
                const cFields = flyingProbeData.components.fields || [];
                const ciName = cFields.indexOf('COMPONENT_NAME');
                const ciX = cFields.indexOf('X_COORDINATE');
                const ciY = cFields.indexOf('Y_COORDINATE');
                const ciLayer = cFields.indexOf('LAYER');
                // 飞针文件的坐标单位（实测 mil）：不换算会把位号写到板外几十米，
                // BBox 跟着被撑爆 —— 导入后整块板缩成一个小点，看起来就是「文本不能用」。
                const fpScaleMM = (typeof flyingLengthScaleMM === 'function')
                    ? flyingLengthScaleMM(flyingProbeData) : 1;
                let nText = 0, nMiss = 0;
                const missSet = new Set();
                if (ciName >= 0 && ciX >= 0 && ciY >= 0) {
                    flyingProbeData.components.rows.forEach(row => {
                        const name = row[ciName];
                        if (!name || (typeof isFlyingPadPlaceholder === 'function' && isFlyingPadPlaceholder(name))) return;
                        // 位号按面分开导出：该面的位号图层没勾选就跳过
                        const isBottomRow = ciLayer >= 0 ? /^b/i.test(String(row[ciLayer] || '')) : false;
                        if (typeof isRefdesLayerOn === 'function' && !isRefdesLayerOn(isBottomRow ? 'B' : 'T')) return;
                        const mmX = parseFloat(row[ciX]) * fpScaleMM, mmY = parseFloat(row[ciY]) * fpScaleMM;
                        if (!isFinite(mmX) || !isFinite(mmY)) return;
                        // 先量宽度（锚点 0,0），再按「水平居中 + 垂直居中」算基线位置
                        const probe = fontTextToPath(String(name), emStd, { x: 0, y: 0 });
                        if (!probe.d) { nMiss++; return; }
                        if (probe.missing) { nMiss++; probe.missing.split('').forEach(c => missSet.add(c)); }
                        // ⚠️ stdX / stdY 返回的是**字符串**（stdNum 的格式化结果），
                        // 直接参与算术会变成字符串拼接（"3521.12" + 1.5 → "3521.121.5"），
                        // 所以这里必须先转成数字再算位置。
                        const cx = parseFloat(stdX(mmX)), cy = parseFloat(stdY(mmY));
                        if (!isFinite(cx) || !isFinite(cy)) return;
                        const baseX = cx - probe.width / 2;
                        const baseY = cy + capStd / 2;
                        const placed = fontTextToPath(String(name), emStd, { x: baseX, y: baseY });
                        if (!placed.d) { nMiss++; return; }
                        grow(baseX, baseY);
                        grow(baseX + probe.width, baseY - capStd);
                        shapes.push(['TEXT', 'L', stdNum(baseX), stdNum(baseY), '0.8', '0', '0',
                            String(txtLayer), '', stdNum(emStd), String(name), placed.d, '',
                            nextGid(), FONT_OUTLINE_META.family, '0', 'pinpart'].join('~'));
                        nText++;
                    });
                }
                if (nText || nMiss) {
                    appLog(`标准版位号：写出 ${nText} 条 TEXT（字高 ${capMil}mil，文档层）`
                        + (nMiss ? `，${nMiss} 条因缺少字形轮廓被跳过`
                            + (missSet.size ? `（缺字：${[...missSet].slice(0, 12).join('')}）` : '') : ''));
                }
            }
        }

        // 兜底：一个图元都没生成时，BBox 用原点，避免出现 Infinity
        if (!isFinite(bx0)) { bx0 = STD_ORIGIN_X; bx1 = STD_ORIGIN_X; by0 = STD_ORIGIN_Y; by1 = STD_ORIGIN_Y; }

        // 内层层数：必须在 layers 表里真正启用，否则标准版只按 2 层板打开
        const innerLayerCount = stdInnerLayerCount(config);
        if (innerLayerCount > 0) {
            appLog(`标准版图层：${innerLayerCount + 2} 层板（启用内层 ${innerLayerCount} 层）`);
        }

        return {
            head: {
                docType: '3',
                editorVersion: STD_EDITOR_VER,
                newgId: true,
                c_para: {},
                x: STD_ORIGIN_X,
                y: STD_ORIGIN_Y,
                hasIdFlag: true
            },
            canvas: STD_CANVAS,
            shape: shapes,
            layers: buildStdLayers(innerLayerCount),
            objects: STD_OBJECTS,
            BBox: {
                x: stdNum(bx0),
                y: stdNum(by0),
                width: stdNum(bx1 - bx0),
                height: stdNum(by1 - by0)
            },
            preference: { hideFootprints: '', hideNets: '' },
            DRCRULE: STD_DRCRULE,
            netColors: {}
        };
    }

    // 目标：标准版 —— 生成并下载嘉立创EDA标准版 PCB 源码（.json）
    // @returns 是否导出成功（用于操作计数）
    async function exportForStandard(config) {
        if (!loadedFiles || loadedFiles.length === 0) {
            alert('请先导入 Gerber 文件');
            return false;
        }
        try {
            const doc = buildStandardSource(config);
            if (!doc.shape.length) {
                alert('没有可导出的图元，请检查已勾选的图层');
                return false;
            }
            const json = JSON.stringify(doc, null, 2);
            const baseName = currentZipName || `${new Date().getTime()}`;
            downloadBlobAsFile(new Blob([json], { type: 'application/json;charset=utf-8' }),
                `Gerber_To_PCB_${baseName}.json`);

            let nPad = 0, nVia = 0, nHole = 0, nTrack = 0, nArc = 0, nSolid = 0, nSlot = 0, nNet = 0;
            const netNames = new Set();
            // 各图元的网络字段索引（与 buildStandardSource 里写入的位置一致）
            const netFieldIdx = { PAD: 7, VIA: 4, TRACK: 3, ARC: 3, CIRCLE: 8, SOLIDREGION: 2 };
            doc.shape.forEach(s => {
                const f = s.split('~');
                const k = f[0];
                if (k === 'PAD') { nPad++; if (parseFloat(f[13]) > 0) nSlot++; }
                else if (k === 'VIA') nVia++;
                else if (k === 'HOLE') nHole++;
                else if (k === 'TRACK') nTrack++;
                else if (k === 'ARC') nArc++;
                else if (k === 'SOLIDREGION') nSolid++;
                const ni = netFieldIdx[k];
                if (ni !== undefined && f[ni]) { nNet++; netNames.add(f[ni]); }
            });
            appLog('标准版源码生成完毕');
            appLog(`焊盘 ${nPad} 个（含槽孔 ${nSlot} 个）/ 过孔 ${nVia} 个 / 非金属化孔 ${nHole} 个`);
            appLog(`导线 ${nTrack} 条 / 圆弧 ${nArc} 条 / 填充区域 ${nSolid} 块`);
            appLog(nNet ? `已写网络：${netNames.size} 个网络名 / ${nNet} 个图元`
                : '未写网络（「生成网络」未勾选）');
            appLog(`画布尺寸 ${doc.BBox.width} × ${doc.BBox.height} 单位（1 单位 = 10 mil）`);
            return true;
        } catch (e) {
            console.error(e);
            appLog(`标准版导出失败: ${e.message}`);
            alert('标准版导出失败: ' + e.message);
            return false;
        }
    }

    // --- [新增] 手动生成 DEBUG 源码 ---
    window.generateDebugSource = async () => {
        if (loadedFiles.length === 0) {
            alert("请先导入 Gerber 文件");
            return;
        }

        const btn = document.querySelector('button[onclick="generateDebugSource()"]');
        const oldText = btn.textContent;
        btn.textContent = "生成中...";

        // 构造配置：指定生成 V3 版本，且模式为 debug (输出到文本框不下载)
        const config = {
            mode: 'debug',           // 关键：输出到文本框
            targetVer: 'pro_v3',     // 关键：强制生成 V3 版本
            sourceType: document.getElementById('cfg-source-type').value,
            tryNetlist: document.getElementById('cfg-netlist').checked
        };

        try {
            // 调用现有的导出逻辑
            await exportForEasyEDA_Pro(config);
            
            // 按钮反馈
            btn.textContent = "已完成";
        } catch (e) {
            console.error(e);
            btn.textContent = "失败";
        }

        setTimeout(() => btn.textContent = oldText, 1000);
    };

