'use strict';
/*
  editor-main.js
  ------------------------------------------------------------
  畫面組裝 + 使用者操作。實際的版位繪製/欄位邏輯都委派給 core.js +
  modules/*.js，這支不重複那些邏輯，只做調度跟 DOM 事件綁定。

  編輯還是走「放大編輯」彈出視窗（openExpandModal），商品/LOGO的拖曳/縮放/
  旋轉直接在主畫面小格子上就能操作，其餘設定（品牌/主標文字/LOGO模式/
  背景色/陰影）在放大編輯視窗裡調整。

  右側是固定常駐的「提示與警示」面板（renderIssuesPanel()）——不是編輯用的
  設定欄，只放兩種「需要注意」的內容：
    1. 素材自動比對不到、需要手動處理的警示（跟之前一樣）
    2. 彙整全部banner/版位的主標文字問題（超過字數上限/踩到禁用語），
       有安全建議值的會有「套用」按鈕，不用逐格打開放大編輯才看得到。
  這個面板即時反映所有banner的狀態，不需要先選取哪一格。
*/

var STAGE_WIDTH = 760; // 主畫面每個banner舞台的顯示寬度(px)，1200x360縮小顯示

/* ── 主畫面：一整排往下捲的 banner 清單，沒有分頁、沒有固定右欄 ── */
function renderAll(){
  var main = document.getElementById('main');
  main.innerHTML = '';
  if(STATE.banners.length === 0){
    main.innerHTML = '<div class="empty-hint">目前沒有任何組合，點右上角「匯入工單」或左側「＋ 新增一組」開始。</div>';
  } else {
    STATE.banners.forEach(function(banner, idx){
      main.appendChild(buildBannerCard(banner, idx));
    });
  }
  renderIssuesPanel();
  renderProductionList();
  updateActiveListItem();
}

/* ── 左側「製作物列表」：跟krcb專案同一個精神，清單項目跟捲動位置互相同步 ──
   每次renderAll()都整個重建（main畫面本來就整個重建），点擊直接捲到main
   畫面對應的那張banner-card；捲動時哪一項該亮，交給updateActiveListItem()
   (綁在#main的scroll事件，見initProductionListScrollSpy())處理。 */
function renderProductionList(){
  var panel = document.getElementById('list-panel');
  if(!panel) return;
  // 2026-09：「＋ 新增一組」從右上角工具列搬到這裡（標題列右側，項目清單上方）。
  // 標題列不管有沒有banner都要顯示，不然清單清空之後就沒有地方可以新增了。
  var html = '<div class="list-panel-header"><span>製作物列表</span>'+
    '<button type="button" class="tbtn list-add-btn" id="btn-add-banner" title="新增一組">＋ 新增一組</button></div>';
  STATE.banners.forEach(function(banner, idx){
    html += '<div class="list-item" data-idx="'+idx+'">'+escHtml(bannerDateLabel(banner, idx))+'</div>';
  });
  panel.innerHTML = html;
  Array.prototype.forEach.call(panel.querySelectorAll('.list-item'), function(el){
    el.onclick = function(){ scrollToBannerCard(Number(el.dataset.idx)); };
  });
  document.getElementById('btn-add-banner').onclick = function(){
    // 一包的張數沒有上限。新增後直接捲到新的那一組。
    STATE.banners.push(emptyBanner());
    renderAll();
    scrollToBannerCard(STATE.banners.length - 1);
  };
}

/* 捲動時，找出目前「貼在main畫面頂端」的那張banner-card，把清單裡對應的
   項目標成active——用「card頂端離main頂端最近、但還沒超過頂端太多」這個
   判斷，而不是用IntersectionObserver的預設可見比例，是因為banner-card
   高度不一定都大於視窗高度，用可見比例判斷在卡片很高/很矮時都容易誤判。 */
function updateActiveListItem(){
  var main = document.getElementById('main');
  var panel = document.getElementById('list-panel');
  if(!main || !panel) return;
  var mainTop = main.getBoundingClientRect().top;
  var bestIdx = 0, bestDist = Infinity;
  Array.prototype.forEach.call(main.querySelectorAll('.banner-card'), function(card){
    var dist = card.getBoundingClientRect().top - mainTop;
    if(dist <= 40 && Math.abs(dist) < bestDist){ bestDist = Math.abs(dist); bestIdx = Number(card.dataset.idx); }
  });
  Array.prototype.forEach.call(panel.querySelectorAll('.list-item'), function(el){
    el.classList.toggle('active', Number(el.dataset.idx) === bestIdx);
  });
}

function initProductionListScrollSpy(){
  var main = document.getElementById('main');
  if(!main) return;
  var ticking = false;
  main.addEventListener('scroll', function(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){ updateActiveListItem(); ticking = false; });
  });
}

function buildBannerCard(banner, idx){
  var card = document.createElement('div');
  card.className = 'banner-card';
  card.id = 'banner-card-'+idx; // 給警語點擊/左側製作物列表捲動定位用
  card.dataset.idx = idx;

  var head = document.createElement('div');
  head.className = 'banner-head';
  head.innerHTML =
    '<div class="banner-title">'+
      '<span class="banner-ordinal">#'+(idx+1)+'</span>'+
      '<input type="date" class="banner-date-input" value="'+(banner.date||'')+'" title="曝光日期">'+
    '</div>'+
    '<div class="banner-actions">'+
      '<button class="icon-btn" data-act="dl" title="下載這一組"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1"/></svg></button>'+
      '<button class="icon-btn" data-act="dup" title="複製這組"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M2.5 11V3a1 1 0 011-1h8"/></svg></button>'+
      '<button class="icon-btn" data-act="del" title="刪除這組"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-9"/></svg></button>'+
    '</div>';
  head.querySelector('.banner-date-input').onchange = function(){
    banner.date = this.value || null;
    renderAll();
  };
  head.querySelector('[data-act=dl]').onclick = function(){ downloadSingleBannerWithCheck(banner, idx); };
  head.querySelector('[data-act=dup]').onclick = function(){
    STATE.banners.splice(idx+1, 0, JSON.parse(JSON.stringify(banner)));
    renderAll();
  };
  head.querySelector('[data-act=del]').onclick = function(){ confirmDeleteBanner(banner); };
  card.appendChild(head);

  var stage = Core.buildBannerStage(banner, STAGE_WIDTH, {
    onChange: function(){ pushMainUndoCheckpoint(); renderAll(); }, // 拖曳結束才會呼叫到，一次拖曳只記一筆還原紀錄
    onExpand: function(key){ openExpandModal(banner, key); },
    onRequestPick: function(key, kind){ quickPick(banner[key], kind); },
    // 主畫面同時有好幾組banner在畫面上，點選任何一格的logo/商品，其他所有
    // 格子(不管哪個banner、左中右哪一格)的選取框都要跟著收掉，才會是「整個
    // 畫面同時間只有一個選取框」——不用等點空白處才收，跟你確認過的行為。
    onSelectLogo: function(slot){ deselectAllSlotsExcept(slot); },
    onSelectProduct: function(slot){ deselectAllSlotsExcept(slot); }
  });
  card.appendChild(stage);
  return card;
}

/* 刪除整組前先跳警示popup（跟文案檢查提醒同一套popup樣式），按「刪除」才真的
   刪。用banner物件本身去找目前的位置，不吃呼叫當下的idx——popup開著的期間
   如果順序有變動，才不會刪錯組。 */
function confirmDeleteBanner(banner){
  var idx = STATE.banners.indexOf(banner);
  if(idx < 0) return;
  var label = '#'+(idx+1)+'（'+bannerDateLabel(banner, idx)+'）';
  var overlay = createOverlay(
    '<div class="popup-panel" style="width:380px;">'+
      '<div class="popup-head"><span>刪除這一組？</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body">'+
        '<div class="banword-warning" style="display:block;">確定要刪除 '+escHtml(label)+' 這一組嗎？<br>刪除後這一組的內容無法復原。</div>'+
      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="delete-cancel-btn">取消</button>'+
        '<span style="flex:1"></span>'+
        '<button class="tbtn" id="delete-confirm-btn">刪除</button>'+
      '</div>'+
    '</div>'
  );
  overlay.querySelector('#delete-cancel-btn').onclick = closePopup;
  overlay.querySelector('#delete-confirm-btn').onclick = function(){
    var i = STATE.banners.indexOf(banner);
    if(i >= 0) STATE.banners.splice(i, 1);
    closePopup();
    renderAll();
  };
}

/* 主畫面上直接點版位（不放大）要換圖：直接跳系統檔案選擇，不跳自訂popup */
function quickPick(slot, kind){
  Assets.pickImage(function(d){
    if(kind === 'logo'){ slot.logoRaw = d; clearLogoPresets(slot); Modules.logo.applyProcessing(slot, renderAll); return; }
    if(kind === 'product'){ setUploadedProductSrc(slot, d); renderAll(); return; }
  });
}

/* ── 放大編輯 modal：滿版展開 + 左側物件切換／中間畫布／右側一般設定 ── */
var _modalCtx = null;

function computeModalScale(cfg){
  var r = cfg.blockRect;
  var availW = Math.min(window.innerWidth * 0.95, 1200) - 230 - 280 - 48;
  var availH = Math.min(window.innerHeight * 0.96, 900) - 48; // popup可用高度再調高一點（跟.modal-panel的max-height:98vh配合）
  return Math.max(0.5, Math.min(2, availW / r.w, availH / r.h));
}

