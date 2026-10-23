// ====================================================================================
// about.js  —  「关于」页面的脚本
// ------------------------------------------------------------------------------------
// 只做一件事：把扩展清单（extension.json）里的版本 / 名称填到页面上。
//   ① 优先用 EDA 扩展接口 sys_FileSystem.getExtensionFile('/extension.json') 取本扩展文件；
//   ② 取不到再退回 fetch('/extension.json')；
//   ③ 两者都失败则保持占位文案「版本 —」，不影响页面其余内容。
// 不依赖主工具的其它脚本，本页面单独加载。
// ====================================================================================

(function () {
	

	function setText(id, text) {
		let el = document.getElementById(id);
		if (el && text) el.textContent = text;
	}

	function stripHash(version) {
		// 版本号尾部拼接的构建哈希（形如 3.8.0+abc123）只保留语义版本
		return String(version || '').split('+')[0];
	}

	function applyManifest(manifest) {
		if (!manifest) return;
		let ver = stripHash(manifest.version);
		if (ver) {
			setText('meta-version', '版本 v' + ver);
			setText('foot-line', (manifest.displayName || 'Gerber 转 PCB (G2PCB)') + ' v' + ver + ' · 开源辅助工具 · ' + (manifest.license || 'Apache-2.0'));
		}
		let desc = manifest.description;
		if (desc) {
			let sub = document.querySelector('.hero-sub');
			if (sub) sub.setAttribute('title', desc);
		}
	}

	async function tryEdaFile() {
		try {
			if (typeof eda === 'undefined' || !eda.sys_FileSystem ||
				typeof eda.sys_FileSystem.getExtensionFile !== 'function') return null;
			let file = await eda.sys_FileSystem.getExtensionFile('/extension.json');
			if (!file) return null;
			return JSON.parse(await file.text());
		} catch (e) {
			return null;
		}
	}

	async function tryFetch() {
		try {
			let res = await fetch('/extension.json', { cache: 'no-store' });
			if (!res || !res.ok) return null;
			return await res.json();
		} catch (e) {
			return null;
		}
	}

	async function boot() {
		let manifest = await tryEdaFile();
		if (!manifest) manifest = await tryFetch();
		applyManifest(manifest);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
