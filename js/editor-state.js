'use strict';
/*
  editor-state.js
  ------------------------------------------------------------
  資料模型：一個 pack = 4~6 個 banner，每個 banner 三格 left / mid / right，
  每格的欄位跟版型（configs/skbn-layout.js）的 zone 一一對應：
    logoZone → logoSrc（品牌LOGO，三種顯示模式：原始/裁切+白底/滿版填滿）
    tagZone  → tagVariant（掛標，全站共用白/紅/關，只有版型裡有定義tagZone
               的格子才會顯示，目前只有「右」）
    ctaZone  → CTA圓形徽章，全站共用固定素材（只有一種版本，不用設定，見
               cta-module.js）
    artZone  → productSrc（曝品/商品圖，可選商品影子＋位置/縮放調整）
    textZone → title（主標文字，唯一還是純文字輸入的欄位）
  brand 保留純資料用途（給資料庫下拉排序比對用），不會畫在圖上。
*/
var SLOT_LABEL = { left:'左', mid:'中', right:'右' };

function emptySlot(key){
  var cfg = (window.SKBN_LAYOUT && SKBN_LAYOUT.slots[key]) || {};
  return {
    brand:'',
    title:'',
    logoSrc:null, logoRaw:null, logoBgColor:null,
    logoMode:'original',  // 'original' | 'trim'（裁切+白底） | 'fill'（滿版填滿，不要白底）
    logoShape:'wide',     // 'wide'（沿用版位原本的橫版寬度） | 'square'（改用置中正方形範圍）
    logoOffsetX:0, logoOffsetY:0, logoScale:1, // LOGO在範圍內的位置微調(比例)/縮放倍率，畫布上可直接拖曳/滾輪調整
    logoForceWhite:false, // 強制把LOGO整個變成白色剪影（大促類LOGO常常都要白色，不用另外準備白色版檔案）
    tagVariant:'auto',   // 'auto' | 'white' | 'red' | 'off' —— 掛標是全站共用固定素材，見 configs/shared-elements.js
    productSrc:null,
    productOffsetX:0, productOffsetY:0, productScale:1, productRot:0, // 商品圖位置/縮放/旋轉微調，畫布上直接拖曳調整
    shadowOffsetX:0, shadowOffsetY:0, // 陰影獨立位移(比例)，跟商品本體位置完全脫鉤，畫布上獨立拖曳調整
    bgColor: cfg.defaultColor || '#333333',
    presetBgColor: null, presetTextColor: null, // 這一格LOGO對應的檔期標準配色(第一組，如果有的話)
    presetColors: [],     // 這一格LOGO的專屬色票清單 [{bg,text},...]（一個LOGO可以有多組，例如限時特賣橘/藍/紅），給右側「快捷色票」按鈕用
    titleColor: null,     // null=用text-module的預設白字；有值時是自動配色算出的「同色系文字色」
    titleLimit: cfg.titleCharLimit || null,     // 主標文字字數上限，固定值(見configs/skbn-layout.js的titleCharLimit：左右6字、中間7字)，不是從Excel「字數」欄逐列帶入——那一欄只是工單填寫者自己算好的參考字數，不是規則本身（已跟你確認過這個bug）
    materialType: null,   // 券樣類素材的種類（例如"商城券*1"），給configs/material-text-style.js查文字樣式用
    materialTexts: [],    // 券樣疊字，一個文字框一個(有些券樣圖疊了兩張券，各自要有自己的文字，例如["$100","$100"])
    shadowAngle:'off'  // 'off' | 'left' | 'top' | 'right' —— 四選一，'off'=不開陰影
  };
}
/* date：這組(一張1200x360)對應的曝光日期，'YYYY-MM-DD'字串或null（手動新增
   的banner還沒設定日期時是null）。一張banner只有一個曝光日期，不是每格
   slot各自一個，所以放在banner本身，不是emptySlot()裡。 */
function emptyBanner(date){ return { date: date || null, left:emptySlot('left'), mid:emptySlot('mid'), right:emptySlot('right') }; }

/* 畫面上顯示banner的名稱：有設定日期就顯示日期(M/D)，還沒設定就退回
   「第N組」——側邊警示面板、下載檔名、放大編輯確認彈窗標題全部共用這支，
   不要各自維護一份「怎麼顯示banner名稱」的邏輯。 */
function bannerDateLabel(banner, idx){
  if(banner && banner.date){
    var d = new Date(banner.date+'T00:00:00');
    if(!isNaN(d.getTime())) return (d.getMonth()+1)+'/'+d.getDate();
  }
  return '第'+(idx+1)+'組';
}

var STATE = { banners:[emptyBanner(), emptyBanner(), emptyBanner(), emptyBanner()], warnings:[] };

/* ── 共用小工具：跳系統檔案選擇視窗，選完轉成 dataURL 回呼 ── */
var Assets = {
  pickImage: function(cb){
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = function(){
      var f = inp.files[0];
      if(!f) return;
      var reader = new FileReader();
      reader.onload = function(){ cb(reader.result); };
      reader.readAsDataURL(f);
    };
    inp.click();
  }
};
