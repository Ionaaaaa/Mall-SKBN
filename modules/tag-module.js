'use strict';
/*
  tag-module.js
  ------------------------------------------------------------
  掛標：全站共用的固定圖（白色版／紅色版兩選一，見configs/shared-elements.js），
  不是依品牌挑選的素材，也不用上傳。預設依這一格背景色深淺自動選版本，
  slot.tagVariant 可以手動覆蓋成 'white' 或 'red'（放大編輯面板裡的
  「自動/白/紅」三選一）。
  只有版型裡有定義 tagZone 的格子才會顯示這個區塊（目前只有「右」，見
  configs/skbn-layout.js），core.js 會先檢查 cfg.tagZone 存不存在才呼叫這支。
*/
window.Modules = window.Modules || {};
window.Modules.tag = {

  /* 掛標本身不能拖曳/縮放(全站共用固定素材，位置/大小是版型決定的)，但
   放大編輯視窗裡點一下這個區塊，還是要能自動切換左側到「掛標」分頁
   （跟logo/商品一樣的導覽捷徑，見editor-main.js），所以還是要接onSelect、
   加上可以點擊的游標樣式。 */
  buildDom: function(el, slot, cfg, originX, originY, scale, onChange, onSelect){
    if(slot.tagVariant === 'off') return; // 關閉：整個不畫、不留佔位框
    var box = document.createElement('div');
    box.className = 'zone-box tag-zone';
    Core.applyZoneStyle(box, cfg.tagZone, originX, originY, scale);
    if(onSelect){
      box.style.cursor = 'pointer';
      box.onclick = onSelect;
    }
    var path = resolveSharedElement('tag', slot.bgColor, slot.tagVariant);
    if(path){
      var img = document.createElement('img');
      // 檔案還沒上傳到 system-elements/shared/ 之前，這裡不要顯示瀏覽器
      // 預設那個很醜的「圖片壞掉」小圖示，退回乾淨的文字佔位就好。
      img.onerror = function(){ box.innerHTML = '<span class="ph">掛標（尚未上傳白/紅版）</span>'; };
      img.src = path;
      box.appendChild(img);
    } else {
      box.innerHTML = '<span class="ph">掛標</span>';
    }
    el.appendChild(box);
  },

  drawExport: function(ctx, cfg, slot, originX, originY, done){
    if(!cfg.tagZone){ done(); return; }
    var path = resolveSharedElement('tag', slot.bgColor, slot.tagVariant);
    if(!path){ done(); return; }
    var z = cfg.tagZone;
    var img = new Image();
    img.onload = function(){
      var scale = Math.min(z.w/img.width, z.h/img.height);
      var w = img.width*scale, h = img.height*scale;
      var lx = (z.x-originX) + (z.w-w)/2, ly = (z.y-originY) + (z.h-h)/2;
      ctx.drawImage(img, lx, ly, w, h);
      done();
    };
    img.onerror = done;
    img.src = path;
  }
};
