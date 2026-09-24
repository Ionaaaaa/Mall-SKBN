'use strict';
/*
  editor-export.js
  ------------------------------------------------------------
  「整包下載」：每組 banner 各呼叫 Core.renderBannerToCanvas() 輸出一張
  1200x360 JPG，打包成一個 zip 檔下載；也支援單張下載一組。畫圖邏輯完全在
  core.js + 各 Module 裡，這支檔案只負責「收集結果、轉檔、觸發下載」。

  ⚠ 下載前一定要先確定字型真的載入完成——canvas的ctx.fillText()是同步的，
  字型如果還在非同步下載中，canvas會直接拿當下有的字體畫下去(通常是系統
  預設字體)，不會像一般DOM文字那樣「字型下載完自動重繪」。document.fonts.load()
  + .ready 這兩行就是確保ShopeeNoto真的可以用了才開始畫，不然畫面上看起來
  字體是對的，下載出來的圖卻可能是別的字體，兩邊會對不起來。

  輸出格式：改成JPG（跟你確認過），品質給到0.95，肉眼幾乎看不出跟PNG的差異，
  檔案又比PNG小很多。canvas本身一定是白底不透明(renderBannerToCanvas一開始
  就整張fillRect白色)，JPG不支援透明本來就不是問題。
*/
var EXPORT_JPEG_QUALITY = 0.98;

function ensureFontReady(){
  var titleFontSpec = (SKBN_LAYOUT.titleFontWeight||700)+' '+(SKBN_LAYOUT.titleFontPx||40)+'px "ShopeeNoto"';
  return Promise.all([
    document.fonts.load(titleFontSpec),
    document.fonts.ready
  ]).catch(function(){ /* 字型載入失敗也不擋下載，退回系統預設字體總比完全不能下載好 */ });
}

function downloadAllBanners(banners){
  if(!banners.length){ alert('目前沒有內容可以下載。'); return; }
  ensureFontReady().then(function(){
    _downloadAllBannersInner(banners);
  });
}

/* ══════════════════ 檔名 / 資料夾名 ══════════════════
   2026-09 改版：
   ・每張圖的檔名是「該張的曝光日期」：SKBN_0901.jpg（MMDD，補零）。舊版用
     bannerDateLabel()的"9/1"當檔名，斜線在檔名裡會被當成資料夾分隔，所以
     一律改用補零的MMDD。還沒設定日期的那組退回 SKBN_第N組.jpg。
   ・整包下載的zip檔名 = 活動走期 + "_Mall SKBN"，例如 0901-0907_Mall SKBN.zip
     （走期 = 所有組別曝光日期裡最早～最晚；全部同一天就只寫那一天；完全沒有
     設定日期就只叫 Mall SKBN.zip）。
   ・zip裡面不再多包一層資料夾：所有圖檔 + 一個暫存檔直接放在最外層。 */
var DRAFT_FILENAME = 'SKBN_暫存檔.json';

function _dateToMMDD(dateStr){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  return m ? (m[2] + m[3]) : null;
}

/* 單張檔名（不含副檔名）：SKBN_0901 */
function bannerFileBase(banner, idx){
  var mmdd = _dateToMMDD(banner && banner.date);
  return 'SKBN_' + (mmdd || ('第'+(idx+1)+'組'));
}

/* 整包用的檔名：「複製這組」會把日期也複製過去，兩個banner可能撞名——撞名的
   話幫後面重複的加_(2)/_(3)後綴，避免zip裡的檔案互相覆蓋掉。 */
function bannerFilenames(banners){
  var counts = {};
  return banners.map(function(banner, idx){
    var base = bannerFileBase(banner, idx);
    counts[base] = (counts[base]||0) + 1;
    return counts[base] > 1 ? (base+'_('+counts[base]+')') : base;
  });
}

/* 活動走期：0901-0907；只有一天就是0901；沒有任何日期回傳空字串。日期是
   'YYYY-MM-DD'，字串直接排序就是時間順序（跨年也對）。 */
function exportRangeLabel(banners){
  var dates = banners.map(function(b){ return b.date; })
    .filter(function(d){ return _dateToMMDD(d); }).sort();
  if(!dates.length) return '';
  var first = _dateToMMDD(dates[0]), last = _dateToMMDD(dates[dates.length-1]);
  return first === last ? first : (first+'-'+last);
}

function exportFolderName(banners){
  var range = exportRangeLabel(banners);
  return (range ? range+'_' : '') + 'Mall SKBN';
}

