'use strict';
/*
  editor-import.js
  ------------------------------------------------------------
  解析「924-930美術工單」這種格式的 Excel（跟舊版「720-726」範本欄位不一樣，
  這支已經改成對這份新格式）：整張表找「檔期」出現的欄位當左/中/右三塊的錨點，
  每個錨點右邊固定 8 欄，順序固定是：
    檔期 / LOGO檔名 / 主標文字 / 曝品(類型) / (內容，沒有標題) / 背景色 / 字數 / 掛標
  不寫死欄位字母，換了版本、欄位有位移也還撐得住（只要「檔期」還是每塊的第一欄）。

  「曝品」欄位規則（這份工單特有）：
    - 主列(banner的第一列)寫「商品」→ 緊接著同一列的「內容」欄就是真正的商品
      圖檔名，例如 商品 + tw-11134207-...jpg
    - 主列寫「素材」→ 真正的素材種類/文字寫在下面那一列(banner的第二列)，
      同一組「類型/內容」欄位位置，例如 素材 → 下一列 商城券*1 / $200
    - 主列寫「無」→ 這格沒有曝品

  掛標/CTA是全站共用固定素材（見shared-elements.js）。「掛標」欄只在明確寫「無」
  時生效，代表這格真的不需要掛標，直接把tagVariant設'off'；寫其他值（商城／
  商城券*1…）不去動它，維持原本依背景深淺自動切換白/紅版的邏輯。使用者事後
  都還可以在放大編輯面板手動改回自動/白/紅。

  「字數」欄不拿來當字數上限——那一欄只是工單填寫者自己算好、給自己核對用
  的參考數字，逐列都不一樣，不是規則本身。真正的字數上限是固定值（左右6字、
  中間7字，跟工單表頭「SKBN(左) 6字」等一致），寫在configs/skbn-layout.js的
  titleCharLimit，emptySlot()建立每一格時就會帶進來，這裡完全不用讀這欄
  （已跟你確認過這是bug，之前誤把這欄當上限用）。

  「上線日期」欄：在「檔期」那一列的正上方一列（表頭再往上一列），一個banner
  只有一個，不是三塊各自一個——是這一張(1200x360、左中右三格)整體的曝光
  日期，存進banner.date（'YYYY-MM-DD'字串），畫面上顯示banner名稱都改用
  這個日期（見editor-state.js的bannerDateLabel()），不指定的話才退回顯示
  「第N組」。

  圖片本身（LOGO/曝品的實際圖檔）Excel抓不到，這支只抓「文字」；真正把文字
  換成圖檔來源的比對邏輯在 asset-matcher.js（先比對這批上傳資料夾，再查
  資料庫，都沒有就列進警示清單），由 resolveAndApplyBanners() 呼叫。
*/

/* Excel日期序號→'YYYY-MM-DD'字串。25569是Excel紀年(1899-12-30)到Unix
   epoch(1970-01-01)之間差的天數，是標準轉換公式，不是這個專案自己發明的。 */
function excelSerialToISODate(serial){
  if(typeof serial !== 'number' || !isFinite(serial)) return null;
  var utcMs = Math.round((serial - 25569) * 86400000);
  var d = new Date(utcMs);
  if(isNaN(d.getTime())) return null;
  var mm = String(d.getUTCMonth()+1).padStart(2,'0');
  var dd = String(d.getUTCDate()).padStart(2,'0');
  return d.getUTCFullYear()+'-'+mm+'-'+dd;
}