/* 放大編輯視窗裡的所有調整都先寫在「草稿」slot上，不是真正的banner[key]，
   使用者按「完成」才會把草稿寫回去、按×或直接關掉才會整個丟棄——跟你
   確認過的行為：沒按確認不該更新。只有materialTexts是陣列，用索引直接
   改內容(bindMaterialTextFieldInputs)，需要另外淺拷貝一份，不然草稿跟
   真正的slot會共用同一個陣列，草稿改了就會直接影響到還沒確認的真資料。
   其餘欄位都是整個重新指定(slot.xxx = ...)，共用同一份物件屬性描述沒問題，
   Object.assign就能正確複製。 */
function cloneSlotForEdit(slot){
  var copy = Object.assign({}, slot);
  copy.materialTexts = (slot.materialTexts || []).slice();
  return copy;
}

function openExpandModal(banner, key){
  closeModal();
  var realSlot = banner[key];
  var slot = cloneSlotForEdit(realSlot);
  var cfg = Core.layoutFor(key);
  _modalCtx = { banner:banner, key:key, slot:slot, realSlot:realSlot, cfg:cfg, activeTab:'product', scale: computeModalScale(cfg), undoStack:[], lastSnapshot:null };
  _modalCtx.lastSnapshot = snapshotSlot(slot);

  var overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';

  var panel = document.createElement('div');
  panel.id = 'modal-panel';
  panel.className = 'modal-panel';

  var objects = document.createElement('div');
  objects.className = 'modal-objects';
  objects.id = 'modal-objects';
  panel.appendChild(objects);

  var stage = document.createElement('div');
  stage.className = 'modal-stage';
  stage.id = 'modal-stage-inner';
  panel.appendChild(stage);

  var settings = document.createElement('div');
  settings.className = 'modal-settings';
  settings.id = 'modal-settings';

  var settingsFace = document.createElement('div');
  settingsFace.className = 'settings-face';
  settingsFace.id = 'modal-settings-face';
  settings.appendChild(settingsFace);

  var libraryFace = document.createElement('div');
  libraryFace.className = 'library-face';
  libraryFace.id = 'modal-library-face';
  settings.appendChild(libraryFace);

  panel.appendChild(settings);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  requestAnimationFrame(function(){ overlay.classList.add('open'); });

  renderModalPanels();
  // 2026-09：拿掉「點背景深色區域關閉popup」——跟使用者的色盤互動時(拖曳選色)
  // 有機會誤觸成「點到背景」，導致視窗突然關掉。現在只能用右上角×或
  // 「確認並關閉」按鈕關閉，不會再有這個問題。
}

/* 重新組出左側物件面板＋右側設定面板的內容並重新綁定事件——初次開啟、
   以及Ctrl+Z還原時都會呼叫這支。還原不能只重畫中間畫布(refreshModalStage)，
   顏色/文字輸入框、掛標按鈕這些表單欄位本身顯示的值也要跟著草稿資料
   重新同步，不然畫面雖然還原了，表單上顯示的還是還原前的值。 */
function renderModalPanels(){
  if(!_modalCtx) return;
  var key = _modalCtx.key, cfg = _modalCtx.cfg, slot = _modalCtx.slot;
  var objects = document.getElementById('modal-objects');
  var settingsFace = document.getElementById('modal-settings-face');
  if(!objects || !settingsFace) return;

  objects.innerHTML = buildModalObjectsHTML(key, cfg, slot);
  settingsFace.innerHTML = buildModalSettingsHTML(key, cfg, slot);

  refreshModalStage();
  bindModalObjectFields(objects, slot, cfg);
  bindModalSettingsFields(settingsFace, slot, cfg);
  bindObjectTabs(objects);
  bindModalBrandLabel(objects, slot);

  document.getElementById('modal-close').onclick = closeModal;
}

/* ── 放大編輯視窗的還原(Ctrl+Z)：只保留資料欄位，不含__開頭的快取欄位
   (圖片載入快取、LOGO內容框偵測結果...)，這些是渲染時的效能快取，不是
   使用者資料，還原/比較時不需要也不該管它們。 */
function snapshotSlot(slot){
  var copy = {};
  Object.keys(slot).forEach(function(k){
    if(k.indexOf('__') === 0) return;
    copy[k] = (k === 'materialTexts') ? (slot[k]||[]).slice() : slot[k];
  });
  return copy;
}

/* 每次refreshModalStage(每個欄位變更/每次拖曳結束都會呼叫到)重畫之前，
   先比對「這次重畫前」的草稿快照跟上一次記錄的快照：不一樣才代表真的有
   一個變更完成了，把「變更前」那個快照推進undo堆疊。拖曳中的每個
   pointermove不會呼叫到這裡（只有放開滑鼠那刻的onChange才會），所以一次
   拖曳只會產生一筆還原紀錄，不會拖曳幾百次滑鼠移動就變成幾百筆。 */
function pushUndoCheckpoint(){
  var snap = snapshotSlot(_modalCtx.slot);
  var prev = _modalCtx.lastSnapshot;
  if(prev && JSON.stringify(prev) !== JSON.stringify(snap)){
    _modalCtx.undoStack.push(prev);
    if(_modalCtx.undoStack.length > 50) _modalCtx.undoStack.shift(); // 上限50筆，避免無限累積佔記憶體
  }
  _modalCtx.lastSnapshot = snap;
}

/* Ctrl+Z（Mac是Cmd+Z）：還原放大編輯視窗裡上一步的欄位變更，涵蓋位置/
   縮放/文字/背景色/掛標開關…等所有草稿欄位。還原後要先把lastSnapshot
   同步成還原後的狀態，再呼叫renderModalPanels——不然renderModalPanels
   裡的refreshModalStage會呼叫pushUndoCheckpoint，把「剛剛被還原掉的那個
   狀態」誤判成一次新變更又推回堆疊，變成一直卡在兩個狀態來回跳。 */
function undoModal(){
  if(!_modalCtx || !_modalCtx.undoStack.length) return;
  var prev = _modalCtx.undoStack.pop();
  Object.assign(_modalCtx.slot, prev);
  _modalCtx.slot.materialTexts = (prev.materialTexts || []).slice();
  _modalCtx.lastSnapshot = snapshotSlot(_modalCtx.slot);
  renderModalPanels();
}

/* ── 主畫面(沒開放大編輯視窗)的方向鍵/Ctrl+Z ──────────────────────────
   主畫面小格子本來就能直接拖曳商品圖/LOGO(見core.js的buildBannerStage)，
   跟放大編輯視窗共用同一套slot.__pmSelected/__lmSelected選取狀態，這裡
   只是額外補鍵盤操作。跟放大編輯視窗那份的差異：這裡沒有「草稿」，
   slot本身就是STATE.banners裡的真資料，所以undo要另外記錄「變更前的
   狀態」，選到不同物件要重新起算(不能拿舊物件的快照跟新物件比較)。 */
var _mainUndo = { stack:[], lastRef:null, lastSnapshot:null };

function findMainSelectedSlot(){
  for(var i=0;i<STATE.banners.length;i++){
    var banner = STATE.banners[i];
    for(var k=0;k<Core.SLOT_KEYS.length;k++){
      var key = Core.SLOT_KEYS[k];
      var slot = banner[key];
      if(slot.__pmSelected || slot.__lmSelected) return { banner:banner, key:key, slot:slot };
    }
  }
  return null;
}

function pushMainUndoCheckpoint(){
  var sel = findMainSelectedSlot();
  if(!sel){ _mainUndo.lastRef = null; _mainUndo.lastSnapshot = null; return; }
  if(_mainUndo.lastRef !== sel.slot){
    _mainUndo.lastRef = sel.slot;
    _mainUndo.lastSnapshot = snapshotSlot(sel.slot);
    return;
  }
  var snap = snapshotSlot(sel.slot);
  if(JSON.stringify(_mainUndo.lastSnapshot) !== JSON.stringify(snap)){
    _mainUndo.stack.push({ slot: sel.slot, snapshot: _mainUndo.lastSnapshot });
    if(_mainUndo.stack.length > 50) _mainUndo.stack.shift();
  }
  _mainUndo.lastSnapshot = snap;
}

function undoMain(){
  if(!_mainUndo.stack.length) return;
  var entry = _mainUndo.stack.pop();
  Object.assign(entry.slot, entry.snapshot);
  entry.slot.materialTexts = (entry.snapshot.materialTexts || []).slice();
  _mainUndo.lastRef = entry.slot;
  _mainUndo.lastSnapshot = snapshotSlot(entry.slot);
  renderAll();
}

/* 鍵盤操作：Ctrl/Cmd+Z還原上一步，方向鍵微調目前選取物件(商品圖/LOGO)
   的位置，一次1px、按住Shift放大到10px。offsetX/Y都是「zone寬高的比例」，
   所以1px要換算成1/zone寬（或高），不能直接加1——不然不同zone大小移動的
   視覺距離會不一樣。有開放大編輯視窗時走草稿版本(_modalCtx.slot)，沒開
   的話直接對主畫面的真資料操作。 */
