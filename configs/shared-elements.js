'use strict';
/*
  configs/shared-elements.js
  ------------------------------------------------------------
  掛標／CTA 是全站共用的固定元素（不是依品牌/檔期挑選的資料庫素材）：
    - 掛標：白色版／紅色版兩種，依背景深淺自動決定用哪版（也可手動覆蓋，
      見 slot.tagVariant，'auto'|'white'|'red'|'off'）
    - CTA：只有一種版本（固定黑色圓底），不分深淺、不用切換、不能關閉，
      每一格都一定會顯示

  這支故意寫成 .js（不是 .json），原因跟 skbn-layout.js 一樣：避免用
  file:// 直接開頁面時 fetch 本機檔案被瀏覽器擋掉。

  圖檔實際放在 system-elements/shared/，檔名要跟這裡的 path 對上；
  之後上傳新圖直接覆蓋同檔名即可，不用改這支檔案。
*/
window.SHARED_ELEMENTS = {
  tag: {
    white: 'system-elements/shared/tag-white.png',
    red:   'system-elements/shared/tag-red.png'
  },
  cta: 'system-elements/shared/cta.png', // 只有一種版本，固定黑色圓底，不分深淺
  /* 亮度門檻（只給掛標用）：算出背景色的相對亮度(0~1)，低於這個值算「深色」
     用白版，否則算「淺色」用紅版。0.4是一般常見的深淺分界，要更敏感/更遲鈍
     微調這個數字就好。 */
  luminanceThreshold: 0.4
};

/* 算一個 hex 顏色的相對亮度(0~1)，公式是WCAG那套標準相對亮度算法。 */
function colorLuminance(hex){
  if(!hex) return 0;
  hex = hex.replace('#','');
  if(hex.length === 3) hex = hex.split('').map(function(c){ return c+c; }).join('');
  var r = parseInt(hex.substr(0,2),16)/255;
  var g = parseInt(hex.substr(2,2),16)/255;
  var b = parseInt(hex.substr(4,2),16)/255;
  function lin(c){ return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}

/* 依背景色+手動覆蓋設定，決定「掛標」該用哪個路徑（CTA不用這支，CTA固定
   只有一種版本，直接用 SHARED_ELEMENTS.cta 就好）。
   variant: slot.tagVariant，'auto'|'white'|'red'|'off'，'off'回傳null。 */
function resolveSharedElement(kind, bgColor, variant){
  if(variant === 'off') return null;
  var pair = SHARED_ELEMENTS[kind];
  if(!pair || typeof pair === 'string') return pair || null;
  if(variant === 'white') return pair.white;
  if(variant === 'red') return pair.red;
  // auto：依背景亮度判斷
  var lum = colorLuminance(bgColor);
  return lum < SHARED_ELEMENTS.luminanceThreshold ? pair.white : pair.red;
}
