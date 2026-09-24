'use strict';
/*
  color-utils.js
  ------------------------------------------------------------
  給「背景色沒指定時自動配色」「有指定背景色時自動配同色系文字」用的顏色工具。

  規則（跟你確認過的版本）：
    1. 有指定背景色 → 自動配「同色系但保證看得清楚」的文字色：抓背景色的色相(H)，
       文字色維持同色相，但明度(L)大幅拉開（背景淺→文字用深、背景深→文字用淺），
       不是死板的純黑/純白，是同色系的深/淺版本。
    2. 沒指定背景色 → 同時抓 LOGO 跟商品的「主色」，取兩者裡飽和度較高（視覺上
       比較明顯/搶眼）的那個當基準色相；背景用這個色相，但明度刻意跟主體（商品/
       LOGO本身的明度）拉開，不能跟主體同一個明暗區間（不然會「吃色」，商品/LOGO
       融進背景裡分不出來）。

  這些都是「合理預設」，不是使用者逐一調整過的美術判斷——套用結果如果覺得
  某幾組不夠好看，之後可以在放大編輯面板手動改背景色，改完文字色也會跟著重算。
*/
var ColorUtils = (function(){

  function hexToRgb(hex){
    hex = String(hex||'').replace('#','');
    if(hex.length === 3) hex = hex.split('').map(function(c){ return c+c; }).join('');
    var num = parseInt(hex, 16);
    if(isNaN(num)) return { r:128, g:128, b:128 };
    return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
  }

  function rgbToHex(r,g,b){
    function h(v){ v = Math.max(0,Math.min(255,Math.round(v))); var s = v.toString(16); return s.length===1?'0'+s:s; }
    return '#'+h(r)+h(g)+h(b);
  }

  function rgbToHsl(r,g,b){
    r/=255; g/=255; b/=255;
    var max=Math.max(r,g,b), min=Math.min(r,g,b);
    var h=0,s=0,l=(max+min)/2;
    if(max!==min){
      var d = max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h = (g-b)/d + (g<b?6:0); break;
        case g: h = (b-r)/d + 2; break;
        case b: h = (r-g)/d + 4; break;
      }
      h *= 60;
    }
    return { h:h, s:s*100, l:l*100 };
  }

  function hslToRgb(h,s,l){
    h = ((h%360)+360)%360; s/=100; l/=100;
    if(s===0){ var v=l*255; return { r:v,g:v,b:v }; }
    var q = l<0.5 ? l*(1+s) : l+s-l*s;
    var p = 2*l-q;
    function hue2rgb(t){
      if(t<0) t+=1; if(t>1) t-=1;
      if(t<1/6) return p+(q-p)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    }
    var hk = h/360;
    return {
      r: hue2rgb(hk+1/3)*255,
      g: hue2rgb(hk)*255,
      b: hue2rgb(hk-1/3)*255
    };
  }

  function hslToHex(h,s,l){
    var rgb = hslToRgb(h,s,l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function hexToHsl(hex){
    var rgb = hexToRgb(hex);
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
  }

  /* 抓一張圖(logo或商品，PNG去背也沒差，只看不透明的像素)的「主色」：
     縮到一張小canvas(<=48px)逐點取樣，跳過接近透明、接近全白、接近全黑的
     像素(這些通常是留白/陰影，不是主體真正的顏色)，其餘依飽和度加權平均，
     飽和度愈高的像素對主色的影響力愈大，避免大面積淡色把主色洗淡。
     回傳 { h,s,l, hex, avgL }；avgL是「不加權」的平均明度，拿來判斷整體
     主體是偏亮還是偏暗（給背景對比判斷用）。找不到有效像素時回傳null。 */
  function sampleDominantColor(src, cb){
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function(){
      try{
        var SZ = 48;
        var c = document.createElement('canvas'); c.width=SZ; c.height=SZ;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, SZ, SZ);
        var d = ctx.getImageData(0,0,SZ,SZ).data;
        var sumH=0, sumS=0, weight=0, sumL=0, countL=0;
        for(var i=0;i<d.length;i+=4){
          var r=d[i], g=d[i+1], b=d[i+2], a=d[i+3];
          if(a < 40) continue;
          var hsl = rgbToHsl(r,g,b);
          sumL += hsl.l; countL++;
          // 跳過接近全白/接近全黑：這些通常是背景留白或陰影，不是主體色彩
          if(hsl.l > 94 || hsl.l < 6) continue;
          var w = Math.max(hsl.s, 6); // 飽和度當權重，至少給6避免完全忽略灰階主體
          sumH += hsl.h * w;
          sumS += hsl.s * w;
          weight += w;
        }
        if(weight === 0 || countL === 0){ cb(null); return; }
        var h = sumH/weight, s = sumS/weight, l = sumL/countL;
        cb({ h:h, s:s, l:l, hex: hslToHex(h,s,l), avgL:l });
      }catch(e){
        console.warn('[color-utils] 取樣主色失敗', e);
        cb(null);
      }
    };
    img.onerror = function(){ cb(null); };
    img.src = src;
  }

  /* 依「主體」的主色，決定一個不會吃色的背景色：同色相，飽和度稍微收斂
     (背景滿版大面積，太鮮豔的同飽和度看起來會很刺眼)，明度刻意跟主體的
     平均明度拉開一個安全距離(至少35)，確保背景跟商品/LOGO不會融在一起。 */
  function pickContrastingBackground(subjectHsl){
    var h = subjectHsl.h;
    var s = Math.min(Math.max(subjectHsl.s * 0.75, 30), 62);
    var subjectL = subjectHsl.avgL != null ? subjectHsl.avgL : subjectHsl.l;
    var bgL = subjectL >= 52 ? 16 : 88; // 主體偏亮→背景深；主體偏暗→背景淺
    return { h:h, s:s, l:bgL, hex: hslToHex(h, s, bgL) };
  }

  /* 依背景色，決定「同色系但保證看得清楚」的文字色：同色相，明度往背景的
     反方向拉開，飽和度拉高一點點讓文字不會死板死灰。 */
  function pickTextColorForBackground(bgHex){
    var hsl = hexToHsl(bgHex);
    var textL = hsl.l >= 50 ? 20 : 92;
    var textS = hsl.l >= 50 ? Math.max(hsl.s, 45) : Math.min(hsl.s + 15, 55);
    return hslToHex(hsl.h, textS, textL);
  }

  /* 兩個候選主色(LOGO / 商品)，取「視覺上比較明顯」的當背景色配色基準：
     用飽和度當判斷依據——飽和度愈高，色彩愈搶眼愈容易被注意到。飽和度
     打平時優先用商品色(商品是版位視覺焦點)。任一個沒有就直接用另一個。*/
  function pickDominantOf(logoColor, productColor){
    if(logoColor && !productColor) return logoColor;
    if(productColor && !logoColor) return productColor;
    if(!logoColor && !productColor) return null;
    return (productColor.s >= logoColor.s) ? productColor : logoColor;
  }

  /* 左右卡片背景「光暈」專用：同色相、同飽和度，只把明度往白色推一段比例k
     （k=0不變，k=1推到全白）。這套公式是跟你核可的光暈色 #ff5c6f 反推回來
     的（底色 #d0011b、H≈353°/S≈100%幾乎沒變，只有L從41%推到68%，比例約
     0.46），所以拿掉hue/飽和度的調整，只調明度，同一套公式可以套用在任何
     底色（不用為每個底色寫死一個光暈色）。k預設0.45，跟background-module.js
     的GLOW.k保持一致（那邊是實際套用光暈時真正用的數字，這裡預設值只是
     給沒特別指定k時的保險）。 */
  function lightenForGlow(hex, k){
    if(k == null) k = 0.45;
    var hsl = hexToHsl(hex);
    var l2 = hsl.l + (100 - hsl.l) * k;
    return hslToHex(hsl.h, hsl.s, l2);
  }

  /* 商品陰影色專用：跟lightenForGlow反方向，同色相、同飽和度，只把明度
     往黑色壓一段比例k（k=0不變，k=1壓到全黑）。這套公式最早是跟你在
     skbn-shadow-test.html調出來、核可的陰影色 #940016 反推回來的
     （底色 #d0011b，H≈352°/S≈99%幾乎沒變，只有L從41%壓到29%，比例約
     0.29），拿掉hue/飽和度的調整，只調明度，同一套公式可以套用在
     任何底色（不用為每張卡片寫死一個陰影色，底色換了陰影色自動跟著算）。
     2026-09再調深一次：你反饋套用新的soft/fade/occlude數字後陰影顏色
     看起來太淺，改成k=0.4（壓暗比例從29%提高到40%），同色相/飽和度
     不變，用法對稱lightenForGlow的k（GLOW.k）。 */
  function darkenForShadow(hex, k){
    if(k == null) k = 0.4;
    var hsl = hexToHsl(hex);
    var l2 = hsl.l * (1 - k);
    return hslToHex(hsl.h, hsl.s, l2);
  }

  return {
    hexToRgb: hexToRgb, rgbToHex: rgbToHex,
    rgbToHsl: rgbToHsl, hslToRgb: hslToRgb, hslToHex: hslToHex, hexToHsl: hexToHsl,
    sampleDominantColor: sampleDominantColor,
    pickContrastingBackground: pickContrastingBackground,
    pickTextColorForBackground: pickTextColorForBackground,
    pickDominantOf: pickDominantOf,
    lightenForGlow: lightenForGlow,
    darkenForShadow: darkenForShadow
  };
})();
