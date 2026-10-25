// ====================================================================================
// about.js  —  「关于」页面的脚本
// ------------------------------------------------------------------------------------
// 做三件事：
//   ① 把功能清单渲染成「主行 + 详情行」的手风琴表格（布局与狼黑工具的关于页一致）；
//   ② 把扩展清单（extension.json）里的版本号填到页头；
//   ③ 处理「联系开发者 / 请开发者喝蜜雪」的二维码浮窗。
//
// 版本号取法：优先 EDA 接口 sys_FileSystem.getExtensionFile('/extension.json')，
// 取不到再 fetch 绝对路径，再退回相对路径；都失败则保持空白，不影响页面其余内容。
// 不依赖主工具的其它脚本，本页面单独加载。
// ====================================================================================

(function () {

	/** 功能清单：与 README 的「能转成什么格式」表对应，一个通道一行 */
	const FEATURES = [
		{
			name: '导入Gerber',
			brief: '读 Gerber / 钻孔文件，还原成可编辑的 PCB',
			scope: ['PCB'],
			version: 'V2.2.45 ~ 4',
			demoUrl: 'https://pbt-pub.jlc.com/pbt/bbs/8707762781426302976-20260205_220643.mp4',
			steps: [
				'在 PCB 文档里打开「Gerber工具 → 导入Gerber」',
				'选 .zip、多个 Gerber / 钻孔文件，或直接把文件拖进窗口',
				'核对「处理模式」与图层设置，需要网络时勾选「尝试生成网络」',
				'选一个出口：通过源码导入、通过图元导入，或导出嘉立创 EDA 工程',
			],
			note: '只有 PCB 文档能写入画布，从首页 / 原理图 / 符号页打开时只能用导出。导入前请新建空白 PCB 并备份。',
		},
		{
			name: '通过源码导入',
			brief: '生成文档源码写入画布，还原最完整、可撤销',
			scope: ['PCB'],
			version: 'V2.2.45 ~ 4',
			demoUrl: '',
			steps: [
				'在「写入画布」里点「通过源码导入」',
				'大板（>500KB）会先提示可能卡顿，可改用「导出专业版 V3」',
				'写入后可用一次撤销退回',
			],
			note: '非 PCB 页签打开时按钮会禁用，请先打开或新建一个 PCB 文档。',
		},
		{
			name: '通过图元导入',
			brief: '逐个创建图元，图元多时会卡顿、无法完全撤回',
			scope: ['PCB'],
			version: 'V2.2.45 ~ 4',
			demoUrl: '',
			steps: [
				'在「写入画布」里点「通过图元导入」',
				'图元数很多的板子建议改用源码导入或先导出工程',
			],
			note: '埋盲孔需先手动添加规则；FPC 补强、合并成组不支持这个通道。',
		},
		{
			name: '导出嘉立创 EDA 工程',
			brief: '导出 .epro2 / .epro / 标准版 .json 工程文件',
			scope: ['PCB'],
			version: 'V2.2.45 ~ 4',
			demoUrl: '',
			steps: [
				'点「导出嘉立创 EDA」',
				'专业版 V3 存 .epro2、V2 存 .epro，标准版存 .json',
				'在 EDA 里用「文件 → 打开」载入新工程',
			],
			note: '原工程不受影响，元件特别多的板子走这条路更稳，不会卡死客户端。',
		},
		{
			name: '导出位图 PDF',
			brief: '按层输出 PDF 位图，DPI 可调',
			scope: ['PCB'],
			version: 'V2.2.45 ~ 4',
			demoUrl: '',
			steps: ['点「导出位图 PDF」', '选要输出的层与 DPI', '保存后用于核对或打印'],
			note: '输出的是不可编辑的位图，需要继续改图请用导出工程文件。',
		},
	];

	/**
	 * 转义 HTML 特殊字符（功能清单里的文字一律按纯文本渲染）
	 * @param {string} text 原始文本
	 * @returns {string} 转义后的文本
	 */
	function escapeHtml(text) {
		return String(text == null ? '' : text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	/**
	 * 生成环境标签
	 * @param {string[]} scope 适用环境
	 * @returns {string} HTML 片段
	 */
	function scopeTags(scope) {
		if (!Array.isArray(scope)) return '';
		const classOf = (name) => (name === '原理图' || name === '符号' ? 'sch' : name === '全局' ? 'global' : 'pcb');
		const tags = scope.map((name) => `<span class="tag tag-scope ${classOf(name)}">${escapeHtml(name)}</span>`).join('');
		return scope.length > 1 ? `<div class="tag-row">${tags}</div>` : tags;
	}

	/**
	 * 生成「使用方法」有序列表
	 * @param {string[]} steps 步骤文本
	 * @returns {string} HTML 片段
	 */
	function stepsHtml(steps) {
		if (!Array.isArray(steps) || steps.length === 0) return '';
		return `<ol class="howto-list">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`;
	}

	/**
	 * 生成「注意」段落
	 * @param {string} note 注意事项
	 * @returns {string} HTML 片段
	 */
	function noteHtml(note) {
		if (!note) return '';
		return `<h4 class="note-heading"><span class="note-tag">注意</span></h4><p class="howto-note">${escapeHtml(note)}</p>`;
	}

	/**
	 * 渲染整张功能表（主行可点开详情行）
	 * @param {HTMLElement} tbody 表格主体
	 * @returns {void}
	 */
	function renderTable(tbody) {
		for (const item of FEATURES) {
			const link = item.demoUrl
				? `<a href="${escapeHtml(item.demoUrl)}" target="_blank">打开</a>`
				: '<span class="muted">暂无</span>';

			const mainRow = document.createElement('tr');
			mainRow.className = 'main-row';
			mainRow.innerHTML = `
				<td class="name-col">${escapeHtml(item.name)}</td>
				<td class="brief-col">${escapeHtml(item.brief)}</td>
				<td>
					<div class="env-stack">
						${scopeTags(item.scope)}
						<span class="ver-text">${escapeHtml(item.version)}</span>
					</div>
				</td>
				<td>${link}</td>
			`;

			const detailsRow = document.createElement('tr');
			detailsRow.className = 'details-row';
			detailsRow.innerHTML = `
				<td colspan="4" class="details-cell">
					<div class="details-content">
						<h4><span class="usage-tag">使用方法</span></h4>
						${stepsHtml(item.steps)}
						${noteHtml(item.note)}
					</div>
				</td>
			`;

			tbody.appendChild(mainRow);
			tbody.appendChild(detailsRow);

			mainRow.addEventListener('click', () => {
				const isActive = mainRow.classList.contains('active');
				document.querySelectorAll('.main-row').forEach((row) => row.classList.remove('active'));
				document.querySelectorAll('.details-row').forEach((row) => row.classList.remove('show'));
				if (!isActive) {
					mainRow.classList.add('active');
					detailsRow.classList.add('show');
				}
			});
		}
	}

	/**
	 * 绑定二维码浮窗
	 * @returns {void}
	 */
	function bindImageModal() {
		const modal = document.getElementById('imageModal');
		const modalImg = document.getElementById('modalImage');
		const closeBtn = document.querySelector('.close-btn');
		if (!modal || !modalImg) return;

		document.querySelectorAll('.popup-trigger').forEach((trigger) => {
			trigger.addEventListener('click', (e) => {
				e.preventDefault();
				modalImg.src = trigger.getAttribute('data-img');
				modal.style.display = 'flex';
			});
		});

		if (closeBtn) {
			closeBtn.addEventListener('click', () => {
				modal.style.display = 'none';
				modalImg.src = '';
			});
		}

		window.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.style.display = 'none';
				modalImg.src = '';
			}
		});
	}

	/**
	 * 版本号尾部拼接的构建哈希（形如 3.8.0+abc123）只保留语义版本
	 * @param {string} version 原始版本
	 * @returns {string} 语义版本
	 */
	function stripHash(version) {
		return String(version || '').split('+')[0];
	}

	/**
	 * 把清单里的版本号写到页头
	 * @param {object} manifest 扩展清单
	 * @returns {void}
	 */
	function applyManifest(manifest) {
		if (!manifest) return;
		const ver = stripHash(manifest.version);
		const el = document.getElementById('appVersion');
		if (el && ver) el.textContent = 'v' + ver;
	}

	/** 取扩展清单：EDA 接口 → 绝对路径 → 相对路径 */
	async function loadManifest() {
		try {
			if (typeof eda !== 'undefined' && eda.sys_FileSystem &&
				typeof eda.sys_FileSystem.getExtensionFile === 'function') {
				const file = await eda.sys_FileSystem.getExtensionFile('/extension.json');
				if (file) return JSON.parse(await file.text());
			}
		} catch (e) { /* 落到 fetch */ }

		for (const url of ['/extension.json', '../extension.json']) {
			try {
				const res = await fetch(url, { cache: 'no-store' });
				if (res && res.ok) return await res.json();
			} catch (e) { /* 换下一条 */ }
		}
		return null;
	}

	/**
	 * 启动
	 * @returns {void}
	 */
	function start() {
		const tbody = document.querySelector('#featureTable tbody');
		if (tbody) renderTable(tbody);
		bindImageModal();
		loadManifest().then(applyManifest).catch(() => { });
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
	else start();
})();