document.addEventListener('keydown', function(e){
  var mod = e.ctrlKey || e.metaKey;
  if(mod && e.key.toLowerCase() === 'z'){
    e.preventDefault();
    if(_modalCtx) undoModal(); else undoMain();
    return;
  }

  var arrowDelta = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] }[e.key];
  if(!arrowDelta) return;
  var step = e.shiftKey ? 10 : 1;
  var dx = arrowDelta[0]*step, dy = arrowDelta[1]*step;

  if(_modalCtx){
    var slot = _modalCtx.slot;
    if(slot.__pmSelected){
      var az = _modalCtx.cfg.artZone;
      slot.productOffsetX = (slot.productOffsetX||0) + dx/az.w;
      slot.productOffsetY = (slot.productOffsetY||0) + dy/az.h;
    } else if(slot.__lmSelected){
      var lz = Modules.logo.effectiveZone(_modalCtx.cfg, slot);
      slot.logoOffsetX = (slot.logoOffsetX||0) + dx/lz.w;
      slot.logoOffsetY = (slot.logoOffsetY||0) + dy/lz.h;
    } else {
      return;
    }
    e.preventDefault();
    refreshModalStage();
    return;
  }

  var sel = findMainSelectedSlot();
  if(!sel) return;
  var cfg = Core.layoutFor(sel.key);
  var mslot = sel.slot;
  if(mslot.__pmSelected){
    var maz = cfg.artZone;
    mslot.productOffsetX = (mslot.productOffsetX||0) + dx/maz.w;
    mslot.productOffsetY = (mslot.productOffsetY||0) + dy/maz.h;
  } else {
    var mlz = Modules.logo.effectiveZone(cfg, mslot);
    mslot.logoOffsetX = (mslot.logoOffsetX||0) + dx/mlz.w;
    mslot.logoOffsetY = (mslot.logoOffsetY||0) + dy/mlz.h;
  }
  e.preventDefault();
  pushMainUndoCheckpoint();
  renderAll();
});

/* ── 左側：物件（商品圖／LOGO／掛標）切換 + 上傳，一次只顯示一個分頁的內容 ── */
/* 券樣疊字輸入框：一個文字範圍(box)一個輸入框——單張券只有一個框，雙張券
   （例如商城券*2）就會有兩個框，各自控制各自的文字內容。materialType不是
   券樣類就完全不顯示這段（一般商品沒有這個欄位）。 */
function buildMaterialTextFieldsHTML(slot){
  if(!slot.materialType) return '';
  var style = (window.MATERIAL_TEXT_STYLE && window.MATERIAL_TEXT_STYLE.get) ? window.MATERIAL_TEXT_STYLE.get(slot.materialType) : null;
  var boxCount = (style && style.boxes && style.boxes.length) ? style.boxes.length : 1;
  var html = '';
  for(var i=0; i<boxCount; i++){
    var label = boxCount > 1 ? ('券樣疊字（第'+(i+1)+'張券，例如 "$100"）') : '券樣疊字（例如 "$100"）';
    var val = (slot.materialTexts && slot.materialTexts[i] != null) ? slot.materialTexts[i] : (slot.materialTexts&&slot.materialTexts[0]) || '';
    html += '<div class="field"><label>'+label+'</label><input type="text" class="f-material-text" data-idx="'+i+'" value="'+escHtml(val)+'"></div>';
  }
  return html;
}

function buildModalObjectsHTML(key, cfg, slot){
  var tabs = [
    { k:'product', label:'商品圖' },
    { k:'logo', label:'LOGO' }
  ];
  if(cfg.tagZone) tabs.push({ k:'tag', label:'掛標' });

  // 標題顯示品牌名稱（Excel匯入或手動填的slot.brand），沒有brand時才退回
  // 顯示版位方位當預設；可以直接點文字修改，不用另外開「品牌」輸入框。
  var html =
    '<div class="modal-headline"><b><span id="modal-brand-label" class="brand-editable" contenteditable="true">'+escHtml(slot.brand||SLOT_LABEL[key])+'</span></b>'+
      '<button class="icon-btn" id="modal-close" title="關閉"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>'+
    '<div class="obj-tabs">'+
      tabs.map(function(t){ return '<button class="obj-tab" data-tab="'+t.k+'">'+t.label+'</button>'; }).join('')+
    '</div>';

  html +=
    '<div class="obj-panel" data-panel="product">'+
      // 去背/上傳更換/移除：由上往下排，沒有商品圖時整組隱藏(見updateProductToolsUI)
      '<div id="f-prod-tools">'+
        '<div class="field"><button class="tbtn btn-block" id="f-prod-cutout">去背</button></div>'+
        '<div class="field"><button class="tbtn btn-block" id="f-prod-replace">上傳更換</button></div>'+
        '<div class="field"><button class="tbtn btn-block" id="f-prod-remove">移除</button></div>'+
      '</div>'+
      '<div class="field"><button class="tbtn btn-block primary" id="f-prod-browse">瀏覽資料庫（圖示選擇）</button></div>'+
      '<div class="field"><label>或用下拉選單</label><select id="f-prod-lib"><option value="">－－</option></select></div>'+
      '<div id="material-text-fields">'+buildMaterialTextFieldsHTML(slot)+'</div>'+
      '<div class="hint-sm">直接在畫布上點一下商品圖就能拖曳移動、拖四角控制點縮放、拖上方把手旋轉，滾輪也可以縮放。</div>'+
    '</div>';

  html +=
    '<div class="obj-panel" data-panel="logo">'+
      '<div class="field row2"><button class="tbtn btn-block" id="f-logo-replace">上傳更換</button><button class="tbtn btn-block" id="f-logo-remove">移除</button></div>'+
      '<div class="field"><button class="tbtn btn-block primary" id="f-logo-browse">瀏覽資料庫（圖示選擇）</button></div>'+
      '<div class="field"><label>或用下拉選單</label><select id="f-logo-lib"><option value="">－－</option></select></div>'+
      '<div class="field"><label>形狀</label>'+
        '<div class="angle-btns" id="f-logo-shape">'+
          '<button class="angle-btn" data-shape="wide">橫版</button>'+
          '<button class="angle-btn" data-shape="square">方形</button>'+
        '</div>'+
      '</div>'+
      '<div class="field"><label>顯示方式</label>'+
        '<div class="angle-btns" id="f-logo-mode">'+
          '<button class="angle-btn" data-mode="original">原始</button>'+
          '<button class="angle-btn" data-mode="trim">裁切+色底</button>'+
          '<button class="angle-btn" data-mode="fill">滿版填滿</button>'+
        '</div>'+
      '</div>'+
      '<div class="field"><label>顏色</label>'+
        '<div class="angle-btns" id="f-logo-white">'+
          '<button class="angle-btn" data-white="0">原色</button>'+
          '<button class="angle-btn" data-white="1">強制白色</button>'+
        '</div>'+
      '</div>'+
      '<div class="hint-sm">「裁切+色底」的色塊固定不動，LOGO素材可以在裡面滾輪縮放/拖曳捲動。「強制白色」會把LOGO整個變成白色剪影，不用另外準備白色版檔案（只對有去背透明背景的PNG有效，JPG沒有透明資訊會整塊變白）。點畫布上的LOGO會出現選取框。</div>'+
    '</div>';

  if(cfg.tagZone){
    html +=
      '<div class="obj-panel" data-panel="tag">'+
        '<div class="hint-sm">全站共用固定素材，預設依背景深淺自動換白/紅版，不用上傳。</div>'+
        '<div class="field"><label>版本</label>'+
          '<div class="angle-btns" id="f-tag-variant">'+
            '<button class="angle-btn" data-variant="auto">自動</button>'+
            '<button class="angle-btn" data-variant="white">白</button>'+
            '<button class="angle-btn" data-variant="red">紅</button>'+
            '<button class="angle-btn" data-variant="off">關</button>'+
          '</div>'+
        '</div>'+
      '</div>';
  }

  return html;
}

/* 目前開著的放大編輯視窗，「切換左側分頁」這支函式本身——存成模組層級的
   參照，這樣refreshModalStage()裡的onSelectLogo/onSelectProduct/onSelectTag
   才能呼叫得到(這幾個hook是使用者點畫布上的物件時觸發，不是點左側分頁
   按鈕，兩條路徑要能共用同一套「切換分頁」邏輯，不要各自維護一份)。 */
var _activateObjTab = null;

function selectModalTab(key){
  if(_activateObjTab) _activateObjTab(key);
}

function bindObjectTabs(objects){
  var tabs = objects.querySelectorAll('.obj-tab');
  var panels = objects.querySelectorAll('.obj-panel');
  function activate(key){
    _modalCtx.activeTab = key;
    tabs.forEach(function(t){ t.classList.toggle('active', t.dataset.tab === key); });
    panels.forEach(function(p){ p.style.display = (p.dataset.panel === key) ? '' : 'none'; });
    // 分頁一改變(不管是點分頁按鈕，還是點畫布上的物件觸發的)，右側如果還
    // 開著上一個分頁的資料庫瀏覽視窗，先關掉——不然會出現「左側已經切到
    // LOGO分頁，右側卻還停在商品圖的資料庫縮圖」這種左右對不起來的畫面
    // (這是你反映的bug)。
    closeLibraryDrawer();
  }
  _activateObjTab = activate;
  tabs.forEach(function(t){ t.onclick = function(){ activate(t.dataset.tab); }; });
  activate(_modalCtx.activeTab || 'product');
}

/* 使用者自己上傳照片(不是從資料庫選)、或整個移除商品圖時都要走這支——
   自己上傳的照片一定不是券樣，materialType/materialTexts要清乾淨，不然
   原本選著的券樣文字會留著疊在新照片上面(這是你反映的bug：換成沒有券的
   素材，文字沒有跟著消失)。跟pickProductOrMaterialForSlot()是兩種不同
   情境：那支是「換成資料庫裡『另一個』素材/商品」，這支是「換成使用者
   自己的檔案，或乾脆不放圖了」，這兩種都確定新狀態一定沒有券樣文字。 */
