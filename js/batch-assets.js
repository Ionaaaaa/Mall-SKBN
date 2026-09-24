'use strict';
/*
  batch-assets.js
  ------------------------------------------------------------
  「這批（這週）素材資料夾」上傳：使用者把美術工單附的那包 zip（例如
  924-930.zip）整包丟進來，這支負責解壓、把每張圖轉成 dataURL，並且對每個
  檔名做「標準化」處理，給 asset-matcher.js 拿去跟 Excel 裡寫的檔名模糊比對。

  標準化規則（已跟你確認過）：去掉副檔名、空白、底線、連字號、括號，以及
  「Copy of」「複製」這幾個常見的重複檔名前後綴，主體名稱相同就算同一個檔案。
  這樣「Beauty_康是美.png」才比對得到「Beauty_康是美 - 複製.png」，
  「幫寶適logo-15.png」才比對得到「Copy of 幫寶適logo-15.png」。

  只做「這一批」用，不會寫進 data/asset-library.json 資料庫——這批資料夾是
  每週會變的素材，資料庫放的是「重複使用、跨檔期」的固定素材（LOGO常用建檔、
  券樣模板等）。
*/
var BatchAssets = (function(){
  var files = []; // [{ name, normalized, dataUrl, ext }]

  function normalizeName(name){
    if(!name) return '';
    var base = String(name);
    // 只取檔名本身，去掉資料夾路徑
    base = base.split('/').pop().split('\\').pop();
    // 去掉副檔名
    base = base.replace(/\.[a-zA-Z0-9]+$/, '');
    // 去掉常見的重複檔名前後綴
    base = base.replace(/copy of/gi, '');
    base = base.replace(/複製/g, '');
    base = base.toLowerCase();
    // 去掉空白、底線、連字號、括號、百分比符號——這幾個常常是Excel跟實際
    // 檔名對同一個商品用不同符號表達的地方(例如Excel寫"10%菸鹼醯胺"，
    // 檔名寫成"10_菸鹼醯胺"，%沒去掉的話兩邊永遠對不起來，這是實際踩過
    // 的bug)。全形/半形括號內容不特別處理，只去符號本身。
    base = base.replace(/[\s_\-（）()%]/g, '');
    return base;
  }

  /* 讀一個 zip 檔（File物件），解出所有圖片，回傳 Promise，resolve時
     files 已經準備好。非圖片（.txt/.json等）會被忽略。 */
  function loadZip(file){
    return JSZip.loadAsync(file).then(function(zip){
      var entries = [];
      zip.forEach(function(relPath, entry){
        if(entry.dir) return;
        if(!/\.(png|jpg|jpeg|webp|gif)$/i.test(relPath)) return;
        entries.push(entry);
      });
      return Promise.all(entries.map(function(entry){
        return entry.async('base64').then(function(b64){
          var ext = (entry.name.match(/\.([a-zA-Z0-9]+)$/)||[,'png'])[1].toLowerCase();
          var mime = ext === 'jpg' ? 'jpeg' : ext;
          var shortName = entry.name.split('/').pop().split('\\').pop();
          return {
            name: shortName,
            normalized: normalizeName(shortName),
            ext: ext,
            dataUrl: 'data:image/'+mime+';base64,'+b64
          };
        });
      }));
    }).then(function(list){
      files = list;
      return files;
    });
  }

  /* 讀一批直接選出來/拖曳進來的檔案（webkitdirectory 資料夾選取，或拖曳
     整個資料夾用 editor-popups.js 的遞迴 entry 讀取），跟 loadZip() 產生
     同一種格式的清單，後面 asset-matcher.js 用起來完全不用分是zip還是
     資料夾來源。非圖片檔案會被忽略。 */
  function loadFileList(fileArray){
    var images = (fileArray||[]).filter(function(f){ return /\.(png|jpe?g|webp|gif)$/i.test(f.name); });
    return Promise.all(images.map(function(f){
      return new Promise(function(resolve){
        var reader = new FileReader();
        reader.onload = function(){
          var ext = (f.name.match(/\.([a-zA-Z0-9]+)$/)||[,'png'])[1].toLowerCase();
          resolve({ name:f.name, normalized: normalizeName(f.name), ext:ext, dataUrl: reader.result });
        };
        reader.onerror = function(){ resolve(null); };
        reader.readAsDataURL(f);
      });
    })).then(function(list){
      files = list.filter(Boolean);
      return files;
    });
  }

  function list(){ return files.slice(); }
  function clear(){ files = []; }
  function isLoaded(){ return files.length > 0; }

  /* 依標準化後的名稱找檔案，可能同時比對到多個（例如同名 .jpg/.png 兩個
     版本），全部回傳讓呼叫端決定怎麼處理（見 asset-matcher.js 的取捨規則）。*/
  function findAllByNormalized(normalized){
    if(!normalized) return [];
    return files.filter(function(f){ return f.normalized === normalized; });
  }

  return {
    normalizeName: normalizeName,
    loadZip: loadZip,
    loadFileList: loadFileList,
    list: list,
    clear: clear,
    isLoaded: isLoaded,
    findAllByNormalized: findAllByNormalized
  };
})();
