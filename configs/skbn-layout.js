'use strict';
/*
  configs/skbn-layout.js
  ------------------------------------------------------------
  這是你量出來的真實版型座標，直接對應你貼的那份 CSS（.SKBN / .左 / .中 / .右...）。
  座標系統：整張圖是 1200x360 的白底畫布，左中右三個「卡片」用絕對座標疊在
  白底上面（不是切三等份），每張卡片四個角各自導 35px 圓角。
  這支故意做成 .js（不是 .json），指定成 window.SKBN_LAYOUT 這個全域變數，
  是為了避免用 file:// 直接開頁面時 fetch 本機 json 被瀏覽器擋掉——這份是
  編輯器運作的必要資料（不像 asset-library 只是「錦上添花」的資料庫功能），
  不能因為忘記開本機伺服器就整個壞掉。

  之後如果你有第二種版型（例如版位數量不同、尺寸不同），可以另外存一份
  configs/xxx-layout.js，在 editor-main.js 換一行指定要用哪份，
  不用改 core.js 或任何 Module。
*/
window.SKBN_LAYOUT = {
  canvas: { w: 1200, h: 360 },

  slots: {
    left: {
      blockRect:  { x:11,  y:20,  w:336, h:318, radius:35 },
      defaultColor: '#0054a4',
      logoZone:   { x:132, y:27,  w:188, h:46 },
      textZone:   { x:17,  y:88,  w:324, h:38 },
      ctaZone:    { x:255, y:142, w:79,  h:79 },   // 圓形，w當直徑
      artZone:    { x:11,  y:136, w:336, h:202 },
      tagZone:    { x:11,  y:20,  w:118, h:53 },   // 左邊掛標，你後來補的座標
      glowEnabled: true, // 左右卡片背景要加圓形光暈（置中在artZone後方），中間版位不用
      titleCharLimit: 6  // 主標文字字數上限，固定值(跟工單表頭「SKBN(左) 6字」一致)，不是工單「字數」欄那個逐列填的參考數字
    },
    mid: {
      blockRect:  { x:369, y:12,  w:462, h:338, radius:35 },
      defaultColor: '#ee4d2d',
      logoZone:   { x:423, y:26,  w:353, h:45 },   // 橫LOGO：跟左右一樣是logo，只是比較寬
      textZone:   { x:383, y:81,  w:434, h:44 },
      titleFontPx: 46, // 中間版位文字比左右大一點（你量出來的是46pt，左右是39pt，見下面全域預設值）
      ctaZone:    { x:737, y:142, w:80,  h:80 },
      artZone:    { x:369, y:136, w:462, h:214 },
      tagZone:    null,
      glowEnabled: false, // 中間KV不加光暈
      titleCharLimit: 7  // 跟工單表頭「SKBN(中) 7字」一致
    },
    right: {
      blockRect:  { x:850, y:20,  w:336, h:318, radius:35 },
      defaultColor: '#d0011b',
      logoZone:   { x:970, y:28,  w:188, h:45 },
      textZone:   { x:857, y:88,  w:323, h:37 },
      ctaZone:    { x:1094,y:142, w:79,  h:79 },
      artZone:    { x:850, y:136, w:336, h:202 },
      tagZone:    { x:850, y:20,  w:118, h:53 },   // 目前只有右邊這個組合有掛標，之後有需要再補左/中
      glowEnabled: true, // 左右卡片背景要加圓形光暈（置中在artZone後方），中間版位不用
      titleCharLimit: 6  // 跟工單表頭「SKBN(右) 6字」一致
    }
  },

  /* 主標文字固定樣式：左右39pt、中間46pt(比較大一點，見mid.titleFontPx)，
     都是粗體。這裡的39是「沒有個別指定titleFontPx時」的全域預設值，
     text-module.js會先看該版位自己的cfg.titleFontPx，沒有才退回用這個。
     網頁/canvas環境用px，這裡假設你說的「pt」跟你原本設計工具裡輸出網頁
     用的習慣一致，即pt=px。如果實際上是印刷pt，跟我說一聲，改數字就好。 */
  titleFontPx: 39,
  titleFontWeight: 700
};