function clearMaterialTextState(slot){
  slot.materialType = null;
  slot.materialTexts = [];
}

function setUploadedProductSrc(slot, dataUrl){
  slot.productSrc = dataUrl;
  clearMaterialTextState(slot);
  syncMaterialPresets(slot, null);
  slot.productOffsetX = 0; slot.productOffsetY = 0; slot.productScale = 1;
}

/* 不管是從下拉選單還是瀏覽資料庫選圖，只要是換「商品圖」，都要走這支——
   之前的bug是瀏覽資料庫選圖只換了productSrc，沒有同步更新materialType，
   換成兩張券的圖但文字邏輯還在用一張券的設定，這裡統一處理掉，兩個入口
   都用同一套邏輯，不會再有兩邊行為不一致的問題。

   2026-09再修一個bug：判斷「這個素材要不要開文字框」原本只看有沒有
   matchType(有登記在資料庫裡就開)，但免運車/蝦幣堆這種「有matchType、
   但沒有文字」(hasText:false)的素材，也會被誤判成需要文字框，換成免運車
   之後左側還是會多出一個券樣疊字輸入框、畫面上也還留著文字。真正該看的
   是asset-library.json裡這筆的hasText，不是有沒有matchType——matchType
   只是「素材種類」的分類鍵，跟這個種類需不需要疊字是兩件事。 */
function pickProductOrMaterialForSlot(slot, path){
  var matched = AssetLibrary.artwork().filter(function(it){ return it.path === path; })[0];
  slot.productSrc = path;
  // 換圖之後位置/縮放清掉重算，讓CTA避開邏輯用新圖的實際尺寸重新跑一次，
  // 不要沿用舊圖算出來的位置(舊圖跟新圖大小/形狀可能完全不同)。
  slot.productOffsetX = 0; slot.productOffsetY = 0; slot.productScale = 1;
  // 不管這個素材需不需要疊字(hasText)，只要資料庫裡有登記presetColor就同步
  // 色票——免運車/蝦幣堆/限時特賣這種沒有疊字框的素材也可能有專屬色票。
  syncMaterialPresets(slot, matched);

  if(!matched || !matched.hasText){
    clearMaterialTextState(slot);
    return;
  }
  slot.materialType = matched.matchType;
  // 這裡是之前那個bug的真正原因：換成兩張券時，只給第一個框塞了文字，
  // 第二個框留空(undefined)，畫的時候第二個框沒填過就「借用」第一個框
  // 的內容顯示——這樣預設看起來兩張券文字一樣沒問題，但後來才發現使用者
  // 编辑第一個框時，因為第二個框壓根沒有自己的值，會一直跟著借用、跟著
  // 變動，變成「兩個框看起來共用同一份文字」。改成換種類的當下就先把
  // 每個框都塞一份「各自獨立」的初始文字(複製自舊值，不是共用參照)，
  // 之後編輯任何一個框都只會動到那一個框自己的值。
  var style = (window.MATERIAL_TEXT_STYLE && window.MATERIAL_TEXT_STYLE.get) ? window.MATERIAL_TEXT_STYLE.get(slot.materialType) : null;
  var boxCount = (style && style.boxes && style.boxes.length) ? style.boxes.length : 1;
  var baseText = (slot.materialTexts && slot.materialTexts[0]) || '';
  var next = [];
  for(var i=0; i<boxCount; i++) next.push(baseText);
  slot.materialTexts = next;
}

/* 券樣疊字輸入框的DOM是動態的(依券樣種類有幾個文字框而變動)，換了種類後
   要整個重新產生這一小塊HTML再重新綁事件，不能只靠refreshModalStage()——
   那個只會重畫中間的畫布預覽，不會動到左側這塊物件面板，所以之前才會
   出現「畫面上已經變成兩張券，左側卻還是只有一個文字框」的問題。 */
function refreshMaterialTextFieldsUI(slot){
  var container = document.getElementById('material-text-fields');
  if(!container) return;
  container.innerHTML = buildMaterialTextFieldsHTML(slot);
  bindMaterialTextFieldInputs(container, slot);
}

function bindMaterialTextFieldInputs(container, slot){
  Array.prototype.forEach.call(container.querySelectorAll('.f-material-text'), function(input){
    input.oninput = function(){
      var idx = Number(input.dataset.idx);
      slot.materialTexts = slot.materialTexts || [];
      slot.materialTexts[idx] = input.value;
      refreshModalStage();
    };
  });
}

/* 商品圖的「去背 / 上傳更換 / 移除」三顆按鈕：沒有商品圖時整組隱藏
   (沒東西可去背、可換、可移除)；有商品圖但是是「券樣素材」(有疊字)時去背
   反灰——券樣疊字位置是照整張圖的比例算的，裁切會讓字跑掉，而且這種是設計好的
   固定素材，本來就不需要去背。這支要在每次slot.productSrc變動後呼叫，
   refreshModalStage()尾端會統一呼叫，所以不用每個入口各自處理。 */
function updateProductToolsUI(slot){
  var box = document.getElementById('f-prod-tools');
  if(!box || !slot) return;
  box.style.display = slot.productSrc ? '' : 'none';
  var cut = document.getElementById('f-prod-cutout');
  if(cut){
    var locked = !!slot.materialType;
    cut.disabled = locked;
    cut.title = locked ? '券樣素材有疊字，不能去背/裁切（要用自己的圖請先「上傳更換」）' : '橡皮擦、裁切、自動去背、點選顏色去背';
  }
}

/* 開啟去背編輯器（js/erase-editor.js，獨立模組）。完成套用後只換掉商品圖本身，
   位置/縮放維持不變；只有「裁切」讓尺寸變了才重設位置縮放(不然裁完位置會怪)。 */
function openProductCutout(slot){
  if(!slot || !slot.productSrc) return;
  if(!window.SkbnEraseEditor){
    alert('找不到去背編輯器：請確認 js/erase-editor.js 已放進 js 資料夾，並在 editor.html 引入。');
    return;
  }
  window.SkbnEraseEditor.open(slot.productSrc, {
    title: '商品圖去背',
    onApply: function(res){
      slot.productSrc = res.dataUrl;
      if(res.sizeChanged){ slot.productOffsetX = 0; slot.productOffsetY = 0; slot.productScale = 1; }
      refreshModalStage();
      refreshMaterialTextFieldsUI(slot);
      syncProductLibrarySelect(slot);
    }
  });
}

