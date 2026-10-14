// ====================================================================================
// 06-utils.js  —  通用工具函数
// ------------------------------------------------------------------------------------
// 职责：与业务无关、可被任意模块复用的基础函数。
//   mapNameToId / generateUUID / downloadBlobAsFile / downloadStringAsFile /
//   appLog / isGerberText / calculateMaxId / copyDebugSource / getEnvInfo
// 依赖：无（appLog 运行时访问 #debug-source-area，getEnvInfo 运行时访问 eda 全局对象）。
// 加载顺序：第 6 个
// ====================================================================================

// ====================================================================================
// 5. 辅助工具函数 (Utils)
// ====================================================================================

    // --- [新增] 辅助：将文件名中的层名 (Top, Bottom, Inner1...) 转为 ID ---
    function mapNameToId(nameStr) {
        if (!nameStr) return null;
        const upper = nameStr.toUpperCase();
        if (upper === 'TOP') return 1;
        if (upper === 'BOTTOM') return 2;
        // 匹配 Inner1, Inner2 ...
        const m = upper.match(/INNER(\d+)/);
        if (m) {
            return 14 + parseInt(m[1]); // Inner1 -> 15, Inner2 -> 16
        }
        return null;
    }

    // --- [新增] UUID 生成辅助函数 (无连字符格式) ---
    function generateUUID() {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    // --- [新增] Blob 下载辅助函数 ---
    function downloadBlobAsFile(blob, fileName) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // --- [新增] 全局日志工具函数 ---
    function appLog(msg) {
        const area = document.getElementById('debug-source-area');
        if (!area) return;
        
        const now = new Date();
        // const yyyy = now.getFullYear();
        // const mm = String(now.getMonth() + 1).padStart(2, '0');
        // const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        
        // const timeStr = `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
        const timeStr = `${hh}:${min}:${ss}`;
        area.value += `${timeStr} ${msg}\n`;
        
        // 自动滚动到底部
        area.scrollTop = area.scrollHeight;
    }


    // 判断是否为 Gerber 文件
    function isGerberText(name) {
        const ext = name.split('.').pop().toLowerCase();
        if(['json', 'png', 'jpg', 'pdf', 'doc'].includes(ext)) return false;
        return true; 
    }

    // 计算最大 ID 
    function calculateMaxId(source, version) {
        // 安全检查
        // if (!source) return { ticket: 10000, id: 10000 };

        let maxTicket = 0;
        let maxIdNum = 0;

        // 统一判断版本逻辑 (兼容传入 'pro_v3', 'V3专业版' 等情况)
        const isV3 = version && (version.includes('V3') || version === 'pro_v3');

        if (isV3) {
            // =========================
            // V3 源码处理逻辑
            // =========================

            // 1. 获取最大 ticket
            // 正则匹配: "ticket":167 或 "ticket": 167
            const ticketRegex = /"ticket"\s*:\s*(\d+)/g;
            let tMatch;
            while ((tMatch = ticketRegex.exec(source)) !== null) {
                const val = parseInt(tMatch[1], 10);
                if (!isNaN(val) && val > maxTicket) {
                    maxTicket = val;
                }
            }

            // 2. 获取最大 id (仅限 e+数值 格式)
            // 正则匹配: "id":"e27"
            const idRegex = /"id"\s*:\s*"e(\d+)"/g;
            let iMatch;
            while ((iMatch = idRegex.exec(source)) !== null) {
                const val = parseInt(iMatch[1], 10);
                if (!isNaN(val) && val > maxIdNum) {
                    maxIdNum = val;
                }
            }

            return {
                ticket: maxTicket + 100,
                id: maxIdNum + 100
            };

        } else {
            // =========================
            // V2 源码处理逻辑
            // =========================
            
            // V2 格式通常为数组 ["STRING","e41",...]
            // 我们全局搜索带引号的 "e+数字" 格式即可覆盖
            const idRegex = /"e(\d+)"/g;
            let match;
            while ((match = idRegex.exec(source)) !== null) {
                const val = parseInt(match[1], 10);
                if (!isNaN(val) && val > maxIdNum) {
                    maxIdNum = val;
                }
            }

            return {
                ticket: null,
                id: maxIdNum + 100
            };
        }
    }

    // 文件选择 input 回调
    function handleFileSelect(e) { handleFiles(e.target.files); }

    // 浏览器下载文件
    function downloadStringAsFile(content, fileName) {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // 复制功能  ---
    function copyDebugSource() {
        const area = document.getElementById('debug-source-area');
        if (!area) return;
        
        area.select();
        document.execCommand('copy'); 
        
        // [修复] 通过 ID 精准获取“复制”按钮，而不是获取第一个按钮
        const btn = document.getElementById('btn-debug-copy');
        if (btn) {
            const oldText = btn.textContent;
            btn.textContent = "已复制";
            
            // 1秒后恢复文字
            setTimeout(() => {
                btn.textContent = oldText;
            }, 1000);
        }
    }


    // --- 辅助：获取当前环境信息 ---
    function getEnvInfo() {
        let clientVer = 'browser';
        let isEdaEnv = false;

        if (typeof eda !== 'undefined') {
            isEdaEnv = true;
            const verStr = eda.sys_Environment.getEditorCurrentVersion(); // "2.2.45.5"
            if (verStr.startsWith('2')) clientVer = 'pro_v2';
            else if (verStr.startsWith('3')) clientVer = 'pro_v3';
        }
        return { clientVer, isEdaEnv };
    }



