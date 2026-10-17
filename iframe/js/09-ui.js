// ====================================================================================
// 09-ui.js  —  UI 渲染与交互
// ------------------------------------------------------------------------------------
// 职责：
//   · 图层表格渲染 renderLayerTable，分组与图层类型下拉初始化渲染
//   · 画布绘制 drawCanvas / resizeCanvas / requestDraw / drawRulers / autoFitView
//   · Tab 切换、单位切换、DPI 选择、板层数与板子类型等交互
//   · 缩放 / 平移 / 框选，以及挂到 window 上供 HTML 内联 onclick 调用的处理函数
// 依赖：03-state.js（画布上下文）、02-config.js（图层数据）。
// 注意：本文件在【加载时】即为画布注册 wheel / mousedown / contextmenu 等监听。
// 加载顺序：第 9 个
// ====================================================================================

// ====================================================================================
// 7. UI 交互与渲染 (UI & Rendering)
// ====================================================================================

    // renderLayerTable 表格渲染 (DOM 生成)。
    function renderLayerTable() {
        const container = document.getElementById('layer-list-content');
        container.innerHTML = `
            <div class="layer-table-head">
                <div class="col-color">颜色</div>
                <div class="col-vis">启用</div>
                <div class="col-name">文件名</div>
                <div class="col-layer">图层类型</div>
            </div>
        `;

        const copperCountEl = document.getElementById('cfg-copper-layers');
        const copperCount = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;
        const maxInnerId = 12 + copperCount; // InnerX 的最大 ID 限制

        // --- 1. 构建图层类型下拉菜单 (保持原逻辑) ---
        let selectOptionsHtml = '';
        uiGroups.forEach(group => {
            const validIds = group.ids.filter(id => {
                // 飞针标注层不是可分配的图层类型（它没有对应的输入文件），不进下拉框
                if (isFlyingLayer(id)) return false;
                if (group.id === "INNER") {
                    if (copperCount <= 2) return false;
                    return id <= maxInnerId;
                }
                return true; 
            });
            if (validIds.length === 0) return; 

            selectOptionsHtml += `<optgroup label="${group.name}">`;
            validIds.forEach(id => {
                const def = layerDefs[id];
                if (def) selectOptionsHtml += `<option value="${id}">${def.name}</option>`;
            });
            selectOptionsHtml += `</optgroup>`;
        });

        // --- [新增] 2. 构建“仅铜层”下拉菜单选项 (Top, Inner..., Bottom) ---
        // 用于埋盲孔的起始/结束层选择
        let copperPairOptions = '';
        
        // Top (ID 1)
        copperPairOptions += `<option value="1">顶层线路</option>`;
        
        // Inner Layers (ID 15 ~ maxInnerId)
        // 注意：maxInnerId = 12 + copperCount. 
        // 比如 4层板: max=16 (Inner1=15, Inner2=16)
        if (copperCount > 2) {
            for (let i = 15; i < 15 + (copperCount - 2); i++) {
                // 如果 layerDefs 中有定义中文名则使用，否则用 InnerX
                const name = layerDefs[i] ? layerDefs[i].name : `内层${i-14}`;
                copperPairOptions += `<option value="${i}">${name}</option>`;
            }
        }
        
        // Bottom (ID 2)
        copperPairOptions += `<option value="2">底层线路</option>`;


        // --- 3. 渲染列表 ---
        let currentGroupId = null;

        loadedFiles.forEach(file => {
            const gid = getGroupId(file.layerId);
            const groupName = uiGroups.find(g => g.id === gid).name;

            if (gid !== currentGroupId) {
                const gDiv = document.createElement('div');
                gDiv.className = 'layer-header'; 
                gDiv.innerHTML = `
                    <input type="checkbox" id="group-cb-${gid}" onchange="toggleGroup('${gid}', this.checked)" style="margin-right:8px">
                    <span>${groupName}</span>
                `;
                container.appendChild(gDiv);
                currentGroupId = gid;
            }

            // 主行
            const row = document.createElement('div');
            row.className = 'layer-row';
            row.dataset.group = gid;
            
            const def = layerDefs[file.layerId] || layerDefs[57];
            const rowSelectHtml = selectOptionsHtml.replace(`value="${file.layerId}"`, `value="${file.layerId}" selected`);

            row.innerHTML = `
                <div class="col-color"><input type="color" value="${def.color}" onchange="updateColor(${file.layerId},this.value)"></div>
                <div class="col-vis"><input type="checkbox" class="file-cb" ${file.visible?'checked':''} onchange="toggleFile(${file.index},this.checked)"></div>
                <div class="col-name" title="${file.name}">${file.name}</div>
                <div class="col-layer"><select class="layer-select" onchange="changeLayer(${file.index},this.value)">${rowSelectHtml}</select></div>
            `;
            container.appendChild(row);

            // --- [新增] 如果是埋盲孔 (ID 502)，插入子行 ---
            if (file.layerId === 502) {
                const subRow = document.createElement('div');
                subRow.className = 'layer-sub-row';
                
                // 确定下拉框的默认值
                // 如果文件对象里没有 pairStart/End (比如手动切过来的)，默认设为 Top/Bottom
                const valStart = file.pairStart || 1; 
                const valEnd = file.pairEnd || 2;

                // 生成带有 selected 的 HTML
                const startHtml = copperPairOptions.replace(`value="${valStart}"`, `value="${valStart}" selected`);
                const endHtml = copperPairOptions.replace(`value="${valEnd}"`, `value="${valEnd}" selected`);

                subRow.innerHTML = `
                    <span>└ 从 </span>
                    <select onchange="updateViaPair(${file.index}, 'start', this.value)">${startHtml}</select>
                    <span> 到 </span>
                    <select onchange="updateViaPair(${file.index}, 'end', this.value)">${endHtml}</select>
                `;
                container.appendChild(subRow);
            }
        });

        const activeGroups = [...new Set(loadedFiles.map(f => getGroupId(f.layerId)))];
        activeGroups.forEach(gid => updateGroupCheckboxState(gid));

        // --- 4. 飞针标注层（来自 FlyingProbeTesting.json，不对应任何 Gerber 文件）---
        renderFlyingLayerRows(container);
    }

    /**
     * 渲染标注层行：引脚编号 / 网络名称 / 元件位号 / 补强名称。
     * 前三层需要飞针文件；「补强名称」只要有补强层（58/59）就显示 —— 两者独立判断。
     * （早先这里一进来就判断飞针文件，导致 FPC 板通常没有飞针文件时，补强行根本不出现。）
     * 这些层都没有对应的输入文件；前三层只做画布标注，「元件位号」勾选后才随导出写入。
     */
    function renderFlyingLayerRows(container) {
        const hasFlying = (typeof flyingProbeData !== 'undefined' && !!flyingProbeData);
        const hasStiff = (typeof loadedFiles !== 'undefined' && loadedFiles)
            ? loadedFiles.some(f => f.layerId === 58 || f.layerId === 59) : false;
        if (!hasFlying && !hasStiff) return;

        // 并入「自定义/特殊」分组：找到该分组的最后一行，把标注行紧接其后插入；
        // 若当前没有任何「自定义/特殊」文件，则先补一个分组标题（无文件时该组没有复选框行）。
        const customGid = uiGroups[4].id;
        let anchor = null;
        container.querySelectorAll('.layer-row').forEach(row => {
            if (row.dataset.group === customGid) anchor = row;
        });
        if (!anchor) {
            const head = document.createElement('div');
            head.className = 'layer-header';
            // 该组没有任何真实文件时，表头复选框也要能勾选/取消（否则标注层无法整组开关）
            head.innerHTML = `<input type="checkbox" id="group-cb-${customGid}"`
                + ` onchange="toggleGroup('${customGid}', this.checked)" style="margin-right:8px">`
                + `<span>${uiGroups[4].name}</span>`;
            container.appendChild(head);
            anchor = head;
        }

        const ids = [];
        if (hasFlying) ids.push(...FLYING_PIN_LAYER_IDS);
        if (hasStiff) ids.push(FLYING_LAYER.STIFFENER);

        let insertAfter = anchor;
        ids.forEach(id => {
            const def = layerDefs[id];
            if (!def) return;
            const row = document.createElement('div');
            row.className = 'layer-row';
            row.dataset.group = customGid;
            row.innerHTML = `
                <div class="col-color"><input type="color" value="${def.color}" onchange="updateColor(${id},this.value)"></div>
                <div class="col-vis"><input type="checkbox" ${flyingOverlayVisible[id] ? 'checked' : ''} onchange="toggleOverlay(${id},this.checked)"></div>
                <div class="col-name">${def.name}</div>
            `;
            insertAfter.insertAdjacentElement('afterend', row);
            insertAfter = row;
        });
    }

    /** 切换飞针标注层的显示；元件位号同时决定是否随导出写入 */
    window.toggleOverlay = (id, checked) => {
        if (!isFlyingLayer(id)) return;
        flyingOverlayVisible[id] = !!checked;
        // 标注层属于「自定义/特殊」组：单独改一行后，组复选框要跟着变全选/半选/不选
        updateGroupCheckboxState(getGroupId(id));
        drawCanvas();
    };

    // 新增 forceSolid 参数，用于独立控制是否强制 100% 不透明
    function drawCanvas(forceNoDpr = false, forceSolid = false) {
        // --- 交互期快照快放（只用于屏幕交互，导出/PDF 一律走完整渲染）---
        // 见 03-state.js 里 viewInteracting / snapInfo 的说明。
        if (!forceNoDpr && viewInteracting && snapValid && snapInfo
            && snapCanvas.width === mainCanvas.width && snapCanvas.height === mainCanvas.height
            && paintFromSnapshot()) return;

        // --- [核心修复] ---
        // 如果是导出模式 (forceNoDpr=true)，强制 dpr=1，忽略屏幕缩放
        // 否则使用屏幕的 devicePixelRatio
        const dpr = forceNoDpr ? 1 : (window.devicePixelRatio || 1);
        
        // 1. 清空主画布 (使用逻辑像素尺寸)
        const logicalW = mainCanvas.width / dpr;
        const logicalH = mainCanvas.height / dpr;

        ctx.save();
        ctx.setTransform(1,0,0,1,0,0); // 重置矩阵以清空全屏
        ctx.clearRect(0,0, mainCanvas.width, mainCanvas.height);
        ctx.restore(); 
        
        // 2. 【关键】每次绘制都用**绝对** setTransform 设定 dpr，而不是依赖
        //    resizeCanvas 之前留下的 scale。
        //    原因：只要有人重设过 `mainCanvas.width`（**导出 PDF 就会**，见 08-export.js
        //    的 finally），context 变换会被浏览器重置成单位矩阵 —— 此时若仍靠
        //    resizeCanvas 里那句 scale(dpr) 就失效了，图形会按「设备像素」绘制（小 dpr 倍、
        //    整体偏左上），而标注文字层用的是绝对 setTransform(dpr) → 两者对不上。
        //    这就是「高 DPI 屏上图形与标注文字 DPI 不一致」的根因（且只在导出过 PDF 后出现，
        //    所以看起来像「不定时」）。
        //    这里幂等：无论之前状态如何，进入绘制时一定是 dpr。
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 绘制原点
        ctx.save();
        ctx.translate(viewState.offsetX, viewState.offsetY);
        ctx.scale(viewState.scale, -viewState.scale); 
        ctx.beginPath(); ctx.strokeStyle = '#CCC'; ctx.lineWidth = 1/viewState.scale;
        ctx.moveTo(-200000,0); ctx.lineTo(200000,0); ctx.moveTo(0,-200000); ctx.lineTo(0,200000); ctx.stroke();
        ctx.restore();


        // 权重排序 (数值越大越靠上层显示，后绘制)
        const renderPriority = {
            // --- Level 1: 最高优先级 ---
            11: 1000, // 板框 (Outline)
            47: 900,  // 钻孔 (Drill)
            500: 900, // 金属化通孔
            501: 900, // 非金属化通孔
            502: 900, // 埋盲孔

            // --- Level 2: 顶层堆叠 (铜 < 阻焊 < 丝印 < 锡膏 < 补强 < 装配) ---
            9:  850,  // Top Assembly
            58: 840,  // Top Stiffener
            7:  830,  // Top Paste
            3:  820,  // Top Silk
            5:  810,  // Top Solder Mask
            1:  800,  // Top Copper

            // --- Level 3: 内层 (动态计算，位于 600~700 之间) ---

            // --- Level 4: 底层堆叠 (铜 < 阻焊 < 丝印 < 锡膏 < 补强 < 装配) ---
            10: 450,  // Bot Assembly
            59: 440,  // Bot Stiffener
            8:  430,  // Bot Paste
            4:  420,  // Bot Silk
            6:  410,  // Bot Solder Mask
            2:  400,  // Bot Copper

            // --- Level 5: 背景层 ---
            57: 200,  // Other
            56: 100,  // Drill Drawing
            14: 60,   // Mechanical
            13: 50    // Document
        };

        const getZ = (id) => {
            // 1. 如果在静态表中定义了，直接返回
            if (renderPriority[id] !== undefined) return renderPriority[id];
            
            // 2. 动态计算内层优先级 (Inner1 ~ Inner32 对应 ID 15 ~ 46)
            // 要求: Inner1 (ID 15) > Inner2 (ID 16) > ...
            // 算法: 基础值 600 + (最大ID 46 - 当前ID)
            // 结果: Inner1 (15) => 600 + 31 = 631
            //       Inner32 (46) => 600 + 0 = 600
            if (id >= 15 && id <= 46) {
                return 600 + (46 - id); 
            }
            
            return 0; // 未知图层沉底
        };
        
        // 排序
        const renderOrder = loadedFiles.slice().sort((a,b) => getZ(a.layerId) - getZ(b.layerId));

        // --- [性能优化] 预先算出「世界坐标下的可视矩形」，供逐图元裁剪使用 ---
        // 屏幕坐标与世界坐标的关系： sx = offsetX + scale*x ； sy = offsetY - scale*y
        // 故可视范围： x ∈ [-offsetX/scale, (logicalW-offsetX)/scale]
        //             y ∈ [(offsetY-logicalH)/scale, offsetY/scale]
        const cullPadMM = 2 / (viewState.scale || 1); // 至少留 2 像素余量
        const viewRect = {
            minX: -viewState.offsetX / viewState.scale - cullPadMM,
            maxX: (logicalW - viewState.offsetX) / viewState.scale + cullPadMM,
            minY: (viewState.offsetY - logicalH) / viewState.scale - cullPadMM,
            maxY: viewState.offsetY / viewState.scale + cullPadMM
        };
        // 包围盒与可视矩形是否相交（pad 为额外余量，单位 mm）
        const rectVisible = (x0, y0, x1, y1, pad) =>
            !(x1 < viewRect.minX - pad || x0 > viewRect.maxX + pad ||
              y1 < viewRect.minY - pad || y0 > viewRect.maxY + pad);


        // 2. 循环绘制每个文件
        renderOrder.forEach(file => {
            if (!file.visible) return;
            const def = layerDefs[file.layerId] || layerDefs[57] || { color: '#888', alpha: 1 };

            // --- 先算「本层内容包围盒」，用于 ① 整层跳过 ② 合成时只拷贝内容矩形 ---
            // ⚠️ 必须放在 bufCtx.save() 之前：这里的 return 会跳过末尾的 restore，
            //    否则会破坏 buffer 上下文的 save 栈（后续图层的变换被重复叠加 → 画面错位）。
            const { commands, apertures } = file.data;
            // 光圈参数仍是「文件单位」，本图层内统一按这个倍率换算成 mm
            // （坐标在解析阶段已换算，只有光圈/宏尺寸没有）。
            // 注意：钻孔文件的刀具直径在解析时已经换算成 mm，不能再乘一次。
            const unitScale = (!file.data.isDrill && file.data.units === 'in') ? 25.4 : 1;
            // --- [性能优化] 裁剪余量：取本图层光圈的最大尺寸（换算成 mm），
            //     保证被裁掉的一定是完全落在视口之外的图元 ---
            let maxApMM = 0;
            for (const k in apertures) {
                const pp = apertures[k] && apertures[k].params;
                if (!pp) continue;
                for (let q = 0; q < pp.length; q++) {
                    const v = Math.abs(pp[q]);
                    if (v > maxApMM) maxApMM = v;
                }
            }
            const cullPadAp = maxApMM * unitScale + cullPadMM;
            let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
            for (let i = 0; i < commands.length; i++) {
                const c = commands[i];
                if (typeof c.x === 'number' && isFinite(c.x)) {
                    if (c.x < bMinX) bMinX = c.x;
                    if (c.x > bMaxX) bMaxX = c.x;
                    if (typeof c.y === 'number' && isFinite(c.y)) {
                        if (c.y < bMinY) bMinY = c.y;
                        if (c.y > bMaxY) bMaxY = c.y;
                    }
                    // 圆弧/槽孔会鼓出端点之外：把「圆心 ± 半径」并入包围盒
                    if ((c.mode === 2 || c.mode === 3) && typeof c.i === 'number' && typeof c.j === 'number') {
                        const px = (typeof c.prevX === 'number') ? c.prevX : c.x;
                        const py = (typeof c.prevY === 'number') ? c.prevY : c.y;
                        const acx = px + c.i, acy = py + c.j;
                        const ar = Math.sqrt(c.i * c.i + c.j * c.j);
                        if (acx - ar < bMinX) bMinX = acx - ar;
                        if (acx + ar > bMaxX) bMaxX = acx + ar;
                        if (acy - ar < bMinY) bMinY = acy - ar;
                        if (acy + ar > bMaxY) bMaxY = acy + ar;
                    }
                }
                if (Array.isArray(c.path)) {
                    for (let q = 0; q < c.path.length; q++) {
                        const o = c.path[q];
                        if (typeof o.x === 'number' && isFinite(o.x)) { if (o.x < bMinX) bMinX = o.x; if (o.x > bMaxX) bMaxX = o.x; }
                        if (typeof o.y === 'number' && isFinite(o.y)) { if (o.y < bMinY) bMinY = o.y; if (o.y > bMaxY) bMaxY = o.y; }
                    }
                }
            }
            // 整层都在视口外：本层什么都不会画，直接跳过（此时还没 save，安全）
            if (bMinX === Infinity || !rectVisible(bMinX, bMinY, bMaxX, bMaxY, cullPadAp)) return;

            // A. 清空 Buffer
            // 只清「上一层真正画过的那块矩形」：全屏 clearRect 在 4K/高 DPI 下
            // 一层就是几千万像素，16 层白清一遍纯属浪费（buffer 里的内容只可能落在
            // lastBufRect 内 —— 每次绘制前都会按同样的规则清一次）。
            bufCtx.save();
            bufCtx.setTransform(1,0,0,1,0,0);
            if (lastBufRect) {
                bufCtx.clearRect(lastBufRect.x, lastBufRect.y, lastBufRect.w, lastBufRect.h);
            } else {
                bufCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
            }
            bufCtx.restore(); // 如果 bufferCanvas 上下文没有做 dpr scale，这里其实不需要 restore，但为了安全
            lastBufRect = null;
            
            // B. Buffer 绘图设置
            bufCtx.save();
            // 关键：Buffer 也要应用 dpr 和 视图变换
            bufCtx.scale(dpr, dpr); 
            bufCtx.translate(viewState.offsetX, viewState.offsetY);
            bufCtx.scale(viewState.scale, -viewState.scale);

            bufCtx.fillStyle = def.color;
            bufCtx.strokeStyle = def.color;
            if(file.layerId === 47) { bufCtx.fillStyle="#ffffff"; bufCtx.strokeStyle="#ffffff"; }
            
            // ... (原有的绘制 Loop 保持不变，包含 commands 遍历) ...
            // 逐次 Flash 都要用到的两样东西，按光圈缓存：
            //   · 换算过单位的光圈参数数组（原来每颗焊盘都 map 一遍，几十万个临时数组）
            //   · 宏轮廓（原来每颗焊盘都跑一次 $n 表达式求值）
            const _apParamsCache = new Map();
            const _macroShapeCache = new Map();
            let currX=0; let currY=0;
            bufCtx.lineCap = 'round'; bufCtx.lineJoin = 'round'; 
            bufCtx.beginPath();

            let curPolarity = null;   // 当前生效的极性：仅在真正变化时才提交路径
            let pathBroken = false;   // 路径是否已与上一条画出的图元断开，需要重新 moveTo

            for (let i = 0; i < commands.length; i++) {
                const cmd = commands[i];

                // 极性处理
                // --- [性能优化] 原实现在每条命令上都无条件 stroke()+beginPath()，
                //     这会打断「同图层内连续线段」的路径批处理：每段被单独提交，
                //     而下一段又是从空路径开始 lineTo，结果每层只画出第一段。
                //     改为仅在极性真正变化时才提交路径，其余情况让线段自然累积成一条路径。 ---
                const polarity = (cmd.polarity === 'C') ? 'C' : 'D';
                if (polarity !== curPolarity) {
                    bufCtx.stroke(); 
                    bufCtx.beginPath();
                    bufCtx.globalCompositeOperation = polarity === 'C' ? 'destination-out' : 'source-over'; 
                    curPolarity = polarity;
                }

                if (cmd.type === 2) { // Move
                    bufCtx.stroke(); 
                    bufCtx.beginPath();
                    bufCtx.moveTo(cmd.x, cmd.y);
                    currX = cmd.x; currY = cmd.y;
                    pathBroken = false;   // [性能优化] 路径已在新位置重新起笔
                } else if (cmd.type === 1) { // Line / Arc
                    const ap = apertures[cmd.ap];
                    // 线宽取自光圈参数，需按文件单位换算成 mm（英寸文件曾按英寸当 mm 画，线宽细 25.4 倍）
                    const width = (ap && ap.params && ap.params[0]) ? (ap.params[0] * unitScale) : (0.05);
                    
                    if (bufCtx.lineWidth !== width) {
                        bufCtx.stroke(); bufCtx.beginPath();
                        bufCtx.lineWidth = width;
                        bufCtx.moveTo(currX, currY); 
                        pathBroken = false;
                    }

                    // 本段的起点：圆弧用指令里记录的上一点，直线用路径当前点
                    const isArc = (cmd.mode === 2 || cmd.mode === 3);
                    const segX0 = isArc ? cmd.prevX : currX;
                    const segY0 = isArc ? cmd.prevY : currY;

                    // --- [性能优化] 视口外裁剪：整段都在可视矩形之外就跳过绘制 ---
                    let segVisible;
                    if (isArc) {
                        // 圆弧可能向外鼓出，用「圆心 ± 半径」的包围盒判断，偏保守但安全
                        const acx = segX0 + cmd.i; const acy = segY0 + cmd.j;
                        const ar = Math.sqrt(cmd.i*cmd.i + cmd.j*cmd.j);
                        segVisible = rectVisible(acx - ar, acy - ar, acx + ar, acy + ar, cullPadAp);
                    } else {
                        segVisible = rectVisible(Math.min(segX0, cmd.x), Math.min(segY0, cmd.y),
                                                 Math.max(segX0, cmd.x), Math.max(segY0, cmd.y), cullPadAp);
                    }
                    if (!segVisible) {
                        currX = cmd.x; currY = cmd.y;
                        pathBroken = true;   // 路径在这里断开，下一段要先 moveTo 重新起笔
                        continue;
                    }
                    // 上一段被裁掉过，本段必须重新起笔，否则会被 Canvas 连出一条长直线
                    if (pathBroken) { bufCtx.moveTo(segX0, segY0); pathBroken = false; }

                    if (isArc) { 
                        const cx = cmd.prevX + cmd.i; const cy = cmd.prevY + cmd.j;
                        const radius = Math.sqrt(cmd.i*cmd.i + cmd.j*cmd.j);
                        // 【整圆修复】Gerber 用「起点 = 终点」的 G02/G03 表达 360° 圆弧
                        // （嘉立创EDA标准版把 CIRCLE 图元导出成这种整圆弧）。此时起止角相同，
                        // arc(cx,cy,r,sa,ea) 的扫掠角为 0，Canvas 会画出空路径 —— 整圆因此
                        // 「凭空消失」。这里必须先 moveTo 到圆周上的点，再显式画 0~2π。
                        const isFullCircle = radius > 1e-9
                            && Math.abs(cmd.x - cmd.prevX) < 1e-6
                            && Math.abs(cmd.y - cmd.prevY) < 1e-6;
                        if (isFullCircle) {
                            bufCtx.moveTo(cx + radius, cy);
                            bufCtx.arc(cx, cy, radius, 0, Math.PI * 2, cmd.mode === 2);
                        } else {
                            const sa = Math.atan2(cmd.prevY - cy, cmd.prevX - cx);
                            const ea = Math.atan2(cmd.y - cy, cmd.x - cx);
                            bufCtx.arc(cx, cy, radius, sa, ea, cmd.mode === 2);
                        }
                    } else {
                        bufCtx.lineTo(cmd.x, cmd.y);
                    }
                    currX = cmd.x; currY = cmd.y;
                } else if (cmd.type === 3) { // Flash (D03)
                    bufCtx.stroke(); bufCtx.beginPath();
                    const ap = apertures[cmd.ap];
                    // --- [性能优化] 视口外裁剪（用本图层最大光圈尺寸作余量，偏保守） ---
                    if (!rectVisible(cmd.x - cullPadAp, cmd.y - cullPadAp,
                                     cmd.x + cullPadAp, cmd.y + cullPadAp, 0)) {
                        pathBroken = true;
                        continue;
                    }
                    const safeAp = ap || { type:'C', params:[0.2] }; 
                    
                    // 【修改注意】: 这里不要直接转大写，因为宏名称是区分大小写的
                    const rawType = safeAp.type; 
                    const type = rawType.toUpperCase(); 
                    // 光圈参数仍是「文件单位」，必须换算成 mm。
                    // 坐标在解析阶段已经换算过，只有光圈尺寸没有 —— 英寸文件以前
                    // 会按英寸当 mm 画，走线/焊盘细 25.4 倍，看起来就是"渲染错误"。
                    const rawParams = safeAp.params || [];
                    // 钻孔刀具直径在解析时已换算成 mm，图形光圈参数还是文件单位
                    const up = (!file.data.isDrill && file.data.units === 'in') ? 25.4 : 1;
                    let p = _apParamsCache.get(cmd.ap);
                    if (!p) {
                        p = rawParams.map(v => (typeof v === 'number' && isFinite(v)) ? v * up : v);
                        _apParamsCache.set(cmd.ap, p);
                    }

                    // 获取宏定义 (注意 file.data.macros 是第一步 parse 返回的)
                    const macros = file.data.macros || {}; 

                    bufCtx.save();
                    bufCtx.translate(cmd.x, cmd.y);
                    
                    // 【新增】优先检查宏：支持 P-CAD / 嘉立创 / EasyEDA Pro 的参数化宏（含 $n 变量）
                    let macroDrew = false;
                    // 宏求值要用「文件单位」的参数，宏基元随后再统一乘 up
                    // 缓存键用 cmd.ap（同一个光圈定义 = 同一套参数），不能只用宏名 ——
                    // 同名宏被不同 %ADD 用不同参数实例化时，轮廓是不一样的。
                    let macroShape = _macroShapeCache.get(cmd.ap);
                    if (macroShape === undefined) {
                        macroShape = macros[rawType] ? resolveApertureMacro(macros[rawType], rawParams) : null;
                        _macroShapeCache.set(cmd.ap, macroShape || null);
                    }
                    if (macroShape) {
                        const uScale = up;
                        bufCtx.beginPath();
                        if (macroShape.type === 'POLYGON' && macroShape.points && macroShape.points.length) {
                            bufCtx.moveTo(macroShape.points[0].x * uScale, macroShape.points[0].y * uScale);
                            for (let k = 1; k < macroShape.points.length; k++) {
                                bufCtx.lineTo(macroShape.points[k].x * uScale, macroShape.points[k].y * uScale);
                            }
                            bufCtx.closePath();
                            macroDrew = true;
                        } else {
                            // 缓存键：同一光圈（类型 + 参数）的布尔轮廓只需算一次
                            const ops = macroPrimsToPath(macroShape, 0, 0, uScale,
                                rawType + '|' + (rawParams || []).join(','));
                            ops.forEach(op => {
                                if (op.cmd === 'M') bufCtx.moveTo(op.x, op.y);
                                else if (op.cmd === 'L') bufCtx.lineTo(op.x, op.y);
                                else if (op.cmd === 'A') {
                                    const mcX = op.startX + op.i; const mcY = op.startY + op.j;
                                    const mr = Math.sqrt(op.i * op.i + op.j * op.j);
                                    bufCtx.arc(mcX, mcY, mr,
                                        Math.atan2(op.startY - mcY, op.startX - mcX),
                                        Math.atan2(op.y - mcY, op.x - mcX), op.mode === 2);
                                }
                            });
                            macroDrew = ops.length > 0;
                        }
                        // 轮廓已由 macroPrimsToPath 做过布尔运算（暗并集 − 清差集），
                        // 各环互不重叠，evenodd 与 nonzero 等价；这里保留 evenodd。
                        if (macroDrew) bufCtx.fill('evenodd');
                    }
                    
                    // --- 形状绘制逻辑 (包含对 EasyEDA Pro 宏形状的支持) ---
                    
                    if (macroDrew) {
                        // 已经按宏画过，跳过标准形状分支，避免二次叠加错误图形
                    }
                    else if (type === 'RECT' || (type === 'R' && p.length >= 2)) {
                        // 标准矩形
                        if (p.length >= 3 && p[2]) bufCtx.rotate(p[2] * Math.PI / 180); // 仅在有旋转参数时旋转
                        bufCtx.fillRect(-p[0]/2, -p[1]/2, p[0], p[1]);
                    }
                    // --- EasyEDA Pro Drill Symbols (宏映射) ---
                    else if (type.includes('ICON')) {
                        const size = 0.5; // 默认图标大小
                        const hs = size/2;
                        
                        if (type.includes('RECT')) {
                            // IconRect, IconRect2
                            bufCtx.fillRect(-hs, -hs, size, size);
                        } else if (type.includes('TRIANGLE')) {
                            // IconTriangle
                            bufCtx.beginPath();
                            bufCtx.moveTo(0, hs);
                            bufCtx.lineTo(hs, -hs);
                            bufCtx.lineTo(-hs, -hs);
                            bufCtx.closePath();
                            bufCtx.fill();
                        } else if (type.includes('DIAMOND')) {
                            // IconDiamond
                            bufCtx.beginPath();
                            bufCtx.moveTo(0, hs);
                            bufCtx.lineTo(hs, 0);
                            bufCtx.lineTo(0, -hs);
                            bufCtx.lineTo(-hs, 0);
                            bufCtx.closePath();
                            bufCtx.fill();
                        } else if (type.includes('PLUS')) {
                            // IconPlus
                            bufCtx.lineWidth = size * 0.2;
                            bufCtx.moveTo(0, -hs); bufCtx.lineTo(0, hs);
                            bufCtx.moveTo(-hs, 0); bufCtx.lineTo(hs, 0);
                            bufCtx.stroke();
                        } else if (type.includes('X')) {
                            // IconX
                            bufCtx.lineWidth = size * 0.2;
                            bufCtx.moveTo(-hs, -hs); bufCtx.lineTo(hs, hs);
                            bufCtx.moveTo(hs, -hs); bufCtx.lineTo(-hs, hs);
                            bufCtx.stroke();
                        } else if (type.includes('STAR')) {
                            // IconStar4, IconStar6 (简化为 *)
                            bufCtx.lineWidth = size * 0.15;
                            bufCtx.moveTo(0, -hs); bufCtx.lineTo(0, hs);
                            bufCtx.moveTo(-hs*0.86, -hs*0.5); bufCtx.lineTo(hs*0.86, hs*0.5);
                            bufCtx.moveTo(hs*0.86, -hs*0.5); bufCtx.lineTo(-hs*0.86, hs*0.5);
                            bufCtx.stroke();
                        } else {
                            // 未知 Icon，画个圈代替
                            bufCtx.arc(0, 0, hs, 0, Math.PI*2); bufCtx.fill();
                        }
                    }
                    // --- 标准形状 ---
                    else if (type === 'ROUNDRECT' && p.length >= 5) {
                        const dia = p[0]; const rad = dia/2;
                        const dx = p[3]-p[1]; const dy = p[4]-p[2];
                        const side1 = Math.sqrt(dx*dx + dy*dy);
                        const side2 = Math.sqrt(Math.pow(-p[1]-p[3],2) + Math.pow(-p[2]-p[4],2));
                        const rot = Math.atan2(dy, dx);
                        bufCtx.rotate(rot);
                        bufCtx.beginPath();
                        if(bufCtx.roundRect) bufCtx.roundRect(-(side1+dia)/2, -(side2+dia)/2, side1+dia, side2+dia, rad);
                        else bufCtx.rect(-(side1+dia)/2, -(side2+dia)/2, side1+dia, side2+dia);
                        bufCtx.fill();
                    }
                    else if (type === 'OVAL' && p.length === 5) {
                        bufCtx.lineCap = 'round'; bufCtx.lineWidth = p[0];
                        bufCtx.beginPath(); bufCtx.moveTo(p[1], p[2]); bufCtx.lineTo(p[3], p[4]); bufCtx.stroke();
                    }
                    else if (type === 'C') { 
                        // Circle
                        const dia = p[0];
                        bufCtx.beginPath(); bufCtx.arc(0, 0, dia/2, 0, Math.PI*2); bufCtx.fill();
                        
                        // 兼容处理：如果 C 后面跟了两个参数 (例如 EasyEDA Pro 的 0.44X0.37)，
                        // 虽然这不符合标准 Gerber C 的定义，但为了避免空白，我们忽略第二个参数或将其视为孔。
                        // 标准逻辑是：param[1] 是孔径。
                        if (p.length > 1 && p[1] > 0) {
                             bufCtx.globalCompositeOperation = "destination-out";
                             bufCtx.beginPath(); bufCtx.arc(0,0,p[1]/2, 0, Math.PI*2); bufCtx.fill();
                             // 恢复
                             bufCtx.globalCompositeOperation = cmd.polarity === 'C' ? 'destination-out' : 'source-over';
                        }
                    } 
                    else if (type === 'O') { // Obround
                        const w=p[0]; const h=p[1]; const r=Math.min(w,h)/2;
                        bufCtx.beginPath();
                        if(bufCtx.roundRect) bufCtx.roundRect(-w/2, -h/2, w, h, r); else bufCtx.rect(-w/2, -h/2, w, h);
                        bufCtx.fill();
                        if (p.length > 2 && p[2] > 0) { // Hole
                             bufCtx.globalCompositeOperation = "destination-out";
                             bufCtx.beginPath(); bufCtx.arc(0,0,p[2]/2, 0, Math.PI*2); bufCtx.fill();
                             bufCtx.globalCompositeOperation = cmd.polarity === 'C' ? 'destination-out' : 'source-over';
                        }
                    }
                    
                    bufCtx.restore();
                    bufCtx.beginPath(); bufCtx.moveTo(cmd.x, cmd.y); currX = cmd.x; currY = cmd.y;

                } else if (cmd.type === 4) { // Region
                    bufCtx.stroke(); bufCtx.beginPath(); 
                    // 防御：G37 区域必须带 path。历史缺陷里 D04~D09 会生成无 path 的 type:4，
                    // 直接读 cmd.path.length 会抛异常并让整个导入中断。
                    if (!Array.isArray(cmd.path) || cmd.path.length === 0) { continue; }
                    // --- [性能优化] 视口外裁剪：先求该区域的包围盒 ---
                    let rMinX = Infinity; let rMinY = Infinity; let rMaxX = -Infinity; let rMaxY = -Infinity;
                    for (let q = 0; q < cmd.path.length; q++) {
                        const oq = cmd.path[q];
                        if (oq.x < rMinX) rMinX = oq.x;
                        if (oq.x > rMaxX) rMaxX = oq.x;
                        if (oq.y < rMinY) rMinY = oq.y;
                        if (oq.y > rMaxY) rMaxY = oq.y;
                    }
                    if (cmd.path.length > 0 && !rectVisible(rMinX, rMinY, rMaxX, rMaxY, cullPadAp)) {
                        const lastOp = cmd.path[cmd.path.length - 1];
                        currX = lastOp.x; currY = lastOp.y;
                        pathBroken = true;
                        continue;
                    }
                    cmd.path.forEach(op => {
                        if (op.cmd === 'M') bufCtx.moveTo(op.x, op.y);
                        else if (op.cmd === 'L') bufCtx.lineTo(op.x, op.y);
                        else if (op.cmd === 'A') {
                            const cx = op.startX + op.i; const cy = op.startY + op.j;
                            const r = Math.sqrt(op.i*op.i + op.j*op.j);
                            // 同 type 1 的整圆修复：区域内也可能出现「起点=终点」的整圆弧
                            const fullArc = r > 1e-9
                                && Math.abs(op.x - op.startX) < 1e-6
                                && Math.abs(op.y - op.startY) < 1e-6;
                            if (fullArc) {
                                bufCtx.moveTo(cx + r, cy);
                                bufCtx.arc(cx, cy, r, 0, Math.PI * 2, op.mode === 2);
                            } else {
                                const sa = Math.atan2(op.startY - cy, op.startX - cx);
                                const ea = Math.atan2(op.y - cy, op.x - cx);
                                bufCtx.arc(cx, cy, r, sa, ea, op.mode === 2);
                            }
                        }
                    });
                    bufCtx.closePath(); bufCtx.fill('evenodd'); 
                    bufCtx.beginPath(); 
                    if (cmd.path.length > 0) {
                        const last = cmd.path[cmd.path.length-1];
                        currX = last.x; currY = last.y;
                        bufCtx.moveTo(currX, currY); 
                    }
                } else if (cmd.type === 6) { // 槽孔 (Slot) 绘制逻辑
                    bufCtx.stroke(); bufCtx.beginPath();
                    
                    const ap = apertures[cmd.ap];
                    // 获取钻刀直径
                    const dia = (ap && ap.params && ap.params[0]) ? ap.params[0] : 0.1;
                    
                    // 设置绘制样式：线宽=直径，线端=圆头
                    bufCtx.lineWidth = dia;
                    bufCtx.lineCap = 'round';
                    bufCtx.lineJoin = 'round';
                    
                    // 绘制直线（因为线宽和线端样式的存在，会自动变成两头圆的槽）
                    bufCtx.moveTo(cmd.startX, cmd.startY);
                    bufCtx.lineTo(cmd.x, cmd.y);
                    
                    bufCtx.stroke();
                    
                    // 重置，防止影响后续绘图
                    bufCtx.beginPath();
                    currX = cmd.x; currY = cmd.y;
                }
            }
            bufCtx.stroke();
            bufCtx.restore();

            // C. 合成 (注意 drawImage 时因为 ctx 已经 scale 了 dpr，
            // 而 bufferCanvas 本身是 dpr 倍大的，所以绘制尺寸要除以 dpr 或者调整 drawImage 参数)
            //
            // 【只拷贝内容所在的矩形】把「世界包围盒 ∩ 视口」换算成设备像素后取整，
            // 源矩形与目标矩形都落在整数设备像素上（dest = device/dpr，ctx 已按 dpr 缩放），
            // 因此是 1:1 拷贝，不会引入任何重采样模糊。
            // 与 C 段合成共用：内容矩形要留足余量 —— 光圈「最大参数」只是尺寸量级，
            // 长圆（O 型带 5 个参数）、宏基元、旋转矩形都可能把图形画到参数值之外，
            // 余量给 3 倍 + 2px 才能保证这条矩形一定是「实际绘制内容」的超集。
            const _pad = cullPadAp * 3 + 2 / (viewState.scale || 1);
            let sx = Math.floor((viewState.offsetX + viewState.scale * (bMinX - _pad)) * dpr);
            let sy = Math.floor((viewState.offsetY - viewState.scale * (bMaxY + _pad)) * dpr);
            let ex = Math.ceil((viewState.offsetX + viewState.scale * (bMaxX + _pad)) * dpr);
            let ey = Math.ceil((viewState.offsetY - viewState.scale * (bMinY - _pad)) * dpr);
            if (sx < 0) sx = 0;
            if (sy < 0) sy = 0;
            if (ex > bufferCanvas.width) ex = bufferCanvas.width;
            if (ey > bufferCanvas.height) ey = bufferCanvas.height;
            if (ex <= sx || ey <= sy) return;   // 内容全在画布外
            const sw = ex - sx, sh = ey - sy;

            ctx.save();
            // ctx.globalAlpha = def.alpha;
			// ctx.globalAlpha = forceNoDpr ? 1.0 : def.alpha;
			ctx.globalAlpha = forceSolid ? 1.0 : def.alpha;
            // 关键：因为 ctx 已经 scale(dpr, dpr)，这里绘制逻辑尺寸即可
            // bufferCanvas 是物理像素尺寸，drawImage 会自动映射
            ctx.drawImage(bufferCanvas, sx, sy, sw, sh, sx / dpr, sy / dpr, sw / dpr, sh / dpr);
            ctx.restore();
            // 记下这块矩形：下一层只需要清掉这一块，不必全屏 clearRect
            lastBufRect = { x: sx, y: sy, w: sw, h: sh };
        });
        // 飞针标注叠加（引脚编号 / 网络名称 / 元件位号）：只在交互画布上画，PDF 导出保持干净
        if (!forceNoDpr) drawFlyingOverlays(dpr);
        // 仅在非导出模式下绘制标尺
        if (!forceNoDpr) drawRulers();
        // 与函数开头的 ctx.save() 配对：不 restore 会每帧泄漏一个 save 状态
        ctx.restore();
        if (!forceNoDpr) captureSnapshot();
    }

    /** 把当前画布内容存成「上一帧快照」，供交互期快速贴图 */
    function captureSnapshot() {
        if (!mainCanvas.width || !mainCanvas.height) return;
        if (snapCanvas.width !== mainCanvas.width || snapCanvas.height !== mainCanvas.height) {
            snapCanvas.width = mainCanvas.width;
            snapCanvas.height = mainCanvas.height;
        }
        const dpr = window.devicePixelRatio || 1;
        snapCtx.setTransform(1, 0, 0, 1, 0, 0);
        snapCtx.clearRect(0, 0, snapCanvas.width, snapCanvas.height);
        snapCtx.drawImage(mainCanvas, 0, 0);
        snapInfo = {
            offsetX: viewState.offsetX, offsetY: viewState.offsetY,
            scale: viewState.scale,
            w: mainCanvas.width / dpr, h: mainCanvas.height / dpr
        };
        snapValid = true;
    }

    /**
     * 用快照贴出当前视图（缩放/平移中）。
     * 世界点 p 在快照里的屏幕位置 = snapOffset + snapScale·p，
     * 现在要画在 offset + scale·p → 整幅图按 k = scale/snapScale 缩放、
     * 平移 (offset - k·snapOffset) 即可。
     * @returns {boolean} 是否成功贴图（false 时调用方回退到完整渲染）
     */
    function paintFromSnapshot() {
        const k = viewState.scale / (snapInfo.scale || 1);
        if (!isFinite(k) || k <= 0) return false;
        const dpr = window.devicePixelRatio || 1;
        const w = mainCanvas.width / dpr, h = mainCanvas.height / dpr;
        const sx = viewState.offsetX - snapInfo.offsetX * k;
        const sy = viewState.offsetY - snapInfo.offsetY * k;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(snapCanvas, 0, 0, snapCanvas.width, snapCanvas.height,
            sx, sy, snapInfo.w * k, snapInfo.h * k);
        ctx.restore();
        return true;
    }

    /**
     * 标记「正在交互」：交互期间走快照路径，停止 150ms 后补一次完整渲染。
     * 缩放/拖拽的每一帧都调用它（滚轮、中键拖动都接）。
     */
    window.notifyViewInteraction = () => {
        viewInteracting = true;
        if (snapIdleTimer) clearTimeout(snapIdleTimer);
        snapIdleTimer = setTimeout(() => {
            viewInteracting = false;
            requestDraw();
        }, 150);
    };

    /**
     * 构建飞针标注数据（引脚编号 / 网络名称 / 元件位号）。
     * extractRawData + consolidate 开销不小，而 drawCanvas 会跟着平移缩放高频调用，
     * 所以结果缓存到 flyingLabelCache：只有导入 / 重载参数（processRawFiles）时才置空重建。
     */
    function ensureFlyingLabels() {
        if (flyingLabelCache !== null) return flyingLabelCache;
        flyingLabelCache = { pads: [], comps: [], stiffeners: [] };
        if (!loadedFiles || loadedFiles.length === 0) return flyingLabelCache;

        // extractRawData 在大板上开销不小，而补强与飞针都要用同一份数据 → 只取一次
        let rawCache = null;
        const getRaw = () => {
            if (!rawCache) rawCache = PadTool.extractRawData(loadedFiles.slice());
            return rawCache;
        };

        // ① FPC 补强标注：材料 + 厚度，与飞针无关，只要有补强填充就构建。
        //    位置取补强区域的包围盒中心，尺寸用于字号自适应（与焊盘标注同一套 fitFont 规则）。
        try {
            (getRaw().rawFills || []).forEach(f => {
                if ((f.layerId !== 58 && f.layerId !== 59) || !f.stiffener) return;
                let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
                (f.path || []).forEach(op => {
                    if (typeof op.x !== 'number' || !isFinite(op.x)) return;
                    if (typeof op.y !== 'number' || !isFinite(op.y)) return;
                    if (op.x < x0) x0 = op.x; if (op.x > x1) x1 = op.x;
                    if (op.y < y0) y0 = op.y; if (op.y > y1) y1 = op.y;
                });
                if (!isFinite(x0) || !(x1 > x0) || !(y1 > y0)) return;
                flyingLabelCache.stiffeners.push({
                    x: (x0 + x1) / 2, y: (y0 + y1) / 2,
                    bw: x1 - x0, bh: y1 - y0,
                    material: f.stiffener.material,
                    thickness: f.stiffener.thickness
                });
            });
        } catch (e) { console.error('补强标注构建失败:', e); }

        // ② 飞针标注：没有飞针文件时到此为止（补强标注已经构建好了）
        if (typeof flyingProbeData === 'undefined' || !flyingProbeData) return flyingLabelCache;

        const index = buildFlyingPinIndex(flyingProbeData);
        // 孤立焊盘的占位名（PAD / PAD1 / PAD23…）不作为位号显示
        flyingLabelCache.comps = index.comps.filter(c => !c.isPadOnly).map(c => ({ x: c.x, y: c.y, ref: c.ref }));
        if (!index.pins.length) return flyingLabelCache;

        try {
            // 用全部已加载文件（不按勾选过滤）：标注层的显隐应独立于铜层勾选状态
            const rd = getRaw();
            const uni = PadTool.consolidate(
                rd.rawPads || [], rd.rawVias || [], rd.rawTracks || [],
                rd.rawPolys || [], rd.rawFills || [], rd.drills || [],
                rd.rawImages || [], rd.rawTextLines || [], rd.rawCoppers || []
            );
            (uni.unifiedPads || []).forEach(pad => {
                const prim = pad.top || pad.bottom || pad.innerRep || (pad.inners && pad.inners[0]);
                const box = padMatchBoxMM(prim);
                const pin = flyingPinAt(index, pad.x, pad.y, box);
                if (!pin) return;
                // 记录焊盘包围盒尺寸（mm）：文字大小要以它为上限，超出就换行/隐藏
                let bw = box ? (box.x1 - box.x0) : ((prim && prim.w) || 0);
                let bh = box ? (box.y1 - box.y0) : ((prim && prim.h) || 0);
                flyingLabelCache.pads.push({
                    x: pad.x, y: pad.y, num: pin.num, net: pin.net, comp: pin.comp,
                    bw: isFinite(bw) ? bw : 0, bh: isFinite(bh) ? bh : 0,
                    isPadOnly: !!pin.isPadOnly
                });
            });
        } catch (e) { console.error('飞针标注构建失败:', e); }
        return flyingLabelCache;
    }

    /**
     * 在画布上叠加飞针标注文字。
     * 注意：画布的世界坐标被 ctx.scale(s, -s) 上下翻转了，直接在世界坐标里 fillText 会镜像，
     * 所以这里用 setTransform 回到「只有 HiDPI 缩放」的状态，用屏幕像素坐标写字。
     *
     * 字号规则：
     *   · 引脚编号 / 网络名称 —— 文字必须完整落在**焊盘包围盒**内：两行排布（编号在上、网络名在下）
     *     各占半高；只要有一行放不下就退化为「单行只显示编号」；编号也放不下则整块隐藏。
     *   · 元件位号 —— 固定字高 FLYING_REFDES_CANVAS_MIL（16 mil），按世界尺寸随缩放变化。
     * 所有文字都不描边（先前为了压住底层图形加了黑色描边，视觉发糊且不符合要求）。
     */
    function drawFlyingOverlays(dpr) {
        const showNum = !!flyingOverlayVisible[FLYING_LAYER.PAD_NUMBER];
        const showNet = !!flyingOverlayVisible[FLYING_LAYER.NET_NAME];
        const showRef = !!flyingOverlayVisible[FLYING_LAYER.REFDES];
        const showStiff = !!flyingOverlayVisible[FLYING_LAYER.STIFFENER];
        if (!showNum && !showNet && !showRef && !showStiff) return;

        const labels = ensureFlyingLabels();
        const wantPad = (showNum || showNet) && labels.pads.length > 0;
        const wantRef = showRef && labels.comps.length > 0;
        const wantStiff = showStiff && labels.stiffeners.length > 0;
        if (!wantPad && !wantRef && !wantStiff) return;

        const s = viewState.scale || 1;
        const cssW = mainCanvas.width / dpr; const cssH = mainCanvas.height / dpr;
        const numCol = (layerDefs[FLYING_LAYER.PAD_NUMBER] || {}).color || '#ff5555';
        const netCol = (layerDefs[FLYING_LAYER.NET_NAME] || {}).color || '#33e0ff';
        const refCol = (layerDefs[FLYING_LAYER.REFDES] || {}).color || '#ff44dd';
        const stiffCol = (layerDefs[FLYING_LAYER.STIFFENER] || {}).color || '#193366';

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 只保留屏幕 DPR，坐标=CSS 像素
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 世界坐标 → 屏幕像素；返回 null 表示在视口外
        const project = (wx, wy, margin) => {
            const px = viewState.offsetX + wx * s;
            const py = viewState.offsetY - wy * s;
            const m = margin || 40;
            if (px < -m || py < -m || px > cssW + m || py > cssH + m) return null;
            return { x: px, y: py };
        };
        const setFont = (px) => { ctx.font = px + 'px Consolas, "Courier New", monospace'; };
        /** 在 maxW × maxH 的像素框内，text 能用的最大字号（0 = 放不下） */
        const fitFont = (text, maxW, maxH, maxFont) => {
            if (maxW <= 1 || maxH <= 1) return 0;
            const probe = 10;
            setFont(probe);
            const w = ctx.measureText(text).width;
            if (!(w > 0)) return 0;
            const cap = (maxFont > 0) ? maxFont : FLYING_LABEL_MAX_FONT;
            return Math.min(probe * maxW / w, maxH, cap);
        };

        if (wantPad) {
            labels.pads.forEach(p => {
                const pt = project(p.x, p.y, 0);
                if (!pt) return;
                // 焊盘包围盒（屏幕像素），左右各留 1px 边距，避免文字压到焊盘边缘外
                const boxW = (p.bw || 0) * s - 2;
                const boxH = (p.bh || 0) * s - 2;
                if (boxW <= 1 || boxH <= 1) return;   // 焊盘太小，连编号都放不下 → 隐藏
                // 占用位焊盘的占位名（PAD / PAD1…）不作为引脚编号显示
                const numTxt = (showNum && p.num && !p.isPadOnly && !isFlyingPadPlaceholder(p.num)) ? String(p.num) : '';
                const netTxt = (showNet && p.net) ? String(p.net) : '';
                // ① 两行：编号在上、网络名在下，各占半高
                if (numTxt && netTxt) {
                    const fNum = fitFont(numTxt, boxW, boxH / 2);
                    const fNet = fitFont(netTxt, boxW, boxH / 2);
                    if (fNum >= FLYING_LABEL_MIN_FONT && fNet >= FLYING_LABEL_MIN_FONT) {
                        const half = boxH / 4;
                        setFont(fNum); ctx.fillStyle = numCol; ctx.fillText(numTxt, pt.x, pt.y - half);
                        setFont(fNet); ctx.fillStyle = netCol; ctx.fillText(netTxt, pt.x, pt.y + half);
                        return;
                    }
                }
                // ② 单行：优先编号，占满整个焊盘框；编号放不下才轮到网络名
                if (numTxt) {
                    const f = fitFont(numTxt, boxW, boxH);
                    if (f >= FLYING_LABEL_MIN_FONT) {
                        setFont(f); ctx.fillStyle = numCol; ctx.fillText(numTxt, pt.x, pt.y);
                        return;
                    }
                }
                if (netTxt) {
                    const f = fitFont(netTxt, boxW, boxH);
                    if (f >= FLYING_LABEL_MIN_FONT) {
                        setFont(f); ctx.fillStyle = netCol; ctx.fillText(netTxt, pt.x, pt.y);
                    }
                }
            });
        }

        if (wantRef) {
            const fpx = Math.max(6, FLYING_REFDES_CANVAS_MIL * 0.0254 * s);   // 16 mil 字高，随缩放
            setFont(fpx);
            ctx.fillStyle = refCol;
            labels.comps.forEach(c => {
                const pt = project(c.x, c.y, 60);
                if (pt) ctx.fillText(String(c.ref), pt.x, pt.y);
            });
        }

        // FPC 补强：材料名在上、厚度在下，与「引脚编号 / 网络名称」完全同一套排布与字号规则
        if (wantStiff) {
            labels.stiffeners.forEach(st => {
                const pt = project(st.x, st.y, 60);
                if (!pt) return;
                const boxW = (st.bw || 0) * s - 2;
                const boxH = (st.bh || 0) * s - 2;
                if (boxW <= 1 || boxH <= 1) return;      // 补强区域太小 → 不显示

                const nameTxt = STIFFENER_LABEL[st.material] || st.material || '';
                const thTxt = (st.thickness !== null && st.thickness !== undefined && isFinite(st.thickness))
                    ? String(st.thickness) + 'mm' : '';

                // ① 两行：材料在上、厚度在下，各占半高
                if (nameTxt && thTxt) {
                    const fName = fitFont(nameTxt, boxW, boxH / 2, FLYING_STIFFENER_MAX_FONT);
                    const fTh = fitFont(thTxt, boxW, boxH / 2, FLYING_STIFFENER_MAX_FONT);
                    if (fName >= FLYING_LABEL_MIN_FONT && fTh >= FLYING_LABEL_MIN_FONT) {
                        // 行距默认 boxH/4（与引脚标注同一套），但不超过 0.72 倍字号 ——
                        // 否则高瘦补强（例如 4×10mm 的竖条）两行会被拉开近半屏，
                        // 看着像两个互不相干的标签。
                        const half = Math.min(boxH / 4, Math.max(fName, fTh) * 0.72);
                        setFont(fName); ctx.fillStyle = stiffCol; ctx.fillText(nameTxt, pt.x, pt.y - half);
                        setFont(fTh); ctx.fillStyle = stiffCol; ctx.fillText(thTxt, pt.x, pt.y + half);
                        return;
                    }
                }
                // ② 单行兜底：优先材料名，放不下才轮到厚度
                const single = nameTxt || thTxt;
                if (!single) return;
                const f = fitFont(single, boxW, boxH, FLYING_STIFFENER_MAX_FONT);
                if (f >= FLYING_LABEL_MIN_FONT) {
                    setFont(f); ctx.fillStyle = stiffCol; ctx.fillText(single, pt.x, pt.y);
                }
            });
        }
        ctx.restore();
    }

    function resizeCanvas() {
        const c = document.getElementById('canvas-container');
        const dpr = window.devicePixelRatio || 1;
        
        // 1. 设置物理像素 (用于清晰度)
        mainCanvas.width = c.clientWidth * dpr;
        mainCanvas.height = c.clientHeight * dpr;
        
        rulerH.width = c.clientWidth * dpr;
        rulerH.height = 20 * dpr; // 标尺高度固定
        rulerV.width = 20 * dpr;
        rulerV.height = c.clientHeight * dpr;
        
        bufferCanvas.width = mainCanvas.width;
        bufferCanvas.height = mainCanvas.height;
        lastBufRect = null;   // 改尺寸会把 buffer 内容清空，脏矩形记录同步失效

        // 2. 设置 CSS 尺寸 (用于布局)
        mainCanvas.style.width = c.clientWidth + 'px';
        mainCanvas.style.height = c.clientHeight + 'px';
        rulerH.style.width = c.clientWidth + 'px';
        rulerH.style.height = '20px';
        rulerV.style.width = '20px';
        rulerV.style.height = c.clientHeight + 'px';

        // 3. 规范化坐标系：所有绘图操作依然使用 CSS 像素逻辑，Scale 自动处理 HiDPI
        ctx.scale(dpr, dpr);
        ctxH.scale(dpr, dpr);
        ctxV.scale(dpr, dpr);
        // buffer 不需要 scale，因为它是在内部 transform 处理的，或者也统一 scale

        requestDraw(); // 触发重绘
    }

    /**
     * 监听 devicePixelRatio 变化。
     * 把窗口拖到「不同缩放比例」的显示器上时，dpr 会变，但并不一定触发 resize 事件；
     * 不重算画布就会出现「图形按旧 dpr、文字按新 dpr」的错位（同样表现为图形与文字不一致）。
     * matchMedia 的 resolution 查询只匹配挂载时的 dpr，所以每次变化后要重新挂一次。
     */
    function watchDprChanges() {
        if (!window.matchMedia) return;
        const dpr = window.devicePixelRatio || 1;
        const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
        const onChange = () => {
            try { resizeCanvas(); drawCanvas(); } catch (e) { /* 忽略：下一帧会重绘 */ }
            watchDprChanges();
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
        else if (mq.addListener) mq.addListener(onChange);
    }


    // switchTab, setUnitUI (简单的 UI 响应)。
    // --- UI 切换逻辑 (新增) ---
    function switchTab(tabId, btnElement) {
        // 1. 切换 Tab 样式
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        btnElement.classList.add('active');

        // 2. 切换内容显示
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
    }

    // --- UI 控件适配逻辑 (适配新界面) ---
    function setUnitUI(val, type) {
        // 用户手动点选单位时置位：只有手动改过，解析器才会忽略文件自带的单位声明
        if (!window.__autoDetecting) window.manualUnitOverride = true;
        // 视觉切换
        const group = document.getElementById(`ui-units-group-${type}`);
        if (group) {
            group.querySelectorAll('.seg-btn').forEach(btn => {
                if(btn.dataset.val === val) btn.classList.add('active');
                else btn.classList.remove('active');
            });
        }

        // 逻辑映射
        if (type === 'graphic') {
            document.getElementById('cfg-units').value = val;
        } 
        // --- 【新增】钻孔单位逻辑 ---
        else if (type === 'drill') {
            document.getElementById('cfg-d-units').value = val;
        }
    }



    // --- 排序与索引重置辅助函数 ---
    function sortLoadedFiles() {
        // 1. 创建优先级映射表
        const idPriority = {};
        let pCounter = 0;
        uiGroups.forEach(g => g.ids.forEach(id => idPriority[id] = pCounter++));
        
        // 2. 根据图层ID的优先级进行排序
        loadedFiles.sort((a,b) => {
            const pa = idPriority[a.layerId] !== undefined ? idPriority[a.layerId] : 9999;
            const pb = idPriority[b.layerId] !== undefined ? idPriority[b.layerId] : 9999;
            return pa - pb;
        });
        
        // 3. 关键修复：重新分配索引 (index)
        loadedFiles.forEach((f, i) => f.index = i);
    }

    // --- [新增] 更新板子属性统计 ---
    function updateBoardStats() {
        // 1. 层数 (直接读取设置)
        const layerEl = document.getElementById('cfg-copper-layers');
        const layerCount = layerEl ? layerEl.value : 2;
        document.getElementById('prop-layers').textContent = layerCount;

        // 2. 尺寸 (基于板框层 ID 11 的包围盒)
        const outlineFile = loadedFiles.find(f => f.layerId === 11);
        const dimEl = document.getElementById('prop-dim');
        
        if (outlineFile) {
            const b = outlineFile.data.bounds;
            if (b.minX !== Infinity && b.maxX !== -Infinity) {
                const w = (b.maxX - b.minX).toFixed(3);
                const h = (b.maxY - b.minY).toFixed(3);
                dimEl.textContent = `${w} x ${h} mm`;
            } else {
                dimEl.textContent = "无法计算";
            }
        } else {
            dimEl.textContent = "未找到板框";
        }

        // 3. 钻孔统计
        let thCount = 0; // 通孔 (ID 47, 500, 501)
        let bbCount = 0; // 埋盲孔 (ID 502)

        loadedFiles.forEach(f => {
            // 统计 Flash 指令 (Type 3) 作为孔的数量
            // 注意：某些通过 G85 槽孔定义的钻孔可能在 parse 阶段被转换，这里主要统计 Flash
            const flashCount = f.data.commands.filter(c => c.type === 3).length;

            if (f.layerId === 47 || f.layerId === 500 || f.layerId === 501) {
                thCount += flashCount;
            } else if (f.layerId === 502) {
                bbCount += flashCount;
            }
        });

        document.getElementById('prop-th').textContent = thCount;
        
        const bbRow = document.getElementById('row-prop-bb');
        const bbEl = document.getElementById('prop-bb');
        
        if (bbCount > 0) {
            bbEl.textContent = bbCount;
            bbRow.style.display = 'flex';
        } else {
            bbRow.style.display = 'none';
        }

        // 4. 软件名称 / 导出时间（从导入文件的头部注释解析）
        //    软件名称读不到 → 隐藏该行；导出时间读不到 → 回退用文件时间的最小值。
        const src = (typeof detectEasyEdaSource === 'function') ? detectEasyEdaSource() : null;
        const softRow = document.getElementById('row-prop-soft');
        const timeRow = document.getElementById('row-prop-time');
        if (softRow) {
            if (src && src.software) {
                document.getElementById('prop-soft').textContent = src.software;
                softRow.style.display = 'flex';
            } else {
                softRow.style.display = 'none';
            }
        }
        if (timeRow) {
            if (src && src.time) {
                document.getElementById('prop-time').textContent = src.time;
                timeRow.style.display = 'flex';
            } else {
                timeRow.style.display = 'none';
            }
        }
    }

    // 自动适配视图
    function autoFitView() {
        if (loadedFiles.length === 0) return;

        // 收集全部可视坐标（含区域路径点），用于按分位数做「抗离群」适配
        // ⚠️ 性能：大板有上百万个坐标点，全量 push + 两次 sort 要 0.9s（实测本板 619ms+314ms）。
        //    这里改成「先数总量、再按 stride 抽样到 ≤6 万点」——0.2% / 99.8% 分位数对
        //    抽样不敏感（离群点本来就要被裁掉），小板的 stride=1，行为与原来完全一致。
        const collectPts = (files) => {
            const xs = []; const ys = [];
            let total = 0;
            files.forEach(f => {
                if (!f.data || !Array.isArray(f.data.commands)) return;
                f.data.commands.forEach(c => {
                    total++;
                    if (Array.isArray(c.path)) total += c.path.length;
                });
            });
            const MAX_SAMPLES = 60000;
            const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
            let idx = 0;
            const visitPt = (x, y) => {
                if ((idx++ % stride) !== 0) return;
                if (typeof x === 'number' && isFinite(x)) xs.push(x);
                if (typeof y === 'number' && isFinite(y)) ys.push(y);
            };
            files.forEach(f => {
                if (!f.data || !Array.isArray(f.data.commands)) return;
                f.data.commands.forEach(c => {
                    visitPt(c.x, c.y);
                    if (Array.isArray(c.path)) c.path.forEach(o => visitPt(o.x, o.y));
                });
            });
            return { xs, ys };
        };
        const quantile = (arr, p) => {
            if (!arr.length) return NaN;
            const a = arr.slice().sort((m, n) => m - n);
            const idx = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
            return a[idx];
        };

        let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;

        // 1) 有板框层（ID 11）时以板框为主 —— 最贴近"板子的真实尺寸"
        const outline = loadedFiles.find(f => f.layerId === 11 && f.data && f.data.bounds && isFinite(f.data.bounds.minX));
        if (outline) {
            const b = outline.data.bounds;
            if ((b.maxX - b.minX) > 0.1 && (b.maxY - b.minY) > 0.1) {
                minX = b.minX; maxX = b.maxX; minY = b.minY; maxY = b.maxY;
            }
        }
        const hasBox = minX !== Infinity;
        const boxW = hasBox ? (maxX - minX) : 0;
        const boxH = hasBox ? (maxY - minY) : 0;

        // 2) 用「坐标分位数」算一个抗离群的包围盒。
        //    历史缺陷：直接对所有图层取绝对坐标并集，只要有一个离群坐标
        //    （钻孔文件从 0 开始、Gerber 里几条假 (0,0) 指令）就能把范围撑大
        //    好几倍，整块板被缩成角落里一个小点 —— 看起来就像"渲染错误"。
        const { xs, ys } = collectPts(loadedFiles);
        if (xs.length && ys.length) {
            const rx0 = quantile(xs, 0.002); const rx1 = quantile(xs, 0.998);
            const ry0 = quantile(ys, 0.002); const ry1 = quantile(ys, 0.998);
            if (!hasBox) {
                minX = rx0; maxX = rx1; minY = ry0; maxY = ry1;
            } else {
                // 有板框时以板框为准，但若其它图层明显超出板框（典型：丝印文字伸出板外），
                // 就扩展到能容纳它们，避免内容被裁掉。5% 容差用来过滤零散离群点。
                const tolW = boxW * 0.05; const tolH = boxH * 0.05;
                if (isFinite(rx0) && rx0 < minX - tolW) minX = rx0;
                if (isFinite(rx1) && rx1 > maxX + tolW) maxX = rx1;
                if (isFinite(ry0) && ry0 < minY - tolH) minY = ry0;
                if (isFinite(ry1) && ry1 > maxY + tolH) maxY = ry1;
            }
        }

        // 3) 退化保护：分位数失效（点数太少 / 全部同位）时退回真实极值
        if (!isFinite(minX) || !isFinite(maxX) || !((maxX - minX) > 0)) {
            if (!xs.length) return;
            minX = xs.reduce((m, v) => Math.min(m, v), Infinity);
            maxX = xs.reduce((m, v) => Math.max(m, v), -Infinity);
        }
        if (!isFinite(minY) || !isFinite(maxY) || !((maxY - minY) > 0)) {
            if (!ys.length) return;
            minY = ys.reduce((m, v) => Math.min(m, v), Infinity);
            maxY = ys.reduce((m, v) => Math.max(m, v), -Infinity);
        }
        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return;
        const w = maxX - minX; const h = maxY - minY;
        const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
        const cw = document.getElementById('canvas-container').clientWidth;
        const ch = document.getElementById('canvas-container').clientHeight;
        const scaleX = cw / (w * 1.2 || 100); const scaleY = ch / (h * 1.2 || 100);
        viewState.scale = Math.min(scaleX, scaleY);
        if(!isFinite(viewState.scale) || viewState.scale <= 0) viewState.scale = 10;
        viewState.offsetX = cw / 2 - cx * viewState.scale; 
        viewState.offsetY = ch / 2 + cy * viewState.scale;
    }

    // 辅助：获取图层所属的组ID
    function getGroupId(layerId) {
        let group = uiGroups.find(g => g.ids.includes(layerId));
        if (!group) group = uiGroups[4]; // 默认为自定义/其他
        return group.id;
    }

    // 辅助：更新指定组的复选框状态 (核心逻辑)
    function updateGroupCheckboxState(gid) {
        const groupCb = document.getElementById(`group-cb-${gid}`);
        if (!groupCb) return;

        // 组内成员 = 真实图层文件 + 标注虚拟层（引脚编号 / 网络名称 / 元件位号 / 补强名称）。
        // 标注层不在 loadedFiles 里，早先只统计文件 → 单独取消一个标注行时组复选框不会变半选。
        const groupFiles = loadedFiles.filter(f => getGroupId(f.layerId) === gid);
        const flyingIds = FLYING_LAYER_IDS.filter(id => getGroupId(id) === gid);
        const total = groupFiles.length + flyingIds.length;

        if (total === 0) {
            groupCb.checked = false;
            groupCb.indeterminate = false;
            return;
        }

        const visibleCount = groupFiles.filter(f => f.visible).length
            + flyingIds.filter(id => !!flyingOverlayVisible[id]).length;

        if (visibleCount === 0) {
            // 1. 全不选
            groupCb.checked = false;
            groupCb.indeterminate = false;
        } else if (visibleCount === total) {
            // 2. 全选
            groupCb.checked = true;
            groupCb.indeterminate = false;
        } else {
            // 3. 半选 (显示横线)
            groupCb.checked = false; // 这里设为false或true都可以，关键是下一行
            groupCb.indeterminate = true;
        }
    }

    // 更新颜色
    window.updateColor = (id, val) => { if(layerDefs[id]) layerDefs[id].color = val; drawCanvas(); };

    // --- [新增] 更新埋盲孔层对信息 ---
    window.updateViaPair = (idx, type, val) => {
        const file = loadedFiles[idx];
        if (!file) return;
        
        const layerVal = parseInt(val);
        if (type === 'start') {
            file.pairStart = layerVal;
        } else {
            file.pairEnd = layerVal;
        }
        console.log(`File [${file.name}] pair updated: ${file.pairStart} -> ${file.pairEnd}`);
    };

    // 切换组可见性
    window.toggleGroup = (gid, isChecked) => { 
        // 1. 更新数据状态（真实文件）
        let hasChanged = false;
        loadedFiles.forEach(f => {
            if (getGroupId(f.layerId) === gid) {
                if (f.visible !== isChecked) {
                    f.visible = isChecked;
                    hasChanged = true;
                }
            }
        });

        // 1.5 标注虚拟层（引脚编号 / 网络名称 / 元件位号 / 补强名称）也归在「自定义/特殊」组，
        //     但它们的状态在 flyingOverlayVisible 里，不在 loadedFiles —— 早先这里只遍历文件，
        //     所以勾选/取消「自定义/特殊」时引脚编号等行毫无反应（画布上也依然显示）。
        const flyingIds = (typeof FLYING_LAYER_IDS !== 'undefined' ? FLYING_LAYER_IDS : [])
            .filter(id => getGroupId(id) === gid);
        flyingIds.forEach(id => {
            if (!!flyingOverlayVisible[id] !== !!isChecked) {
                flyingOverlayVisible[id] = !!isChecked;
                hasChanged = true;
            }
        });

        // 2. 更新 DOM：同步该组下所有子项复选框（含标注虚拟层；它们没有 .file-cb 类）
        document.querySelectorAll(`.layer-row[data-group="${gid}"] .col-vis input[type="checkbox"]`)
            .forEach(cb => { cb.checked = isChecked; });

        // 3. 更新自身状态 (清除半选样式；checked 也显式对齐，便于脚本/快捷键调用)
        const groupCb = document.getElementById(`group-cb-${gid}`);
        if (groupCb) { groupCb.checked = !!isChecked; groupCb.indeterminate = false; }

        if (hasChanged) drawCanvas();
    };

    // 切换单文件可见性
    window.toggleFile = (idx, isChecked) => { 
        // 1. 更新文件可见性
        const file = loadedFiles[idx];
        file.visible = isChecked; 
        
        // 2. 反向更新组复选框状态 (核心修改)
        const gid = getGroupId(file.layerId);
        updateGroupCheckboxState(gid);

        // 3. 重绘
        drawCanvas(); 
    };
    
    // 2. 修改图层类型
    window.changeLayer = (idx, val) => { 
        const newId = parseInt(val);
        const file = loadedFiles[idx];
        
        // 如果旧的不是 502，新的变成了 502，或者反之，都需要重新渲染子行
        const needsRerender = (file.layerId === 502) !== (newId === 502);

        file.layerId = newId; 

        if (newId === 58 || newId === 59) setBoardType('FPC');

        sortLoadedFiles();
        
        // 关键修改：如果涉及 502 变化，必须 renderLayerTable 才能显示/隐藏下拉框
        // 简单的做法是任何类型改变都重绘表格，不仅更安全，代码也更少
        renderLayerTable(); 
        drawCanvas(); 
    };

    // 请求绘制帧
    function requestDraw() {
        if (!isRenderPending) {
            isRenderPending = true;
            requestAnimationFrame(() => {
                drawCanvas();
                isRenderPending = false;
            });
        }
    }

    // --- 标尺绘制 (适配 HiDPI + 自适应步进算法 1-2-5序列) ---
    function drawRulers() {
        const dpr = window.devicePixelRatio || 1;
        
        // 1. 使用逻辑尺寸清空画布 (适配 Retina/HiDPI)
        const logicalW = rulerH.width / dpr;
        const logicalH = rulerH.height / dpr;
        const logicalVH = rulerV.height / dpr;
        const logicalVW = rulerV.width / dpr;

        // ctxH/V 已经在 resizeCanvas 中被 scale(dpr, dpr)
        ctxH.clearRect(0, 0, logicalW, logicalH);
        ctxV.clearRect(0, 0, logicalVW, logicalVH);

        // 2. 自适应步进计算核心逻辑
        const isMM = viewState.unit === 'mm';
        const mmToMil = 39.3700787;
        
        // [核心配置] 屏幕上理想的刻度间距 (像素)
        // 算法会尝试让刻度间距接近这个值
        const idealSpacingPx = 80; 
        
        // 计算当前缩放比例下，理想间距对应的"物理世界"距离 (单位: mm)
        // viewState.scale 是 px/mm
        const rawStepWorldMM = idealSpacingPx / viewState.scale;
        
        // 根据当前显示单位，转换到目标单位域进行"吸附"
        // 如果是 mil 模式，我们希望吸附到 100mil, 50mil 这种整数，而不是 2.54mm 的倍数
        let stepRawDisplay; 
        if (isMM) {
            stepRawDisplay = rawStepWorldMM;
        } else {
            stepRawDisplay = rawStepWorldMM * mmToMil;
        }

        // --- 1-2-5 序列吸附算法 ---
        // 计算数量级 (例如 0.35 -> magnitude=0.1, 35 -> magnitude=10)
        const magnitude = Math.pow(10, Math.floor(Math.log10(stepRawDisplay)));
        // 计算残差 (例如 0.35/0.1 = 3.5)
        const residual = stepRawDisplay / magnitude;
        
        // 查表吸附：选择最接近的标准化步进 (1, 2, 5)
        let standardStep;
        if (residual < 1.5) standardStep = 1;       // 1.0, 10, 0.1
        else if (residual < 3.5) standardStep = 2;  // 2.0, 20, 0.2
        else standardStep = 5;                      // 5.0, 50, 0.5
        
        // 最终计算出的"漂亮"的显示步进 (单位跟随 viewState.unit)
        const niceDisplayStep = standardStep * magnitude; 
        
        // 将步进转换回世界坐标系 (mm)，用于后续绘图循环
        const worldStep = isMM ? niceDisplayStep : (niceDisplayStep / mmToMil);

        // --- 自动精度计算 ---
        // 避免出现 0.300000004 这种情况
        // 如果步进是 0.1，精度设为 1；步进是 0.5，精度设为 1；步进是 10，精度设为 0
        let precision = 0;
        if (niceDisplayStep < 1) {
             precision = Math.max(0, Math.ceil(-Math.log10(niceDisplayStep)));
        }

        // 3. 样式设置
        ctxH.fillStyle = '#aaa'; ctxH.font = '10px Arial'; ctxH.textAlign = 'left'; ctxH.strokeStyle = '#555';
        ctxV.fillStyle = '#aaa'; ctxV.font = '10px Arial'; ctxV.textAlign = 'right'; ctxV.textBaseline = 'middle'; ctxV.strokeStyle = '#555';

        // 4. 绘制 X 轴标尺 (Horizontal)
        // 计算可见区域的世界坐标范围
        const startWorldX = -viewState.offsetX / viewState.scale;
        const endWorldX = (logicalW - viewState.offsetX) / viewState.scale;
        
        // 对齐起始点 (Snap to Grid)
        // 关键：必须从 worldStep 的整数倍开始画，否则刻度会浮动
        // 增加 buffer 防止边缘刻度没画出来
        const startTickX = Math.floor(startWorldX / worldStep) * worldStep;
        
        ctxH.beginPath();
        for (let x = startTickX; x < endWorldX + worldStep; x += worldStep) {
            const screenX = x * viewState.scale + viewState.offsetX;
            
            // 剔除屏幕外的绘制指令 (性能优化)
            if (screenX < -50 || screenX > logicalW + 50) continue;

            // 绘制主刻度线
            ctxH.moveTo(screenX, 0); ctxH.lineTo(screenX, 20);
            
            // 计算标签数值
            let labelVal = isMM ? x : (x * mmToMil);
            
            // [防抖动] 处理 -0.000 问题
            if (Math.abs(labelVal) < 1e-10) labelVal = 0;
            
            // 格式化文字 (应用自动精度)
            const labelStr = labelVal.toFixed(precision);
            ctxH.fillText(labelStr, screenX + 4, 12);

            // 绘制次级刻度 (简单二分)
            const subX = screenX + (worldStep / 2) * viewState.scale;
            if (subX < logicalW) {
                 ctxH.moveTo(subX, 15); ctxH.lineTo(subX, 20);
            }
        }
        ctxH.stroke();

        // 5. 绘制 Y 轴标尺 (Vertical)
        // 注意：Canvas Y轴向下，但 PCB 坐标通常向上，viewState transform 中 Y 是翻转的 (-scale)
        // 视口顶部的世界坐标 (World Y at Screen Top)
        const topWorldY = viewState.offsetY / viewState.scale;
        // 视口底部的世界坐标 (World Y at Screen Bottom)
        const bottomWorldY = (viewState.offsetY - logicalVH) / viewState.scale;
        
        // 对齐起始点
        const startTickY = Math.floor(topWorldY / worldStep) * worldStep;
        
        ctxV.beginPath();
        // 因为坐标系翻转，WorldY 从上到下是减小的，所以用减法遍历
        for (let y = startTickY; y > bottomWorldY - worldStep; y -= worldStep) {
            const screenY = viewState.offsetY - y * viewState.scale;
            
            if (screenY < -50 || screenY > logicalVH + 50) continue;

            // 绘制主刻度线
            ctxV.moveTo(0, screenY); ctxV.lineTo(20, screenY);
            
            let labelVal = isMM ? y : (y * mmToMil);
            if (Math.abs(labelVal) < 1e-10) labelVal = 0;
            const labelStr = labelVal.toFixed(precision);
            
            // 旋转文字使其垂直阅读更自然
            ctxV.save(); 
            ctxV.translate(10, screenY - 2); 
            ctxV.rotate(-Math.PI/2);
            ctxV.fillText(labelStr, -2, 0); 
            ctxV.restore();

            // 绘制次级刻度
            // 注意：屏幕 Y 向下增加，World Y 减小，所以次级刻度在当前刻度的"下方" (screenY + halfStep)
            const subY = screenY + (worldStep / 2) * viewState.scale;
            if (subY < logicalVH) {
                ctxV.moveTo(15, subY); ctxV.lineTo(20, subY);
            }
        }
        ctxV.stroke();
        
        // 6. 填充左上角死角背景
        ctxH.fillStyle = '#252526'; ctxH.fillRect(0,0,20,20);
    }

    // --- 7. 鼠标交互 (优化版：带缩放限制) ---
    mainCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        // 1. 获取鼠标当前在画布上的位置
        const rect = mainCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // 2. 计算鼠标指向的世界坐标 (缩放前的实际物理坐标)
        const wx = (mx - viewState.offsetX) / viewState.scale;
        const wy = (viewState.offsetY - my) / viewState.scale;

        // 3. 预计算新的缩放值
        const zoomFactor = e.deltaY < 0 ? 1.5 : 0.6666;
        let newScale = viewState.scale * zoomFactor;

        // --- [新增] 缩放限制逻辑 ---
        // 获取画布当前最小边长 (用于计算适配比例)
        const minScreenDim = Math.min(mainCanvas.clientWidth, mainCanvas.clientHeight) || 500;

        // 限制 A: 缩小限制 (最大可视范围 10000mm)
        const minScale = minScreenDim / 10000;

        // 限制 B: 放大限制 (最小可视范围 0.02mm)
        const maxScale = minScreenDim / 0.02;

        // 执行截断
        if (newScale < minScale) newScale = minScale;
        if (newScale > maxScale) newScale = maxScale;
        // ---------------------------

        // 4. 应用新的缩放值
        viewState.scale = newScale;

        // 5. 反向计算 Offset，确保鼠标指向的世界坐标位置不变 (实现以鼠标为中心缩放)
        viewState.offsetX = mx - wx * viewState.scale;
        viewState.offsetY = my + wy * viewState.scale; 

        notifyViewInteraction();   // 缩放期间走快照，停止 150ms 后完整重绘
        requestDraw(); // 使用异步绘制
    }, { passive: false }); // 显式声明非被动，确保 preventDefault 生效

    // 鼠标按下事件
    mainCanvas.addEventListener('mousedown', (e) => {
        if (e.button===2 || e.button===1) {
            notifyViewInteraction();
            viewState.isDragging = true;
            viewState.lastX = e.clientX; viewState.lastY = e.clientY;
            mainCanvas.style.cursor = 'grabbing';
        }
    });
    
    // 鼠标移动事件
    window.addEventListener('mousemove', (e) => {
        if (viewState.isDragging) {
            viewState.offsetX += e.clientX - viewState.lastX;
            viewState.offsetY += e.clientY - viewState.lastY;
            viewState.lastX = e.clientX; viewState.lastY = e.clientY;
            notifyViewInteraction();   // 交互期走快照，松手后再完整重绘
            requestDraw(); // 使用异步绘制
        }
    });
    
    // 鼠标松开事件
    window.addEventListener('mouseup', () => { viewState.isDragging=false; mainCanvas.style.cursor='default'; });
    
    // 右键菜单屏蔽
    mainCanvas.addEventListener('contextmenu', e=>e.preventDefault());
    
    // 单位切换按钮事件
    document.getElementById('unit-btn').addEventListener('click', function() {
        viewState.unit = viewState.unit==='mm'?'mil':'mm';
        this.textContent = viewState.unit;
        drawCanvas();
    });

    // --- 修复后的步进器与UI同步逻辑 ---

    // 2. 步进器调整 (支持所有整数位/小数位调整)
    window.stepVal = (targetId, delta) => {
        const input = document.getElementById(targetId);
        if (!input) return;

        // 用户手动调精度时置位：只有手动改过，解析器才会忽略文件自带的精度声明
        if (!window.__autoDetecting) window.manualFormatOverride = true;

        let val = parseInt(input.value) + delta;
        // 限制范围 1 ~ 8
        if (val < 1) val = 1;
        if (val > 8) val = 8;
        
        input.value = val;
        
        // 立即更新对应的 UI 显示文本
        // 规则：ID 为 'cfg-dec' 对应 'ui-val-dec'
        // 其他规则：'cfg-xxx' 对应 'ui-val-xxx'
        let uiId = "";
        if (targetId === 'cfg-dec') {
            uiId = 'ui-val-dec';
        } else {
            uiId = targetId.replace('cfg', 'ui-val');
        }
        
        const uiEl = document.getElementById(uiId);
        if (uiEl) uiEl.textContent = val;
    };

    // 3. 核心：从隐藏 Input 同步状态到 UI 显示
    // (在自动检测、重置、手动点击后调用)
    window.syncUiFromState = function() {
        // 同步单位按钮状态
        const currentUnit = document.getElementById('cfg-units').value;
        setUnitUI(currentUnit, 'graphic'); // 确保图形单位UI同步
        
        // --- 修复：同步所有数值显示 ---
        
        // 1. 图形参数
        const gInt = document.getElementById('cfg-g-int').value;
        const gDec = document.getElementById('cfg-dec').value;
        if(document.getElementById('ui-val-g-int')) document.getElementById('ui-val-g-int').textContent = gInt;
        if(document.getElementById('ui-val-dec')) document.getElementById('ui-val-dec').textContent = gDec;

        // 2. 钻孔参数
        const dInt = document.getElementById('cfg-d-int').value;
        const dDec = document.getElementById('cfg-d-dec').value;
        if(document.getElementById('ui-val-d-int')) document.getElementById('ui-val-d-int').textContent = dInt;
        if(document.getElementById('ui-val-d-dec')) document.getElementById('ui-val-d-dec').textContent = dDec;
    };
    // --- 新增：DPI 联动逻辑 ---

    // 1. 点击预设按钮调用
    window.updateDpiUI = (val) => {
        val = parseInt(val);
        // 更新隐藏的核心配置 Input
        document.getElementById('cfg-dpi').value = val;
        
        // 更新输入框显示
        document.getElementById('ui-dpi-input').value = val;
        
        // 更新按钮高亮状态
        highlightDpiBtn(val);
    };

    // 2. 手动输入时调用
    window.handleCustomDpiInput = (val) => {
        if (!val) return;
        const numVal = parseInt(val);
        
        // 更新隐藏的核心配置 Input
        document.getElementById('cfg-dpi').value = numVal;
        
        // 尝试匹配按钮高亮 (如果输入的是 1200，则高亮 1200 按钮，否则取消所有高亮)
        highlightDpiBtn(numVal);
    };

    // 辅助：高亮匹配的按钮
    function highlightDpiBtn(val) {
        // 修改点：这里的 ID 从 #ui-dpi-presets 改为 #ui-dpi-group，以匹配 HTML
        document.querySelectorAll('#ui-dpi-group .dpi-btn').forEach(btn => {
            if (parseInt(btn.dataset.val) === val) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // 为了兼容原有的 setDpi 调用 (如果还有遗漏的旧代码调用它)
    window.setDpi = window.updateDpiUI;
    
    // 2. 处理铜层数变更
    window.handleLayerCountChange = (val) => {
        console.log("当前铜层数设置为:", val);
        
        // 关键：层数改变后，重新渲染表格，触发 renderLayerTable 中的过滤逻辑
        renderLayerTable();

        // [新增] 同步更新属性面板显示的层数
        if(document.getElementById('prop-layers')) {
            document.getElementById('prop-layers').textContent = val;
        }
    };

    // 1. 设置板子类型并更新 UI (FPC/PCB)
    window.setBoardType = (type) => {
        // 更新隐藏输入框的值
        const input = document.getElementById('cfg-board-type');
        if (input) input.value = type;

        // 更新按钮的高亮激活状态
        const group = document.getElementById('ui-board-type');
        if (group) {
            group.querySelectorAll('.seg-btn').forEach(btn => {
                if (btn.dataset.val === type) {
                    btn.classList.add('active'); // 激活目标按钮
                } else {
                    btn.classList.remove('active'); // 取消其他按钮
                }
            });
        }
        console.log(`Board Type switched to: ${type}`);
    };

