'use strict';
/*
  text-module.js
  ------------------------------------------------------------
  只剩「主標文字」一種文字了（掛標已經改成圖片，見tag-module.js）。
  固定樣式：40px粗體（SKBN_LAYOUT.titleFontPx/titleFontWeight），置中對齊
  textZone。直接在版位上用 contenteditable 點字編輯。
*/
window.Modules = window.Modules || {};
window.Modules.text = {

  // 這一格「不需要掛標」（tagVariant='off'，見editor-import.js的Excel「無」
  // 判斷或使用者放大編輯面板手動關掉）而且也沒有LOGO時，上面那排完全空白，
  // 主標文字上移10px填一下視覺空隙。只有真的有tagZone（會顯示掛標）的格子
  // 才套用，跟掛標無關的中間格位不受影響。掛標重新打開或補了LOGO都會自動
  // 還原，不用另外處理。
  TITLE_SHIFT_UP_PX: 10,

  _titleShiftUp: function(cfg, slot){
    return (cfg.tagZone && slot.tagVariant === 'off' && !slot.logoSrc) ? Modules.text.TITLE_SHIFT_UP_PX : 0;
  },

  buildDom: function(el, slot, cfg, originX, originY, scale, onChange){
    var box = document.createElement('div');
    box.className = 'zone-box title-zone';
    var shiftUp = Modules.text._titleShiftUp(cfg, slot);
    var zone = shiftUp ? { x:cfg.textZone.x, y:cfg.textZone.y-shiftUp, w:cfg.textZone.w, h:cfg.textZone.h } : cfg.textZone;
    Core.applyZoneStyle(box, zone, originX, originY, scale);
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';

    var title = document.createElement('div');
    title.className = 'title-text';
    title.contentEditable = true;
    title.setAttribute('data-ph','主標文字');
    var fontPx = cfg.titleFontPx || SKBN_LAYOUT.titleFontPx;
    title.style.fontSize = (fontPx * scale) + 'px';
    title.style.fontWeight = SKBN_LAYOUT.titleFontWeight;
    title.style.color = slot.titleColor || '#fff';
    title.innerText = slot.title || '';
    title.oninput = function(){
      slot.title = title.innerText;
      if(typeof onTitleTextChanged === 'function') onTitleTextChanged();
    };
    // 2026-09：文案只會有一行，按Enter不換行(當作「輸入完成」，游標離開這格)。
    // 中文輸入法選字時按的Enter(isComposing / keyCode 229)是在確認選字，不能擋，
    // 不然選不了字。
    title.addEventListener('keydown', function(e){
      if(e.key !== 'Enter') return;
      if(e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      title.blur();
    });
    // 貼上的文字如果帶換行(從Excel/文件複製多行)，換行一律換成空白，維持單行。
    title.addEventListener('paste', function(e){
      var text = (e.clipboardData || window.clipboardData).getData('text');
      e.preventDefault();
      document.execCommand('insertText', false, String(text).replace(/[\r\n]+/g, ' '));
    });

    box.appendChild(title);
    el.appendChild(box);
  },

  drawExport: function(ctx, cfg, slot, originX, originY){
    if(!slot.title) return;
    var z = cfg.textZone;
    var shiftUp = Modules.text._titleShiftUp(cfg, slot);
    var lx = (z.x-originX) + z.w/2, ly = (z.y-originY) + z.h/2 - shiftUp;
    var fontPx = cfg.titleFontPx || SKBN_LAYOUT.titleFontPx;
    ctx.fillStyle = slot.titleColor || '#fff';
    ctx.font = SKBN_LAYOUT.titleFontWeight+' '+fontPx+'px "ShopeeNoto", "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    Modules.text._wrapText(ctx, slot.title, lx, ly, z.w*0.96, fontPx*1.08);
  },

  _wrapText: function(ctx, text, cx, cy, maxW, lineH){
    var lines = [], line = '';
    for(var i=0;i<text.length;i++){
      var test = line + text[i];
      if(ctx.measureText(test).width > maxW && line){ lines.push(line); line = text[i]; }
      else line = test;
    }
    lines.push(line);
    var startY = cy - (lines.length-1)*lineH/2;
    lines.forEach(function(l, i){ ctx.fillText(l, cx, startY + i*lineH); });
  }
};