/* ══════════════════ 暫存檔（存檔 / 載入） ══════════════════
   把目前所有組別存成一個JSON，放進整包下載的zip裡；之後按右上角「載入暫存檔」
   （可以直接選這個json，也可以直接選整包zip）就能還原成當時的畫面繼續編輯。
   序列化時把底線開頭的欄位丟掉——那些是渲染快取(圖片物件、選取狀態、匯入
   工單的暫存欄位)，不是使用者資料，而且有些(HTMLImageElement)根本無法存成
   JSON。唯一例外是LOGO的內容框偵測結果(__logoContentW/H、__trimInitFor)：
   載入後如果這三個是空的，logo-module會重新偵測並把使用者調整過的LOGO位置/
   縮放蓋掉(見logo-module.js的_detectLogoContent)，所以要一起存起來。 */
var DRAFT_KEEP_KEYS = { '__logoContentW':1, '__logoContentH':1, '__trimInitFor':1 };

function serializeDraft(banners){
  return JSON.stringify({
    app: 'skbn-editor',
    version: 1,
    savedAt: new Date().toISOString(),
    banners: banners
  }, function(key, value){
    if(key.charAt(0) === '_' && !DRAFT_KEEP_KEYS[key]) return undefined;
    return value;
  });
}

/* 把暫存檔裡的banner還原成編輯器用的資料結構：每一格先用emptySlot()的預設值
   打底再蓋上存檔內容，之後如果新增了欄位，舊的暫存檔載入後也不會缺欄位。 */
function restoreBannersFromDraft(saved){
  return saved.map(function(sb){
    var banner = emptyBanner(sb && sb.date);
    Core.SLOT_KEYS.forEach(function(key){
      var slot = emptySlot(key);
      var s = (sb && sb[key]) || {};
      Object.keys(s).forEach(function(k){
        if(k === '__proto__') return;
        slot[k] = s[k];
      });
      if(!Array.isArray(slot.materialTexts)) slot.materialTexts = [];
      banner[key] = slot;
    });
    return banner;
  });
}

/* 讀暫存檔：可以是單獨的.json，也可以是整包下載的.zip（會自動找裡面的暫存檔）。 */
function loadDraftFromFile(file){
  function fail(msg){ alert(msg || '暫存檔讀取失敗：這不是有效的暫存檔。'); }
  function apply(text){
    var data;
    try{ data = JSON.parse(text); }catch(e){ fail(); return; }
    if(!data || data.app !== 'skbn-editor' || !Array.isArray(data.banners) || !data.banners.length){ fail(); return; }
    if(!confirm('載入暫存檔會取代目前畫面上的所有內容，確定要載入嗎？')) return;
    STATE.banners = restoreBannersFromDraft(data.banners);
    STATE.warnings = [];
    renderAll();
  }

  if(/\.zip$/i.test(file.name)){
    JSZip.loadAsync(file).then(function(zip){
      var entry = null;
      zip.forEach(function(relPath, e){
        if(!e.dir && relPath.split('/').pop() === DRAFT_FILENAME) entry = e;
      });
      if(!entry){ fail('這個zip裡面找不到暫存檔（'+DRAFT_FILENAME+'）。'); return; }
      entry.async('string').then(apply);
    }).catch(function(){ fail(); });
  } else {
    var reader = new FileReader();
    reader.onload = function(){ apply(reader.result); };
    reader.onerror = function(){ fail(); };
    reader.readAsText(file);
  }
}

/* 只下載暫存檔（.json），不輸出圖片、不打包zip。檔名帶活動走期，例如
   0901-0907_SKBN_暫存檔.json，沒有日期就是 SKBN_暫存檔.json。 */
