// ====================================================================================
// processors/industry-common.js  —  行业标准处理器的公共部分
// ------------------------------------------------------------------------------------
// 职责：被 industry-rs274x 复用（原 industry-x2 / x3 / rs274d 模块已移除）。
//   · LAYER_ID                内部图层 ID 常量（与 02-config.js 的 rawLayerData 一致）
//   · mapCopperLayerNo        Gerber X2 的铜层序号 → 内部图层 ID
//   · parseGerberFileFunction 解析 %TF.FileFunction 属性值 → 图层 ID
//                            （保留：通用模式若日后接入 X2 属性可直接复用）
//   · INDUSTRY_LAYER_RULES    面向「任何软件导出的 Gerber」的图层识别规则
//   · resolveIndustryLayerId  按规则解析文件名对应的图层 ID
// 说明：纯数据 + 纯函数，加载期不访问 DOM。
// 加载顺序：registry.js 之后、各 industry-*.js 之前
// ====================================================================================

    // 内部图层 ID 约定（与 02-config.js 的 rawLayerData 保持一致）：
    //   1 顶层铜  2 底层铜  3 顶层丝印  4 底层丝印  5 顶层阻焊  6 底层阻焊
    //   7 顶层锡膏 8 底层锡膏 9 顶层装配 10 底层装配 11 板框 12 多层 13 文档 14 机械
    //   15~46 内层 1~32   47 钻孔   56 钻孔图   57 其他   58/59 补强
    const LAYER_ID = {
        TOP: 1, BOTTOM: 2,
        TOP_SILK: 3, BOT_SILK: 4,
        TOP_MASK: 5, BOT_MASK: 6,
        TOP_PASTE: 7, BOT_PASTE: 8,
        TOP_ASSEMBLY: 9, BOT_ASSEMBLY: 10,
        OUTLINE: 11, MULTI: 12, DOCUMENT: 13, MECHANICAL: 14,
        DRILL: 47, DRILL_DRAWING: 56, OTHER: 57
    };

    /**
     * 铜层序号 → 内部图层 ID。
     *
     * @param n - Gerber X2 中 Copper 的层号（从 1 起，1=顶层，N=底层）
     * @param side - 'Top' | 'Bot' | 'Inr'
     * @returns 内部图层 ID
     */
    function mapCopperLayerNo(n, side) {
        const num = parseInt(n, 10);
        if (!num || num < 1) return LAYER_ID.TOP;
        if (num === 1) return LAYER_ID.TOP;
        if (side === 'Bot') return LAYER_ID.BOTTOM;
        // 内层：Copper,L2,Inr → 内层1(15)；Copper,L3,Inr → 内层2(16)
        const innerIdx = num - 1;
        if (innerIdx >= 1 && innerIdx <= 32) return 14 + innerIdx;
        return LAYER_ID.OTHER;
    }

    /**
     * 解析 Gerber X2/X3 的 %TF.FileFunction 属性值。
     * 形如：Copper,L1,Top / Copper,L2,Inr / Soldermask,Top / Legend,Bot /
     *       Paste,Top / Profile,NP / Assembly,Top / Other,Drill / Drillmap
     *
     * @param value - 属性值（逗号分隔）
     * @returns 内部图层 ID；无法识别时返回 null
     */
    function parseGerberFileFunction(value) {
        if (!value) return null;
        const parts = String(value).split(',').map((s) => s.trim());
        const kind = (parts[0] || '').toLowerCase();
        const second = (parts[1] || '').toLowerCase();
        const side = (parts.length > 2 ? parts[2] : parts[1] || '').toLowerCase();
        const isBottom = /bot|bottom/.test(side) || /bot|bottom/.test(second);

        switch (kind) {
            case 'copper': {
                // Copper,L<n>,<Top|Inr|Bot>
                const n = second.replace(/^l/i, '');
                return mapCopperLayerNo(n, isBottom ? 'Bot' : (/inr|inner/.test(side) ? 'Inr' : 'Top'));
            }
            case 'soldermask':
            case 'solder_mask':
                return isBottom ? LAYER_ID.BOT_MASK : LAYER_ID.TOP_MASK;

            case 'legend':
            case 'silkscreen':
                return isBottom ? LAYER_ID.BOT_SILK : LAYER_ID.TOP_SILK;

            case 'paste':
            case 'smdpaste':
                return isBottom ? LAYER_ID.BOT_PASTE : LAYER_ID.TOP_PASTE;

            case 'assembly':
                return isBottom ? LAYER_ID.BOT_ASSEMBLY : LAYER_ID.TOP_ASSEMBLY;

            case 'profile':
                return LAYER_ID.OUTLINE;

            case 'drillmap':
                return LAYER_ID.DRILL_DRAWING;

            case 'mechanical':
                return LAYER_ID.MECHANICAL;

            case 'other':
                if (/drill/.test(second)) return LAYER_ID.DRILL;
                return LAYER_ID.OTHER;

            default:
                return null;
        }
    }

    // 组装图层规则的公共片段（注意：SEP 是字符类，BOT/TOP 是分组，拼接时不要重复加括号）
    const _SEP = '[_.\\- ]';                 // 分隔符：下划线 / 点 / 横线 / 空格
    const _SEPo = _SEP + '?';                // 可选分隔符
    const _BOT = '(?:bot|bottom|back|b)';    // 方位词：底（含单字母 b，兼容 -B_Cu）
    const _TOP = '(?:top|front|f)';          // 方位词：顶（含单字母 f，兼容 -F_Cu）
    const re = (body) => new RegExp(body, 'i');

    /**
     * 行业通用的图层识别规则：自上而下匹配，命中即止。
     * 覆盖 KiCad、Altium/Protel、Eagle、OrCAD、PADS、P-CAD 等常见导出命名。
     *
     * 两个排序要点（踩过坑）：
     *  1. 同一族内必须「扩展名 → 方位词在后 → 方位词在前 → 无方位词」，
     *     否则 "*_silkscreen_bottom.gbr" 会先被泛化的顶层规则吃掉，归到顶层丝印。
     *  2. 方位词前缀型（F_Cu / B_Mask）与后缀型（copper_top / soldermask_bottom）
     *     两种命名都要写，因为不同软件的习惯完全相反。
     */
    const INDUSTRY_LAYER_RULES = [
        // ---------- 板框 / 外形 ----------
        { regex: re('(^|' + _SEP + ')edge' + _SEPo + 'cuts'), layerId: LAYER_ID.OUTLINE },  // KiCad: -Edge_Cuts.gbr
        { regex: re('\\.GKO$'), layerId: LAYER_ID.OUTLINE },                                 // Altium keep-out
        { regex: re('\\.GM1$|\\.OUT$'), layerId: LAYER_ID.OUTLINE },                         // Altium 机械层 1 常作板框
        { regex: re('\\.BDR$'), layerId: LAYER_ID.OUTLINE },                                 // P-CAD Board
        { regex: re('(board' + _SEPo + 'outline|outline|profile)'), layerId: LAYER_ID.OUTLINE },

        // ---------- 钻孔 ----------
        // 细分规则优先：区分金属化(PTH 500) / 非金属化(NPTH 501) / 埋盲孔(502)。
        // 这三类在提取时行为不同（NPTH 不算电镀孔、埋盲孔要读层对），所以不能一律归 47。
        { regex: re('drill' + _SEPo + 'npth' + _SEPo + 'through'), layerId: 501 },
        { regex: re('drill' + _SEPo + 'pth' + _SEPo + 'through'), layerId: 500 },
        { regex: re('drill' + _SEPo + '.*' + _SEPo + 'to' + _SEPo), layerId: 502 },
        { regex: re('\\.DRL$|\\.XLN$|\\.XY$|\\.NCD$|\\.NC$'), layerId: LAYER_ID.DRILL },
        { regex: re('\\.GD1$'), layerId: LAYER_ID.DRILL_DRAWING },                           // Protel 钻孔图
        { regex: re('\\.GDD$'), layerId: LAYER_ID.DRILL_DRAWING },
        { regex: re('drill' + _SEPo + 'map'), layerId: LAYER_ID.DRILL_DRAWING },
        { regex: re('(ncdrill|\\.txt$)'), layerId: LAYER_ID.DRILL },
        { regex: re('drill'), layerId: LAYER_ID.DRILL },

        // ---------- 内层铜（必须早于外层铜规则）----------
        { regex: re(_SEP + '(?:in|inner)' + _SEPo + 'l?(\\d+)'), captureInner: 1 },          // -In1_Cu / .IN1 / inner2
        { regex: re('\\.G(\\d+)$'), captureInnerStr: 1 },                                    // Protel 内层: .G1 .G2

        // ---------- 嘉立创自定义层：Gerber_CustomLayerN.GCL → 自定义 N (71~100) ----------
        { regex: re('custom' + _SEPo + 'layer' + _SEPo + '(\\d+)'), captureCustom: 1 },

        // ---------- 外层铜 ----------
        { regex: re('\\.GTL$'), layerId: LAYER_ID.TOP },
        { regex: re('\\.GBL$'), layerId: LAYER_ID.BOTTOM },
        { regex: re('\\.TOP$'), layerId: LAYER_ID.TOP },                                     // P-CAD / Eagle: .TOP
        { regex: re('\\.BOT$'), layerId: LAYER_ID.BOTTOM },                                  // P-CAD / Eagle: .BOT
        { regex: re('copper' + _SEPo + _BOT), layerId: LAYER_ID.BOTTOM },                    // copper_bottom / CopperBottom
        { regex: re('copper' + _SEPo + _TOP), layerId: LAYER_ID.TOP },                       // copper_top / CopperTop
        { regex: re(_BOT + _SEPo + 'cu\\b'), layerId: LAYER_ID.BOTTOM },                     // -B_Cu / bottom_cu
        { regex: re(_TOP + _SEPo + 'cu\\b'), layerId: LAYER_ID.TOP },                        // -F_Cu / top_cu
        { regex: re(_BOT + _SEPo + '(?:copper|layer)'), layerId: LAYER_ID.BOTTOM },          // BottomCopper / BottomLayer
        { regex: re(_TOP + _SEPo + '(?:copper|layer)'), layerId: LAYER_ID.TOP },             // TopCopper / TopLayer

        // ---------- 丝印 ----------
        { regex: re('\\.GTO$|\\.STC$|\\.PLC$'), layerId: LAYER_ID.TOP_SILK },                // .GTO / Eagle .STC
        { regex: re('\\.GBO$|\\.STS$|\\.PLS$'), layerId: LAYER_ID.BOT_SILK },                // .GBO / Eagle .STS
        { regex: re('\\.TSL$'), layerId: LAYER_ID.TOP_SILK },                                // P-CAD Top Silk
        { regex: re('\\.BSL$'), layerId: LAYER_ID.BOT_SILK },                                // P-CAD Bottom Silk
        { regex: re('(?:silkscreen|silk|legend)' + _SEPo + _BOT), layerId: LAYER_ID.BOT_SILK },
        { regex: re(_BOT + _SEPo + '(?:silkscreen|silk|legend)'), layerId: LAYER_ID.BOT_SILK },
        { regex: re('(?:silkscreen|silk|legend)' + _SEPo + _TOP), layerId: LAYER_ID.TOP_SILK },
        { regex: re(_TOP + _SEPo + '(?:silkscreen|silk|legend)'), layerId: LAYER_ID.TOP_SILK },
        { regex: re('silkscreen|silk|legend'), layerId: LAYER_ID.TOP_SILK },                 // 无方位词默认顶层

        // ---------- 锡膏 / 钢网（嘉立创的 smdmask 必须排在阻焊之前，否则会被 mask 规则吃掉）----------
        { regex: re('smd' + _SEPo + 'mask' + _SEPo + _BOT), layerId: LAYER_ID.BOT_PASTE },   // JLC: _smdmask_bottom
        { regex: re('smd' + _SEPo + 'mask' + _SEPo + _TOP), layerId: LAYER_ID.TOP_PASTE },   // JLC: _smdmask_top

        // ---------- 阻焊 ----------
        { regex: re('\\.GTS$|\\.SMT$'), layerId: LAYER_ID.TOP_MASK },                        // .GTS / Eagle .SMT
        { regex: re('\\.GBS$|\\.SMB$'), layerId: LAYER_ID.BOT_MASK },                        // .GBS / Eagle .SMB
        { regex: re('\\.TMS$'), layerId: LAYER_ID.TOP_MASK },                                // P-CAD Top Mask
        { regex: re('\\.BMS$'), layerId: LAYER_ID.BOT_MASK },                                // P-CAD Bottom Mask
        { regex: re('(?:solder' + _SEPo + 'mask|mask)' + _SEPo + _BOT), layerId: LAYER_ID.BOT_MASK },
        { regex: re(_BOT + _SEPo + '(?:solder' + _SEPo + 'mask|mask)'), layerId: LAYER_ID.BOT_MASK },
        { regex: re('(?:solder' + _SEPo + 'mask|mask)' + _SEPo + _TOP), layerId: LAYER_ID.TOP_MASK },
        { regex: re(_TOP + _SEPo + '(?:solder' + _SEPo + 'mask|mask)'), layerId: LAYER_ID.TOP_MASK },
        { regex: re('solder' + _SEPo + 'mask'), layerId: LAYER_ID.TOP_MASK },                // 无方位词默认顶层

        // ---------- 锡膏 / 钢网（其余命名）----------
        { regex: re('\\.GTP$|\\.CRT$'), layerId: LAYER_ID.TOP_PASTE },                       // .GTP / Eagle .CRT
        { regex: re('\\.GBP$|\\.CRB$'), layerId: LAYER_ID.BOT_PASTE },                       // .GBP / Eagle .CRB
        { regex: re('(?:paste|stencil)' + _SEPo + _BOT), layerId: LAYER_ID.BOT_PASTE },
        { regex: re(_BOT + _SEPo + '(?:solder' + _SEPo + 'paste|paste|stencil)'), layerId: LAYER_ID.BOT_PASTE },
        { regex: re('(?:paste|stencil)' + _SEPo + _TOP), layerId: LAYER_ID.TOP_PASTE },
        { regex: re(_TOP + _SEPo + '(?:solder' + _SEPo + 'paste|paste|stencil)'), layerId: LAYER_ID.TOP_PASTE },
        { regex: re('solder' + _SEPo + 'paste|paste|stencil'), layerId: LAYER_ID.TOP_PASTE },

        // ---------- 装配 ----------
        { regex: re('\\.GTA$'), layerId: LAYER_ID.TOP_ASSEMBLY },
        { regex: re('\\.GBA$'), layerId: LAYER_ID.BOT_ASSEMBLY },
        { regex: re('(?:assembly|fab)' + _SEPo + _BOT), layerId: LAYER_ID.BOT_ASSEMBLY },
        { regex: re(_BOT + _SEPo + '(?:fab|assembly)'), layerId: LAYER_ID.BOT_ASSEMBLY },
        { regex: re('(?:assembly|fab)' + _SEPo + _TOP), layerId: LAYER_ID.TOP_ASSEMBLY },
        { regex: re(_TOP + _SEPo + '(?:fab|assembly)'), layerId: LAYER_ID.TOP_ASSEMBLY },
        { regex: re('fabrication|assembly'), layerId: LAYER_ID.TOP_ASSEMBLY },

        // ---------- 机械 / 文档 / 其他 ----------
        { regex: re('\\.GME$'), layerId: LAYER_ID.MECHANICAL },
        { regex: re('\\.GML$'), layerId: LAYER_ID.MECHANICAL },                              // P-CAD Mechanical
        { regex: re('\\.GD[2-9]$'), layerId: LAYER_ID.MECHANICAL },
        { regex: re('mechanical|mech'), layerId: LAYER_ID.MECHANICAL },
        { regex: re('user' + _SEPo + '(?:drawings|comments|eco)'), layerId: LAYER_ID.DOCUMENT },
        { regex: re('\\.GDL$'), layerId: LAYER_ID.DOCUMENT }
    ];

    /**
     * 用行业规则解析文件名对应的图层 ID。
     *
     * @param name - 文件名（可含路径）
     * @param defaultId - 都不匹配时的返回值（默认 57 其他）
     * @returns 图层 ID
     */
    function resolveIndustryLayerId(name, defaultId) {
        const fallback = (defaultId === undefined || defaultId === null) ? LAYER_ID.OTHER : defaultId;
        if (!name) return fallback;
        const base = String(name).split(/[\\/]/).pop();
        for (let i = 0; i < INDUSTRY_LAYER_RULES.length; i++) {
            const rule = INDUSTRY_LAYER_RULES[i];
            const m = base.match(rule.regex);
            if (!m) continue;
            // 捕获内层序号的两类规则
            if (rule.captureInnerStr) {
                const num = parseInt(String(m[rule.captureInnerStr]).replace(/^l/i, ''), 10);
                if (num >= 1 && num <= 32) return 14 + num;
                continue;
            }
            if (rule.captureInner) {
                const num = parseInt(m[rule.captureInner], 10);
                if (num >= 1 && num <= 32) return 14 + num;
                continue;
            }
            // 嘉立创自定义层：Gerber_CustomLayerN.GCL → 71~100
            if (rule.captureCustom) {
                const num = parseInt(m[rule.captureCustom], 10);
                if (num >= 1 && num <= 30) return 70 + num;
                continue;
            }
            return rule.layerId;
        }
        return fallback;
    }
