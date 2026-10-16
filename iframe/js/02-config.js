// ====================================================================================
// 02-config.js  —  运行配置与图层定义数据
// ------------------------------------------------------------------------------------
// 职责：调试开关、全局变量，以及 Gerber 图层识别与展示所需的全部静态数据。
//   · DEBUG / currentZipName / flyingProbeData        —— 调试开关与全局变量
//   · rawLayerData / cnNames / layerDefs / layerIdMap —— 图层定义与中文名映射
//   · uiGroups / allGroupedIds                        —— 侧栏图层分组
//   · fileNameRules / easyEdaRules / customPatternRules / extensionRules —— 文件名识别规则
// 依赖：无（本文件内自执行若干 for/forEach 完成初始化）。
// 说明：工程文件头模板常量已拆分至 01-templates.js。
// 加载顺序：第 2 个
// ====================================================================================

// ====================================================================================
// 1. 全局常量与配置
// ====================================================================================

    // --- 调试开关 ---
    // let DEBUG = true;  // 开启调试模式
    let DEBUG = false; // 关闭调试模式

    // --- 全局变量 ---
    let currentZipName = null; // 用于存储当前导入的压缩包名
    let flyingProbeData = null; //用于存储飞针测试数据

    // 原始图层数据定义 ["类型", 层ID, "类型", "别名", 状态, "激活颜色", 激活透明度, "非激活颜色", 非激活透明度]
    const rawLayerData = [
        ["LAYER",1,"TOP","Top Layer",3,"#cc6633",1,"#7f0000",0.5],
        ["LAYER",2,"BOTTOM","Bottom Layer",3,"#6699ff",1,"#00007f",0.5],
        ["LAYER",3,"TOP_SILK","Top Silkscreen Layer",3,"#ffcc00",0.8,"#7f6600",0.5],
        ["LAYER",4,"BOT_SILK","Bottom Silkscreen Layer",3,"#66cc33",0.8,"#336619",0.5],
        ["LAYER",5,"TOP_SOLDER_MASK","Top Solder Mask Layer",3,"#800080",0.2,"#400040",0.5],
        ["LAYER",6,"BOT_SOLDER_MASK","Bottom Solder Mask Layer",3,"#aa00ff",0.2,"#55007f",0.5],
        ["LAYER",7,"TOP_PASTE_MASK","Top Paste Mask Layer",3,"#808080",0.2,"#404040",0.5],
        ["LAYER",8,"BOT_PASTE_MASK","Bottom Paste Mask Layer",3,"#800000",0.2,"#400000",0.5],
        ["LAYER",9,"TOP_ASSEMBLY","Top Assembly Layer",3,"#33cc99",0.5,"#19664c",0.5],
        ["LAYER",10,"BOT_ASSEMBLY","Bottom Assembly Layer",3,"#5555ff",0.5,"#2a2a7f",0.5],
        ["LAYER",11,"OUTLINE","Board Outline Layer",3,"#ff00ff",1,"#7f007f",0.5],
        ["LAYER",12,"MULTI","Multi-Layer",3,"#c0c0c0",0.7,"#606060",0.5],
        ["LAYER",13,"DOCUMENT","Document Layer",3,"#ffffff",0.7,"#7f7f7f",0.5],
        ["LAYER",14,"MECHANICAL","Mechanical Layer",3,"#f022f0",0.7,"#781178",0.5],
        ["LAYER",15,"SIGNAL","Inner1",3,"#999966",1,"#4c4c33",0.5],
        ["LAYER",16,"SIGNAL","Inner2",3,"#0099cc",1,"#004000",0.5],
        ["LAYER",17,"SIGNAL","Inner3",3,"#339999",1,"#007f00",0.5],
        ["LAYER",18,"SIGNAL","Inner4",3,"#bc8e00",1,"#5e4700",0.5],
        ["LAYER",19,"SIGNAL","Inner5",0,"#70dbfa",1,"#386d7d",0.5],
        ["LAYER",20,"SIGNAL","Inner6",0,"#00cc66",1,"#006633",0.5],
        ["LAYER",21,"SIGNAL","Inner7",0,"#9966ff",1,"#4c337f",0.5],
        ["LAYER",22,"SIGNAL","Inner8",0,"#800080",1,"#400040",0.5],
        ["LAYER",23,"SIGNAL","Inner9",0,"#008080",1,"#004040",0.5],
        ["LAYER",24,"SIGNAL","Inner10",0,"#15935f",1,"#a492f",0.5],
        ["LAYER",25,"SIGNAL","Inner11",0,"#000080",1,"#000040",0.5],
        ["LAYER",26,"SIGNAL","Inner12",0,"#00b400",1,"#005a00",0.5],
        ["LAYER",27,"SIGNAL","Inner13",0,"#2e4756",1,"#17232b",0.5],
        ["LAYER",28,"SIGNAL","Inner14",0,"#99842f",1,"#4c4217",0.5],
        ["LAYER",29,"SIGNAL","Inner15",0,"#ffffaa",1,"#7f7f55",0.5],
        ["LAYER",30,"SIGNAL","Inner16",0,"#99842f",1,"#4c4217",0.5],
        ["LAYER",31,"SIGNAL","Inner17",0,"#2e4756",1,"#17232b",0.5],
        ["LAYER",32,"SIGNAL","Inner18",0,"#3535ff",1,"#1a1a7f",0.5],
        ["LAYER",33,"SIGNAL","Inner19",0,"#8000bc",1,"#40005e",0.5],
        ["LAYER",34,"SIGNAL","Inner20",0,"#43ae5f",1,"#21572f",0.5],
        ["LAYER",35,"SIGNAL","Inner21",0,"#c3ecce",1,"#617667",0.5],
        ["LAYER",36,"SIGNAL","Inner22",0,"#728978",1,"#39443c",0.5],
        ["LAYER",37,"SIGNAL","Inner23",0,"#39503f",1,"#1c281f",0.5],
        ["LAYER",38,"SIGNAL","Inner24",0,"#0c715d",1,"#06382e",0.5],
        ["LAYER",39,"SIGNAL","Inner25",0,"#5a8a80",1,"#2d4540",0.5],
        ["LAYER",40,"SIGNAL","Inner26",0,"#2b937e",1,"#15493f",0.5],
        ["LAYER",41,"SIGNAL","Inner27",0,"#23999d",1,"#114c4e",0.5],
        ["LAYER",42,"SIGNAL","Inner28",0,"#45b4e3",1,"#225a71",0.5],
        ["LAYER",43,"SIGNAL","Inner29",0,"#215da1",1,"#102e50",0.5],
        ["LAYER",44,"SIGNAL","Inner30",0,"#4564d7",1,"#22326b",0.5],
        ["LAYER",45,"SIGNAL","Inner31",0,"#6969e9",1,"#343474",0.5],
        ["LAYER",46,"SIGNAL","Inner32",0,"#9069e9",1,"#483474",0.5],
        ["LAYER",47,"HOLE","Hole Layer",3,"#222222",1,"#111111",0.5],
        ["LAYER",48,"COMPONENT_SHAPE","Component Shape Layer",1,"#00cccc",1,"#006666",0.5],
        ["LAYER",49,"COMPONENT_MARKING","Component Marking Layer",1,"#66ffcc",1,"#337f66",0.5],
        ["LAYER",50,"PIN_SOLDERING","Pin Soldering Layer",1,"#cc9999",1,"#664c4c",0.5],
        ["LAYER",51,"PIN_FLOATING","Pin Floating Layer",1,"#ff99ff",1,"#7f4c7f",0.5],
        ["LAYER",52,"COMPONENT_MODEL","Component Model Layer",0,"#ffffff",1,"#7f7f7f",0.5],
        ["LAYER",53,"3D_SHELL_OUTLINE","3D Shell Outline Layer",3,"#66ff99",1,"#337f4c",0.5],
        ["LAYER",54,"3D_SHELL_TOP","3D Shell Top Layer",3,"#ffccff",1,"#7f667f",0.5],
        ["LAYER",55,"3D_SHELL_BOTTOM","3D Shell Bottom Layer",3,"#0066cc",1,"#003366",0.5],
        ["LAYER",56,"DRILL_DRAWING","Drill Drawing Layer",3,"#008080",1,"#004040",0.5],
        ["LAYER",57,"OTHER","Ratline Layer",7,"#6464ff",1,"#32327f",0.5],
        ["LAYER",58,"TOP_STIFFENER","Top Stiffener Layer",0,"#eee666",1,"#777333",0.5],
        ["LAYER",59,"BOTTOM_STIFFENER","Bottom Stiffener Layer",0,"#ccff00",1,"#667f00",0.5],
        // --- [新增] 内部专用图元图层 (ID 500+) ---
        ["LAYER",500,"DRILL_PTH","PTH Through",3,"#222222",1,"#666666",0.5],          // 金属化通孔
        ["LAYER",501,"DRILL_NPTH","NPTH Through",3,"#222222",1,"#7f4c00",0.5],        // 非金属化通孔
        ["LAYER",502,"DRILL_BLIND","Blind/Buried Via",3,"#cccccc",0.5,"#007f7f",0.5],  // 埋盲孔
        // --- [新增] 飞针标注层（2001~2003）：数据来自 FlyingProbeTesting.json，**仅用于画布标注显示**，
        //     不对应任何 Gerber 文件、也不参与导入。前两个只显示，元件位号勾选后才会导出。
        ["LAYER",2001, "PAD_NUMBER", "引脚编号", 3, "#ffffff", 1, "#7f2a2a", 0.5],
        ["LAYER",2002, "NET_NAME",   "网络名称", 3, "#ffffff", 1, "#196f7f", 0.5],
        ["LAYER",2003, "REFDES",     "元件位号", 3, "#00ffff", 1, "#7f226f", 0.5]
    ];

    // 飞针标注层 id 常量（与上面的 rawLayerData 一一对应）
    const FLYING_LAYER = { PAD_NUMBER: 2001, NET_NAME: 2002, REFDES: 2003 };
    const FLYING_LAYER_IDS = [FLYING_LAYER.PAD_NUMBER, FLYING_LAYER.NET_NAME, FLYING_LAYER.REFDES];
    const isFlyingLayer = (id) => FLYING_LAYER_IDS.indexOf(id) >= 0;

    // 元件位号字高（默认 24 mil）：画布按世界尺寸随缩放显示，导出装配层文字也用同一字高
    const FLYING_REFDES_HEIGHT_MIL = 24;

    // 引脚编号 / 网络名称的文字上限（px）；低于下限说明焊盘实在装不下，直接隐藏
    const FLYING_LABEL_MAX_FONT = 12;
    const FLYING_LABEL_MIN_FONT = 4;

    // 添加自定义层 (71-100)
    for(let i=71; i<=100; i++) {
        const color = rawLayerData.find(d => d[1] === (i-71+46))?.[5] || "#888888"; // 简单回退颜色
        rawLayerData.push(["LAYER", i, "CUSTOM", `自定义${i-70}`, 0, color, 1, color, 0.5]);
    }

    // 中文名称映射表
    const cnNames = {
        1: "顶层线路", 
        2: "底层线路", 
        3: "顶层丝印", 
        4: "底层丝印", 
        5: "顶层阻焊", 
        6: "底层阻焊", 
        7: "顶层锡膏", 
        8: "底层锡膏", 
        9: "顶层装配", 
        10: "底层装配",
        11: "板框层", 
        12: "多层", 
        13: "文档层", 
        14: "机械层",
        47: "钻孔层", 
        57: "其他",
        48: "元件形状层",
        49: "元件标记层",
        50: "引脚焊接层",
        51: "引脚浮动层",
        52: "元件模型层",
        53: "3D外壳边框层",
        54: "3D外壳顶层",
        55: "3D外壳底层",
        56: "钻孔图层",
        58: "顶部补强层(FPC)",
        59: "底部补强板(FPC)",
        500: "金属化通孔",
        501: "非金属化通孔",
        502: "埋盲孔"
    };
    
    // 初始化 layerDefs
    const layerDefs = {};
    const layerIdMap = {};
    
    // 对图层名称进行汉化处理
    rawLayerData.forEach(item => {
        const id = item[1];
        let name = cnNames[id] || item[3]; // 优先使用中文名，否则用英文
        if (id >= 15 && id <= 46) name = item[3].replace("Inner", "内层"); // 内层汉化

        layerDefs[id] = {
            name: name,
            color: item[5], // 第6个参数
            alpha: item[6]  // 第7个参数
        };
        layerIdMap[id] = name;
    });

    // 定义分组显示结构
    const uiGroups = [
        { 
            id: "TOP", name: "顶面", 
            ids: [1, 3, 5, 7, 9, 58] 
        },
        { 
            id: "BOTTOM", name: "底面", 
            ids: [2, 4, 6, 8, 10, 59] 
        },
        { 
            id: "INNER", name: "内层", 
            ids: [] // 自动填充 15-46
        },
        { 
            id: "OTHER", name: "多层/钻孔", 
            // [修改] 添加 500, 501, 502
            ids: [11, 12, 47, 500, 501, 502] 
        },
        {
            id: "CUSTOM", name: "自定义/特殊",
            ids: [] // 自动填充剩余
        }
    ];

    // 填充内层
    for(let i=15; i<=46; i++) uiGroups[2].ids.push(i);

    // 填充其余未归类的层到“自定义/特殊”
    const allGroupedIds = new Set(uiGroups.flatMap(g => g.ids));
    rawLayerData.forEach(item => {
        if(!allGroupedIds.has(item[1]) && item[1] !== 47) {
             uiGroups[4].ids.push(item[1]);
        }
    });
    
    // --- 文件名匹配规则 (重构版：优先全名，后备扩展名) ---
    const fileNameRules = [];

    // 1. EasyEDA/立创EDA 导出文件名格式
    const easyEdaRules = [
        { regex: /Gerber_TopLayer/i, layerId: 1 },                // 顶层
        { regex: /Gerber_BottomLayer/i, layerId: 2 },             // 底层
        { regex: /Gerber_TopSilkscreenLayer/i, layerId: 3 },      // 顶层丝印
        { regex: /Gerber_BottomSilkscreenLayer/i, layerId: 4 },   // 底层丝印
        { regex: /Gerber_TopSolderMaskLayer/i, layerId: 5 },      // 顶层阻焊
        { regex: /Gerber_BottomSolderMaskLayer/i, layerId: 6 },   // 底层阻焊
        { regex: /Gerber_TopPasteMaskLayer/i, layerId: 7 },       // 顶层锡膏
        { regex: /Gerber_BottomPasteMaskLayer/i, layerId: 8 },    // 底层锡膏
        { regex: /Gerber_TopAssemblyLayer/i, layerId: 9 },        // 顶层装配
        { regex: /Gerber_BottomAssemblyLayer/i, layerId: 10 },    // 底层装配
        { regex: /Gerber_BoardOutlineLayer/i, layerId: 11 },      // 板框
        { regex: /Gerber_MechanicalLayer/i, layerId: 14 },        // 机械层
        { regex: /Gerber_DocumentLayer/i, layerId: 13 },          // 文档层
        { regex: /Gerber_DrillDrawingLayer/i, layerId: 56 },      // 钻孔图层

        // --- [新增] 细分钻孔匹配规则 ---
        // 使用 ID 500+
        { regex: /Drill_PTH_Through/i, layerId: 500 },            // 金属化钻孔
        { regex: /Drill_NPTH_Through/i, layerId: 501 },           // 非金属化钻孔
        { regex: /Drill_.*_to_.*/i, layerId: 502 },               // 埋盲孔钻孔
        
        // --- [原有] 通用兜底规则 ---
        { regex: /Drill_PTH/i, layerId: 47 },                     
        { regex: /Drill_NPTH/i, layerId: 47 },                    
        { regex: /Drill_Through/i, layerId: 47 }
    ];
    
    // 动态添加 EasyEDA Pro 内层规则 (Gerber_InnerLayer1.G1 -> ID 15)
    for (let i = 1; i <= 32; i++) {
        // 这里的正则变成了 /Gerber_InnerLayer1\./i
        // 这样它只能匹配 "Gerber_InnerLayer1.G1"，而无法匹配 "Gerber_InnerLayer10.G10"
        easyEdaRules.push({ 
            regex: new RegExp(`Gerber_InnerLayer${i}\\.`, 'i'), 
            layerId: 14 + i 
        });
    }

    // 2. 【新增】自定义下划线命名规则 (匹配 xxx_copper_top.gbr 等)
    const customPatternRules = [
        { regex: /_copper_top\.gbr$/i, layerId: 1 },         // 顶层线路
        { regex: /_copper_bottom\.gbr$/i, layerId: 2 },      // 底层线路
        
        { regex: /_silkscreen_top\.gbr$/i, layerId: 3 },     // 顶层丝印
        { regex: /_silkscreen_bottom\.gbr$/i, layerId: 4 },  // 底层丝印
        
        { regex: /_soldermask_top\.gbr$/i, layerId: 5 },     // 顶层阻焊
        { regex: /_soldermask_bottom\.gbr$/i, layerId: 6 },  // 底层阻焊
        
        { regex: /_smdmask_top\.gbr$/i, layerId: 7 },        // 顶层助焊/钢网
        { regex: /_smdmask_bottom\.gbr$/i, layerId: 8 },     // 底层助焊/钢网
        
        { regex: /_outline\.gbr$/i, layerId: 11 },           // 板框
        
        // 钻孔文件直接匹配扩展名 .drl (对应你的 xxx.drl)
        { regex: /\.drl$/i, layerId: 47 } 
    ];


    // 3. 【低优先级】通用扩展名兜底
    // 如果文件名不匹配上面的特定格式，则尝试通过扩展名识别
    const extensionRules = [
        { regex: /\.GTL$/i, layerId: 1 }, 
        { regex: /\.GBL$/i, layerId: 2 },
        { regex: /\.GTO$/i, layerId: 3 }, 
        { regex: /\.GBO$/i, layerId: 4 },
        { regex: /\.GTS$/i, layerId: 5 }, 
        { regex: /\.GBS$/i, layerId: 6 },
        { regex: /\.GTP$/i, layerId: 7 }, 
        { regex: /\.GBP$/i, layerId: 8 },
        { regex: /\.GTA$/i, layerId: 9 }, 
        { regex: /\.GBA$/i, layerId: 10 },
        { regex: /\.GKO$|\.GM1$|\.GML$|\.OUT$/i, layerId: 11 },
        { regex: /\.GME$/i, layerId: 14 },
        { regex: /\.GDL$/i, layerId: 13 },
        { regex: /\.GDD$/i, layerId: 56 },
        { regex: /\.DRL$|\.TXT$|\.XY$|\.XLN$/i, layerId: 47 } // 常见钻孔扩展名
    ];

    // 动态添加通用内层扩展名 (.G1, .G2, .GP1, .IN1 等)
    for (let i = 1; i <= 32; i++) {
        extensionRules.push({ 
            // 匹配 .G1, .G10, .GP1 等，依靠 $ 确保是结尾，避免 .G1 匹配 .G10
            regex: new RegExp(`\\.G${i}$|\\.GP${i}$|\\.IN${i}$`, 'i'), 
            layerId: 14 + i 
        });
    }

    // 合并规则：高优先级在前，数组 find 方法会返回第一个匹配项
    fileNameRules.push(...easyEdaRules, ...customPatternRules, ...extensionRules);

