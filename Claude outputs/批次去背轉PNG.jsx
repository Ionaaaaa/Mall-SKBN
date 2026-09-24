#target photoshop
/*
  批次去背轉 PNG（有操作介面版）
  ------------------------------------------------------------
  用法：Photoshop > 檔案 > 指令碼 > 瀏覽... 選這個檔案（或放進
  Presets/Scripts 資料夾，重開 Photoshop 後會出現在 檔案 > 指令碼 選單）。

  流程：
    1. 跳出設定視窗：選資料夾或選檔案，確認清單、輸出位置與選項，按「開始去背」。
    2. 自動在你選的位置建立一個新資料夾（預設「去背_PNG」），去背後的 PNG 都放裡面。
       原檔完全不會被修改或覆蓋。
    3. 跑完會顯示結果視窗：失敗的圖會列在裡面，可以直接在 Photoshop 開啟自己手動去背，
       或按「重試」再自動跑一次。

  需求：Photoshop 2021 (v22) 以上。
*/

// ===== 可調整的設定 =====
var DEFAULT_OUT_NAME  = "去背_PNG";   // 輸出資料夾的預設名稱（視窗裡也能改）
// 2026-09：原本用 $ 錨定「副檔名一定要在檔名最後面」，導致「蔓越莓.png 的副本」
// 這種副檔名後面還接了文字的檔名（複製/副本/雲端同步衝突檔常見）整個被跳過，
// 即使 Photoshop 其實開得起來。改成「副檔名後面接的是結尾或非英數字元」就算，
// 不用剛好在最後一個字——這樣「xxx.png 的副本」「xxx.jpg(1)」都收得到，但
// 「xxx.pngeddon」這種副檔名只是巧合出現在字中間的還是不會誤判。
//
// 2026-09：另外加了 gif/svg/ico/avif 這幾個網頁常見的圖檔格式（你從網站上
// 存下來的圖常見這幾種）。gif 是 Photoshop 原生格式，跟其他格式一樣穩定；
// svg/ico/avif 要看你的 Photoshop 版本支不支援，開不起來的話會自動歸進
// 「失敗清單」，不會讓整批中斷，你可以照結果視窗裡的方式手動開或重試
// （見openTypeFor的說明）。如果你網頁常存的還有別種格式(例如.tif以外的
// 掃描檔、.pdf)，跟我說要加哪些，我再補進來。
var EXTENSIONS        = /\.(jpe?g|png|psd|psb|tiff?|bmp|webp|heic|gif|svg|ico|avif)(?=$|[^a-zA-Z0-9])/i;
var ADD_SUFFIX        = "";      // 輸出檔名加尾綴，例如 "_cut" -> 商品A_cut.png；留空 = 同檔名
var TRANSPARENT_MIN_RATIO = 0.01; // 透明的像素佔整張圖超過這個比例，就當成「已去背」（0.01 = 1%）
// 2026-09：「已去背而略過」的圖，現在一律在processOne()裡直接另存成PNG進輸出
// 資料夾(不管原始檔名/格式是什麼)，不再需要另外複製原檔，這個開關已經沒有用到。
var MAX_CONSECUTIVE_FAIL = 3;    // 連續失敗幾張就先暫停詢問（只有勾選「連續失敗時暫停詢問」才會生效）
var PAUSE_ON_FAIL = false;       // 預設不暫停：全部跑完，失敗的最後一起列在結果視窗（設定視窗裡可以勾選改成暫停）

// 備援做法：如果自動「選取主體」在你的 Photoshop 跑不動，可以自己錄一個動作
// （錄「選取 > 主體」＋「以選取範圍建立圖層遮色片」＋「套用圖層遮色片」），
// 把動作組跟動作名稱填在下面，腳本就會改成每張圖都執行你的動作。兩個都要填才會啟用。
var ACTION_SET  = "";   // 例如 "批次去背"（動作組名稱）
var ACTION_NAME = "";   // 例如 "去背"（動作名稱）

// 下面這幾個由設定視窗的勾選決定，這裡是預設值
var SKIP_TRANSPARENT = true;   // 已經去背（背景透明）的圖略過
var TRIM_TRANSPARENT = false;  // 去背後裁掉四周透明邊
var SKIP_EXISTING    = true;   // 輸出資料夾裡已有同名 PNG 就略過（中斷後可續跑）
// ========================

// 去背方式：由設定視窗選擇。"auto" = 先 AI 選取主體，失敗再改用去純色背景；"ai" = 只用 AI；"solid" = 只用去純色背景
var CUTOUT_MODE     = "auto";
var SOLID_TOLERANCE = 30;   // 純色背景法的容許值（魔術棒，0~255）：越大，跟背景色相近的部分也會被去掉
var CORNER_DIFF     = 30;   // 四個角落顏色的差異超過這個值，就判定背景不是單一純色
var EDGE_CONTRACT_PX = 1;   // 純色背景法去背後，主體邊緣內縮幾像素，用來去掉白邊（0 = 不內縮）
var LAST_METHOD     = "";   // 最近一張圖實際用到的方法（"ai" / "solid"），給結果統計用

var MIRROR_FOLDERS = true;  // 由設定視窗的勾選決定：輸出資料夾裡是否保持原本的子資料夾結構
var ORIGIN = {};             // 記錄每個檔案是從哪個「根資料夾」加進來的（用來算相對路徑）