function parseWorkOrder(rows){
  var headerRowIdx = -1, anchors = [];
  for(var r=0; r<rows.length; r++){
    var cols = [];
    rows[r].forEach(function(v,c){ if(String(v).trim()==='檔期') cols.push(c); });
    if(cols.length >= 2){ headerRowIdx = r; anchors = cols; break; }
  }
  if(headerRowIdx === -1) return null;

  // 「上線日期」在表頭那一列的正上方一列，掃那一列找欄位位置，找不到就當
  // 沒有日期資料(dateCol=-1)，banner.date維持null，畫面上退回顯示「第N組」。
  var dateCol = -1;
  var dateHeaderRow = rows[headerRowIdx-1];
  if(dateHeaderRow){
    dateHeaderRow.forEach(function(v,c){ if(String(v).trim()==='上線日期') dateCol = c; });
  }

  var blockNames = ['left','mid','right'];
  var blocks = anchors.slice(0,3).map(function(anchorCol, i){
    return {
      key: blockNames[i],
      campaign:  anchorCol,
      logo:      anchorCol+1,
      title:     anchorCol+2,
      artType:   anchorCol+3,
      artContent:anchorCol+4,
      bgColor:   anchorCol+5,
      tag:       anchorCol+7
    };
  });

  var banners = [];
  // 2026-09：不再限制最多幾組（之前上限6組，你的工單一包有7組，第7組會被吃掉）
  for(var r2 = headerRowIdx+1; r2 < rows.length; r2 += 2){
    var row = rows[r2];
    var row2 = rows[r2+1] || [];
    if(!row || blocks.every(function(b){ return !String(row[b.campaign]||'').trim(); })) continue;

    var banner = emptyBanner(dateCol >= 0 ? excelSerialToISODate(row[dateCol]) : null);
    blocks.forEach(function(b){
      var slot = banner[b.key];
      slot.brand = String(row[b.campaign]||'').trim();
      slot.title = String(row[b.title]||'').trim();

      var bg = String(row[b.bgColor]||'').trim();
      if(/^#?[0-9a-f]{6}$/i.test(bg)){
        slot.bgColor = bg[0]==='#' ? bg : ('#'+bg);
      } else {
        slot.bgColor = null; // 「不指定」或空白 → 之後自動配色（見 resolveAndApplyBanners）
      }

      slot._importLogoRaw = String(row[b.logo]||'').trim();

      // 掛標欄寫「無」→ 明確不需要掛標，直接關掉（跟背景色深淺自動判斷分開處理，
      // 使用者事後還是可以在放大編輯面板手動切回「自動/白/紅」）。寫其他值
      // （例如「商城」「商城券*1」）維持預設'auto'，不動既有的自動判斷邏輯。
      if(String(row[b.tag]||'').trim() === '無') slot.tagVariant = 'off';

      var artType = String(row[b.artType]||'').trim();
      slot._importArtType = artType;
      if(artType === '商品'){
        slot._importArtContent = String(row[b.artContent]||'').trim();
      } else if(artType === '素材'){
        slot._importMaterialType = String(row2[b.artType]||'').trim();
        slot._importMaterialText = String(row2[b.artContent]||'').trim();
      }
    });
    banners.push(banner);
  }
  return banners;
}

function handleExcelFile(file, onSuccess, onFail){
  var reader = new FileReader();
  reader.onload = function(evt){
    try{
      var wb = XLSX.read(evt.target.result, { type:'array' });
      var sheet = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' });
      var banners = parseWorkOrder(rows);
      if(banners && banners.length) onSuccess(banners);
      else onFail('讀取到 Excel，但沒有比對到左中右三塊的欄位格式，請確認是不是同一種工單範本，或手動輸入內容。');
    }catch(err){
      console.error(err);
      onFail('這份 Excel 讀取失敗，請確認檔案格式，或直接手動輸入內容。');
    }
  };
  reader.readAsArrayBuffer(file);
}

/* 2026-09：CTA避開邏輯搬到 modules/product-module.js 的 _maybeAvoidCta()——
   之前這裡用「商品最寬可能有多寬」的保守估計來預先判斷，結果對細長型商品
   （很多商品本來就不寬）誤判成「會撞到」，位移位移過頭。現在改成等圖片
   真的載入、算出實際內容框（trim tight box）之後才判斷真的有沒有重疊，
   沒重疊就完全不動，見product-module.js。 */

/* ── 素材自動比對 + 套用（陰影/裁切白底/自動背景配色）───────────────────
   在 Excel 匯入後、以及每次「這批素材資料夾」重新上傳後都會呼叫一次。
   對還沒解出圖檔來源的欄位重新嘗試比對，已經有來源的（不管是比對到的還是
   使用者事後手動換的）不會被覆蓋。完成後回傳這一輪的警示清單（沒有殘留
   上一輪已經解決掉的項目）。 */
function resolveAndApplyBanners(banners, onDone){
  var warnings = [];
  var ensureLib = (typeof AssetLibrary !== 'undefined' && !AssetLibrary.isLoaded()) ? AssetLibrary.load() : Promise.resolve();
  ensureLib.then(function(){
    var slotPromises = [];
    banners.forEach(function(banner, bIdx){
      Core.SLOT_KEYS.forEach(function(key){
        slotPromises.push(resolveSlot(banner[key], banner, bIdx, key, warnings));
      });
    });
    Promise.all(slotPromises).then(function(){ onDone(warnings); });
  });
}

