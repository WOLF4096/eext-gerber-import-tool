// ====================================================================================
// 03-state.js  —  运行时状态、画布上下文与协议弹窗
// ------------------------------------------------------------------------------------
// 职责：
//   · 全局可变状态：rawFilesCache / loadedFiles / viewState
//   · 主画布与标尺的 2D 上下文、离屏缓冲画布
//   · 用户协议确认与条款弹窗（confirmAction / showDisclaimer / 协议复选框同步）
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
    // 只在画布上做文字标注；「元件位号」勾选后还会参与导出（见 05-pad-tool.js）。
    // 三层默认全部勾选显示（导入的 Gerber 若带飞针文件即刻可见）。
    const flyingOverlayVisible = {
        [FLYING_LAYER.PAD_NUMBER]: true,
        [FLYING_LAYER.NET_NAME]: true,
        [FLYING_LAYER.REFDES]: true
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



    // --- 弹窗与协议确认逻辑 ---
    // 「用户协议与免责声明」的确认改由侧栏复选框（#cfg-agree）承担：
    // 勾选后才会放行导入 / 导出嘉立创EDA 操作；弹窗本身只用于查看条款正文。

    /** 打开《用户协议与免责声明》弹窗 */
    function showDisclaimer() {
        const modal = document.getElementById('disclaimer-modal');
        if (modal) modal.style.display = 'flex';
    }

    /** 关闭《用户协议与免责声明》弹窗 */
    function closeDisclaimer() {
        const modal = document.getElementById('disclaimer-modal');
        if (modal) modal.style.display = 'none';
    }

    /** 协议复选框是否已勾选 */
    function isAgreementChecked() {
        const cb = document.getElementById('cfg-agree');
        return !!(cb && cb.checked);
    }

    /** 复选框勾选状态变化时的回调（HTML onchange 调用） */
    function onAgreementChange() {
        syncAgreementButtons();
    }

    /** 依据协议勾选状态，切换受控按钮的「锁定」外观（按钮仍可点击，点击会震动提示） */
    function syncAgreementButtons() {
        const debugOn = typeof DEBUG !== 'undefined' && DEBUG;
        const locked = !debugOn && !isAgreementChecked();
        document.querySelectorAll('.agree-gated').forEach(btn => {
            btn.classList.toggle('is-locked', locked);
        });
    }

    /** 未勾选协议就点击受控按钮：让协议复选框左右震动提醒 */
    function shakeAgreement() {
        const row = document.getElementById('agree-row');
        if (!row) return;
        row.classList.remove('agree-shake');
        void row.offsetWidth; // 强制回流，保证连续点击也能重放动画
        row.classList.add('agree-shake');
        row.addEventListener('animationend', () => row.classList.remove('agree-shake'), { once: true });
        const cb = document.getElementById('cfg-agree');
        if (cb) cb.focus();
    }

    /**
     * 统一的导入 / 导出确认入口（HTML 内联 onclick 调用）。
     * 已勾选协议 → 直接执行；未勾选 → 震动协议复选框并中止。
     */
    function confirmAction(actionCallback) {
        // DEBUG 模式跳过协议校验，便于调试
        if (typeof DEBUG !== 'undefined' && DEBUG) {
            actionCallback();
            return;
        }
        if (!isAgreementChecked()) {
            shakeAgreement();
            return;
        }
        actionCallback();
    }