function cTID(s){ return charIDToTypeID(s); }
function sTID(s){ return stringIDToTypeID(s); }
function niceName(f){ try { return decodeURI(f.name); } catch(e){ return f.name; } }

// 2026-09：「xxx.png 的副本」這種檔名，副檔名不在最後面，Photoshop 光靠檔名
// 猜格式會猜錯（或直接說開不起來）。這裡自己從檔名裡找出副檔名是什麼，
// 待會兒 app.open() 時明講「這是 PNG／JPEG／PSD…」，不用讓 Photoshop 自己猜。
function extOf(name){
  var m = String(name).match(/\.(jpe?g|png|psd|psb|tiff?|bmp|webp|heic|gif|svg|ico|avif)(?=$|[^a-zA-Z0-9])/i);
  return m ? m[1].toLowerCase() : "";
}
function openTypeFor(ext){
  switch(ext){
    case "jpg": case "jpeg": return OpenDocumentType.JPEG;
    case "png": return OpenDocumentType.PNG;
    case "psd": return OpenDocumentType.PHOTOSHOP;
    case "psb": return (typeof OpenDocumentType.LARGEDOCUMENTFORMAT !== "undefined") ? OpenDocumentType.LARGEDOCUMENTFORMAT : undefined;
    case "tif": case "tiff": return OpenDocumentType.TIFF;
    case "bmp": return OpenDocumentType.BMP;
    case "gif": return (typeof OpenDocumentType.COMPUSERVEGIF !== "undefined") ? OpenDocumentType.COMPUSERVEGIF : undefined;
    // webp/heic/svg/ico/avif 沒有固定的格式常數(部分要看Photoshop版本有沒有支援)，
    // 交給Photoshop自己判斷；副檔名正常結尾的圖不受影響，開不起來的會進失敗清單。
    default: return undefined;
  }
}

// 檔案相對於它的根資料夾的子資料夾路徑（用 / 分隔），在根資料夾底下就回傳 ""
function relDirOf(f){
  var root = ORIGIN[f.fsName.toLowerCase()];
  if(!root || !f.parent) return "";
  var p = f.parent.fsName, r = root.fsName;
  if(p.toLowerCase() === r.toLowerCase()) return "";
  if(p.toLowerCase().indexOf(r.toLowerCase()) !== 0) return "";
  var rel = p.substr(r.length).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  try { return decodeURI(rel); } catch(e){ return rel; }
}
// 畫面上顯示用：子資料夾/檔名
function displayPath(f){
  var rel = relDirOf(f);
  return (rel ? rel + "/" : "") + niceName(f);
}
// 建立資料夾（連同上層不存在的資料夾）
function ensureFolder(fd){
  if(fd.exists) return true;
  if(fd.parent && !fd.parent.exists) ensureFolder(fd.parent);
  return fd.create();
}
// 遞迴收集資料夾裡的圖片；略過輸出資料夾（避免把之前的成果又收進來）和隱藏資料夾
function collectFiles(folder, skipNames, out){
  var items = folder.getFiles(), i;
  for(i = 0; i < items.length; i++){
    var it = items[i];
    if(it instanceof File){
      if(EXTENSIONS.test(it.name)) out.push(it);
    } else if(it instanceof Folder){
      var nm = niceName(it);
      if(nm.charAt(0) === "." || nm.charAt(0) === "$") continue;
      var skip = false;
      for(var s = 0; s < skipNames.length; s++){ if(skipNames[s] && nm.toLowerCase() === skipNames[s].toLowerCase()) skip = true; }
      if(!skip) collectFiles(it, skipNames, out);
    }
  }
  return out;
}

/* ───────────── Photoshop 處理 ───────────── */

// 失敗後嘗試把 Photoshop 狀態「洗乾淨」，避免一張失敗影響後面所有圖
function resetState(){
  try { app.purge(PurgeTarget.ALLCACHES); } catch(e){}
  try { app.bringToFront(); } catch(e){}
  try { $.sleep(800); } catch(e){}
}

function hasSelection(doc){
  try { var b = doc.selection.bounds; return (b[2].value - b[0].value) > 0 && (b[3].value - b[1].value) > 0; }
  catch(e){ return false; }
}

// 選取主體（等同「選取 > 主體」）
function selectSubject(doc){
  var tries = [
    function(){ var d = new ActionDescriptor(); d.putBoolean(sTID("sampleAllLayers"), false); executeAction(sTID("autoCutout"), d, DialogModes.NO); },
    function(){ executeAction(sTID("autoCutout"), undefined, DialogModes.NO); }
  ];
  var lastErr = "";
  for(var i = 0; i < tries.length; i++){
    try {
      tries[i]();
      if(hasSelection(doc)) return;
    } catch(e){ lastErr = String(e.message || e); }
  }
  throw new Error("「選取主體」執行失敗（Photoshop 版本 " + app.version + "）" + (lastErr ? "：" + lastErr : "：找不到主體"));
}

/* ── 去純色背景（例如白底商品照、白底 LOGO）：不靠 AI，用「魔術棒」從四個角落點背景 ── */

