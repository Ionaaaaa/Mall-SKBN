'use strict';
/*
  asset-library.js
  ------------------------------------------------------------
  這支是「系統元素」資料庫（現在只有 LOGO 用得到，因為掛標/CTA已經改成
  全站共用固定素材，見 configs/shared-elements.js，不用挑資料庫）跟
  「作圖區」商品素材庫的讀取工具：
    systemElements('logo') —— LOGO，依分類（造節/全站大促/常用建檔）
    artwork()              —— 商品/曝品作圖區素材，依分類（全站大促/常用建檔）

  ⚠ 用瀏覽器直接雙擊 editor.html（file://）通常沒辦法 fetch 本機檔案，
  這支會抓不到資料庫、但編輯器其他功能都正常。要讓資料庫生效，請用簡單的
  本機伺服器打開這個資料夾，例如：
    python3 -m http.server 8000   然後瀏覽器開 http://localhost:8000/editor.html

  未來要換成真的後端 API：只要把 load() 裡的 fetch 目標換成你的 API endpoint，
  回傳格式維持 { systemElements:{ catKey:{label,items:[...]} }, artwork:{...} }
  就好，其他檔案完全不用改。
*/
var AssetLibrary = (function(){
  var raw = { systemElements:{}, artwork:{} };
  var loaded = false;

  function load(){
    return fetch('data/asset-library.json')
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(json){ raw = json || raw; loaded = true; })
      .catch(function(e){
        console.warn('[AssetLibrary] 讀不到 data/asset-library.json（可能是用 file:// 直接打開，或還沒建檔），先略過，不影響其他功能。', e);
      });
  }

  /* 攤平 systemElements，依 type 篩選（'logo'|'tag'|'cta'），回傳
     [{ id, brand, name, path, categoryKey, categoryLabel }] */
  function systemElements(type){
    var out = [];
    Object.keys(raw.systemElements || {}).forEach(function(catKey){
      var cat = raw.systemElements[catKey];
      (cat.items || []).forEach(function(it){
        if(it.type === type){
          out.push(Object.assign({}, it, { categoryKey:catKey, categoryLabel:cat.label }));
        }
      });
    });
    return out;
  }

  /* 攤平 artwork，回傳 [{ id, brand, name, path, categoryKey, categoryLabel }] */
  function artwork(){
    var out = [];
    Object.keys(raw.artwork || {}).forEach(function(catKey){
      var cat = raw.artwork[catKey];
      (cat.items || []).forEach(function(it){
        out.push(Object.assign({}, it, { categoryKey:catKey, categoryLabel:cat.label }));
      });
    });
    return out;
  }

  /* 依品牌文字模糊比對排序，比對得到的排前面 */
  function sortByBrand(list, brand){
    if(!brand) return list;
    return list.slice().sort(function(a,b){
      var am = (a.brand||'').indexOf(brand) >= 0 ? 0 : 1;
      var bm = (b.brand||'').indexOf(brand) >= 0 ? 0 : 1;
      return am - bm;
    });
  }

  return { load:load, systemElements:systemElements, artwork:artwork, sortByBrand:sortByBrand, isLoaded:function(){ return loaded; } };
})();
