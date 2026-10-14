// ====================================================================================
// 01-templates.js  —  工程文件头模板常量
// ------------------------------------------------------------------------------------
// 职责：存放导出「嘉立创 EDA 工程文件」时使用的源码头模板（纯数据，无逻辑）。
//   · LCEDA_STD_Head_Source —— 标准版头文件（当前为空串，预留）
//   · LCEDA_V2_Head_Source  —— 专业版 V2 头（["DOCTYPE","PCB","1.8"] 行格式）
//   · LCEDA_V3_Head_Source  —— 专业版 V3 头（{"type":"DOCHEAD"}||{...} 行格式）
// 依赖：无。被 08-export.js 的 configureHeader() / exportForEasyEDA_Pro() 运行时读取。
// 注意：本文件是「由 EDA 导出的模板文本」，请勿手工格式化或调整缩进 ——
//       模板内容会被逐行解析，改动空白可能导致导出文件解析失败。
// 加载顺序：第 1 个
// ====================================================================================

    // 标准版头文件
    const LCEDA_STD_Head_Source = ``; 

    // 专业版 V2 头文件
    const LCEDA_V2_Head_Source = `["DOCTYPE","PCB","1.8"]
["HEAD",{"editorVersion":"2.2.45.5","importFlag":0}]
["CANVAS",0,0,"mil",5,5,1,1,10,10,0,0,5]
["LAYER",1,"TOP","Top Layer",3,"#cc6633",1,"#7f0000",1]
["LAYER",2,"BOTTOM","Bottom Layer",3,"#6699ff",1,"#00007f",1]
["LAYER",3,"TOP_SILK","Top Silkscreen Layer",3,"#ffcc00",0.9,"#7f6600",1]
["LAYER",4,"BOT_SILK","Bottom Silkscreen Layer",3,"#66cc33",0.9,"#336619",1]
["LAYER",5,"TOP_SOLDER_MASK","Top Solder Mask Layer",3,"#800080",0.7,"#400040",1]
["LAYER",6,"BOT_SOLDER_MASK","Bottom Solder Mask Layer",3,"#aa00ff",0.7,"#55007f",1]
["LAYER",7,"TOP_PASTE_MASK","Top Paste Mask Layer",3,"#808080",1,"#404040",1]
["LAYER",8,"BOT_PASTE_MASK","Bottom Paste Mask Layer",3,"#800000",1,"#400000",1]
["LAYER",9,"TOP_ASSEMBLY","Top Assembly Layer",3,"#33cc99",1,"#19664c",1]
["LAYER",10,"BOT_ASSEMBLY","Bottom Assembly Layer",3,"#5555ff",1,"#2a2a7f",1]
["LAYER",11,"OUTLINE","Board Outline Layer",3,"#ff00ff",1,"#7f007f",1]
["LAYER",12,"MULTI","Multi-Layer",3,"#c0c0c0",0.5,"#606060",1]
["LAYER",13,"DOCUMENT","Document Layer",3,"#ffffff",1,"#7f7f7f",1]
["LAYER",14,"MECHANICAL","Mechanical Layer",3,"#f022f0",1,"#781178",1]
["LAYER",15,"SIGNAL","Inner1",3,"#999966",1,"#4c4c33",1]
["LAYER",16,"SIGNAL","Inner2",3,"#0099cc",1,"#004000",1]
["LAYER",17,"SIGNAL","Inner3",3,"#339999",1,"#007f00",1]
["LAYER",18,"SIGNAL","Inner4",3,"#bc8e00",1,"#5e4700",1]
["LAYER",19,"SIGNAL","Inner5",0,"#70dbfa",1,"#39503f",1]
["LAYER",20,"SIGNAL","Inner6",0,"#00cc66",1,"#006633",1]
["LAYER",21,"SIGNAL","Inner7",0,"#9966ff",1,"#4c337f",1]
["LAYER",22,"SIGNAL","Inner8",0,"#800080",1,"#400040",1]
["LAYER",23,"SIGNAL","Inner9",0,"#008080",1,"#004040",1]
["LAYER",24,"SIGNAL","Inner10",0,"#15935f",1,"#0a492f",1]
["LAYER",25,"SIGNAL","Inner11",0,"#000080",1,"#000040",1]
["LAYER",26,"SIGNAL","Inner12",0,"#00b400",1,"#005a00",1]
["LAYER",27,"SIGNAL","Inner13",0,"#2e4756",1,"#17232b",1]
["LAYER",28,"SIGNAL","Inner14",0,"#99842f",1,"#4c4217",1]
["LAYER",29,"SIGNAL","Inner15",0,"#ffffaa",1,"#7f7f55",1]
["LAYER",30,"SIGNAL","Inner16",0,"#99842f",1,"#4c4217",1]
["LAYER",31,"SIGNAL","Inner17",0,"#2e4756",1,"#17232b",1]
["LAYER",32,"SIGNAL","Inner18",0,"#3535ff",1,"#1a1a7f",1]
["LAYER",33,"SIGNAL","Inner19",0,"#8000bc",1,"#40005e",1]
["LAYER",34,"SIGNAL","Inner20",0,"#43ae5f",1,"#21572f",1]
["LAYER",35,"SIGNAL","Inner21",0,"#c3ecce",1,"#617667",1]
["LAYER",36,"SIGNAL","Inner22",0,"#728978",1,"#39443c",1]
["LAYER",37,"SIGNAL","Inner23",0,"#39503f",1,"#1c281f",1]
["LAYER",38,"SIGNAL","Inner24",0,"#0c715d",1,"#06382e",1]
["LAYER",39,"SIGNAL","Inner25",0,"#5a8a80",1,"#2d4540",1]
["LAYER",40,"SIGNAL","Inner26",0,"#2b937e",1,"#15493f",1]
["LAYER",41,"SIGNAL","Inner27",0,"#23999d",1,"#114c4e",1]
["LAYER",42,"SIGNAL","Inner28",0,"#45b4e3",1,"#225a71",1]
["LAYER",43,"SIGNAL","Inner29",0,"#215da1",1,"#102e50",1]
["LAYER",44,"SIGNAL","Inner30",0,"#4564d7",1,"#22326b",1]
["LAYER",45,"SIGNAL","Inner31",0,"#6969e9",1,"#343474",1]
["LAYER",46,"SIGNAL","Inner32",0,"#9069e9",1,"#483474",1]
["LAYER",47,"HOLE","Hole Layer",3,"#222222",0.5,"#111111",1]
["LAYER",48,"COMPONENT_SHAPE","Component Shape Layer",3,"#00cccc",1,"#006666",1]
["LAYER",49,"COMPONENT_MARKING","Component Marking Layer",3,"#66ffcc",1,"#337f66",1]
["LAYER",50,"PIN_SOLDERING","Pin Soldering Layer",3,"#cc9999",1,"#664c4c",1]
["LAYER",51,"PIN_FLOATING","Pin Floating Layer",3,"#ff99ff",1,"#7f4c7f",1]
["LAYER",52,"COMPONENT_MODEL","Component Model Layer",0,"#ffffff",1,"#7f7f7f",1]
["LAYER",53,"3D_SHELL_OUTLINE","3D Shell Outline Layer",3,"#66ff99",1,"#337f4c",1]
["LAYER",54,"3D_SHELL_TOP","3D Shell Top Layer",3,"#ffccff",1,"#7f667f",1]
["LAYER",55,"3D_SHELL_BOTTOM","3D Shell Bottom Layer",3,"#0066cc",1,"#003366",1]
["LAYER",56,"DRILL_DRAWING","Drill Drawing Layer",3,"#008080",1,"#004040",1]
["LAYER",57,"OTHER","Ratline Layer",7,"#6464ff",1,"#32327f",1]
["LAYER",58,"TOP_STIFFENER","Top Stiffener Layer",0,"#eee666",1,"#777333",1]
["LAYER",59,"BOTTOM_STIFFENER","Bottom Stiffener Layer",0,"#ccff00",1,"#667f00",1]
["LAYER",71,"CUSTOM","Custom1",0,"#9069e9",1,"#483474",1]
["LAYER",72,"CUSTOM","Custom2",0,"#6969e9",1,"#343474",1]
["LAYER",73,"CUSTOM","Custom3",0,"#4564d7",1,"#22326b",1]
["LAYER",74,"CUSTOM","Custom4",0,"#215da1",1,"#102e50",1]
["LAYER",75,"CUSTOM","Custom5",0,"#45b4e3",1,"#225a71",1]
["LAYER",76,"CUSTOM","Custom6",0,"#23999d",1,"#114c4e",1]
["LAYER",77,"CUSTOM","Custom7",0,"#2b937e",1,"#15493f",1]
["LAYER",78,"CUSTOM","Custom8",0,"#5a8a80",1,"#2d4540",1]
["LAYER",79,"CUSTOM","Custom9",0,"#0c715d",1,"#06382e",1]
["LAYER",80,"CUSTOM","Custom10",0,"#39503f",1,"#1c281f",1]
["LAYER",81,"CUSTOM","Custom11",0,"#728978",1,"#39443c",1]
["LAYER",82,"CUSTOM","Custom12",0,"#c3ecce",1,"#617667",1]
["LAYER",83,"CUSTOM","Custom13",0,"#43ae5f",1,"#21572f",1]
["LAYER",84,"CUSTOM","Custom14",0,"#8000bc",1,"#40005e",1]
["LAYER",85,"CUSTOM","Custom15",0,"#3535ff",1,"#1a1a7f",1]
["LAYER",86,"CUSTOM","Custom16",0,"#2e4756",1,"#17232b",1]
["LAYER",87,"CUSTOM","Custom17",0,"#99842f",1,"#4c4217",1]
["LAYER",88,"CUSTOM","Custom18",0,"#ffffaa",1,"#7f7f55",1]
["LAYER",89,"CUSTOM","Custom19",0,"#99842f",1,"#4c4217",1]
["LAYER",90,"CUSTOM","Custom20",0,"#2e4756",1,"#17232b",1]
["LAYER",91,"CUSTOM","Custom21",0,"#00b400",1,"#005a00",1]
["LAYER",92,"CUSTOM","Custom22",0,"#000080",1,"#000040",1]
["LAYER",93,"CUSTOM","Custom23",0,"#15935f",1,"#0a492f",1]
["LAYER",94,"CUSTOM","Custom24",0,"#008080",1,"#004040",1]
["LAYER",95,"CUSTOM","Custom25",0,"#800080",1,"#400040",1]
["LAYER",96,"CUSTOM","Custom26",0,"#9966ff",1,"#4c337f",1]
["LAYER",97,"CUSTOM","Custom27",0,"#00cc66",1,"#006633",1]
["LAYER",98,"CUSTOM","Custom28",0,"#70dbfa",1,"#39503f",1]
["LAYER",99,"CUSTOM","Custom29",0,"#bc8e00",1,"#5e4700",1]
["LAYER",100,"CUSTOM","Custom30",0,"#00ff00",1,"#007f00",1]
["LAYER",361,"SUBSTRATE","Dielectric1",0,"#000000",0,"#000000",1]
["LAYER",362,"SUBSTRATE","Dielectric2",0,"#000000",0,"#000000",1]
["LAYER",363,"SUBSTRATE","Dielectric3",0,"#000000",0,"#000000",1]
["LAYER",364,"SUBSTRATE","Dielectric4",0,"#000000",0,"#000000",1]
["LAYER",365,"SUBSTRATE","Dielectric5",0,"#000000",0,"#000000",1]
["LAYER",366,"SUBSTRATE","Dielectric6",0,"#000000",0,"#000000",1]
["LAYER",367,"SUBSTRATE","Dielectric7",0,"#000000",0,"#000000",1]
["LAYER",368,"SUBSTRATE","Dielectric8",0,"#000000",0,"#000000",1]
["LAYER",369,"SUBSTRATE","Dielectric9",0,"#000000",0,"#000000",1]
["ACTIVE_LAYER",1]
["RULE_TEMPLATE","自定义配置"]
["RULE","1","copperThickness1oz",1,["mil",[[0],[0,0],[0,0,0],[0,0,0,0],[0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]]]]
["RULE","1","copperThickness2oz",0,["mil",[[0],[0,0],[0,0,0],[0,0,0,0],[0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]]]]
["RULE","1","copperThicknessInner0.5oz",0,["mil",[[0],[0,0],[0,0,0],[0,0,0,0],[0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]]]]
["RULE","2","otherClearance",1,["mil",0,0,0]]
["RULE","3","copperThickness1oz",1,["mil",1,10,100]]
["RULE","3","copperThickness2oz",0,["mil",1,10,100]]
["RULE","3","copperThickness0.5oz",0,["mil",1,10,100]]
["RULE","11","netLength",1,["mil",0,0]]
["RULE","10","differentialPair",1,["mil",5,10,100,5.9843,5.9843,0,10]]
["RULE","4","blindVia",1,[]]
["RULE","5","viaSize",1,["mil",0.5,12.0079,196.8504,0.5,6.0039,124.0158]]
["RULE","6","innerPlane",1,["mil",10,10,0,10,10,90,"0",10,10,90]]
["RULE","7","copperRegion",1,["mil",10,10,1,10,10,90,"0",1,10,10,90]]
["RULE","8","pasteMaskExpansion",1,["mil",0,0,-1000,-1000]]
["RULE","9","solderMaskExpansion",1,["mil",2.0079,2.0079,-1000,-1000,2.0079,2.0079]]
["RULE","12","Common",1,[0,1,0,1,0,[1,2,12],[]]]
["PRIMITIVE","ALL",1,0]
["PRIMITIVE","COMPONENT",1,1]
["PRIMITIVE","PROPERTY",1,1]
["PRIMITIVE","COMPONENTSILK",1,1]
["PRIMITIVE","TRACK",1,1]
["PRIMITIVE","VIA",1,1]
["PRIMITIVE","TESTPOINT",1,1]
["PRIMITIVE","PAD",1,1]
["PRIMITIVE","PADSPAIR",1,0]
["PRIMITIVE","NETWORK",1,0]
["PRIMITIVE","SUTUREHOLE",1,1]
["PRIMITIVE","TEARDROP",1,1]
["PRIMITIVE","RATLINE",0,0]
["PRIMITIVE","GROUP",1,0]
["PRIMITIVE","TEXT",1,1]
["PRIMITIVE","IMAGE",1,1]
["PRIMITIVE","PICTURE",1,1]
["PRIMITIVE","DIMENSION",1,1]
["PRIMITIVE","BOARDOUTLINE",1,1]
["PRIMITIVE","SLOTREGION",1,1]
["PRIMITIVE","FILLREGIEN",1,1]
["PRIMITIVE","COPPEROUTLINE",1,1]
["PRIMITIVE","COPPERFILLED",1,1]
["PRIMITIVE","PROHIBITEDREGION",1,1]
["PRIMITIVE","CONSTRAINT",1,1]
["PRIMITIVE","PARTITION",0,0]
["PRIMITIVE","LINE",1,1]
["PRIMITIVE","LOCKED",1,1]
["PRIMITIVE","UNLOCKED",1,1]
["PRIMITIVE","SHELL",1,1]
["PRIMITIVE","BOSS",1,1]
["PRIMITIVE","CREASE",1,1]
["PRIMITIVE","TOPSHELLCUT",1,1]
["PRIMITIVE","SIDESHELLCUT",1,1]
["PRIMITIVE","TOPBOTTOMENTITY",1,1]
["PRIMITIVE","SIDEENTITY",1,1]
["PRIMITIVE","FPC_STIFFENER",1,1]
["SILK_OPTS",3,"#000000","#FFFFFF"]
["SILK_OPTS",4,"#000000","#FFFFFF"]
["PREFERENCE",1,10,1,20,50,1,0,"L45",0,0,1,1,"JLC06161H-3313",0,3,"OPTIMIZA_OPEN",0,"OPTIMIZA_NONE",true,true]
["PANELIZE",0,1,1,0,0,1]
["PANELIZE_STAMP",1,0,1,21.6535,8,33.4646]
["PANELIZE_SIDE",1,1,236.2205,78.7402,39.3701,19.685]
["PANELIZE_STAMP",0,0,1,21.6535,8,33.4646]
["PANELIZE_SIDE",0,0,236.2205,78.7402,39.3701,19.685]`.trim();

    // 专业版 V3 头文件
    const LCEDA_V3_Head_Source = `{"type":"DOCHEAD"}||{"docType":"PCB","client":"6af495b598287a2d","uuid":"2ffffa5e735e7565","updateTime":1770062807370,"version":"1770062807370"}|
{"type":"CANVAS","ticket":1,"id":"CANVAS"}||{"originX":0,"originY":0,"unit":"mil","gridXSize":5,"gridYSize":5,"snapXSize":5,"snapYSize":5,"altSnapXSize":10,"altSnapYSize":10,"gridType":"NONE","multiGridType":"NONE","multiGridRatio":5,"highlightValue":0.5}|
{"type":"LAYER","ticket":2,"id":"[\\"LAYER\\",1]"}||{"layerId":1,"layerType":"TOP","layerName":"Top Layer","use":true,"show":true,"locked":false,"activeColor":"#cc6633","activateTransparency":1,"inactiveColor":"#7f0000","inactiveTransparency":1}|
{"type":"LAYER","ticket":3,"id":"[\\"LAYER\\",2]"}||{"layerId":2,"layerType":"BOTTOM","layerName":"Bottom Layer","use":true,"show":true,"locked":false,"activeColor":"#6699ff","activateTransparency":1,"inactiveColor":"#00007f","inactiveTransparency":1}|
{"type":"LAYER","ticket":4,"id":"[\\"LAYER\\",3]"}||{"layerId":3,"layerType":"TOP_SILK","layerName":"Top Silkscreen Layer","use":true,"show":true,"locked":false,"activeColor":"#ffcc00","activateTransparency":0.9,"inactiveColor":"#7f6600","inactiveTransparency":1}|
{"type":"LAYER","ticket":5,"id":"[\\"LAYER\\",4]"}||{"layerId":4,"layerType":"BOT_SILK","layerName":"Bottom Silkscreen Layer","use":true,"show":true,"locked":false,"activeColor":"#66cc33","activateTransparency":0.9,"inactiveColor":"#336619","inactiveTransparency":1}|
{"type":"LAYER","ticket":6,"id":"[\\"LAYER\\",5]"}||{"layerId":5,"layerType":"TOP_SOLDER_MASK","layerName":"Top Solder Mask Layer","use":true,"show":true,"locked":false,"activeColor":"#800080","activateTransparency":0.7,"inactiveColor":"#400040","inactiveTransparency":1}|
{"type":"LAYER","ticket":7,"id":"[\\"LAYER\\",6]"}||{"layerId":6,"layerType":"BOT_SOLDER_MASK","layerName":"Bottom Solder Mask Layer","use":true,"show":true,"locked":false,"activeColor":"#aa00ff","activateTransparency":0.7,"inactiveColor":"#55007f","inactiveTransparency":1}|
{"type":"LAYER","ticket":8,"id":"[\\"LAYER\\",7]"}||{"layerId":7,"layerType":"TOP_PASTE_MASK","layerName":"Top Paste Mask Layer","use":true,"show":true,"locked":false,"activeColor":"#808080","activateTransparency":1,"inactiveColor":"#404040","inactiveTransparency":1}|
{"type":"LAYER","ticket":9,"id":"[\\"LAYER\\",8]"}||{"layerId":8,"layerType":"BOT_PASTE_MASK","layerName":"Bottom Paste Mask Layer","use":true,"show":true,"locked":false,"activeColor":"#800000","activateTransparency":1,"inactiveColor":"#400000","inactiveTransparency":1}|
{"type":"LAYER","ticket":10,"id":"[\\"LAYER\\",9]"}||{"layerId":9,"layerType":"TOP_ASSEMBLY","layerName":"Top Assembly Layer","use":true,"show":true,"locked":false,"activeColor":"#33cc99","activateTransparency":1,"inactiveColor":"#19664c","inactiveTransparency":1}|
{"type":"LAYER","ticket":11,"id":"[\\"LAYER\\",10]"}||{"layerId":10,"layerType":"BOT_ASSEMBLY","layerName":"Bottom Assembly Layer","use":true,"show":true,"locked":false,"activeColor":"#5555ff","activateTransparency":1,"inactiveColor":"#2a2a7f","inactiveTransparency":1}|
{"type":"LAYER","ticket":12,"id":"[\\"LAYER\\",11]"}||{"layerId":11,"layerType":"OUTLINE","layerName":"Board Outline Layer","use":true,"show":true,"locked":false,"activeColor":"#ff00ff","activateTransparency":1,"inactiveColor":"#7f007f","inactiveTransparency":1}|
{"type":"LAYER","ticket":13,"id":"[\\"LAYER\\",12]"}||{"layerId":12,"layerType":"MULTI","layerName":"Multi-Layer","use":true,"show":true,"locked":false,"activeColor":"#c0c0c0","activateTransparency":0.5,"inactiveColor":"#606060","inactiveTransparency":1}|
{"type":"LAYER","ticket":14,"id":"[\\"LAYER\\",13]"}||{"layerId":13,"layerType":"DOCUMENT","layerName":"Document Layer","use":true,"show":true,"locked":false,"activeColor":"#ffffff","activateTransparency":1,"inactiveColor":"#7f7f7f","inactiveTransparency":1}|
{"type":"LAYER","ticket":15,"id":"[\\"LAYER\\",14]"}||{"layerId":14,"layerType":"MECHANICAL","layerName":"Mechanical Layer","use":true,"show":true,"locked":false,"activeColor":"#f022f0","activateTransparency":1,"inactiveColor":"#781178","inactiveTransparency":1}|
{"type":"LAYER","ticket":16,"id":"[\\"LAYER\\",15]"}||{"layerId":15,"layerType":"SIGNAL","layerName":"Inner1","use":true,"show":true,"locked":false,"activeColor":"#999966","activateTransparency":1,"inactiveColor":"#4c4c33","inactiveTransparency":1}|
{"type":"LAYER","ticket":17,"id":"[\\"LAYER\\",16]"}||{"layerId":16,"layerType":"SIGNAL","layerName":"Inner2","use":true,"show":true,"locked":false,"activeColor":"#0099cc","activateTransparency":1,"inactiveColor":"#004000","inactiveTransparency":1}|
{"type":"LAYER","ticket":18,"id":"[\\"LAYER\\",17]"}||{"layerId":17,"layerType":"SIGNAL","layerName":"Inner3","use":true,"show":true,"locked":false,"activeColor":"#339999","activateTransparency":1,"inactiveColor":"#007f00","inactiveTransparency":1}|
{"type":"LAYER","ticket":19,"id":"[\\"LAYER\\",18]"}||{"layerId":18,"layerType":"SIGNAL","layerName":"Inner4","use":true,"show":true,"locked":false,"activeColor":"#bc8e00","activateTransparency":1,"inactiveColor":"#5e4700","inactiveTransparency":1}|
{"type":"LAYER","ticket":20,"id":"[\\"LAYER\\",19]"}||{"layerId":19,"layerType":"SIGNAL","layerName":"Inner5","use":false,"show":false,"locked":false,"activeColor":"#70dbfa","activateTransparency":1,"inactiveColor":"#39503f","inactiveTransparency":1}|
{"type":"LAYER","ticket":21,"id":"[\\"LAYER\\",20]"}||{"layerId":20,"layerType":"SIGNAL","layerName":"Inner6","use":false,"show":false,"locked":false,"activeColor":"#00cc66","activateTransparency":1,"inactiveColor":"#006633","inactiveTransparency":1}|
{"type":"LAYER","ticket":22,"id":"[\\"LAYER\\",21]"}||{"layerId":21,"layerType":"SIGNAL","layerName":"Inner7","use":false,"show":false,"locked":false,"activeColor":"#9966ff","activateTransparency":1,"inactiveColor":"#4c337f","inactiveTransparency":1}|
{"type":"LAYER","ticket":23,"id":"[\\"LAYER\\",22]"}||{"layerId":22,"layerType":"SIGNAL","layerName":"Inner8","use":false,"show":false,"locked":false,"activeColor":"#800080","activateTransparency":1,"inactiveColor":"#400040","inactiveTransparency":1}|
{"type":"LAYER","ticket":24,"id":"[\\"LAYER\\",23]"}||{"layerId":23,"layerType":"SIGNAL","layerName":"Inner9","use":false,"show":false,"locked":false,"activeColor":"#008080","activateTransparency":1,"inactiveColor":"#004040","inactiveTransparency":1}|
{"type":"LAYER","ticket":25,"id":"[\\"LAYER\\",24]"}||{"layerId":24,"layerType":"SIGNAL","layerName":"Inner10","use":false,"show":false,"locked":false,"activeColor":"#15935f","activateTransparency":1,"inactiveColor":"#0a492f","inactiveTransparency":1}|
{"type":"LAYER","ticket":26,"id":"[\\"LAYER\\",25]"}||{"layerId":25,"layerType":"SIGNAL","layerName":"Inner11","use":false,"show":false,"locked":false,"activeColor":"#000080","activateTransparency":1,"inactiveColor":"#000040","inactiveTransparency":1}|
{"type":"LAYER","ticket":27,"id":"[\\"LAYER\\",26]"}||{"layerId":26,"layerType":"SIGNAL","layerName":"Inner12","use":false,"show":false,"locked":false,"activeColor":"#00b400","activateTransparency":1,"inactiveColor":"#005a00","inactiveTransparency":1}|
{"type":"LAYER","ticket":28,"id":"[\\"LAYER\\",27]"}||{"layerId":27,"layerType":"SIGNAL","layerName":"Inner13","use":false,"show":false,"locked":false,"activeColor":"#2e4756","activateTransparency":1,"inactiveColor":"#17232b","inactiveTransparency":1}|
{"type":"LAYER","ticket":29,"id":"[\\"LAYER\\",28]"}||{"layerId":28,"layerType":"SIGNAL","layerName":"Inner14","use":false,"show":false,"locked":false,"activeColor":"#99842f","activateTransparency":1,"inactiveColor":"#4c4217","inactiveTransparency":1}|
{"type":"LAYER","ticket":30,"id":"[\\"LAYER\\",29]"}||{"layerId":29,"layerType":"SIGNAL","layerName":"Inner15","use":false,"show":false,"locked":false,"activeColor":"#ffffaa","activateTransparency":1,"inactiveColor":"#7f7f55","inactiveTransparency":1}|
{"type":"LAYER","ticket":31,"id":"[\\"LAYER\\",30]"}||{"layerId":30,"layerType":"SIGNAL","layerName":"Inner16","use":false,"show":false,"locked":false,"activeColor":"#99842f","activateTransparency":1,"inactiveColor":"#4c4217","inactiveTransparency":1}|
{"type":"LAYER","ticket":32,"id":"[\\"LAYER\\",31]"}||{"layerId":31,"layerType":"SIGNAL","layerName":"Inner17","use":false,"show":false,"locked":false,"activeColor":"#2e4756","activateTransparency":1,"inactiveColor":"#17232b","inactiveTransparency":1}|
{"type":"LAYER","ticket":33,"id":"[\\"LAYER\\",32]"}||{"layerId":32,"layerType":"SIGNAL","layerName":"Inner18","use":false,"show":false,"locked":false,"activeColor":"#3535ff","activateTransparency":1,"inactiveColor":"#1a1a7f","inactiveTransparency":1}|
{"type":"LAYER","ticket":34,"id":"[\\"LAYER\\",33]"}||{"layerId":33,"layerType":"SIGNAL","layerName":"Inner19","use":false,"show":false,"locked":false,"activeColor":"#8000bc","activateTransparency":1,"inactiveColor":"#40005e","inactiveTransparency":1}|
{"type":"LAYER","ticket":35,"id":"[\\"LAYER\\",34]"}||{"layerId":34,"layerType":"SIGNAL","layerName":"Inner20","use":false,"show":false,"locked":false,"activeColor":"#43ae5f","activateTransparency":1,"inactiveColor":"#21572f","inactiveTransparency":1}|
{"type":"LAYER","ticket":36,"id":"[\\"LAYER\\",35]"}||{"layerId":35,"layerType":"SIGNAL","layerName":"Inner21","use":false,"show":false,"locked":false,"activeColor":"#c3ecce","activateTransparency":1,"inactiveColor":"#617667","inactiveTransparency":1}|
{"type":"LAYER","ticket":37,"id":"[\\"LAYER\\",36]"}||{"layerId":36,"layerType":"SIGNAL","layerName":"Inner22","use":false,"show":false,"locked":false,"activeColor":"#728978","activateTransparency":1,"inactiveColor":"#39443c","inactiveTransparency":1}|
{"type":"LAYER","ticket":38,"id":"[\\"LAYER\\",37]"}||{"layerId":37,"layerType":"SIGNAL","layerName":"Inner23","use":false,"show":false,"locked":false,"activeColor":"#39503f","activateTransparency":1,"inactiveColor":"#1c281f","inactiveTransparency":1}|
{"type":"LAYER","ticket":39,"id":"[\\"LAYER\\",38]"}||{"layerId":38,"layerType":"SIGNAL","layerName":"Inner24","use":false,"show":false,"locked":false,"activeColor":"#0c715d","activateTransparency":1,"inactiveColor":"#06382e","inactiveTransparency":1}|
{"type":"LAYER","ticket":40,"id":"[\\"LAYER\\",39]"}||{"layerId":39,"layerType":"SIGNAL","layerName":"Inner25","use":false,"show":false,"locked":false,"activeColor":"#5a8a80","activateTransparency":1,"inactiveColor":"#2d4540","inactiveTransparency":1}|
{"type":"LAYER","ticket":41,"id":"[\\"LAYER\\",40]"}||{"layerId":40,"layerType":"SIGNAL","layerName":"Inner26","use":false,"show":false,"locked":false,"activeColor":"#2b937e","activateTransparency":1,"inactiveColor":"#15493f","inactiveTransparency":1}|
{"type":"LAYER","ticket":42,"id":"[\\"LAYER\\",41]"}||{"layerId":41,"layerType":"SIGNAL","layerName":"Inner27","use":false,"show":false,"locked":false,"activeColor":"#23999d","activateTransparency":1,"inactiveColor":"#114c4e","inactiveTransparency":1}|
{"type":"LAYER","ticket":43,"id":"[\\"LAYER\\",42]"}||{"layerId":42,"layerType":"SIGNAL","layerName":"Inner28","use":false,"show":false,"locked":false,"activeColor":"#45b4e3","activateTransparency":1,"inactiveColor":"#225a71","inactiveTransparency":1}|
{"type":"LAYER","ticket":44,"id":"[\\"LAYER\\",43]"}||{"layerId":43,"layerType":"SIGNAL","layerName":"Inner29","use":false,"show":false,"locked":false,"activeColor":"#215da1","activateTransparency":1,"inactiveColor":"#102e50","inactiveTransparency":1}|
{"type":"LAYER","ticket":45,"id":"[\\"LAYER\\",44]"}||{"layerId":44,"layerType":"SIGNAL","layerName":"Inner30","use":false,"show":false,"locked":false,"activeColor":"#4564d7","activateTransparency":1,"inactiveColor":"#22326b","inactiveTransparency":1}|
{"type":"LAYER","ticket":46,"id":"[\\"LAYER\\",45]"}||{"layerId":45,"layerType":"SIGNAL","layerName":"Inner31","use":false,"show":false,"locked":false,"activeColor":"#6969e9","activateTransparency":1,"inactiveColor":"#343474","inactiveTransparency":1}|
{"type":"LAYER","ticket":47,"id":"[\\"LAYER\\",46]"}||{"layerId":46,"layerType":"SIGNAL","layerName":"Inner32","use":false,"show":false,"locked":false,"activeColor":"#9069e9","activateTransparency":1,"inactiveColor":"#483474","inactiveTransparency":1}|
{"type":"LAYER","ticket":48,"id":"[\\"LAYER\\",47]"}||{"layerId":47,"layerType":"HOLE","layerName":"Hole Layer","use":true,"show":true,"locked":false,"activeColor":"#222222","activateTransparency":0.5,"inactiveColor":"#111111","inactiveTransparency":1}|
{"type":"LAYER","ticket":49,"id":"[\\"LAYER\\",48]"}||{"layerId":48,"layerType":"COMPONENT_SHAPE","layerName":"Component Shape Layer","use":true,"show":true,"locked":false,"activeColor":"#00cccc","activateTransparency":1,"inactiveColor":"#006666","inactiveTransparency":1}|
{"type":"LAYER","ticket":50,"id":"[\\"LAYER\\",49]"}||{"layerId":49,"layerType":"COMPONENT_MARKING","layerName":"Component Marking Layer","use":true,"show":true,"locked":false,"activeColor":"#66ffcc","activateTransparency":1,"inactiveColor":"#337f66","inactiveTransparency":1}|
{"type":"LAYER","ticket":51,"id":"[\\"LAYER\\",50]"}||{"layerId":50,"layerType":"PIN_SOLDERING","layerName":"Pin Soldering Layer","use":true,"show":true,"locked":false,"activeColor":"#cc9999","activateTransparency":1,"inactiveColor":"#664c4c","inactiveTransparency":1}|
{"type":"LAYER","ticket":52,"id":"[\\"LAYER\\",51]"}||{"layerId":51,"layerType":"PIN_FLOATING","layerName":"Pin Floating Layer","use":true,"show":true,"locked":false,"activeColor":"#ff99ff","activateTransparency":1,"inactiveColor":"#7f4c7f","inactiveTransparency":1}|
{"type":"LAYER","ticket":53,"id":"[\\"LAYER\\",52]"}||{"layerId":52,"layerType":"COMPONENT_MODEL","layerName":"Component Model Layer","use":false,"show":false,"locked":false,"activeColor":"#ffffff","activateTransparency":1,"inactiveColor":"#7f7f7f","inactiveTransparency":1}|
{"type":"LAYER","ticket":54,"id":"[\\"LAYER\\",53]"}||{"layerId":53,"layerType":"3D_SHELL_OUTLINE","layerName":"3D Shell Outline Layer","use":true,"show":true,"locked":false,"activeColor":"#66ff99","activateTransparency":1,"inactiveColor":"#337f4c","inactiveTransparency":1}|
{"type":"LAYER","ticket":55,"id":"[\\"LAYER\\",54]"}||{"layerId":54,"layerType":"3D_SHELL_TOP","layerName":"3D Shell Top Layer","use":true,"show":true,"locked":false,"activeColor":"#ffccff","activateTransparency":1,"inactiveColor":"#7f667f","inactiveTransparency":1}|
{"type":"LAYER","ticket":56,"id":"[\\"LAYER\\",55]"}||{"layerId":55,"layerType":"3D_SHELL_BOTTOM","layerName":"3D Shell Bottom Layer","use":true,"show":true,"locked":false,"activeColor":"#0066cc","activateTransparency":1,"inactiveColor":"#003366","inactiveTransparency":1}|
{"type":"LAYER","ticket":57,"id":"[\\"LAYER\\",56]"}||{"layerId":56,"layerType":"DRILL_DRAWING","layerName":"Drill Drawing Layer","use":true,"show":true,"locked":false,"activeColor":"#008080","activateTransparency":1,"inactiveColor":"#004040","inactiveTransparency":1}|
{"type":"LAYER","ticket":58,"id":"[\\"LAYER\\",57]"}||{"layerId":57,"layerType":"OTHER","layerName":"Ratline Layer","use":true,"show":true,"locked":true,"activeColor":"#6464ff","activateTransparency":1,"inactiveColor":"#32327f","inactiveTransparency":1}|
{"type":"LAYER","ticket":59,"id":"[\\"LAYER\\",58]"}||{"layerId":58,"layerType":"TOP_STIFFENER","layerName":"Top Stiffener Layer","use":false,"show":false,"locked":false,"activeColor":"#eee666","activateTransparency":1,"inactiveColor":"#777333","inactiveTransparency":1}|
{"type":"LAYER","ticket":60,"id":"[\\"LAYER\\",59]"}||{"layerId":59,"layerType":"BOTTOM_STIFFENER","layerName":"Bottom Stiffener Layer","use":false,"show":false,"locked":false,"activeColor":"#ccff00","activateTransparency":1,"inactiveColor":"#667f00","inactiveTransparency":1}|
{"type":"LAYER","ticket":61,"id":"[\\"LAYER\\",361]"}||{"layerId":361,"layerType":"SUBSTRATE","layerName":"Dielectric1","use":false,"show":false,"locked":false,"activeColor":"#000000","activateTransparency":0,"inactiveColor":"#000000","inactiveTransparency":1}|
{"type":"LAYER","ticket":62,"id":"[\\"LAYER\\",362]"}||{"layerId":362,"layerType":"SUBSTRATE","layerName":"Dielectric2","use":false,"show":false,"locked":false,"activeColor":"#000000","activateTransparency":0,"inactiveColor":"#000000","inactiveTransparency":1}|
{"type":"LAYER","ticket":63,"id":"[\\"LAYER\\",363]"}||{"layerId":363,"layerType":"SUBSTRATE","layerName":"Dielectric3","use":false,"show":false,"locked":false,"activeColor":"#000000","activateTransparency":0,"inactiveColor":"#000000","inactiveTransparency":1}|
{"type":"LAYER","ticket":64,"id":"[\\"LAYER\\",364]"}||{"layerId":364,"layerType":"SUBSTRATE","layerName":"Dielectric4","use":false,"show":false,"locked":false,"activeColor":"#000000","activateTransparency":0,"inactiveColor":"#000000","inactiveTransparency":1}|
{"type":"LAYER","ticket":65,"id":"[\\"LAYER\\",365]"}||{"layerId":365,"layerType":"SUBSTRATE","layerName":"Dielectric5","use":false,"show":false,"locked":false,"activeColor":"#000000","activateTransparency":0,"inactiveColor":"#000000","inactiveTransparency":1}|
{"type":"ACTIVE_LAYER","ticket":83,"id":"ACTIVE_LAYER"}||{"layerId":1}|
{"type":"RULE_TEMPLATE","ticket":84,"id":"RULE_TEMPLATE"}||{"name":"自定义配置"}|
{"type":"RULE","ticket":85,"id":"[\\"RULE\\",\\"SAFE\\",\\"copperThickness1oz\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","isForAll":"ALL","safeSpacing":[{"layerId":1,"isOpen":true,"content":[[0],[0,0],[0,0,0],[0,0,0,0],[0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0]],"columnNames":[]}]}}|
{"type":"RULE","ticket":86,"id":"[\\"RULE\\",\\"SAFE\\",\\"copperThickness2oz\\"]"}||{"ruleState":"NORMAL","ruleContext":{"unit":"mil","isForAll":"ALL","safeSpacing":[{"layerId":1,"isOpen":true,"content":[[0],[0,0],[0,0,0],[0,0,0,0],[0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0]],"columnNames":[]}]}}|
{"type":"RULE","ticket":87,"id":"[\\"RULE\\",\\"SAFE\\",\\"copperThicknessInner0.5oz\\"]"}||{"ruleState":"NORMAL","ruleContext":{"unit":"mil","isForAll":"ALL","safeSpacing":[{"layerId":1,"isOpen":true,"content":[[0],[0,0],[0,0,0],[0,0,0,0],[0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0]],"columnNames":[]}]}}|
{"type":"RULE","ticket":88,"id":"[\\"RULE\\",\\"OTHER\\",\\"otherClearance\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","deviceClearance":0,"thru2SmdClearance":0,"holeClearance":0}}|
{"type":"RULE","ticket":89,"id":"[\\"RULE\\",\\"TRACK\\",\\"copperThickness1oz\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","track":{"isOpen":true,"content":[{"layerId":1,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":2,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":15,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":16,"stroMin":1,"stroDef":10,"stroMax":100}]}}}|
{"type":"RULE","ticket":90,"id":"[\\"RULE\\",\\"TRACK\\",\\"copperThickness2oz\\"]"}||{"ruleState":"NORMAL","ruleContext":{"unit":"mil","track":{"isOpen":true,"content":[{"layerId":1,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":2,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":15,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":16,"stroMin":1,"stroDef":10,"stroMax":100}]}}}|
{"type":"RULE","ticket":91,"id":"[\\"RULE\\",\\"TRACK\\",\\"copperThickness0.5oz\\"]"}||{"ruleState":"NORMAL","ruleContext":{"unit":"mil","track":{"isOpen":true,"content":[{"layerId":1,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":2,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":15,"stroMin":1,"stroDef":10,"stroMax":100},{"layerId":16,"stroMin":1,"stroDef":10,"stroMax":100}]}}}|
{"type":"RULE","ticket":92,"id":"[\\"RULE\\",\\"NET_LENGTH\\",\\"netLength\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","netLenMin":0,"netLenMax":0}}|
{"type":"RULE","ticket":93,"id":"[\\"RULE\\",\\"NET_LENGTH_TOLERANCE\\",\\"netLengthTolerance\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","netLengthTolerance":1000}}|
{"type":"RULE","ticket":94,"id":"[\\"RULE\\",\\"DIFFER_ENTAIL\\",\\"differentialPair\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","stroWidth":{"isOpen":true,"content":[{"layerId":1,"stroMin":5,"stroMax":100,"stroDef":10}]},"spacing":{"isOpen":true,"content":[{"layerId":1,"spacMin":5.9843,"spacDef":5.9843}]},"differPairLenTolerMax":10}}|
{"type":"RULE","ticket":95,"id":"[\\"RULE\\",\\"BLIND\\",\\"blindVia\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"blinds":{"content":[]}}}|
{"type":"RULE","ticket":96,"id":"[\\"RULE\\",\\"RADIUS\\",\\"viaSize\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","minRadius":0.5,"defRadius":12.0079,"maxRadius":196.8504,"minInner":0.5,"defInner":6.0039,"maxInner":124.0158}}|
{"type":"RULE","ticket":97,"id":"[\\"RULE\\",\\"PLANE\\",\\"innerPlane\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","mulPad":{"isOpen":true,"content":[{"layerId":1,"connType":"DIVERGENCE","spoSpac":10,"spoWidth":10,"spoAng":90}]}}}|
{"type":"RULE","ticket":98,"id":"[\\"RULE\\",\\"COPPER\\",\\"copperRegion\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","sglPad":{"isOpen":true,"content":[{"layerId":1,"connType":"DIRECT","spoSpac":10,"spoWidth":10,"spoAng":90},{"layerId":2,"connType":"DIRECT","spoSpac":10,"spoWidth":10,"spoAng":90}]},"mulPad":{"isOpen":true,"content":[{"layerId":1,"connType":"DIRECT","spoSpac":10,"spoWidth":10,"spoAng":90},{"layerId":2,"connType":"DIRECT","spoSpac":10,"spoWidth":10,"spoAng":90},{"layerId":15,"connType":"DIRECT","spoSpac":10,"spoWidth":10,"spoAng":90},{"layerId":16,"connType":"DIRECT","spoSpac":10,"spoWidth":10,"spoAng":90}]},"track":{"isOpen":true,"content":[{"layerId":1,"connType":"DIRECT"},{"layerId":2,"connType":"DIRECT"},{"layerId":15,"connType":"DIRECT"},{"layerId":16,"connType":"DIRECT"}]}}}|
{"type":"RULE","ticket":99,"id":"[\\"RULE\\",\\"PASTE\\",\\"pasteMaskExpansion\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","padTopExpan":0,"padBotExpan":0,"testPointTopExpan":-1000,"testPointBotExpan":-1000}}|
{"type":"RULE","ticket":100,"id":"[\\"RULE\\",\\"SOLDER\\",\\"solderMaskExpansion\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"unit":"mil","padTopExpan":2.0079,"padBotExpan":2.0079,"viaTopExpan":-1000,"viaBotExpan":-1000,"testPointTopExpan":2.0079,"testPointBotExpan":2.0079}}|
{"type":"RULE","ticket":101,"id":"[\\"RULE\\",\\"AUTO_ROUTER\\",\\"Common\\"]"}||{"ruleState":"DEFAULT","ruleContext":{"routingCorner":"L45","isKeep":1,"viaQuantity":"LESS","routingEffectPriority":"COMPLETION_FIRST","layers":[1,2,12],"ignoreNets":[]}}|
{"type":"PRIMITIVE","ticket":102,"id":"[\\"PRIMITIVE\\",\\"ALL\\"]"}||{"display":true,"pick":false}|
{"type":"PRIMITIVE","ticket":103,"id":"[\\"PRIMITIVE\\",\\"COMPONENT\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":104,"id":"[\\"PRIMITIVE\\",\\"PROPERTY\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":105,"id":"[\\"PRIMITIVE\\",\\"COMPONENTSILK\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":106,"id":"[\\"PRIMITIVE\\",\\"TRACK\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":107,"id":"[\\"PRIMITIVE\\",\\"VIA\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":108,"id":"[\\"PRIMITIVE\\",\\"TESTPOINT\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":109,"id":"[\\"PRIMITIVE\\",\\"PAD\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":110,"id":"[\\"PRIMITIVE\\",\\"PADSPAIR\\"]"}||{"display":true,"pick":false}|
{"type":"PRIMITIVE","ticket":111,"id":"[\\"PRIMITIVE\\",\\"NETWORK\\"]"}||{"display":true,"pick":false}|
{"type":"PRIMITIVE","ticket":112,"id":"[\\"PRIMITIVE\\",\\"SUTUREHOLE\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":113,"id":"[\\"PRIMITIVE\\",\\"TEARDROP\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":114,"id":"[\\"PRIMITIVE\\",\\"RATLINE\\"]"}||{"display":false,"pick":false}|
{"type":"PRIMITIVE","ticket":115,"id":"[\\"PRIMITIVE\\",\\"GROUP\\"]"}||{"display":true,"pick":false}|
{"type":"PRIMITIVE","ticket":116,"id":"[\\"PRIMITIVE\\",\\"TEXT\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":117,"id":"[\\"PRIMITIVE\\",\\"IMAGE\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":118,"id":"[\\"PRIMITIVE\\",\\"PICTURE\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":119,"id":"[\\"PRIMITIVE\\",\\"DIMENSION\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":120,"id":"[\\"PRIMITIVE\\",\\"BOARDOUTLINE\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":121,"id":"[\\"PRIMITIVE\\",\\"SLOTREGION\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":122,"id":"[\\"PRIMITIVE\\",\\"FILLREGIEN\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":123,"id":"[\\"PRIMITIVE\\",\\"COPPEROUTLINE\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":124,"id":"[\\"PRIMITIVE\\",\\"COPPERFILLED\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":125,"id":"[\\"PRIMITIVE\\",\\"PROHIBITEDREGION\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":126,"id":"[\\"PRIMITIVE\\",\\"CONSTRAINT\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":127,"id":"[\\"PRIMITIVE\\",\\"PARTITION\\"]"}||{"display":false,"pick":false}|
{"type":"PRIMITIVE","ticket":128,"id":"[\\"PRIMITIVE\\",\\"LINE\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":129,"id":"[\\"PRIMITIVE\\",\\"LOCKED\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":130,"id":"[\\"PRIMITIVE\\",\\"UNLOCKED\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":131,"id":"[\\"PRIMITIVE\\",\\"SHELL\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":132,"id":"[\\"PRIMITIVE\\",\\"BOSS\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":133,"id":"[\\"PRIMITIVE\\",\\"CREASE\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":134,"id":"[\\"PRIMITIVE\\",\\"TOPSHELLCUT\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":135,"id":"[\\"PRIMITIVE\\",\\"SIDESHELLCUT\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":136,"id":"[\\"PRIMITIVE\\",\\"TOPBOTTOMENTITY\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":137,"id":"[\\"PRIMITIVE\\",\\"SIDEENTITY\\"]"}||{"display":true,"pick":true}|
{"type":"PRIMITIVE","ticket":138,"id":"[\\"PRIMITIVE\\",\\"FPC_STIFFENER\\"]"}||{"display":true,"pick":true}|
{"type":"SILK_OPTS","ticket":139,"id":"[\\"SILK_OPTS\\",3]"}||{"defaultColor":"#000000","baseColor":"#FFFFFF"}|
{"type":"SILK_OPTS","ticket":140,"id":"[\\"SILK_OPTS\\",4]"}||{"defaultColor":"#000000","baseColor":"#FFFFFF"}|
{"type":"PREFERENCE","ticket":141,"id":"PREFERENCE"}||{"startTrackWidthFollowLast":false,"lastTrackWidth":10,"startViaSizeFollowLast":false,"lastViaInnerDiameter":12.0078,"lastViaDiameter":24.0158,"snap":true,"routingMode":"SURROUND","routingCorner":"L45","removeLoop":true,"rotatingObject":false,"trackFollow":true,"stretchTrackMinCorner":1,"preferenceConfig":"JLC06161H-3313","realTimeUpdateUnusedLayers":false,"unusedPadRange":"VIA","pushVia":"OPTIMIZA_OPEN","pathOptimization4BePushed":"SINGLE","currentPathOptimization4BePushed":"OPTIMIZA_WEAK","removeCircuitsContainingVias":true,"removeAntenna":true}|
{"type":"PANELIZE","ticket":142,"id":"PANELIZE"}||{"on":false,"row":1,"column":1,"rowSpacing":0,"columnSpacing":0,"onlyOutline":true,"horizontalStamp":{"on":false,"stampHoleGroupQuantity":1,"stampHoleDiameter":21.6535,"stampHoleQuantityPerGroup":8,"stampHoleSpacing":33.4646},"verticalStamp":{"on":false,"stampHoleGroupQuantity":1,"stampHoleDiameter":21.6535,"stampHoleQuantityPerGroup":8,"stampHoleSpacing":33.4646},"horizontalSize":{"on":false,"sideHeight":236.2205,"positionHoleDiameter":78.7402,"markDiameter":39.3701,"markExpansion":19.685},"verticalSize":{"on":true,"sideHeight":236.2205,"positionHoleDiameter":78.7402,"markDiameter":39.3701,"markExpansion":19.685}}`.trim();

