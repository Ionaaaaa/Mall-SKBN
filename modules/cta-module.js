'use strict';
/*
  cta-module.js
  ------------------------------------------------------------
  CTA：只有一種版本，固定黑色圓底，不分深淺、不能關閉、每一格都一定會顯示。
  位置/直徑來自 cfg.ctaZone（w當直徑用）。素材只有一張圖（見
  configs/shared-elements.js 的 SHARED_ELEMENTS.cta），檔案還沒放的話就顯示
  純黑圓底當佔位，不會是壞掉的圖示。
*/
window.Modules = window.Modules || {};
window.Modules.cta = {

  buildDom: function(el, slot, cfg, originX, originY, scale, onChange){
    var box = document.createElement('div');
    box.className = 'zone-box cta-zone';
    Core.applyZoneStyle(box, cfg.ctaZone, originX, originY, scale);
    box.style.borderRadius = '50%';
    box.style.overflow = 'hidden';
    box.style.background = 'rgba(0,0,0,0.86)';

    var img = document.createElement('img');
    img.style.objectFit = 'cover'; // 跟輸出一致：cover-fit塞滿整個圓，不留黑邊
    img.onerror = function(){ box.removeChild(img); }; // 沒有素材就維持純黑圓底，不顯示壞掉的圖示
    img.src = SHARED_ELEMENTS.cta;
    box.appendChild(img);

    el.appendChild(box);
  },

  drawExport: function(ctx, cfg, slot, originX, originY, done){
    var z = cfg.ctaZone;
    var lx = z.x-originX, ly = z.y-originY, d = z.w;

    ctx.save();
    ctx.beginPath();
    ctx.arc(lx+d/2, ly+d/2, d/2, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.86)';
    ctx.fill();
    ctx.restore();

    var img = new Image();
    img.onload = function(){
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx+d/2, ly+d/2, d/2, 0, Math.PI*2);
      ctx.clip();
      var scale = Math.max(d/img.width, d/img.height); // cover-fit，圓形不留白邊
      var w = img.width*scale, h = img.height*scale;
      ctx.drawImage(img, lx+(d-w)/2, ly+(d-h)/2, w, h);
      ctx.restore();
      done();
    };
    img.onerror = done; // 沒有素材，就維持前面畫好的純黑圓底
    img.src = SHARED_ELEMENTS.cta;
  }
};