// 取樣四個角落的顏色，回傳 [[r,g,b] x4]
function sampleCornerColors(doc){
  var oldUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  var w = doc.width.value, h = doc.height.value, m = Math.min(2, Math.floor(Math.min(w, h) / 4));
  var pts = [[m, m], [w - m, m], [m, h - m], [w - m, h - m]], out = [];
  try {
    for(var i = 0; i < pts.length; i++){
      var s = doc.colorSamplers.add(pts[i]);
      var c = s.color.rgb;
      out.push([Math.round(c.red), Math.round(c.green), Math.round(c.blue)]);
      s.remove();
    }
  } finally { app.preferences.rulerUnits = oldUnits; }
  return out;
}

// 魔術棒點一下（x, y 是像素座標），add = true 表示加入既有選取範圍
function magicWandClick(x, y, tolerance, add){
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putProperty(cTID("Chnl"), cTID("fsel"));
  d.putReference(cTID("null"), r);
  var pt = new ActionDescriptor();
  pt.putUnitDouble(cTID("Hrzn"), cTID("#Pxl"), x);
  pt.putUnitDouble(cTID("Vrtc"), cTID("#Pxl"), y);
  d.putObject(cTID("T   "), cTID("Pnt "), pt);
  d.putInteger(cTID("Tlrn"), tolerance);
  d.putBoolean(cTID("AntA"), true);
  d.putBoolean(cTID("Cntg"), true);      // 只選「相連」的背景，不會把商品裡面的白色也選走
  if(add) d.putEnumerated(sTID("selectionModifier"), sTID("selectionModifierType"), sTID("addToSelection"));
  executeAction(cTID("setd"), d, DialogModes.NO);
}

// 目前選取範圍佔整張圖的比例（0~1）
function selectionRatio(doc){
  var ch = null;
  try {
    ch = doc.channels.add();
    doc.selection.store(ch);
    var h = ch.histogram, total = 0, sel = 0;
    for(var i = 0; i < h.length; i++){ total += h[i]; sel += h[i] * (i / 255); }
    ch.remove(); ch = null;
    doc.activeLayer = doc.layers[0];
    return total ? sel / total : 0;
  } catch(e){
    try { if(ch) ch.remove(); } catch(e2){}
    try { doc.activeLayer = doc.layers[0]; } catch(e3){}
    return -1;
  }
}

// 用純色背景法建立「主體」的選取範圍。背景不是單一純色就丟錯誤。
function selectBySolidBackground(doc){
  var cs = sampleCornerColors(doc), i, k;
  for(i = 1; i < cs.length; i++){
    for(k = 0; k < 3; k++){
      if(Math.abs(cs[i][k] - cs[0][k]) > CORNER_DIFF) throw new Error("四個角落顏色差異太大，背景不是單一純色");
    }
  }
  var oldUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  var w = doc.width.value, h = doc.height.value, m = Math.min(2, Math.floor(Math.min(w, h) / 4));
  var pts = [[m, m], [w - m, m], [m, h - m], [w - m, h - m]];
  try {
    doc.selection.deselect();
    for(i = 0; i < pts.length; i++) magicWandClick(pts[i][0], pts[i][1], SOLID_TOLERANCE, i > 0);
  } finally { app.preferences.rulerUnits = oldUnits; }

  var ratio = selectionRatio(doc);
  if(ratio >= 0 && ratio < 0.02) throw new Error("純色背景法：背景範圍太小（容許值可能太低）");
  if(ratio > 0.995) throw new Error("純色背景法：整張圖幾乎都是背景色，找不到主體");

  doc.selection.invert();                       // 背景反選 = 主體
  if(EDGE_CONTRACT_PX > 0){ try { doc.selection.contract(new UnitValue(EDGE_CONTRACT_PX, "px")); } catch(ec){} }   // 內縮一點，去掉白邊
  if(!hasSelection(doc)) throw new Error("純色背景法：選取範圍是空的");
}

// 依「去背方式」設定建立主體選取範圍。回傳實際用到的方法："ai" 或 "solid"
function buildSubjectSelection(doc){
  var aiErr = "";
  if(CUTOUT_MODE !== "solid"){
    try { selectSubject(doc); return "ai"; }
    catch(e){
      aiErr = String(e.message || e);
      if(CUTOUT_MODE === "ai") throw e;
      try { doc.selection.deselect(); } catch(ed){}
    }
  }
  try { selectBySolidBackground(doc); return "solid"; }
  catch(e2){
    try { doc.selection.deselect(); } catch(ed2){}
    var m2 = String(e2.message || e2);
    throw new Error(aiErr ? ("AI 選取主體失敗（" + aiErr.replace(/\s+/g, " ") + "）；改用純色背景法也失敗：" + m2) : m2);
  }
}

// 依目前選取範圍建立圖層遮色片（顯示選取範圍）
function makeMaskFromSelection(){
  var d = new ActionDescriptor();
  d.putClass(cTID("Nw  "), cTID("Chnl"));
  var r = new ActionReference();
  r.putEnumerated(cTID("Chnl"), cTID("Chnl"), cTID("Msk "));
  d.putReference(cTID("At  "), r);
  d.putEnumerated(cTID("Usng"), cTID("UsrM"), cTID("RvlS"));
  executeAction(cTID("Mk  "), d, DialogModes.NO);
}

// 套用（合併）圖層遮色片，讓透明度真的寫進像素
function applyMask(){
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putEnumerated(cTID("Chnl"), cTID("Ordn"), cTID("Trgt"));
  d.putReference(cTID("null"), r);
  d.putBoolean(cTID("Aply"), true);
  executeAction(cTID("Dlt "), d, DialogModes.NO);
}

