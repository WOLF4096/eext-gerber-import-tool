// ====================================================================================
// reward.js  —  操作次数统计与赞赏引导（主工具 / 关于页共用）
// ------------------------------------------------------------------------------------
// 职责：
//   · recordImportExportSuccess  PCB 导入 / 导出成功后自增计数并持久化
//   · showRewardDialog           「感觉不错？」弹窗（含蜜雪赞赏码 / 微信二维码展示）
//   · rewardOpenIssues           在外部浏览器打开 GitHub Issues（唯一跳转外部的入口）
//   · getImportExportCount       读取当前累计次数（调试 / 展示用）
// 持久化：优先 eda.sys_Storage.getExtensionAllUserConfigs / setExtensionAllUserConfigs
//         （同步读、异步写，会覆盖扩展全部用户配置 → 必须先读全量再回写）；
//         EDA 接口不可用（纯浏览器调试）时退回 localStorage。
// 弹窗规则：累计次数 % 10 === 0 且该计数值未弹过时弹出；同一计数值只弹一次。
// 不依赖主工具其它脚本；appLog / showToast 均做了存在性兜底。
// 主工具在 ImportGerber.html 中于 06-utils.js 之后加载；关于页在 About.html 中加载。
// ====================================================================================

(function () {
	

	// --- 配置常量 ---
	const COUNT_KEY = 'importExportCount';        // 累计导入/导出成功次数的存储键
	const PROMPTED_KEY = 'lastRewardPromptCount'; // 最近一次弹窗对应的计数值（同一值只弹一次）
	const PROMPT_STEP = 10;                       // 每 10 次弹一次
	const FALLBACK_KEY = 'eext-gerber-import-tool.reward'; // localStorage 兜底键
	const ISSUE_URL = 'https://github.com/WOLF4096/eext-gerber-import-tool/issues';
	const IMG_REWARD = '/images/reward_qrcode.png'; // 赞赏码（请开发者喝蜜雪）
	const IMG_WECHAT = '/images/wx.png';            // 微信二维码（联系开发者）

	// --- 会话内缓存（EDA 接口读取有开销，且写入失败时保证本次会话计数不丢） ---
	let countCache = null;      // 累计次数
	let promptedCache = null;   // 最近弹窗计数值
	let edaReadOk = false;      // 本次读取是否来自 EDA 存储（决定回写走哪条通道）

	function log(msg) {
		if (typeof appLog === 'function') appLog(msg);
		else console.log('[reward] ' + msg);
	}

	function isDebug() {
		return typeof DEBUG !== 'undefined' && DEBUG;
	}

	// ==================================================================================
	// 1. 持久化读写
	// ==================================================================================

	function edaStorageAvailable() {
		return typeof eda !== 'undefined' && eda && eda.sys_Storage &&
			typeof eda.sys_Storage.getExtensionAllUserConfigs === 'function' &&
			typeof eda.sys_Storage.setExtensionAllUserConfigs === 'function';
	}

	/** 读取扩展全部用户配置（EDA 优先，失败退回 localStorage） */
	function readStore() {
		if (edaStorageAvailable()) {
			try {
				const cfg = eda.sys_Storage.getExtensionAllUserConfigs();
				if (cfg && typeof cfg === 'object') {
					edaReadOk = true;
					console.log(cfg);
					return cfg;
				}
			} catch (e) { /* 扩展接口不可用 → 走本地兜底 */ }
		}
		edaReadOk = false;
		try {
			const raw = window.localStorage.getItem(FALLBACK_KEY);
			const cfg = raw ? JSON.parse(raw) : {};
			return (cfg && typeof cfg === 'object') ? cfg : {};
		} catch (e) {
			return {};
		}
	}

	/**
	 * 回写扩展全部用户配置。
	 * 只有当全量配置确实读自 EDA 时才写回 EDA（否则可能把其它配置项覆盖丢），
	 * 本地兜底场景只写 localStorage。
	 * @returns {Promise<boolean>} 是否持久化成功
	 */
	async function writeStore(cfg) {
		if (edaReadOk && edaStorageAvailable()) {
			try {
				const ok = await eda.sys_Storage.setExtensionAllUserConfigs(cfg);
				if (ok) return true;
			} catch (e) { /* 落到本地兜底 */ }
		}
		try {
			window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(cfg));
			return true;
		} catch (e) {
			return false;
		}
	}

	function toPositiveInt(v) {
		const n = parseInt(v, 10);
		return (isFinite(n) && n > 0) ? n : 0;
	}

	/** 当前累计的导入/导出次数 */
	function readCount() {
		if (countCache === null) countCache = toPositiveInt(readStore()[COUNT_KEY]);
		return countCache;
	}

	/** 最近一次弹过窗的计数值（0 = 还没弹过） */
	function readPrompted() {
		if (promptedCache === null) promptedCache = toPositiveInt(readStore()[PROMPTED_KEY]);
		return promptedCache;
	}

	// ==================================================================================
	// 2. 计数入口：导入 / 导出成功后调用
	// ==================================================================================

	/**
	 * 记一次成功的 PCB 导入 / 导出，并在累计到整 10 次时弹出赞赏引导。
	 * DEBUG 模式不计入（避免调试操作污染真实计数）。
	 * @param {string} [source] 操作来源描述（写入日志用，如「导出专业版 V3」）
	 * @returns {Promise<number>} 自增后的累计次数
	 */
	async function recordImportExportSuccess(source) {
		try {
			if (isDebug()) return readCount();

			const count = readCount() + 1;
			countCache = count;

			const store = readStore();
			store[COUNT_KEY] = count;
			const persisted = await writeStore(store);
			log(`PCB 导入/导出累计 ${count} 次${source ? `（${source}）` : ''}` +
				(persisted ? '' : ' · ⚠️ 计数保存失败，仅本次会话有效'));

			// 弹窗判定：整 10 次，且该计数值没弹过（持久化失败时靠 promptedCache 兜底防重）
			if (count % PROMPT_STEP === 0 && readPrompted() !== count) {
				promptedCache = count;
				store[PROMPTED_KEY] = count;
				writeStore(store); // 异步落盘，不阻塞弹窗
				showRewardDialog({
					title: '感觉不错？',
					count: count
				});
			}
			return count;
		} catch (e) {
			console.error('[reward] 计数失败:', e);
			return -1;
		}
	}

	// ==================================================================================
	// 3. 弹窗（自包含 DOM + 样式，主工具 / 关于页通用，不依赖 style.css）
	// ==================================================================================

	const RW_STYLE = `
	.rw-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 100000;
		background: rgba(0,0,0,0.7); display: none; justify-content: center; align-items: center;
		backdrop-filter: blur(2px); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
	.rw-box { width: 440px; max-width: calc(100vw - 40px); max-height: 82vh; background: #252526;
		border: 1px solid #3e3e42; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);
		display: flex; flex-direction: column; overflow: hidden; }
	.rw-head { padding: 14px 18px; border-bottom: 1px solid #3e3e42; font-size: 15px; font-weight: bold;
		color: #eee; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
	.rw-close { cursor: pointer; color: #999; font-size: 16px; line-height: 1; padding: 2px 7px; border-radius: 4px; user-select: none; }
	.rw-close:hover { background: #3c3c3c; color: #fff; }
	.rw-body { padding: 16px 18px; overflow-y: auto; font-size: 13px; line-height: 1.7; color: #ccc; background: #1e1e1e; }
	.rw-img-area { display: none; margin-top: 14px; text-align: center; background: #fff; border-radius: 6px; padding: 12px; }
	.rw-img-area img { max-width: 260px; max-height: 260px; width: auto; height: auto; display: block; margin: 0 auto; }
	.rw-cap { margin-top: 8px; font-size: 12px; color: #666; }
	.rw-url-area { display: none; margin-top: 12px; }
	.rw-url-area input { width: 100%; box-sizing: border-box; padding: 6px 8px; background: #3c3c3c; color: #fff;
		border: 1px solid #3e3e42; border-radius: 4px; font-family: Consolas, monospace; font-size: 12px; }
	.rw-foot { padding: 12px 18px; border-top: 1px solid #3e3e42; display: flex; gap: 8px; flex-wrap: wrap;
		justify-content: flex-end; background: #333337; flex-shrink: 0; }
	.rw-btn { padding: 7px 14px; border: 1px solid #3e3e42; border-radius: 4px; background: #3c3c3c;
		color: #ddd; font-size: 12px; cursor: pointer; transition: opacity 0.15s; }
	.rw-btn:hover { background: #4e4e52; color: #fff; }
	.rw-btn-reward { background: #c2492f; border-color: #c2492f; color: #fff; font-weight: 600; }
	.rw-btn-reward:hover { background: #a93b25; border-color: #a93b25; }
	.rw-btn-ghost { background: transparent; }
	`;

	const RW_HTML = `
	<div class="rw-overlay" id="reward-modal">
		<div class="rw-box">
			<div class="rw-head"><span id="rw-title">感觉不错？</span><span class="rw-close" id="rw-btn-x" title="关闭">✕</span></div>
			<div class="rw-body">
				<p id="rw-desc" style="margin:0;"></p>
				<div class="rw-img-area" id="rw-img-area">
					<img id="rw-img" alt="二维码">
					<div class="rw-cap" id="rw-cap"></div>
				</div>
				<div class="rw-url-area" id="rw-url-area">
					<input id="rw-url" readonly spellcheck="false" onclick="this.select()">
				</div>
			</div>
			<div class="rw-foot">
				<button class="rw-btn rw-btn-reward" id="rw-btn-reward">请开发者喝蜜雪</button>
				<button class="rw-btn" id="rw-btn-issue">反馈问题</button>
				<button class="rw-btn" id="rw-btn-wechat">联系开发者</button>
				<button class="rw-btn rw-btn-ghost" id="rw-btn-close">关闭</button>
			</div>
		</div>
	</div>
	`;

	const IMG_META = {
		reward: { src: IMG_REWARD, cap: '微信扫码 · 请开发者喝蜜雪' },
		wechat: { src: IMG_WECHAT, cap: '微信扫码联系开发者 · WOLF4096' }
	};

	/** 弹窗不存在时创建（幂等） */
	function ensureDialog() {
		if (document.getElementById('reward-modal')) return;

		const style = document.createElement('style');
		style.id = 'reward-style';
		style.textContent = RW_STYLE;
		document.head.appendChild(style);

		const wrap = document.createElement('div');
		wrap.innerHTML = RW_HTML.trim();
		const overlay = wrap.firstChild;
		document.body.appendChild(overlay);

		document.getElementById('rw-btn-close').addEventListener('click', closeRewardDialog);
		document.getElementById('rw-btn-x').addEventListener('click', closeRewardDialog);
		document.getElementById('rw-btn-reward').addEventListener('click', () => rewardShowImage('reward'));
		document.getElementById('rw-btn-wechat').addEventListener('click', () => rewardShowImage('wechat'));
		document.getElementById('rw-btn-issue').addEventListener('click', rewardOpenIssues);

		// 点遮罩空白处 / 按 ESC 关闭（关掉不计数，下次达到条件还会提醒）
		overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeRewardDialog(); });
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && overlay.style.display === 'flex') closeRewardDialog();
		});
	}

	/** 在弹窗内显示图片（'reward' = 赞赏码 / 'wechat' = 微信二维码） */
	function rewardShowImage(kind) {
		ensureDialog();
		const meta = IMG_META[kind] || IMG_META.reward;
		document.getElementById('rw-img').src = meta.src;
		document.getElementById('rw-cap').textContent = meta.cap;
		document.getElementById('rw-img-area').style.display = 'block';
		document.getElementById('rw-url-area').style.display = 'none';
	}

	function hideImageArea() {
		const area = document.getElementById('rw-img-area');
		if (area) area.style.display = 'none';
		const urlArea = document.getElementById('rw-url-area');
		if (urlArea) urlArea.style.display = 'none';
	}

	/**
	 * 打开「感觉不错？」弹窗
	 * @param {object} [opts] { title, count, show: 'reward'|'wechat' }
	 */
	function showRewardDialog(opts) {
		opts = opts || {};
		ensureDialog();

		document.getElementById('rw-title').textContent = opts.title || '感觉不错？';
		const desc = document.getElementById('rw-desc');
		if (opts.count) {
			desc.textContent = `这是你第 ${opts.count} 次用本工具完成 PCB 导入 / 导出。` +
				'如果它帮你省了时间，可以请开发者喝杯蜜雪，遇到问题也欢迎反馈～';
		} else {
			desc.textContent = '本工具免费开源、持续维护。如果它帮你省了时间，' +
				'欢迎请开发者喝杯蜜雪，或反馈使用中遇到的问题～';
		}
		hideImageArea();
		if (opts.show === 'reward' || opts.show === 'wechat') rewardShowImage(opts.show);

		document.getElementById('reward-modal').style.display = 'flex';
	}

	/** 关闭弹窗 */
	function closeRewardDialog() {
		const modal = document.getElementById('reward-modal');
		if (modal) modal.style.display = 'none';
	}

	// ==================================================================================
	// 4. 外部链接：仅「反馈问题」跳转外部浏览器，其余一律在应用内弹窗展示
	// ==================================================================================

	function rewardOpenIssues() {
		// ① 首选 EDA 官方窗口接口：扩展 iframe 内最可靠，
		//    且它是唯一能在返回值 / 异常上确认"是否真的打开了"的通道。
		if (typeof eda !== 'undefined' && eda && eda.sys_Window &&
			typeof eda.sys_Window.open === 'function') {
			try {
				eda.sys_Window.open(ISSUE_URL, '_blank');
				log('已在浏览器打开 GitHub Issues（sys_Window）');
				closeRewardDialog();
				return;
			} catch (e) { /* 落到 ② */ }
		}
		// ② 纯浏览器 / EDA 接口不可用时：<a target="_blank"> 唤起系统默认浏览器。
		//    注意 a.click() 被沙箱策略拦下时不会抛异常，所以这一步只能"尽人事"，
		//    真正失败时由下面的可复制链接兜底。
		try {
			const a = document.createElement('a');
			a.href = ISSUE_URL;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			document.body.appendChild(a);
			a.click();
			a.remove();
			log('已尝试在浏览器打开 GitHub Issues（a[target=_blank]）');
			closeRewardDialog();
			return;
		} catch (e) { /* 落到 ③ */ }
		// ③ 全部失败：把链接展示在弹窗内让用户手动复制
		showRewardDialog({ title: '反馈问题' });
		const desc = document.getElementById('rw-desc');
		if (desc) {
			desc.textContent = '无法自动打开浏览器，请复制下面的链接在浏览器中访问。' +
				'提交时附上报错的 Gerber 样本，更容易定位问题。';
		}
		document.getElementById('rw-url').value = ISSUE_URL;
		document.getElementById('rw-url-area').style.display = 'block';
		if (typeof showToast === 'function') showToast('无法打开浏览器，请手动复制链接', 'warn');
	}

	// ==================================================================================
	// 5. 对外接口
	// ==================================================================================

	window.getImportExportCount = readCount;                 // 读取累计次数
	window.recordImportExportSuccess = recordImportExportSuccess; // 导入/导出成功后调用
	window.showRewardDialog = showRewardDialog;              // 打开弹窗
	window.closeRewardDialog = closeRewardDialog;            // 关闭弹窗
	window.rewardShowImage = rewardShowImage;                // 弹窗内显示二维码
	window.rewardOpenIssues = rewardOpenIssues;              // 外部浏览器打开 Issues
})();