function resolveSlot(slot, banner, bannerIdx, key, warnings){
  var label = bannerDateLabel(banner, bannerIdx)+' '+(SLOT_LABEL[key]||key);

  return new Promise(function(resolve){
    var logoResult = (!slot.logoSrc && slot._importLogoRaw !== undefined)
      ? AssetMatcher.matchLogo(slot._importLogoRaw, slot.brand)
      : { src:null, source:'skip' };
    // 警示改成物件{text,banner,key,kind}，右側面板每次重畫時會重新檢查這一格
    // 現在有沒有圖了(見editor-main.js的activeAssetWarnings)——使用者事後手動
    // 上傳/選了圖，這條警示就自動消失，不用重新匯入。
    if(logoResult.note) warnings.push({ text:label+'：'+logoResult.note, banner:banner, key:key, kind:'logo' });

    var productResult = { src:null, source:'skip' };
    var materialResult = null;
    if(!slot.productSrc){
      if(slot._importArtType === '商品'){
        productResult = AssetMatcher.matchProduct(slot._importArtContent, slot.brand);
        if(productResult.note) warnings.push({ text:label+'：'+productResult.note, banner:banner, key:key, kind:'product' });
      } else if(slot._importArtType === '素材'){
        materialResult = AssetMatcher.matchMaterial(slot._importMaterialType);
        if(materialResult.note) warnings.push({ text:label+'：'+materialResult.note, banner:banner, key:key, kind:'product' });
      }
    }

    function applyLogo(next){
      if(!slot.logoSrc && logoResult.src){
        slot.logoRaw = logoResult.src;
        // 只有從「這批素材資料夾」比對到的一般品牌LOGO才需要自動裁切+白底
        // （原始上傳照片通常有雜亂留白/沒去背，需要處理）。從資料庫比對到
        // 的是已經做好的固定素材(造節/大促/常用建檔)，本來就是正確的樣子，
        // 直接呈現原圖就好，不用再裁切——除非資料庫裡這筆特別登記了
        // forceTrimMode:true(例如品牌會員，圖檔比例跟LOGO框不一樣，需要
        // 裁切+底色的膠囊模式包起來)，這種即使是資料庫比對到的也要用trim。
        slot.logoMode = (logoResult.source === 'batch' || logoResult.forceTrimMode) ? 'trim' : 'original';
        Modules.logo.applyProcessing(slot, next);
      } else {
        next();
      }
    }

    function applyProduct(){
      if(!slot.productSrc){
        if(slot._importArtType === '商品' && productResult.src){
          slot.productSrc = productResult.src;
          slot.shadowAngle = 'right'; // 只有真實商品照片自動加陰影、方向右（已跟你確認過）
        } else if(slot._importArtType === '素材' && materialResult && materialResult.src){
          slot.productSrc = materialResult.src;
          slot.shadowAngle = 'off'; // 素材/券圖不加陰影
          slot.materialType = slot._importMaterialType || null;
          // 記在slot上（不只是applyAutoBackground用完就丟），這樣之後打開放大
          // 編輯視窗，色票列也會看到這個素材的專屬色票（跟LOGO的presetColors
          // 是同一套機制，見editor-main.js的getSlotPresets/syncMaterialPresets）。
          slot.materialPresetColor = materialResult.presetColor || null;
          if(materialResult.hasText){
            // 跟popup裡切換券樣同一個道理：要照這個種類實際有幾個文字框，
            // 塞進對應數量「各自獨立」的初始文字，不要只塞一個然後讓其他
            // 框借用同一份參照(那樣之後編輯會互相牽動)。
            var textStyle = (window.MATERIAL_TEXT_STYLE && window.MATERIAL_TEXT_STYLE.get) ? window.MATERIAL_TEXT_STYLE.get(slot.materialType) : null;
            var boxCount = (textStyle && textStyle.boxes && textStyle.boxes.length) ? textStyle.boxes.length : 1;
            var baseText = slot._importMaterialText || '';
            // 選兩張券時，Excel這欄會寫兩組金額用「/」分隔，例如"$100/$200"，
            // 斜線前對應第1張券樣的文字框、斜線後對應第2張——照順序分給每個
            // box；只有一組數字（沒有斜線）時維持原本行為，每個box套用同一份
            // 文字。box數量比切出來的組數多時，用最後一組補滿剩下的box。
            var textParts = baseText.split('/').map(function(s){ return s.trim(); });
            slot.materialTexts = [];
            for(var bi=0; bi<boxCount; bi++){
              slot.materialTexts.push(textParts[bi] != null ? textParts[bi] : textParts[textParts.length-1]);
            }
          }
        }
      }
      applyAutoBackground();
    }

    function normalizeHex(h){
      if(!h) return '';
      h = String(h).trim().toLowerCase();
      if(h[0] !== '#') h = '#'+h;
      return h;
    }

    /* LOGO強制白色的自動判斷（已跟你確認過）：
       - 大促類(siteWideSale)的LOGO基本上都是白色，直接固定開白色。
       - 造節(festival)、常用建檔(common)的LOGO不一定，跟掛標同一套邏輯：
         依這一格「最終背景色」的深淺自動判斷，深色背景才開白色，淺色
         背景維持原色（跟掛標共用同一個colorLuminance()/門檻，見
         configs/shared-elements.js）。
       只在「這次真的是從資料庫比對到LOGO」時才自動判斷，使用者事後在
       放大編輯面板手動調整過，不會被這裡覆蓋（resolveSlot只會呼叫這裡
       一次，見loadImage的cache機制）。 */
    function applyLogoWhiteAuto(){
      if(logoResult.source !== 'database') return;
      if(logoResult.categoryKey === 'siteWideSale'){
        slot.logoForceWhite = true;
      } else if(logoResult.categoryKey === 'festival' || logoResult.categoryKey === 'common'){
        var lum = (typeof colorLuminance === 'function') ? colorLuminance(slot.bgColor) : 1;
        var threshold = (window.SHARED_ELEMENTS && SHARED_ELEMENTS.luminanceThreshold) || 0.4;
        slot.logoForceWhite = lum < threshold;
      }
    }

    // 記在slot上（不只是這裡的區域變數），這樣放大編輯面板才能顯示這一格
    // 對應的「快捷色票」按鈕，讓使用者事後想改回檔期標準色時一鍵套用，
    // 不用自己記色碼。
    if(logoResult.presetColors && logoResult.presetColors.length){
      slot.presetColors = logoResult.presetColors.slice();
      slot.presetBgColor = logoResult.presetBgColor;
      slot.presetTextColor = logoResult.presetTextColor;
    }

    function applyAutoBackground(){
      if(slot.bgColor){
        // Excel有指定背景色 → 如果剛好跟這一格LOGO的固定配色一樣(同一個
        // 檔期的標準色，Excel只是重複寫了一次)，直接套用完整的固定配色
        // 組合(包含文字色)，不要自己另外推算文字色——推算出來的顏色不一定
        // 是你要的那個黃色（已跟你確認過這個bug）。
        // 2026-09：一個LOGO可以有多組專屬色票(例如限時特賣橘/藍/紅)，Excel的
        // 背景色跟其中任何一組一樣，就套用那一組完整的配色。
        var presetMatch = (logoResult.presetColors || []).filter(function(p){
          return normalizeHex(slot.bgColor) === normalizeHex(p.bg);
        })[0];
        if(presetMatch){
          slot.bgColor = presetMatch.bg;
          slot.titleColor = presetMatch.text || ColorUtils.pickTextColorForBackground(slot.bgColor);
        } else {
          slot.titleColor = ColorUtils.pickTextColorForBackground(slot.bgColor);
        }
        applyLogoWhiteAuto();
        resolve();
        return;
      }
      // Excel沒指定，但這一格的素材本身有對應色票（例如限時特賣-黃/藍/紅各自
      // 對應橘/藍/紅底）→ 直接套用，優先於LOGO的第一組色票（不然限時特賣LOGO
      // 永遠只會套到第一組橘色，藍/紅素材就配到錯的底色）。
      var matPreset = (materialResult && materialResult.presetColor) || null;
      if(matPreset && matPreset.bg && slot.productSrc === materialResult.src){
        slot.bgColor = matPreset.bg;
        slot.titleColor = matPreset.text || ColorUtils.pickTextColorForBackground(slot.bgColor);
        applyLogoWhiteAuto();
        resolve();
        return;
      }
      // Excel沒指定 → 先看這一格的LOGO是不是有固定配色的大促檔期(1010/99/
      // 18號會員日/25節這種)，有的話直接用固定值，不用自動抓色（已跟你
      // 確認過的三組配色，見data/asset-library.json裡各筆的
      // presetBgColor/presetTextColor）。
      if(logoResult.presetBgColor){
        slot.bgColor = logoResult.presetBgColor;
        slot.titleColor = logoResult.presetTextColor || ColorUtils.pickTextColorForBackground(slot.bgColor);
        applyLogoWhiteAuto();
        resolve();
        return;
      }
      // 沒有固定配色可用 → 同時看LOGO/商品主色，取比較明顯(飽和度較高)的
      // 那個來配色，且背景明度會刻意跟主體拉開，避免吃色（已跟你確認過）
      var logoColor = null, productColor = null;
      var tasks = [];
      if(slot.logoSrc) tasks.push(new Promise(function(res){
        ColorUtils.sampleDominantColor(slot.logoSrc, function(c){ logoColor = c; res(); });
      }));
      if(slot.productSrc) tasks.push(new Promise(function(res){
        ColorUtils.sampleDominantColor(slot.productSrc, function(c){ productColor = c; res(); });
      }));
      Promise.all(tasks).then(function(){
        var base = ColorUtils.pickDominantOf(logoColor, productColor);
        if(base){
          var bg = ColorUtils.pickContrastingBackground(base);
          slot.bgColor = bg.hex;
          slot.titleColor = ColorUtils.pickTextColorForBackground(bg.hex);
        } else {
          warnings.push(label+'：目前沒有LOGO/商品圖可以抓色，背景色維持版型預設，建議之後手動指定');
        }
        applyLogoWhiteAuto();
        resolve();
      });
    }

    applyLogo(applyProduct);
  });
}