// 判斷圖層有沒有「透明背景」。有 -> 回傳說明文字；沒有 -> 回傳 null。
// 用兩個彼此獨立的方法，任何一個抓到透明就算：
//   1. 圖層「有內容的範圍」比畫布小 -> 四周有透明邊（最常見的去背圖，不需要 AI 或色版）
//   2. 載入圖層的透明度選取範圍再反選，看有沒有透明的像素，並估算佔整張圖的比例
function detectTransparency(doc, layer){
  var oldUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  try {
    var W = doc.width.value, H = doc.height.value;

    // 方法 1：圖層內容範圍
    try {
      var b = layer.bounds;
      var cw = b[2].value - b[0].value, chh = b[3].value - b[1].value;
      var frac = (cw * chh) / (W * H);
      if(frac < 0.99) return "已經是透明背景（圖片內容只佔畫布約 " + Math.round(frac * 100) + "%，四周是透明的）";
    } catch(e1){}

    // 方法 2：透明度選取範圍
    doc.activeLayer = layer;
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putProperty(cTID("Chnl"), cTID("fsel"));
    d.putReference(cTID("null"), r);
    var r2 = new ActionReference();
    r2.putEnumerated(cTID("Chnl"), cTID("Chnl"), cTID("Trsp"));
    d.putReference(cTID("T   "), r2);
    executeAction(cTID("setd"), d, DialogModes.NO);
    doc.selection.invert();                       // 反選 = 透明的地方
    if(!hasSelection(doc)){ doc.selection.deselect(); return null; }

    var sb = doc.selection.bounds;
    var bboxFrac = ((sb[2].value - sb[0].value) * (sb[3].value - sb[1].value)) / (W * H);
    var ratio = selectionRatio(doc);              // 目前選取的是透明區域，回傳它佔整張圖的比例
    doc.selection.deselect();
    doc.activeLayer = layer;
    if(ratio >= 0) return (ratio >= TRANSPARENT_MIN_RATIO) ? ("已經是透明背景（透明區域約 " + Math.round(ratio * 100) + "%）") : null;
    // 算不出比例時，改看透明區域的外框夠不夠大
    return (bboxFrac >= 0.05) ? "已經有透明背景" : null;
  } catch(e){
    try { doc.selection.deselect(); } catch(e3){}
    try { doc.activeLayer = layer; } catch(e4){}
    return null;
  } finally {
    app.preferences.rulerUnits = oldUnits;
  }
}

