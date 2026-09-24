'use strict';
/*
  asset-matcher.js
  ------------------------------------------------------------
  工單裡 LOGO/曝品/素材 欄位寫的是「人看得懂的檔名/代碼」，不是真的檔案路徑。
  這支負責把這些文字，比對成真的圖檔來源，順序固定：

    1. 先比對「這批上傳資料夾」(BatchAssets，這週的素材zip)
    2. 再比對「資料庫」(data/asset-library.json，跨檔期重複使用的固定素材，
       例如常用LOGO、券樣模板)
    3. 兩邊都沒有 → 回傳 unmatched，呼叫端負責收集警示、不會讓其他格卡住

  中間版位常見的「檔期內建LOGO」(例如 10.10品牌週年慶\01_LOGO) 跟一般品牌LOGO
  是兩條不同的比對路徑：只要文字裡有路徑分隔符號(\ 或 /)，就直接當「內建代碼」
  只查資料庫的 matchKeys，不會去這批資料夾裡找檔名——因為這批資料夾放的是
  這週的商品/品牌LOGO，本來就不會有檔期活動的固定版面素材。

  「素材」類型（曝品欄位='素材'，例如商城券*1/商城券*2/免運車）也是只查資料庫，
  用 matchType 精準比對，不走模糊檔名比對——這些是固定圖庫，不是每週會變的
  上傳檔案。
*/
var AssetMatcher = (function(){

  // 全形英數字轉半形，避免「LOGＯ」這種全形字母比對不到「LOGO」
  function toHalfWidth(s){
    return String(s||'').replace(/[\uFF01-\uFF5E]/g, function(ch){
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
  }

  function normKey(s){
    return toHalfWidth(s).replace(/\\/g,'/').replace(/\s+/g,'').toLowerCase();
  }

  // 去掉像「（請使用上方橘字版）」這種夾在檔名前面的操作備註文字
  function stripInstructionNote(s){
    return String(s||'').replace(/^[（(][^）)]*[）)]\s*/, '').trim();
  }

  function isBuiltinRef(raw){
    return /[\\\/]/.test(String(raw||''));
  }

  /* 資料庫LOGO清單攤平：[{id,brand,name,path,matchKeys,categoryLabel}] */
  function flattenLogos(){
    return (typeof AssetLibrary !== 'undefined') ? AssetLibrary.systemElements('logo') : [];
  }
  function flattenArtwork(){
    return (typeof AssetLibrary !== 'undefined') ? AssetLibrary.artwork() : [];
  }

  /* 依 brand 文字模糊比對資料庫清單(logo或artwork通用)，抓 brand 或 name
     欄位裡有包含關係的，回傳第一個。找不到回傳 null。 */
  function findByBrandText(list, brandText){
    if(!brandText) return null;
    var nb = normKey(brandText);
    if(!nb) return null;
    var hit = list.find(function(it){
      var ni = normKey(it.brand||'');
      return ni && (nb.indexOf(ni) >= 0 || ni.indexOf(nb) >= 0);
    });
    return hit || null;
  }

  /* 依 matchKeys 陣列比對內建代碼類的 LOGO（檔期限定/常用建檔，見
     data/asset-library.json 裡的 matchKeys 欄位）。用「包含」比對，因為
     matchKeys 通常是完整路徑代碼裡「有識別度的那一段」，不用整串相等。 */
  function findByMatchKeys(list, rawText){
    var nr = normKey(rawText);
    if(!nr) return null;
    var hit = list.find(function(it){
      return (it.matchKeys||[]).some(function(k){
        var nk = normKey(k);
        return nk && (nr.indexOf(nk) >= 0 || nk.indexOf(nr) >= 0);
      });
    });
    return hit || null;
  }

  /* 工單文字「包含」清單裡某一筆的任何一個matchKeys就算命中（單向：文字包含
     關鍵字，不是關鍵字包含文字）。找不到回傳 null。 */
  function findByKeyInText(list, text){
    var nt = normKey(text);
    if(!nt) return null;
    var hit = list.find(function(it){
      return (it.matchKeys||[]).some(function(k){
        var nk = normKey(k);
        return nk && nt.indexOf(nk) >= 0;
      });
    });
    return hit || null;
  }

  /* 從這批資料夾裡，依標準化檔名比對，回傳最合適的一個檔案(dataUrl)。
     同名多副檔名（例如 .jpg/.png 都有）時：raw裡有明確寫副檔名就優先選
     那個；沒寫的話優先選 .png（LOGO/去背場景比較常見、透明背景比較安全）。*/
  function pickBestBatchFile(rawName, candidates){
    if(candidates.length === 1) return candidates[0];
    var wantExt = (String(rawName).match(/\.([a-zA-Z0-9]+)$/)||[,''])[1].toLowerCase();
    if(wantExt){
      var exact = candidates.find(function(c){ return c.ext === wantExt || (wantExt==='jpg'&&c.ext==='jpeg'); });
      if(exact) return exact;
    }
    var png = candidates.find(function(c){ return c.ext === 'png'; });
    return png || candidates[0];
  }

  /* 資料庫LOGO的專屬色票（背景色+文字色）。一個LOGO可以有多組：json裡寫
     "presetColors": [{ "bg":"#fd5401", "text":"#f9ff39" }, ...]（例如限時特賣
     有橘/藍/紅三組）；只有一組的老寫法 presetBgColor/presetTextColor 也吃得
     下，會被當成只有一組。回傳統一格式：presetColors是完整清單，
     presetBgColor/presetTextColor是第一組（沒有Excel指定背景色時的預設）。 */
  function logoPresetFields(it){
    var list = (Array.isArray(it.presetColors) && it.presetColors.length)
      ? it.presetColors
      : (it.presetBgColor ? [{ bg: it.presetBgColor, text: it.presetTextColor }] : []);
    return {
      presetColors: list,
      presetBgColor: list.length ? list[0].bg : undefined,
      presetTextColor: list.length ? list[0].text : undefined,
      categoryKey: it.categoryKey,
      // 2026-09：資料庫LOGO預設都是「原圖直接放」(logoMode:'original')，不會
      // 加裁切+底色的膠囊色塊——因為資料庫裡的LOGO本來就是做好的固定素材，
      // 不像使用者自己上傳的照片常常四周有雜亂留白需要裁切。但少數LOGO
      // (例如品牌會員)本身圖檔比例跟版位的LOGO框不一樣，需要用裁切+底色
      // 的膠囊模式包起來才好看，這種在json裡登記forceTrimMode:true，
      // 不管是Excel匯入自動比對到、還是使用者自己手動瀏覽資料庫選到，都會
      // 直接套用trim模式（含自動底色偵測，見modules/logo-module.js）。
      forceTrimMode: !!it.forceTrimMode
    };
  }

  /* ── LOGO ──────────────────────────────────────────────── */
  function matchLogo(rawLogoValue, brandText){
    var raw = String(rawLogoValue||'').trim();
    if(!raw || raw === '無') return { src:null, source:'none' };

    if(isBuiltinRef(raw)){
      var lib = findByMatchKeys(flattenLogos(), raw);
      if(lib) return Object.assign({ src: lib.path, source:'database', note:null }, logoPresetFields(lib));
      return { src:null, source:'unmatched', note:'內建LOGO代碼「'+raw+'」資料庫裡還沒有登記，需要手動上傳或補資料庫' };
    }

    var cleaned = stripInstructionNote(raw);
    var norm = BatchAssets.normalizeName(cleaned);
    var candidates = BatchAssets.findAllByNormalized(norm);
    if(candidates.length){
      var best = pickBestBatchFile(cleaned, candidates);
      return { src: best.dataUrl, source:'batch', note:null };
    }

    // 2026-09：品牌文字比對不到時，再看「工單寫的文字裡有沒有包含這筆LOGO登記的
    // 任何一個關鍵字(matchKeys)」——例如工單寫 Watsons，資料庫品牌是「屈臣氏」，
    // 靠matchKeys裡登記的"Watsons"就比對得到。只看「文字包含關鍵字」單一方向，
    // 避免工單只寫很短的字(例如"logo")就誤中一堆。
    var dbHit = findByBrandText(flattenLogos(), brandText) || findByBrandText(flattenLogos(), cleaned)
      || findByKeyInText(flattenLogos(), brandText) || findByKeyInText(flattenLogos(), cleaned);
    if(dbHit) return Object.assign({ src: dbHit.path, source:'database', note:null }, logoPresetFields(dbHit));

    return { src:null, source:'unmatched', note:'LOGO「'+raw+'」在這批資料夾跟資料庫都比對不到，需要手動上傳或選擇' };
  }

  /* ── 商品（曝品=商品）───────────────────────────────────── */
  function matchProduct(artContent, brandText){
    var raw = String(artContent||'').trim();
    if(!raw || raw === '無') return { src:null, source:'none' };

    var norm = BatchAssets.normalizeName(raw);
    var candidates = BatchAssets.findAllByNormalized(norm);
    if(candidates.length){
      var best = pickBestBatchFile(raw, candidates);
      return { src: best.dataUrl, source:'batch', note:null };
    }

    var dbHit = findByBrandText(flattenArtwork(), brandText);
    if(dbHit) return { src: dbHit.path, source:'database', note:null };

    return { src:null, source:'unmatched', note:'商品圖「'+raw+'」在這批資料夾跟資料庫都比對不到，需要手動上傳或選擇' };
  }

  /* ── 素材（曝品=素材，例如商城券*1/商城券*2/免運車）─────────
     只查資料庫的 matchType，精準比對（這些是固定圖庫，不是每週上傳檔）。*/
  function matchMaterial(materialType){
    var raw = String(materialType||'').trim();
    if(!raw || raw === '無') return { src:null, source:'none', hasText:false };

    var hit = flattenArtwork().find(function(it){ return it.matchType === raw; });
    // presetColor：這個素材專屬對應的背景色+文字色（例如限時特賣-黃/藍/紅），
    // 匯入時Excel沒指定背景色就自動套用，見editor-import.js的applyAutoBackground
    if(hit) return { src: hit.path, source:'database', hasText: !!hit.hasText, presetColor: hit.presetColor || null, note:null };

    return { src:null, source:'unmatched', hasText:false, note:'素材「'+raw+'」資料庫裡還沒有登記對應圖檔，需要手動上傳或補資料庫' };
  }

  return {
    normKey: normKey,
    isBuiltinRef: isBuiltinRef,
    matchLogo: matchLogo,
    logoPresetFields: logoPresetFields,
    matchProduct: matchProduct,
    matchMaterial: matchMaterial
  };
})();
