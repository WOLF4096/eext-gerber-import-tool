// ====================================================================================
// demo-usage.js  —  演示模式（非 EDA 环境）的本机使用次数
// ------------------------------------------------------------------------------------
// 用途：README 里「打开演示」指向 GitHub Pages 上的本页，那里没有 eda.sys_Storage、
//       也没有账号，用一条 cookie 记「这台浏览器打开过几次」，便于判断演示是否真被使用。
// 职责：
//   · isDemo           是否处于演示（非 EDA）环境
//   · read             读取本机累计打开次数 / 首次、最近时间
//   · bump             次数 +1 并写回 cookie（仅应在演示模式调用）
// 约束：
//   · 只在演示模式写；EDA 内的导入 / 导出次数由 reward.js 的 importExportCount 负责，互不干扰
//   · 纯本机 cookie：不联网、不上报，静态托管的服务器看不到
//   · 写失败（隐私模式 / 禁用 cookie / file:// 直开）不抛错，交给调用方决定怎么提示
// 依赖：无（不依赖其它脚本，加载顺序随意，但需早于 10-init.js）
// ====================================================================================

(function () {
	// cookie 名固定，改名字等于让老访客的计数从 0 开始
	const COOKIE_NAME = 'gerber_demo_usage';
	// 1 年；太长容易被浏览器清理策略影响，太短又统计不到
	const MAX_AGE = 31536000;
	// 格式版本：值形如 `1|3|1792000000000|1792000000000`
	const VERSION = 1;

	/**
	 * 是否处于演示（非 EDA）环境
	 * @returns {boolean} true = 浏览器直开演示页
	 */
	function isDemo() {
		return typeof eda === 'undefined';
	}

	/**
	 * 从 document.cookie 里取出原始值
	 * @returns {string} 原始值；没有则空串
	 */
	function readRaw() {
		const parts = String(document.cookie || '').split(';');
		const prefix = COOKIE_NAME + '=';
		for (let i = 0; i < parts.length; i++) {
			const item = parts[i].trim();
			if (item.indexOf(prefix) === 0) {
				try {
					return decodeURIComponent(item.slice(prefix.length));
				} catch (e) {
					return '';
				}
			}
		}
		return '';
	}

	/**
	 * 解析 cookie 值（坏值一律当「没统计过」，避免脏数据把界面写乱）
	 * @param {string} raw 原始值
	 * @returns {{opens: number, firstAt: number, lastAt: number}} 统计结果
	 */
	function parse(raw) {
		const empty = { opens: 0, firstAt: 0, lastAt: 0 };
		if (!raw) return empty;
		const seg = raw.split('|');
		if (seg.length < 4 || parseInt(seg[0], 10) !== VERSION) return empty;
		const opens = parseInt(seg[1], 10);
		if (!(opens > 0)) return empty;
		return {
			opens: opens,
			firstAt: parseInt(seg[2], 10) || 0,
			lastAt: parseInt(seg[3], 10) || 0,
		};
	}

	/**
	 * 写回 cookie
	 * @param {{opens: number, firstAt: number, lastAt: number}} value 统计结果
	 * @returns {boolean} 是否写入成功（写失败通常是隐私模式或禁用了 cookie）
	 */
	function write(value) {
		const payload = [VERSION, value.opens, value.firstAt, value.lastAt].join('|');
		let cookie = COOKIE_NAME + '=' + encodeURIComponent(payload) + '; Path=/; Max-Age=' + MAX_AGE + '; SameSite=Lax';
		// file:// 或 http 下带 Secure 会被浏览器直接丢弃，所以只在 https 上加
		if (location.protocol === 'https:') cookie += '; Secure';
		try {
			document.cookie = cookie;
		} catch (e) {
			return false;
		}
		// 写完回读一次：cookie 被策略拦掉时浏览器不会报错，只能靠回读确认
		return parse(readRaw()).opens === value.opens;
	}

	/**
	 * 读取本机累计打开次数
	 * @returns {{opens: number, firstAt: number, lastAt: number}} 统计结果（未统计过时 opens = 0）
	 */
	function read() {
		return parse(readRaw());
	}

	/**
	 * 次数 +1 并写回；写失败时仍返回内存里的结果，界面可以照常显示「第 N 次」
	 * @returns {{opens: number, firstAt: number, lastAt: number, saved: boolean}} 递增后的结果
	 */
	function bump() {
		const now = Date.now();
		const current = read();
		const next = {
			opens: current.opens + 1,
			firstAt: current.firstAt || now,
			lastAt: now,
		};
		const saved = write(next);
		return { opens: next.opens, firstAt: next.firstAt, lastAt: next.lastAt, saved: saved };
	}

	window.DemoUsage = {
		COOKIE_NAME: COOKIE_NAME,
		isDemo: isDemo,
		read: read,
		bump: bump,
	};
})();