function downloadDraftFile(banners){
  if(!banners.length){ alert('目前沒有內容可以存成暫存檔。'); return; }
  var range = exportRangeLabel(banners);
  var blob = new Blob([serializeDraft(banners)], { type:'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (range ? range+'_' : '') + DRAFT_FILENAME;
  a.click();
}

function _downloadAllBannersInner(banners){
  var zip = new JSZip();
  var names = bannerFilenames(banners);
  var done = 0;
  banners.forEach(function(banner, idx){
    Core.renderBannerToCanvas(banner, function(canvas){
      canvas.toBlob(function(blob){
        zip.file(names[idx]+'.jpg', blob);
        done++;
        if(done === banners.length){
          zip.file(DRAFT_FILENAME, serializeDraft(banners));
          zip.generateAsync({type:'blob'}).then(function(content){
            var a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = exportFolderName(banners)+'.zip';
            a.click();
          });
        }
      }, 'image/jpeg', EXPORT_JPEG_QUALITY);
    });
  });
}

/* 單張下載：只匯出「這一組」，不打包zip，直接下載一張1200x360的jpg。 */
function downloadSingleBanner(banner, idx){
  ensureFontReady().then(function(){
    Core.renderBannerToCanvas(banner, function(canvas){
      canvas.toBlob(function(blob){
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = bannerFileBase(banner, idx)+'.jpg';
        a.click();
      }, 'image/jpeg', EXPORT_JPEG_QUALITY);
    });
  });
}

/* ══════════════════ 下載前的文案檢查提醒（跟krcb專案同一套UI風格） ══════════════════
   字數超過上限、或命中禁用語，下載前先跳一個警告popup列出問題，使用者可以
   選「回去修改」（取消這次下載）或「仍要下載」（尊重使用者的判斷，特殊
   情況下維持可以強制下載，不是死板地完全擋死）。完全沒問題的話直接呼叫
   proceedFn()，不會多跳一個「沒問題」的popup打斷。

   filterRow(row)：單張下載只想看「這一組」自己的問題，不要被其他組的
   問題洗版；整包下載才要看全部，傳null/不傳就不篩選。跟krcb的
   confirmDownloadWithComplianceCheck()同一個精神，只是這個專案所有banner
   本來就同時在記憶體裡（不像krcb要先切分頁才看得到該分頁的資料），不用
   額外處理「切分頁重新掃描」那段複雜度。 */
function showComplianceGate(title, filterRow, proceedFn){
  collectTextIssues(function(allRows){
    var rows = filterRow ? allRows.filter(filterRow) : allRows;
    if(!rows.length){ proceedFn(); return; }

    // 跟inline版(editor-main.js的renderTextIssues())同一套邏輯：算得出
    // 安全替換值(suggested)的命中才顯示「套用」按鈕，記住這個按鈕對應的
    // 是哪一列(row)+哪個hit，點下去才知道要套用哪一個、改哪個banner的
    // 哪個slot。
    var applyable = [];
    var lines = [];
    rows.forEach(function(r){
      if(r.overLimit){
        var wd = Number.isInteger(r.weight) ? r.weight : r.weight.toFixed(1);
        lines.push('・'+escHtml(r.label)+'字數超過上限（目前'+wd+'／上限'+r.limit+'）');
      }
      r.hits.forEach(function(h){
        var msg = '・'+escHtml(r.label)+'包含禁用語「'+escHtml(h.matchedText)+'」'+(h.replace ? '，建議改成「'+escHtml(h.replace)+'」' : (h.note ? '（'+escHtml(h.note)+'）' : ''));
        if(h.suggested !== null && h.suggested !== undefined && h.suggested !== h.matchedText){
          var idx = applyable.length;
          applyable.push({ row:r, hit:h });
          msg += ' <button type="button" class="banword-apply-btn" data-idx="'+idx+'">套用</button>';
        }
        lines.push(msg);
      });
    });

    var overlay = createOverlay(
      '<div class="popup-panel" style="width:440px;max-height:70vh;display:flex;flex-direction:column;">'+
        '<div class="popup-head"><span>'+escHtml(title)+'</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
        '<div class="popup-body" style="overflow-y:auto;">'+
          '<div class="banword-warning" style="display:block;">'+lines.join('<br>')+'</div>'+
          '<div class="hint" style="margin-top:10px;">如果是特殊情況（例如確認過不受這條規則限制），仍然可以選擇繼續下載。</div>'+
        '</div>'+
        '<div class="popup-foot">'+
          '<button class="tbtn primary" id="compliance-cancel-btn">回去修改</button>'+
          '<span style="flex:1"></span>'+
          '<button class="tbtn" id="compliance-proceed-btn">仍要下載</button>'+
        '</div>'+
      '</div>'
    );
    overlay.querySelector('#compliance-cancel-btn').onclick = closePopup;
    overlay.querySelector('#compliance-proceed-btn').onclick = function(){
      closePopup();
      proceedFn();
    };
    // 套用按鈕：換完字關掉這個popup、整段重新掃描一次——如果套用完已經
    // 沒有問題了會直接放行下載，還有其他問題就用最新的檢查結果重開一次
    // popup，不用自己維護「套用後手動更新畫面/重算其他命中index」這些
    // 容易出錯的邏輯。
    Array.prototype.forEach.call(overlay.querySelectorAll('.banword-apply-btn'), function(btn){
      var item = applyable[Number(btn.dataset.idx)];
      btn.onclick = function(){
        var slot = item.row.banner[item.row.key];
        var text = slot.title || '';
        var h = item.hit;
        slot.title = text.slice(0, h.index) + h.suggested + text.slice(h.index + h.matchedText.length);
        renderAll();
        closePopup();
        showComplianceGate(title, filterRow, proceedFn);
      };
    });
  });
}

function downloadSingleBannerWithCheck(banner, idx){
  showComplianceGate('文案檢查提醒（'+bannerDateLabel(banner, idx)+'）', function(r){ return r.banner === banner; }, function(){
    downloadSingleBanner(banner, idx);
  });
}

function downloadAllBannersWithCheck(banners){
  showComplianceGate('文案檢查提醒（整包下載，涵蓋所有組別）', null, function(){
    downloadAllBanners(banners);
  });
}