// 處理一張圖：成功回傳 null；失敗回傳錯誤訊息（字串）；略過回傳 {skipped:true, note}
function processOne(file, outFile){
  var doc = null;
  LAST_METHOD = "";
  try {
    // 明講格式（見extOf/openTypeFor）：檔名不是乾淨副檔名結尾的（例如「xxx.png 的
    // 副本」）也能正確當PNG開，不會被Photoshop誤判或直接開不起來。
    var forcedType = openTypeFor(extOf(file.name));
    try { doc = forcedType ? app.open(file, forcedType) : app.open(file); }
    catch(eo){ throw new Error("無法開啟檔案（可能被其他程式佔用、雲端同步中、或格式特殊）：" + String(eo.message || eo)); }

    // 統一成 RGB 8 bit
    if(doc.mode != DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
    if(doc.bitsPerChannel != BitsPerChannelType.EIGHT) doc.bitsPerChannel = BitsPerChannelType.EIGHT;
    if(doc.layers.length > 1){
      // 多圖層：合併可見圖層（會保留透明度），失敗才退回攤平
      try { doc.mergeVisibleLayers(); } catch(em){ doc.flatten(); }
    }

    var layer = doc.layers[0];

    // 已經去背（背景是透明）的圖：不執行去背，但還是要在輸出資料夾裡存一份PNG，
    // 讓輸出資料夾對這批圖來說是「完整一套」，不會漏掉。
    // 2026-09：以前這裡只是把原檔關掉、不存檔，另外交給runBatch()去複製「檔名
    // 剛好以.png結尾」的原檔——這樣「xxx.png 的副本」這種副檔名不在最後面的
    // 檔名，或本來就不是png的其他格式，都不會被複製進輸出資料夾，圖就憑空
    // 不見了。改成不管原始檔名/格式是什麼，直接把「目前已開啟、已經是透明
    // 背景」的內容另存成PNG(用planOutputs()算好的輸出路徑)，不用比對檔名，
    // 保證輸出資料夾一定有這張圖。
    if(SKIP_TRANSPARENT && !layer.isBackgroundLayer){
      var tnote = detectTransparency(doc, layer);
      if(tnote){
        try {
          if(TRIM_TRANSPARENT) doc.trim(TrimType.TRANSPARENT, true, true, true, true);
          var optSkip = new PNGSaveOptions();
          optSkip.interlaced = false;
          doc.saveAs(outFile, optSkip, true, Extension.LOWERCASE);
        } catch(esave){
          // 另存失敗就不要悄悄漏掉這張圖，當成失敗回報，使用者才會在結果
          // 視窗裡看到、知道要手動處理。
          try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch(ec0){}
          doc = null;
          return "已偵測到透明背景，但另存PNG時發生錯誤：" + String(esave.message || esave);
        }
        try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch(ec){}
        doc = null;
        return { skipped: true, note: tnote };
      }
    }

    if(layer.isBackgroundLayer) layer.isBackgroundLayer = false;   // 背景層轉一般圖層才能有透明度
    doc.activeLayer = layer;

    if(ACTION_SET && ACTION_NAME){
      app.doAction(ACTION_NAME, ACTION_SET);   // 備援：執行使用者自己錄的動作
      doc = app.activeDocument;
    } else {
      try { doc.selection.deselect(); } catch(ed){}
      doc.activeLayer = doc.layers[0];
      LAST_METHOD = buildSubjectSelection(doc);
      makeMaskFromSelection();
      applyMask();
      doc.selection.deselect();
    }

    if(TRIM_TRANSPARENT){
      doc.trim(TrimType.TRANSPARENT, true, true, true, true);
    }

    var opt = new PNGSaveOptions();
    opt.interlaced = false;
    doc.saveAs(outFile, opt, true, Extension.LOWERCASE);
    doc.close(SaveOptions.DONOTSAVECHANGES);
    return null;
  } catch(e){
    try { if(doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch(e2){}
    return String(e.message || e);
  }
}

/* ───────────── 批次執行 ───────────── */

// 依原檔名決定輸出檔名；同名（a.jpg 跟 a.png）會自動加 _2 避免互相覆蓋
function planOutputs(files, outFolder){
  var used = {}, plan = [];
  for(var i = 0; i < files.length; i++){
    var f = files[i];
    var rel = MIRROR_FOLDERS ? relDirOf(f) : "";
    var dir = outFolder.fsName + (rel ? "/" + rel : "");
    var base = niceName(f).replace(/\.[^\.]+$/, "") + ADD_SUFFIX;
    var name = base, n = 2;
    while(used[(dir + "/" + name).toLowerCase()]){ name = base + "_" + n; n++; }
    used[(dir + "/" + name).toLowerCase()] = true;
    plan.push({ file: f, rel: rel, dir: dir, outFile: new File(dir + "/" + name + ".png") });
  }
  return plan;
}

function runBatch(files, outFolder){
  var plan = planOutputs(files, outFolder);
  var res = { ok: 0, failed: [], skippedT: [], skippedExist: 0, stoppedAt: 0, total: plan.length, remaining: [], solidList: [] };

  var oldDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;

  var win = new Window("palette", "批次去背處理中");
  win.orientation = "column";
  win.alignChildren = "fill";
  var label = win.add("statictext", undefined, "準備中...");
  label.preferredSize.width = 380;
  var bar = win.add("progressbar", undefined, 0, plan.length);
  bar.preferredSize.width = 380;
  win.show();

  var consecutiveFail = 0;
  for(var i = 0; i < plan.length; i++){
    var item = plan[i], f = item.file;
    label.text = (i + 1) + " / " + plan.length + "　" + displayPath(f);
    bar.value = i;
    win.update();

    if(SKIP_EXISTING && item.outFile.exists){ res.skippedExist++; continue; }
    ensureFolder(item.outFile.parent);

    var err = processOne(f, item.outFile);
    if(typeof err === "string"){
      resetState();                       // 失敗一次後先重置狀態，再重試同一張一次
      err = processOne(f, item.outFile);
    }
    if(err !== null && typeof err === "object"){
      // 2026-09：另存PNG已經在processOne()裡做掉了(不管原檔名/格式是什麼都會存)，
      // 這裡不用再另外複製原檔。
      res.skippedT.push({ file: f, note: err.note });
    } else if(err === null){
      res.ok++; consecutiveFail = 0;
      if(LAST_METHOD === "solid") res.solidList.push(f);
    } else {
      res.failed.push({ file: f, outFile: item.outFile, err: err });
      consecutiveFail++;
      if(PAUSE_ON_FAIL && consecutiveFail >= MAX_CONSECUTIVE_FAIL){
        if(!confirm("已經連續 " + consecutiveFail + " 張失敗，Photoshop 可能卡在異常狀態。\n\n【是】= 繼續處理剩下的圖，失敗的最後會一起列在結果視窗\n【否】= 先停止並查看結果（結果視窗裡可以按「繼續處理剩下的」接著跑）")){
          res.stoppedAt = i + 1;
          for(var j = i + 1; j < plan.length; j++) res.remaining.push(plan[j].file);
          break;
        }
        consecutiveFail = 0;
      }
    }
  }
  bar.value = plan.length;
  win.close();
  app.displayDialogs = oldDialogs;
  return res;
}

function writeLogs(outFolder, res){
  function put(name, lines){
    var lg = new File(outFolder.fsName + "/" + name);
    if(!lines.length){ try { if(lg.exists) lg.remove(); } catch(e){} return; }
    lg.encoding = "UTF-8";
    lg.open("w"); lg.write(lines.join("\n")); lg.close();
  }
  var fl = [], sk = [], i;
  for(i = 0; i < res.failed.length; i++) fl.push(displayPath(res.failed[i].file) + "　→　" + res.failed[i].err);
  for(i = 0; i < res.skippedT.length; i++) sk.push(displayPath(res.skippedT[i].file) + "　→　" + res.skippedT[i].note);
  var sl = [];
  for(i = 0; i < res.solidList.length; i++) sl.push(displayPath(res.solidList[i]));
  put("_用純色背景法處理_請檢查邊緣.txt", sl);
  put("_去背失敗清單.txt", fl);
  put("_已是透明背景_略過清單.txt", sk);
}

/* ───────────── 介面 ───────────── */

function selectedIndices(lb){
  var s = lb.selection, out = [];
  if(!s) return out;
  if(s instanceof Array){ for(var i = 0; i < s.length; i++) out.push(s[i].index); }
  else out.push(s.index);
  return out;
}

function pickFilesDialog(){
  var r;
  if($.os.indexOf("Windows") >= 0){
    // 2026-09：Windows的檔案選取視窗篩選是照萬用字元比對副檔名結尾，「xxx.png 的
    // 副本」這種檔名選不到——篩選加一個「所有檔案」，選不到圖片版篩選時可以切過去。
    r = File.openDialog("選擇要去背的圖片（可多選）", "圖片:*.jpg;*.jpeg;*.png;*.psd;*.psb;*.tif;*.tiff;*.bmp;*.webp;*.heic;*.gif;*.svg;*.ico;*.avif,所有檔案:*.*", true);
  } else {
    r = File.openDialog("選擇要去背的圖片（可多選）", function(f){ return (f instanceof Folder) || EXTENSIONS.test(f.name); }, true);
  }
  if(!r) return [];
  if(!(r instanceof Array)) r = [r];
  return r;
}

// 設定視窗：回傳 {files, outFolderPath} 或 null（取消）
function showSetupDialog(){
  var pending = [];        // 待處理的 File 陣列（清單的唯一資料來源）
  var customParent = null; // 使用者自己指定的輸出位置；null = 跟著第一張圖所在的資料夾

  var w = new Window("dialog", "批次去背轉 PNG");
  w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 10; w.margins = 16;

  // 1. 選圖
  var p1 = w.add("panel", undefined, "1. 選擇要去背的圖片");
  p1.orientation = "column"; p1.alignChildren = ["fill", "top"]; p1.margins = [12, 18, 12, 12];
  var r1 = p1.add("group");
  var bFolder = r1.add("button", undefined, "選擇資料夾…");
  var bFiles  = r1.add("button", undefined, "選擇檔案…（可多選）");
  var bRemove = r1.add("button", undefined, "移除選取");
  var bClear  = r1.add("button", undefined, "清空");
  var cbSub = p1.add("checkbox", undefined, "選擇資料夾時，連同裡面的子資料夾一起加入");
  cbSub.value = true;
  var lb = p1.add("listbox", undefined, [], { multiselect: true, numberOfColumns: 2, showHeaders: true,
                                              columnTitles: ["檔名", "所在資料夾"], columnWidths: [320, 200] });
  lb.preferredSize = [580, 200];
  var countTxt = p1.add("statictext", undefined, "尚未選擇圖片");
  countTxt.preferredSize.width = 560;

  // 2. 輸出
  var p2 = w.add("panel", undefined, "2. 輸出位置（原檔不會被修改）");
  p2.orientation = "column"; p2.alignChildren = ["fill", "top"]; p2.margins = [12, 18, 12, 12];
  var r2 = p2.add("group");
  r2.add("statictext", undefined, "在選取的位置自動建立資料夾，名稱：");
  var eName = r2.add("edittext", undefined, DEFAULT_OUT_NAME);
  eName.characters = 16;
  var bLoc = r2.add("button", undefined, "更改位置…");
  var outTxt = p2.add("statictext", undefined, "", { truncate: "middle" });
  outTxt.preferredSize.width = 560;

  // 3. 選項
  var p3 = w.add("panel", undefined, "3. 選項");
  p3.orientation = "column"; p3.alignChildren = ["left", "top"]; p3.margins = [12, 18, 12, 12];
  var gm = p3.add("group");
  gm.add("statictext", undefined, "去背方式：");
  var ddMode = gm.add("dropdownlist", undefined, [
    "先用 AI 選取主體，失敗再改用「去純色背景」（建議）",
    "只用 AI 選取主體",
    "只用「去純色背景」（適合白底商品照、白底 LOGO）"
  ]);
  ddMode.selection = (CUTOUT_MODE === "ai") ? 1 : (CUTOUT_MODE === "solid") ? 2 : 0;
  ddMode.preferredSize.width = 400;
  var gt = p3.add("group");
  gt.add("statictext", undefined, "純色背景容許值（0–255，越大去得越多，預設 30）：");
  var eTol = gt.add("edittext", undefined, String(SOLID_TOLERANCE));
  eTol.characters = 5;
  var cbT = p3.add("checkbox", undefined, "已經去背（背景透明）的圖自動略過");
  cbT.value = SKIP_TRANSPARENT;
  var cbE = p3.add("checkbox", undefined, "輸出資料夾裡已有同名 PNG 就略過（中斷後重跑可以續做）");
  cbE.value = SKIP_EXISTING;
  var cbTrim = p3.add("checkbox", undefined, "去背後裁掉四周透明邊");
  cbTrim.value = TRIM_TRANSPARENT;
  var cbMirror = p3.add("checkbox", undefined, "輸出資料夾裡保持跟原本一樣的子資料夾分類（取消勾選 = 全部放在同一層）");
  cbMirror.value = MIRROR_FOLDERS;
  var cbPause = p3.add("checkbox", undefined, "連續失敗 3 張時暫停詢問（不勾 = 一路跑完，失敗的最後一起處理）");
  cbPause.value = PAUSE_ON_FAIL;

  var gb = w.add("group");
  gb.alignment = "right";
  var bCancel = gb.add("button", undefined, "取消", { name: "cancel" });
  var bStart  = gb.add("button", undefined, "開始去背", { name: "ok" });
  bStart.enabled = false;

  function outParent(){
    if(customParent) return customParent;
    if(!pending.length) return null;
    return ORIGIN[pending[0].fsName.toLowerCase()] || pending[0].parent;
  }
  function refresh(){
    lb.removeAll();
    for(var i = 0; i < pending.length; i++){
      var it = lb.add("item", niceName(pending[i]));
      var rel = relDirOf(pending[i]);
      it.subItems[0].text = rel ? rel : (pending[i].parent ? niceName(pending[i].parent) : "");
    }
    countTxt.text = pending.length ? ("共 " + pending.length + " 張") : "尚未選擇圖片";
    bStart.enabled = pending.length > 0;
    refreshOut();
  }
  function refreshOut(){
    var par = outParent();
    var sep = ($.os.indexOf("Windows") >= 0) ? "\\" : "/";
    outTxt.text = par ? ("輸出到：" + par.fsName + sep + eName.text) : "輸出到：（選好圖片後會自動帶入）";
  }
  // root：這批檔案的「根資料夾」，用來算子資料夾的相對路徑；單獨選的檔案就以自己所在資料夾當根
  function addFiles(arr, root){
    var have = {}, i;
    for(i = 0; i < pending.length; i++) have[pending[i].fsName.toLowerCase()] = true;
    for(i = 0; i < arr.length; i++){
      if(!(arr[i] instanceof File) || !EXTENSIONS.test(arr[i].name)) continue;
      var key = arr[i].fsName.toLowerCase();
      if(!have[key]){
        have[key] = true;
        pending.push(arr[i]);
        ORIGIN[key] = root || arr[i].parent;
      }
    }
    pending.sort(function(a, b){ return displayPath(a).toLowerCase() < displayPath(b).toLowerCase() ? -1 : 1; });
    refresh();
  }

  bFolder.onClick = function(){
    var fd = Folder.selectDialog("請選擇「要去背的圖片」所在的資料夾");
    if(!fd) return;
    var arr;
    if(cbSub.value){
      arr = collectFiles(fd, [DEFAULT_OUT_NAME, eName.text], []);
    } else {
      arr = fd.getFiles(function(f){ return (f instanceof File) && EXTENSIONS.test(f.name); });
    }
    if(!arr.length){ alert("這個資料夾裡沒有找到可處理的圖片。"); return; }
    addFiles(arr, fd);
  };
  bFiles.onClick = function(){ addFiles(pickFilesDialog(), null); };
  bRemove.onClick = function(){
    var idx = selectedIndices(lb);
    if(!idx.length) return;
    idx.sort(function(a, b){ return b - a; });
    for(var i = 0; i < idx.length; i++) pending.splice(idx[i], 1);
    refresh();
  };
  bClear.onClick = function(){ pending = []; ORIGIN = {}; refresh(); };
  bLoc.onClick = function(){
    var fd = Folder.selectDialog("請選擇要在哪個資料夾裡建立輸出資料夾");
    if(fd){ customParent = fd; refresh(); }
  };
  eName.onChanging = function(){ refreshOut(); };

  bStart.onClick = function(){
    var nm = eName.text.replace(/^\s+|\s+$/g, "");
    if(!nm || /[\\\/:*?"<>|]/.test(nm)){ alert("輸出資料夾名稱不能是空的，也不能包含 \\ / : * ? \" < > |"); return; }
    if(!outParent()){ alert("請先選擇圖片。"); return; }
    var tv = parseInt(eTol.text, 10);
    if(isNaN(tv) || tv < 0 || tv > 255){ alert("純色背景容許值請輸入 0 到 255 之間的整數。"); return; }
    w.close(1);
  };

  refresh();
  if(w.show() !== 1) return null;

  SKIP_TRANSPARENT = cbT.value;
  SKIP_EXISTING = cbE.value;
  TRIM_TRANSPARENT = cbTrim.value;
  MIRROR_FOLDERS = cbMirror.value;
  PAUSE_ON_FAIL = cbPause.value;
  CUTOUT_MODE = (ddMode.selection.index === 1) ? "ai" : (ddMode.selection.index === 2) ? "solid" : "auto";
  SOLID_TOLERANCE = parseInt(eTol.text, 10);
  var name = eName.text.replace(/^\s+|\s+$/g, "");
  return { files: pending, outFolder: new Folder(outParent().fsName + "/" + name) };
}

// 結果視窗：列出失敗的圖，可直接在 Photoshop 開啟手動去背，或重試自動去背
function showResultDialog(res, outFolder){
  var failed = res.failed;   // [{file, outFile, err}]
  var skippedT = res.skippedT;

  var w = new Window("dialog", "去背結果");
  w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 10; w.margins = 16;

  var summary = w.add("statictext", undefined, "", { multiline: true });
  summary.preferredSize = [600, 48];

  var p1 = w.add("panel", undefined, "失敗的圖片（可以自己在 Photoshop 手動去背）");
  p1.orientation = "column"; p1.alignChildren = ["fill", "top"]; p1.margins = [12, 18, 12, 12];
  var lb = p1.add("listbox", undefined, [], { multiselect: true, numberOfColumns: 2, showHeaders: true,
                                              columnTitles: ["檔名", "失敗原因"], columnWidths: [240, 340] });
  lb.preferredSize = [600, 200];
  var g1 = p1.add("group");
  var bOpen  = g1.add("button", undefined, "在 Photoshop 開啟（選取的；沒選就全部）");
  var bRetry = g1.add("button", undefined, "重試自動去背（選取的；沒選就全部）");
  p1.add("statictext", undefined, "提示：手動去背完，請另存成 PNG 放進輸出資料夾。按「開啟」後這個視窗會關閉，方便你回到 Photoshop 操作。");

  var p2 = null, lb2 = null;
  if(skippedT.length){
    p2 = w.add("panel", undefined, "已經是透明背景而略過的圖片（沒有處理）");
    p2.orientation = "column"; p2.alignChildren = ["fill", "top"]; p2.margins = [12, 18, 12, 12];
    lb2 = p2.add("listbox", undefined, [], { numberOfColumns: 2, showHeaders: true,
                                             columnTitles: ["檔名", "說明"], columnWidths: [240, 340] });
    lb2.preferredSize = [600, 90];
    for(var s = 0; s < skippedT.length; s++){
      var it2 = lb2.add("item", displayPath(skippedT[s].file));
      it2.subItems[0].text = skippedT[s].note;
    }
  }

  var gb = w.add("group");
  gb.alignment = "right";
  var bContinue = gb.add("button", undefined, "繼續處理剩下的");
  var bFolder = gb.add("button", undefined, "開啟輸出資料夾");
  var bClose  = gb.add("button", undefined, "關閉", { name: "ok" });

  function refresh(){
    lb.removeAll();
    for(var i = 0; i < failed.length; i++){
      var it = lb.add("item", displayPath(failed[i].file));
      var reason = failed[i].err.replace(/\s+/g, " ");
      it.subItems[0].text = reason.length > 70 ? reason.substr(0, 70) + "…" : reason;
    }
    var line = "成功 " + res.ok + " 張　失敗 " + failed.length + " 張";
    if(skippedT.length) line += "　已是透明背景略過 " + skippedT.length + " 張";
    if(res.skippedExist) line += "　輸出資料夾已有同名檔略過 " + res.skippedExist + " 張";
    if(res.solidList.length) line += "\n其中 " + res.solidList.length + " 張是用「去純色背景」處理的，建議抽查邊緣（名單在輸出資料夾的文字檔裡）";
    if(res.remaining.length) line += "\n（已中途停止，還有 " + res.remaining.length + " 張還沒處理，可按下方「繼續處理剩下的」）";
    summary.text = line + "\n輸出位置：" + outFolder.fsName;
    bContinue.visible = bContinue.enabled = res.remaining.length > 0;
    bOpen.enabled = bRetry.enabled = failed.length > 0;
    p1.text = failed.length ? "失敗的圖片（可以自己在 Photoshop 手動去背）" : "沒有失敗的圖片";
    writeLogs(outFolder, res);
  }
  function targets(){
    var idx = selectedIndices(lb), out = [], i;
    if(!idx.length){ for(i = 0; i < failed.length; i++) idx.push(i); }
    for(i = 0; i < idx.length; i++) out.push(idx[i]);
    return out;
  }

  bOpen.onClick = function(){
    var idx = targets();
    for(var i = 0; i < idx.length; i++){
      try { app.open(failed[idx[i]].file); } catch(e){}
    }
    w.close(1);
  };
  bRetry.onClick = function(){
    var idx = targets().sort(function(a, b){ return b - a; });
    var old = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    for(var i = 0; i < idx.length; i++){
      var ent = failed[idx[i]];
      bRetry.text = "處理中… " + (i + 1) + " / " + idx.length; w.update();
      resetState();
      var err = processOne(ent.file, ent.outFile);
      if(err === null){ res.ok++; if(LAST_METHOD === "solid") res.solidList.push(ent.file); failed.splice(idx[i], 1); }
      else if(typeof err === "object"){ res.skippedT.push({ file: ent.file, note: err.note }); failed.splice(idx[i], 1); }
      else { ent.err = err; }
    }
    app.displayDialogs = old;
    bRetry.text = "重試自動去背（選取的；沒選就全部）";
    refresh();
  };
  bContinue.onClick = function(){
    var todo = res.remaining;
    res.remaining = [];
    var r = runBatch(todo, outFolder);
    res.ok += r.ok;
    res.skippedExist += r.skippedExist;
    for(var q = 0; q < r.solidList.length; q++) res.solidList.push(r.solidList[q]);
    for(var i = 0; i < r.failed.length; i++) failed.push(r.failed[i]);
    for(var j = 0; j < r.skippedT.length; j++) skippedT.push(r.skippedT[j]);
    res.remaining = r.remaining;
    refresh();
  };
  bFolder.onClick = function(){ try { outFolder.execute(); } catch(e){} };

  refresh();
  w.show();
}

/* ───────────── 主程式 ───────────── */

function main(){
  var setup = showSetupDialog();
  if(!setup) return;

  if(!ensureFolder(setup.outFolder)){
    alert("無法建立輸出資料夾：\n" + setup.outFolder.fsName + "\n\n請確認你有這個位置的寫入權限，或換一個輸出位置。");
    return;
  }

  var res = runBatch(setup.files, setup.outFolder);
  showResultDialog(res, setup.outFolder);
}

try { main(); } catch(e){ alert("執行時發生錯誤：\n" + e.message); }
