// ====================================================================================
// 03-state.js  —  运行时状态、画布上下文与协议弹窗
// ------------------------------------------------------------------------------------
// 职责：
//   · 全局可变状态：rawFilesCache / loadedFiles / viewState
//   · 主画布与标尺的 2D 上下文、离屏缓冲画布
//   · 「免责声明 / 二次确认」弹窗控制（confirmAction / handleDisclaimer）
// 依赖：本文件在【加载时即访问 DOM】（#main-canvas / #ruler-h / #ruler-v），
//       因此所有脚本必须放在 </body> 之前，且本文件早于 09-ui.js。
// 加载顺序：第 3 个
// ====================================================================================

// ====================================================================================
// 2. 全局状态定义
// ====================================================================================

    let rawFilesCache = []; 
    let loadedFiles = [];
    let viewState = { scale: 15, offsetX: 0, offsetY: 0, unit: 'mm', isDragging: false, lastX: 0, lastY: 0 };

    // --- 飞针标注层（引脚编号 / 网络名称 / 元件位号）---------------------------------
    // 数据源：压缩包内的 FlyingProbeTesting.json。这些层不对应 Gerber 文件，
    // 只在画布上做文字标注；只有「元件位号」勾选后才会参与导出（见 05-pad-tool.js）。
    // 前两层默认显示（导入的 Gerber 若带飞针文件即刻可见），位号默认关闭。
    const flyingOverlayVisible = {
        [FLYING_LAYER.PAD_NUMBER]: true,
        [FLYING_LAYER.NET_NAME]: true,
        [FLYING_LAYER.REFDES]: false
    };
    // 标注数据缓存：{ pads:[{x,y,num,net}], comps:[{x,y,ref}] }。导入/重载时置空重建，
    // 避免在 drawCanvas（跟随平移缩放高频调用）里重复做 extractRawData + consolidate。
    let flyingLabelCache = null;
    // --- 5. 画布渲染 (优化版：HiDPI + RAF 节流) ---
    const mainCanvas = document.getElementById('main-canvas');
    const ctx = mainCanvas.getContext('2d', { alpha: false }); // 优化：关闭透明通道
    const rulerH = document.getElementById('ruler-h'); const ctxH = rulerH.getContext('2d');
    const rulerV = document.getElementById('ruler-v'); const ctxV = rulerV.getContext('2d');

    const bufferCanvas = document.createElement('canvas');
    const bufCtx = bufferCanvas.getContext('2d', { willReadFrequently: true });

    let isRenderPending = false; // RAF 锁



    // --- 弹窗逻辑控制 ---
    let pendingAction = null; // 存储待执行的操作

    function confirmAction(actionCallback) {
        // 如果是 DEBUG 模式，直接执行，不弹窗
        if (typeof DEBUG !== 'undefined' && DEBUG) {
            actionCallback();
            return;
        }
        
        // 存储回调并在弹窗中显示
        pendingAction = actionCallback;
        document.getElementById('disclaimer-modal').style.display = 'flex';
    }

    function handleDisclaimer(isAgreed) {
        // 隐藏弹窗
        document.getElementById('disclaimer-modal').style.display = 'none';
        
        if (isAgreed) {
            // 用户同意，执行存储的操作
            if (pendingAction) pendingAction();
        } else {
            // 用户不同意，清空操作（也可以选择关闭窗口或提示）
            console.log("用户拒绝了协议，操作取消。");
        }
        // 重置
        pendingAction = null;
    }