function bindModalObjectFields(objects, slot, cfg){
  document.getElementById('f-prod-cutout').onclick = function(){ openProductCutout(slot); };
  updateProductToolsUI(slot);
  document.getElementById('f-prod-replace').onclick = function(){
    Assets.pickImage(function(d){ setUploadedProductSrc(slot, d); refreshModalStage(); refreshMaterialTextFieldsUI(slot); syncProductLibrarySelect(slot); });
  };
  document.getElementById('f-prod-remove').onclick = function(){
    slot.productSrc = null;
    clearMaterialTextState(slot);
    syncMaterialPresets(slot, null);
    refreshModalStage();
    refreshMaterialTextFieldsUI(slot);
    syncProductLibrarySelect(slot);
  };
  fillLibrarySelect('f-prod-lib', AssetLibrary.sortByBrand(AssetLibrary.artwork(), slot.brand), slot.productSrc, function(path){
    pickProductOrMaterialForSlot(slot, path); refreshModalStage(); refreshMaterialTextFieldsUI(slot); syncProductLibrarySelect(slot);
  });
  document.getElementById('f-prod-browse').onclick = function(){
    openLibraryDrawer('曝品', AssetLibrary.sortByBrand(AssetLibrary.artwork(), slot.brand), function(path){
      pickProductOrMaterialForSlot(slot, path); refreshModalStage(); refreshMaterialTextFieldsUI(slot); syncProductLibrarySelect(slot);
    });
  };

  bindMaterialTextFieldInputs(objects, slot);

  document.getElementById('f-logo-replace').onclick = function(){
    Assets.pickImage(function(d){ slot.logoRaw = d; clearLogoPresets(slot); Modules.logo.applyProcessing(slot, refreshModalStage); });
  };
  document.getElementById('f-logo-remove').onclick = function(){
    slot.logoRaw = null; slot.logoSrc = null; slot.logoBgColor = null;
    clearLogoPresets(slot);
    slot.__logoContentW = null; slot.__logoContentH = null; slot.__trimInitFor = null;
    refreshModalStage();
  };
  var logoModeWrap = document.getElementById('f-logo-mode');
  logoModeWrap.querySelectorAll('.angle-btn').forEach(function(btn){
    if(btn.dataset.mode === (slot.logoMode||'original')) btn.classList.add('active');
    btn.onclick = function(){
      slot.logoMode = btn.dataset.mode;
      logoModeWrap.querySelectorAll('.angle-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      Modules.logo.applyProcessing(slot, refreshModalStage);
    };
  });
  var logoWhiteWrap = document.getElementById('f-logo-white');
  logoWhiteWrap.querySelectorAll('.angle-btn').forEach(function(btn){
    if(btn.dataset.white === (slot.logoForceWhite ? '1' : '0')) btn.classList.add('active');
    btn.onclick = function(){
      slot.logoForceWhite = (btn.dataset.white === '1');
      logoWhiteWrap.querySelectorAll('.angle-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      refreshModalStage();
    };
  });
  var logoShapeWrap = document.getElementById('f-logo-shape');
  logoShapeWrap.querySelectorAll('.angle-btn').forEach(function(btn){
    if(btn.dataset.shape === (slot.logoShape||'wide')) btn.classList.add('active');
    btn.onclick = function(){
      slot.logoShape = btn.dataset.shape;
      logoShapeWrap.querySelectorAll('.angle-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      refreshModalStage();
    };
  });
  fillLibrarySelect('f-logo-lib', AssetLibrary.sortByBrand(AssetLibrary.systemElements('logo'), slot.brand), slot.logoRaw, function(path){
    slot.logoRaw = path; syncLogoPresets(slot, path); Modules.logo.applyProcessing(slot, refreshModalStage);
  });
  document.getElementById('f-logo-browse').onclick = function(){
    openLibraryDrawer('LOGO', AssetLibrary.sortByBrand(AssetLibrary.systemElements('logo'), slot.brand), function(path){
      slot.logoRaw = path; syncLogoPresets(slot, path); Modules.logo.applyProcessing(slot, refreshModalStage);
    });
  };

  if(cfg.tagZone){
    bindVariantSelector('f-tag-variant', slot, 'tagVariant');
  }
}

/* 標題「編輯「品牌名稱」版位」的品牌名稱可以直接點下去改。 */
function bindModalBrandLabel(objects, slot){
  var label = document.getElementById('modal-brand-label');
  if(!label) return;
  label.oninput = function(){ slot.brand = label.innerText.trim(); };
  label.onblur = function(){
    var text = label.innerText.trim();
    slot.brand = text;
    if(!text) label.innerText = SLOT_LABEL[_modalCtx.key];
    refreshLibrarySelects();
  };
}

/* 常用配色快捷色票：DD Day／10.10品牌週年慶／99大促這三個檔期本來就是
   同一組色碼，去重複只留一組，不寫活動名稱——純粹當色票用，點一下同時
   套用背景色+文字色，不用自己記色碼、也不用真的比對到那個LOGO才看得到
   「套用檔期標準色」按鈕。純粹是快捷輸入，不影響自動配色/LOGO比對邏輯。 */
var COMMON_COLOR_PRESETS = [
  { bg:'#ee4e2e', text:'#fffd3e' }, // DD Day／10.10品牌週年慶／99大促共用
  { bg:'#ffa200', text:'#ffff3c' }, // 18號會員日
  { bg:'#d0011d', text:'#ffe600' }  // 商城25節
];

/* ── 「常用配色」色票列 ──
   2026-09：一個LOGO可以有自己專屬的多組色票（例如限時特賣：橘/藍/紅三組，
   見data/asset-library.json的presetColors）。選到（或匯入比對到）那個LOGO，
   色票列最前面就會出現它的專屬色票，後面接分隔線再接一般的常用配色。
   換LOGO/換成自己上傳的圖，專屬色票會跟著更新/消失（syncLogoPresets）。 */
/* 2026-09：素材（例如限時特賣的CFS-娛樂/3C/生活用品）也可以各自登記專屬
   色票（見data/asset-library.json的presetColor），跟LOGO的專屬色票是分開
   存的兩份狀態（slot.materialPresetColor / slot.presetColors），這裡合併
   成同一份色票列顯示：素材排前面（通常比較精準對到這一格實際的檔期/分類），
   LOGO接在後面，顏色重複的只留一個。 */
function getSlotPresets(slot){
  var own = (slot.presetColors && slot.presetColors.length) ? slot.presetColors.slice()
    : (slot.presetBgColor ? [{ bg: slot.presetBgColor, text: slot.presetTextColor }] : []);
  var mat = slot.materialPresetColor ? [slot.materialPresetColor] : [];
  var merged = mat.concat(own);
  var seen = {};
  return merged.filter(function(p){
    var key = (p && p.bg || '') + '|' + (p && p.text || '');
    if(seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

/* 換素材（下拉選單或瀏覽資料庫選圖，統一都會經過pickProductOrMaterialForSlot）
   之後，依這個素材在資料庫裡的presetColor登記更新這一格的專屬色票——跟
   syncLogoPresets是同一套「一鍵套用檔期標準色」機制，只是換成素材觸發。
   matched為null或沒有presetColor就清成沒有素材專屬色票。 */
function syncMaterialPresets(slot, matched){
  slot.materialPresetColor = (matched && matched.presetColor) ? matched.presetColor : null;
  refreshPresetRow(slot);
}

function _presetChipHTML(attr, i, p){
  var text = p.text || '#ffffff';
  return '<button type="button" class="preset-color-chip" '+attr+'="'+i+'" style="background:'+p.bg+';" title="背景 '+p.bg+' ／ 文字 '+text+'">'+
    '<span class="preset-color-chip-dot" style="background:'+text+';"></span></button>';
}

function buildPresetChipsHTML(slot){
  var own = getSlotPresets(slot);
  return (own.length
      ? own.map(function(p, i){ return _presetChipHTML('data-own-idx', i, p); }).join('') + '<span class="preset-color-divider"></span>'
      : '') +
    COMMON_COLOR_PRESETS.map(function(p, i){ return _presetChipHTML('data-idx', i, p); }).join('');
}

function bindPresetChips(slot){
  var row = document.getElementById('f-common-presets');
  if(!row) return;
  function apply(p){
    slot.bgColor = p.bg;
    slot.titleColor = p.text || ColorUtils.pickTextColorForBackground(p.bg);
    document.getElementById('f-bgcolor').value = slot.bgColor;
    document.getElementById('f-titlecolor').value = slot.titleColor;
    refreshModalStage();
  }
  Array.prototype.forEach.call(row.querySelectorAll('.preset-color-chip[data-own-idx]'), function(btn){
    btn.onclick = function(){ apply(getSlotPresets(slot)[Number(btn.dataset.ownIdx)]); };
  });
  Array.prototype.forEach.call(row.querySelectorAll('.preset-color-chip[data-idx]'), function(btn){
    btn.onclick = function(){ apply(COMMON_COLOR_PRESETS[Number(btn.dataset.idx)]); };
  });
}

/* 換LOGO（從資料庫選）之後，依那個LOGO在資料庫裡的登記更新這一格的專屬色票，
   並重畫色票列。找不到（或沒有登記色票）就清成沒有專屬色票。 */
function syncLogoPresets(slot, logoPath){
  var hit = AssetLibrary.systemElements('logo').filter(function(it){ return it.path === logoPath; })[0];
  var f = hit ? AssetMatcher.logoPresetFields(hit) : { presetColors: [] };
  slot.presetColors = f.presetColors.slice();
  slot.presetBgColor = f.presetColors.length ? f.presetColors[0].bg : null;
  slot.presetTextColor = f.presetColors.length ? f.presetColors[0].text : null;
  // 2026-09：少數LOGO在資料庫裡登記了forceTrimMode(例如品牌會員，圖檔比例
  // 跟LOGO框不一樣，需要裁切+底色的膠囊模式包起來才好看)，不管是Excel匯入
  // (見editor-import.js)還是這裡手動瀏覽資料庫選到，都自動套用trim模式，
  // 同步左側「裁切模式」按鈕的選取狀態，不然畫面已經換成膠囊、按鈕卻還
  // 停在原圖那顆。只會「自動打開」，選到一般沒登記這個的LOGO不會反過來
  // 把使用者原本手動選好的模式改掉。
  if(f.forceTrimMode){
    slot.logoMode = 'trim';
    var modeWrap = document.getElementById('f-logo-mode');
    if(modeWrap){
      modeWrap.querySelectorAll('.angle-btn').forEach(function(b){
        b.classList.toggle('active', b.dataset.mode === 'trim');
      });
    }
  }
  refreshPresetRow(slot);
}

function clearLogoPresets(slot){
  slot.presetColors = [];
  slot.presetBgColor = null;
  slot.presetTextColor = null;
  refreshPresetRow(slot);
}

function refreshPresetRow(slot){
  var row = document.getElementById('f-common-presets');
  if(!row) return;
  row.innerHTML = buildPresetChipsHTML(slot);
  bindPresetChips(slot);
}

/* ── 右側：品牌以外的一般設定（文字字數/禁用語檢查已經移到外面常駐的
   提示與警示面板，這裡不重複顯示）── */
function buildModalSettingsHTML(key, cfg, slot){
  return (
    '<div class="side-section-title" style="margin-top:0;">背景色</div>'+
    '<div class="field"><input type="color" id="f-bgcolor" style="width:100%;height:34px;border:1px solid var(--border);border-radius:6px;background:var(--bg);"></div>'+

    '<div class="side-section-title">主標文字顏色</div>'+
    '<div class="field"><input type="color" id="f-titlecolor" style="width:100%;height:34px;border:1px solid var(--border);border-radius:6px;background:var(--bg);"></div>'+

    '<div class="side-section-title">常用配色</div>'+
    '<div class="field preset-color-row" id="f-common-presets">'+buildPresetChipsHTML(slot)+'</div>'+

    '<div class="side-section-title">商品影子</div>'+
    '<div class="field"><label>光源角度</label>'+
      '<div class="angle-btns" id="f-shadow-angle">'+
        '<button class="angle-btn" data-angle="left">左</button>'+
        '<button class="angle-btn" data-angle="top">中</button>'+
        '<button class="angle-btn" data-angle="right">右</button>'+
        '<button class="angle-btn" data-angle="off">關</button>'+
      '</div>'+
    '</div>'+
    '<div class="field"><label>陰影左右位移</label><input type="range" id="f-shadow-x" min="-0.3" max="0.3" step="0.01" style="width:100%;"></div>'+
    '<div class="field"><label>陰影上下位移</label><input type="range" id="f-shadow-y" min="-0.3" max="0.3" step="0.01" style="width:100%;"></div>'+
    '<div class="field"><button class="tbtn btn-block" id="f-shadow-reset">重設商品位置/縮放/旋轉/陰影位移</button></div>'+

    '<div class="field" style="margin-top:20px;"><button class="tbtn primary btn-block" id="f-confirm-close">✓ 確認並關閉</button></div>'
  );
}

function bindModalSettingsFields(settings, slot, cfg){
  document.getElementById('f-bgcolor').value = /^#[0-9a-f]{6}$/i.test(slot.bgColor||'') ? slot.bgColor : '#333333';
  document.getElementById('f-bgcolor').oninput = function(){
    slot.bgColor = this.value;
    slot.titleColor = ColorUtils.pickTextColorForBackground(slot.bgColor);
    document.getElementById('f-titlecolor').value = slot.titleColor;
    refreshModalStage();
  };

  document.getElementById('f-titlecolor').value = /^#[0-9a-f]{6}$/i.test(slot.titleColor||'') ? slot.titleColor : '#ffffff';
  document.getElementById('f-titlecolor').oninput = function(){ slot.titleColor = this.value; refreshModalStage(); };

  bindPresetChips(slot);

  var shadowWrap = document.getElementById('f-shadow-angle');
  shadowWrap.querySelectorAll('.angle-btn').forEach(function(btn){
    if(btn.dataset.angle === (slot.shadowAngle||'off')) btn.classList.add('active');
    btn.onclick = function(){
      slot.shadowAngle = btn.dataset.angle;
      shadowWrap.querySelectorAll('.angle-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      refreshModalStage();
    };
  });

  var shadowX = document.getElementById('f-shadow-x');
  shadowX.value = slot.shadowOffsetX || 0;
  shadowX.oninput = function(){ slot.shadowOffsetX = Number(shadowX.value); refreshModalStage(); };

  var shadowY = document.getElementById('f-shadow-y');
  shadowY.value = slot.shadowOffsetY || 0;
  shadowY.oninput = function(){ slot.shadowOffsetY = Number(shadowY.value); refreshModalStage(); };

  document.getElementById('f-shadow-reset').onclick = function(){
    slot.productOffsetX = 0; slot.productOffsetY = 0; slot.productScale = 1; slot.productRot = 0;
    slot.shadowOffsetX = 0; slot.shadowOffsetY = 0;
    shadowX.value = 0; shadowY.value = 0;
    refreshModalStage();
  };

  document.getElementById('f-confirm-close').onclick = confirmModal;
}

/* 「完成」按鈕：把草稿寫回真正的banner[key]，畫面(主畫面縮圖)才會真的
   更新；closeModal()本身不寫回任何東西，這裡才是唯一真正「儲存」的地方。 */
function confirmModal(){
  if(_modalCtx){
    Object.assign(_modalCtx.realSlot, _modalCtx.slot);
    _modalCtx.realSlot.materialTexts = (_modalCtx.slot.materialTexts || []).slice();
  }
  closeModal();
}

/* text-module.js的contenteditable oninput會呼叫這個全域hook——放大編輯
   視窗裡已經不重複顯示字數/禁用語，這裡只需要更新外面常駐的提示面板，
   讓使用者打字時就能即時看到（不用整個renderAll()，只重繪提示面板，
   contenteditable不會因此失焦）。 */
function onTitleTextChanged(){
  renderIssuesPanel();
}

function escHtml(s){
  var d = document.createElement('div');
  d.innerText = s;
  return d.innerHTML;
}

/* 掛標的「自動/白/紅/關」四選一綁定。 */
function bindVariantSelector(containerId, slot, fieldName){
  var wrap = document.getElementById(containerId);
  if(!wrap) return;
  var current = slot[fieldName] || 'auto';
  wrap.querySelectorAll('.angle-btn').forEach(function(btn){
    if(btn.dataset.variant === current) btn.classList.add('active');
    btn.onclick = function(){
      slot[fieldName] = btn.dataset.variant;
      wrap.querySelectorAll('.angle-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      refreshModalStage();
    };
  });
}

function refreshLibrarySelects(){
  if(!_modalCtx) return;
  var slot = _modalCtx.slot;
  fillLibrarySelect('f-logo-lib', AssetLibrary.sortByBrand(AssetLibrary.systemElements('logo'), slot.brand), slot.logoRaw, function(path){
    slot.logoRaw = path; syncLogoPresets(slot, path); Modules.logo.applyProcessing(slot, refreshModalStage);
  });
  fillLibrarySelect('f-prod-lib', AssetLibrary.sortByBrand(AssetLibrary.artwork(), slot.brand), slot.productSrc, function(path){
    pickProductOrMaterialForSlot(slot, path); refreshModalStage(); refreshMaterialTextFieldsUI(slot); syncProductLibrarySelect(slot);
  });
}

/* 資料庫圖示選擇：右側設定欄「原地切換」成資料庫縮圖畫面——設定欄往左
   滑出去、資料庫畫面從右滑進來，兩個不會同時疊在畫面上，popup本身的
   位置/大小完全不會變動。 */
var _libraryDrawerOpenFor = null; // 記錄目前開著的是哪一個(曝品/LOGO)，同一個再點一次要能收合

function openLibraryDrawer(label, items, onPick){
  var settings = document.getElementById('modal-settings');
  var libraryFace = document.getElementById('modal-library-face');
  if(!settings || !libraryFace) return;

  // 同一個已經開著時再點一次 → 收合（跟你確認過的行為）
  if(settings.classList.contains('show-library') && _libraryDrawerOpenFor === label){
    closeLibraryDrawer();
    return;
  }
  _libraryDrawerOpenFor = label;

  libraryFace.innerHTML = '';

  var head = document.createElement('div');
  head.className = 'modal-headline';
  head.innerHTML = '<b>選擇'+label+'</b>';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.title = '關閉';
  closeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  closeBtn.onclick = closeLibraryDrawer;
  head.appendChild(closeBtn);
  libraryFace.appendChild(head);

  var body = document.createElement('div');
  body.className = 'library-drawer-body';
  libraryFace.appendChild(body);

  // 搜尋框：品牌/名稱/比對關鍵字(matchKeys／matchType)都能搜，即時篩選
  // 卡片，不用逐個分類展開找。有輸入內容時所有分類都會展開顯示（不受
  // 底下手風琴「一次只開一個分類」限制，不然搜尋到別的分類的項目卻因為
  // 收合著看不到）；清空搜尋框就恢復原本手風琴狀態。
  var searchInput = null;
  if(items.length > 0){
    var searchWrap = document.createElement('div');
    searchWrap.className = 'lib-search-wrap';
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'lib-search-input';
    searchInput.placeholder = '搜尋'+label+'（品牌／名稱）…';
    searchInput.autocomplete = 'off';
    searchWrap.appendChild(searchInput);
    body.appendChild(searchWrap);
  }

  if(items.length === 0){
    var empty = document.createElement('div');
    empty.className = 'hint-sm';
    empty.innerText = '目前資料庫是空的。';
    body.appendChild(empty);
  } else {
    var byCategory = {};
    items.forEach(function(it){
      (byCategory[it.categoryLabel] = byCategory[it.categoryLabel] || []).push(it);
    });
    var catKeys = Object.keys(byCategory);
    var groupEls = []; // 記錄每個分類的{grid, chevron, titleEl, cards}，accordion收合／搜尋篩選時要用

    catKeys.forEach(function(catLabel, catIdx){
      var title = document.createElement('div');
      title.className = 'side-section-title lib-cat-title';
      title.style.marginTop = '10px';
      title.style.cursor = 'pointer';
      title.style.display = 'flex';
      title.style.justifyContent = 'space-between';
      title.style.alignItems = 'center';

      var labelSpan = document.createElement('span');
      labelSpan.innerText = catLabel;
      var chevron = document.createElement('span');
      chevron.innerHTML = '▾';
      chevron.style.transition = 'transform .15s';
      title.appendChild(labelSpan);
      title.appendChild(chevron);
      body.appendChild(title);

      var grid = document.createElement('div');
      grid.className = 'lib-grid';
      var cardEls = []; // 這個分類底下每張卡片的{el, searchText}，給搜尋篩選用
      byCategory[catLabel].forEach(function(it){
        var card = document.createElement('div');
        card.className = 'lib-card';

        var thumb = document.createElement('div');
        thumb.className = 'lib-thumb';
        var img = document.createElement('img');
        img.src = it.path;
        img.onerror = function(){ thumb.innerHTML = '<span class="ph">'+it.name+'</span>'; };
        thumb.appendChild(img);
        card.appendChild(thumb);

        var nameEl = document.createElement('div');
        nameEl.className = 'lib-name';
        nameEl.innerText = (it.brand ? ('['+it.brand+'] ') : '') + it.name;
        card.appendChild(nameEl);

        card.onclick = function(){ onPick(it.path); closeLibraryDrawer(); };
        grid.appendChild(card);

        // 搜尋比對範圍：品牌/名稱/比對關鍵字(matchKeys是LOGO用、matchType是
        // 素材用)全部併在一起小寫比對，這樣搜工單上會寫的代碼(例如「CFS-3C」
        // 「蝦皮直營3C家電」)也找得到，不用一定要打完整品牌名稱。
        var searchParts = [it.brand, it.name, it.matchType].concat(it.matchKeys||[]);
        cardEls.push({ el: card, searchText: searchParts.filter(Boolean).join(' ').toLowerCase() });
      });
      body.appendChild(grid);
      groupEls.push({ grid:grid, chevron:chevron, titleEl:title, cards:cardEls });

      // 手風琴：一次只開一個分類，預設第一個展開、其餘收合，點標題切換，
      // 打開某一個會自動收合其他的（跟你舉的例子一樣：開造節就收全站大促）。
      // 搜尋中(searchInput有輸入內容)時例外：每個分類獨立開關，不影響其他
      // 已經因為搜尋結果而展開的分類。
      var expanded = (catIdx === 0);
      grid.style.display = expanded ? '' : 'none';
      chevron.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';

      title.onclick = function(){
        var searching = !!(searchInput && searchInput.value.trim());
        var willExpand = grid.style.display === 'none';
        if(!searching){
          groupEls.forEach(function(g){
            g.grid.style.display = 'none';
            g.chevron.style.transform = 'rotate(-90deg)';
          });
        }
        grid.style.display = willExpand ? '' : 'none';
        chevron.style.transform = willExpand ? 'rotate(0deg)' : 'rotate(-90deg)';
      };
    });

    if(searchInput){
      searchInput.oninput = function(){
        var q = searchInput.value.trim().toLowerCase();
        groupEls.forEach(function(g, i){
          if(!q){
            // 清空搜尋 → 恢復預設手風琴狀態：全部卡片顯示、第一個分類展開
            g.cards.forEach(function(c){ c.el.style.display = ''; });
            g.titleEl.style.display = '';
            g.grid.style.display = (i===0) ? '' : 'none';
            g.chevron.style.transform = (i===0) ? 'rotate(0deg)' : 'rotate(-90deg)';
            return;
          }
          var anyMatch = false;
          g.cards.forEach(function(c){
            var match = c.searchText.indexOf(q) >= 0;
            c.el.style.display = match ? '' : 'none';
            if(match) anyMatch = true;
          });
          g.titleEl.style.display = anyMatch ? '' : 'none';
          g.grid.style.display = anyMatch ? '' : 'none';
          g.chevron.style.transform = anyMatch ? 'rotate(0deg)' : 'rotate(-90deg)';
        });
      };
      // 每次打開瀏覽視窗都是全新的輸入框，直接focus方便馬上打字搜尋。
      // 2026-09修bug：這個視窗本身是用CSS transform做滑入動畫(.library-face
      // 0.2s)，剛插入DOM時整塊還在畫面外/滑動中，這時候呼叫focus()瀏覽器
      // 會自動把輸入框「捲動進可視範圍」，在動畫還沒跑完時硬要捲動，兩個
      // 動作疊在一起就會看起來像抖了一下——你反映的「資料庫出現時抖動」
      // 就是這個。加上{preventScroll:true}讓focus()不要觸發自動捲動，
      // 滑入動畫維持原本平順的樣子，輸入框一樣會拿到焦點可以直接打字。
      setTimeout(function(){
        try{ searchInput.focus({ preventScroll:true }); }
        catch(e){ searchInput.focus(); }
      }, 0);
    }
  }

  settings.classList.add('show-library');
  var panel = document.getElementById('modal-panel');
  // 資料庫瀏覽開著時，中間畫布(拖曳商品/logo位置那塊)先鎖住不能互動——
  // 不然一邊瀏覽縮圖、一邊還能在底下拖曳商品位置，容易手滑誤觸(跟你
  // 確認過的行為)，CSS見.modal-panel.library-open .modal-stage。
  if(panel) panel.classList.add('library-open');
}

function closeLibraryDrawer(){
  var settings = document.getElementById('modal-settings');
  if(settings) settings.classList.remove('show-library');
  var panel = document.getElementById('modal-panel');
  if(panel) panel.classList.remove('library-open');
  _libraryDrawerOpenFor = null;
}

/* currentValue：目前這一格實際用的來源(slot.productSrc/slot.logoRaw)，跟
   選單裡哪個option的value相符就直接選起來顯示——這是你反映的問題：下拉
   選單原本每次選完都會自動跳回「－－」，變成只能用來「觸發一次動作」，
   看不出目前到底是不是資料庫裡的哪一個素材。改成選完就維持顯示那個選項，
   而且每次重新整理這個下拉選單(rebuild面板/換了品牌重新排序)都會依目前
   slot的實際狀態重新對一次，不管是透過這個選單選的、還是透過「瀏覽資料庫」
   縮圖選的、或乾脆是使用者自己上傳的照片(那樣就對不到任何一個option，
   自然顯示「－－」，這樣才正確)。 */
function fillLibrarySelect(selectId, items, currentValue, onPick){
  var sel = document.getElementById(selectId);
  if(!sel) return;
  var byCategory = {};
  items.forEach(function(it){
    byCategory[it.categoryLabel] = byCategory[it.categoryLabel] || [];
    byCategory[it.categoryLabel].push(it);
  });
  var html = '<option value="">－－</option>';
  Object.keys(byCategory).forEach(function(catLabel){
    html += '<optgroup label="'+catLabel+'">';
    byCategory[catLabel].forEach(function(it){
      html += '<option value="'+it.path+'">'+(it.brand?('['+it.brand+'] '):'')+it.name+'</option>';
    });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
  sel.value = items.some(function(it){ return it.path === currentValue; }) ? currentValue : '';
  sel.onchange = function(){
    if(sel.value) onPick(sel.value);
  };
}

/* 商品圖換來源的入口不只f-prod-lib這個下拉選單本身(還有「上傳更換」/
   「移除」/「瀏覽資料庫」縮圖選擇/直接點畫布上的空格子)，這些入口改了
   slot.productSrc之後都要呼叫這支，讓下拉選單重新對一次目前的實際狀態，
   不然選單畫面會卡在上一次的選項、跟真正的來源對不起來。 */
function syncProductLibrarySelect(slot){
  var sel = document.getElementById('f-prod-lib');
  if(!sel) return;
  var match = Array.prototype.some.call(sel.options, function(opt){ return opt.value === slot.productSrc; });
  sel.value = match ? slot.productSrc : '';
}

function refreshModalStage(){
  if(!_modalCtx) return;
  pushUndoCheckpoint();
  updateProductToolsUI(_modalCtx.slot);
  var stage = document.getElementById('modal-stage-inner');
  if(!stage) return;
  stage.innerHTML = '';
  var el = Core.buildBlockStage(_modalCtx.slot, _modalCtx.key, _modalCtx.scale, {
    onChange: refreshModalStage,
    onRequestLogoPick: function(){ Assets.pickImage(function(d){ _modalCtx.slot.logoRaw = d; clearLogoPresets(_modalCtx.slot); Modules.logo.applyProcessing(_modalCtx.slot, refreshModalStage); }); },
    onRequestProductPick: function(){ Assets.pickImage(function(d){ setUploadedProductSrc(_modalCtx.slot, d); refreshModalStage(); refreshMaterialTextFieldsUI(_modalCtx.slot); syncProductLibrarySelect(_modalCtx.slot); }); },
    // 點畫布上的logo/商品/掛標，左側分頁自動跟著切過去，不用自己再點一次
    // 左邊的分頁按鈕(跟你確認過的導覽捷徑)。
    onSelectLogo: function(){ selectModalTab('logo'); },
    onSelectProduct: function(){ selectModalTab('product'); },
    onSelectTag: function(){ selectModalTab('tag'); }
  });
  stage.appendChild(el);
}

function closeModal(){
  closeLibraryDrawer();
  var el = document.getElementById('modal-overlay');
  if(el) el.remove();
  _modalCtx = null;
  renderAll();
}

/* ══════════════════ 右側常駐「提示與警示」面板 ══════════════════
   跟krcb專案同一個精神：素材比對警示 + 全部banner的文案問題彙整，都在
   畫面右側固定看得到，不用先打開放大編輯視窗才看得到。 */
/* 素材比對警示是「活的」：匯入時記下哪一格(banner+key)、缺的是LOGO還是商品圖，
   每次重畫面板都重新檢查那一格現在有沒有圖——使用者手動上傳/選了圖之後，
   這條警示就自動消失。那一組已經被刪掉(不在STATE.banners裡)的也一併不顯示。
   純文字的警示(舊格式/沒有對應格子的)維持一直顯示。 */
function activeAssetWarnings(){
  return (STATE.warnings || []).filter(function(w){
    if(typeof w === 'string') return true;
    if(STATE.banners.indexOf(w.banner) < 0) return false;
    var s = w.banner[w.key];
    if(!s) return false;
    if(w.kind === 'logo') return !(s.logoRaw || s.logoSrc);
    if(w.kind === 'product') return !s.productSrc;
    return true;
  });
}

function renderIssuesPanel(){
  var panel = document.getElementById('side-panel');
  if(!panel) return;
  panel.innerHTML = '';

  var assetWarnings = activeAssetWarnings();
  var hasAssetWarnings = assetWarnings.length > 0;
  if(hasAssetWarnings){
    var w = document.createElement('div');
    w.className = 'warnings-panel';
    w.innerHTML =
      '<div class="warn-head">⚠ 有 '+assetWarnings.length+' 個項目自動比對不到，需要手動上傳/選擇：</div>'+
      '<ul class="warn-list">'+ assetWarnings.map(function(x){ return '<li>'+escHtml(typeof x === 'string' ? x : x.text)+'</li>'; }).join('') +'</ul>';
    panel.appendChild(w);
  }

  var textBox = document.createElement('div');
  textBox.id = 'text-issues-container';
  panel.appendChild(textBox);

  var emptyHint = document.createElement('div');
  emptyHint.className = 'hint-sm';
  emptyHint.style.marginTop = '0';
  emptyHint.innerText = '目前沒有需要注意的項目。';
  if(!hasAssetWarnings) panel.appendChild(emptyHint); // 文字問題還沒算完前先顯示，算完有東西會被下面蓋掉/隱藏

  renderTextIssues(textBox, function(hasTextIssues){
    if(hasAssetWarnings || hasTextIssues) emptyHint.style.display = 'none';
  });
}

/* 彙整全部banner/版位的主標文字問題（超過字數上限/踩到禁用語），每一格
   都用Excel「字數」欄自己的上限(slot.titleLimit)去判斷，不是固定值。這支
   純粹算資料，不管UI——側邊常駐警示面板(renderTextIssues)、下載前的確認
   彈窗(editor-export.js的showComplianceGate)共用同一份判斷邏輯，不要各自
   維護一份，不然兩邊「怎麼算超字數/怎麼算命中」以後改一次要改兩個地方，
   容易漏改。 */
function collectTextIssues(cb){
  if(typeof loadBanwords !== 'function'){ cb([]); return; }
  loadBanwords().then(function(list){
    var rows = [];
    STATE.banners.forEach(function(banner, bIdx){
      Core.SLOT_KEYS.forEach(function(key){
        var slot = banner[key];
        var text = slot.title || '';
        var weight = computeCharWeight(text);
        var overLimit = !!(slot.titleLimit && weight > slot.titleLimit);
        var hits = checkBanwords(text, list);
        if(overLimit || hits.length){
          rows.push({
            banner: banner, key: key, idx: bIdx,
            label: bannerDateLabel(banner, bIdx)+' '+(SLOT_LABEL[key]||key),
            overLimit: overLimit, weight: weight, limit: slot.titleLimit,
            hits: hits
          });
        }
      });
    });
    cb(rows);
  });
}

/* 點警語列表裡的紅字範圍(標籤+超字數提示)，捲動主畫面到對應的那張製作物，
   並閃一下邊框讓使用者知道捲到了哪一張——跟左側製作物列表(renderProductionList)
   共用同一支捲動邏輯，不要各自維護一份。 */
function scrollToBannerCard(idx){
  var card = document.getElementById('banner-card-'+idx);
  if(!card) return;
  card.scrollIntoView({ behavior:'smooth', block:'start' });
  card.classList.add('flash-highlight');
  setTimeout(function(){ card.classList.remove('flash-highlight'); }, 1200);
}

/* 有安全建議值的禁用語會有「套用」按鈕，點下去直接改掉slot.title，同時
   更新畫布顯示（透過renderAll()）。 */
function renderTextIssues(container, onDone){
  container.innerHTML = '';
  collectTextIssues(function(rows){
    if(!rows.length){ if(onDone) onDone(false); return; }

    var box = document.createElement('div');
    box.className = 'warnings-panel';
    var html = '<div class="warn-head">📝 有 '+rows.length+' 處主標文字需要注意：</div>';
    rows.forEach(function(r, ri){
      html += '<div class="text-issue-row text-issue-jump" data-jump="'+ri+'" title="跳到這張製作物">';
      html += '<b>'+escHtml(r.label)+'</b>';
      if(r.overLimit){
        var wd = Number.isInteger(r.weight) ? r.weight : r.weight.toFixed(1);
        html += ' <span class="text-counter over">'+wd+'/'+r.limit+'</span>';
      }
      if(r.hits.length){
        html += '<div class="banword-warning" style="margin-top:4px;">'+
          r.hits.map(function(h, hi){
            var msg = escHtml(h.matchedText) + (h.replace ? '（建議改成「'+escHtml(h.replace)+'」）' : (h.note ? '（'+escHtml(h.note)+'）' : ''));
            if(h.suggested !== null && h.suggested !== undefined && h.suggested !== h.matchedText){
              msg += ' <button type="button" class="banword-apply-btn" data-row="'+ri+'" data-hit="'+hi+'">套用</button>';
            }
            return msg;
          }).join('<br>')+
        '</div>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
    container.appendChild(box);

    Array.prototype.forEach.call(box.querySelectorAll('.text-issue-jump'), function(el){
      el.onclick = function(){ scrollToBannerCard(rows[Number(el.dataset.jump)].idx); };
    });

    Array.prototype.forEach.call(box.querySelectorAll('.banword-apply-btn'), function(btn){
      btn.onclick = function(e){
        e.stopPropagation(); // 套用按鈕現在包在可點擊跳轉的整列裡面，不擋掉冒泡的話點套用會連帶觸發捲動跳轉
        var r = rows[Number(btn.dataset.row)];
        var hit = r.hits[Number(btn.dataset.hit)];
        var slot = r.banner[r.key];
        var text = slot.title || '';
        slot.title = text.slice(0, hit.index) + hit.suggested + text.slice(hit.index + hit.matchedText.length);
        renderAll();
        if(_modalCtx && _modalCtx.slot === slot) refreshModalStage();
      };
    });

    if(onDone) onDone(true);
  });
}

/* ── 頂部工具列 ── */
function initTopbar(){
  // 「＋ 新增一組」已經搬到左側製作物列表標題列（見renderProductionList()）。

  document.getElementById('btn-reset').onclick = function(){
    if(!confirm('確定要清空目前所有內容，重新開始嗎？')) return;
    STATE.banners = [emptyBanner(), emptyBanner(), emptyBanner(), emptyBanner()];
    STATE.warnings = [];
    BatchAssets.clear();
    renderAll();
  };

  // 匯入工單（Excel + 素材資料夾）走 openImportModal()（見 js/editor-popups.js）。

  document.getElementById('btn-download-all').onclick = function(){ downloadAllBannersWithCheck(STATE.banners); };

  // 載入暫存檔（整包下載附的SKBN_暫存檔.json，或直接選整包zip），邏輯見 js/editor-export.js。
  var draftInput = document.getElementById('draft-import');
  document.getElementById('btn-load-draft').onclick = function(){ draftInput.value = ''; draftInput.click(); };
  draftInput.onchange = function(){ if(draftInput.files && draftInput.files[0]) loadDraftFromFile(draftInput.files[0]); };
  // 下載暫存檔：只下載暫存檔本身（.json），不用整包下載、不會輸出圖片。
  document.getElementById('btn-download-draft').onclick = function(){ downloadDraftFile(STATE.banners); };
}

/* 點畫布上商品/LOGO以外的任何地方，都要把目前選取的選取框收起來——不能
   只有「點同一格的空白處」才有效，點別的地方(別的版位、頁面空白處)也要
   收掉，不然選取框會一直卡著。用document層級的pointerdown偵測，只要點擊
   目標不在任何.product-zone/.logo-zone裡面，就把全部slot的選取狀態清掉。
   （在canvas自己的pointerdown handler已經處理「同一格內點外面」的情況，
   這裡只補「點到別格/別的地方」這一種，兩者不會互相衝突：canvas自己的
   handler是bubble前的target階段先跑，這支是document上的bubble階段，
   一定是canvas那份先執行完。） */
/* 點選任何一格的logo/商品時，把「這一格」以外的所有slot(不管哪個banner、
   左中右哪一格)的選取狀態都清掉——logo-module.js/product-module.js自己
   只會處理「同一個slot裡logo跟商品互斥」，不知道畫面上還有其他banner，
   跨slot的互斥交給這裡統一處理。傳進來的targetSlot是剛被選取的那個slot，
   它自己的__pmSelected/__lmSelected在呼叫這支之前就已經被模組設定好了，
   這裡完全不動它，只清掉其他slot的。 */
function deselectAllSlotsExcept(targetSlot){
  STATE.banners.forEach(function(banner){
    Core.SLOT_KEYS.forEach(function(key){
      var slot = banner[key];
      if(slot !== targetSlot){ slot.__pmSelected = false; slot.__lmSelected = false; }
    });
  });
}

function initGlobalDeselect(){
  document.addEventListener('pointerdown', function(e){
    // 排除.product-zone/.logo-zone本身(它們自己的handler已經處理"同一格內
    // 點外面")，也要排除任何表單控制項(色盤/swatch/按鈕/下拉選單)——不然
    // 點色盤要選色時，這裡的renderAll()會把色盤所在的input元素整個砍掉
    // 重建，瀏覽器原生色盤的錨點消失就會自動關閉，變成「一點下去就關掉」。
    if(e.target && e.target.closest && e.target.closest('.product-zone, .logo-zone, input, select, button, .swatch')) return;
    var changed = false;
    STATE.banners.forEach(function(banner){
      Core.SLOT_KEYS.forEach(function(key){
        var slot = banner[key];
        if(slot.__pmSelected || slot.__lmSelected){
          slot.__pmSelected = false; slot.__lmSelected = false; changed = true;
        }
      });
    });
    if(changed) renderAll();
  });
}

/* ── 啟動 ── */
initTopbar();
initGlobalDeselect();
initProductionListScrollSpy();
renderAll();
AssetLibrary.load(); // 非同步；讀完之後下次打開放大編輯面板，「從資料庫選擇」下拉就會有內容
openImportModal(); // 一開啟頁面就跳出匯入彈窗，不用先點「匯入工單」按鈕
