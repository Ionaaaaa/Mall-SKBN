'use strict';
/*
  configs/material-text-style.js
  ------------------------------------------------------------
  券樣類素材（曝品=素材，例如商城券*1配"$100"）疊字的樣式設定。故意做成
  .js（不是.json），原因跟 skbn-layout.js 一樣：避免 file:// 直接開頁面時
  fetch 本機檔案被瀏覽器擋掉。

  byType 用 asset-library.json 裡 artwork 項目的 matchType 當key（就是
  Excel「素材」欄下面那一列寫的種類，例如"商城券*1"）；找不到對應key時
  用 default 這組。

  每一種券樣的設定：
    boxes        —— 文字可用範圍的陣列，不畫出來(只是排版用的隱形邊界)，
                    文字會自動找出「剛好塞得進這個範圍」的最大字級，字數多
                    就自動縮小、字數少就自動放大。**陣列**是因為像商城券*2
                    這種「疊了兩張券」的圖，每張券各自有自己的文字範圍/
                    旋轉角度，同一段文字會分別畫進每一個box——這是你的設計
                    稿本來就有兩組"._100"/"._100_拷貝"的原因，不是重複，是
                    前後兩張券各自要有一份文字。每個box裡的四個數字都是
                    「相對這張券圖本身寬高的比例」(0~1)，不是絕對px，這樣
                    券圖不管縮放多少，文字範圍都跟著對：
                    { xRatio, yRatio, wRatio, hRatio, rotateDeg, color }
                    color是選填的：不指定的話用外層style.color(同一組共用
                    一個顏色)；有指定的話這個box自己用這個顏色，不管外層
                    color是什麼——混合品牌的疊圖(例如「全站券*1+商城券*1」
                    一張全站橘、一張商城紅)才需要這樣逐box指定，單一品牌
                    的組合(商城券*2、全站券*2)不用填，兩個box都用同一個
                    外層color就好。
    color        —— 文字顏色
    fontWeight   —— 字重
    symbolScale  —— $、%、折這幾個字要縮小到「主要數字字級」的幾倍（跟你
                    確認過"$和%的字級需要比文字小一點點"，"折"這次也一起
                    加進來），預設0.72。這幾個符號會跟主要數字共用同一條
                    文字基線對齊，不是用置中對齊——字級不同時用置中對齊，
                    中文字型每個字級的視覺中心點位置不太一樣，符號看起來
                    會忽高忽低，這是"$"位置感覺偏上的原因，改成共用基線後
                    就會穩定對齊在同一條線上。

  商城券*1、商城券*2、全站券*1這三組是直接照你給的CSS設計稿量出來的比例/角度：
    商城券*1(330x153底圖，文字範圍102,31,195,91)：旋轉4.85度，紅色#d0011b
    商城券*2(317x215底圖，兩張券疊圖)：
      後面那張券的文字範圍(78,88,172,95)，旋轉11.41度
      前面那張券的文字範圍(116,17,165,74)，旋轉-4.72度（兩張券旋轉方向
      相反，跟設計稿的matrix算出來的方向一致）
    全站券*1(317x153底圖，文字範圍98,34,195,91)：旋轉角度/縮放矩陣跟
      商城券*1完全一樣(4.85度)，但底圖尺寸不同所以文字範圍比例不同，顏色
      是蝦皮橘#ee4d2d（不是紅色）
  免運車目前還沒有設計稿座標，先給合理預設值，之後有實際設計稿，一樣
  照這個方法量出boxes座標即可套用，不用改程式邏輯。
*/
window.MATERIAL_TEXT_STYLE = {
  default: {
    boxes: [ { xRatio: 0.31, yRatio: 0.20, wRatio: 0.59, hRatio: 0.60, rotateDeg: 0 } ],
    color: '#d0011b', fontWeight: 700, symbolScale: 0.72
  },

  byType: {
    // 照你的設計稿(330x153, 文字範圍102,31,195,91)換算
    '商城券*1': {
      boxes: [ { xRatio: 0.309, yRatio: 0.203, wRatio: 0.591, hRatio: 0.595, rotateDeg: 4.85 } ],
      color: '#d0011b', fontWeight: 700, symbolScale: 0.72
    },
    // 兩張券疊圖，各自有自己的文字範圍跟旋轉角度(照你的設計稿量出來)——
    // 陣列順序照你確認過的：第一個(券樣1)是位置較上方的券，第二個(券樣2)
    // 是位置較下方的券。同一段文字預設兩邊都會畫，但兩個文字框各自獨立
    // 可以編輯成不同內容。
    // 2026-09：兩種保護機制並存——(1)自動保護：畫完券樣1的文字後，用「券樣2
    // 自己的文字框」把那個範圍用券圖原圖清乾淨一次再畫券樣2
    // (product-module.js的_repaintBoxRegion)；(2)券樣1的box上可以另外填
    // maskAfter多邊形(相對券圖的比例座標)，把被前方券擋住的那一小塊文字
    // 蓋回去(product-module.js的_repaintPolygonRegion)。之前量的maskAfter
    // 幾乎等於券樣1自己的文字框、把自己的字蓋掉了，現在量的是文字框下緣
    // 的小三角形，範圍不會蓋到整段文字。
    '商城券*2': {
      boxes: [
        { xRatio: 0.366, yRatio: 0.079, wRatio: 0.521, hRatio: 0.344, rotateDeg: -3.5,
          // 2026-09：券樣1(後方券)的文字被前方券擋住的範圍(相對券圖的比例)，
          // 畫完文字1後用券圖原圖疊回這個多邊形，見product-module.js的maskAfter。
          maskAfter: { points: [
            { xRatio: 0.3404, yRatio: 0.3584 },
            { xRatio: 0.6053, yRatio: 0.4374 },
            { xRatio: 0.3782, yRatio: 0.4374 }
          ] } },
        { xRatio: 0.246, yRatio: 0.409, wRatio: 0.543, hRatio: 0.442, rotateDeg: 11.41 }
      ],
      color: '#d0011b', fontWeight: 700, symbolScale: 0.72
    },
    // 照你的設計稿(317x153底圖，文字範圍98,34,195,91)換算——旋轉角度/縮放
    // 矩陣跟商城券*1完全一樣(4.85度)，但底圖尺寸不同(317x153，不是330x153)
    // 所以文字範圍的比例不一樣，顏色也不同(蝦皮橘 #ee4d2d，不是紅色)。
    '全站券*1': {
      boxes: [ { xRatio: 0.309, yRatio: 0.222, wRatio: 0.615, hRatio: 0.595, rotateDeg: 4.85 } ],
      color: '#ee4d2d', fontWeight: 700, symbolScale: 0.72
    },
    '免運車': {
      boxes: [ { xRatio: 0.15, yRatio: 0.30, wRatio: 0.70, hRatio: 0.40, rotateDeg: 0 } ],
      color: '#333333', fontWeight: 700, symbolScale: 0.85
    },

    /* 2026-09：新增4個券樣組合，資料庫(asset-library.json)裡的圖檔還沒上傳，
       這裡先照你的指示把boxes座標「複製」自現有已經量好的組合當初始值——
       兩張券疊圖的複製商城券*2的兩個box，只有一張券的複製商城券*1的單一
       box。全站券*1+蝦幣堆、商城券*1+蝦幣堆這兩組你會自己拿真實設計稿
       用tools/material-text-calibrator.html重新校正過，這裡的座標只是
       暫時的起始值，不是量好的正式數字（不像商城券*1/商城券*2/全站券*1
       那三組是真的照設計稿算出來的）。 */

    // 兩張全站券疊圖，直接複製商城券*2的box座標(兩張券的相對位置/旋轉角度
    // 假設跟商城券版型一樣)，顏色改用全站的蝦皮橘(跟全站券*1一致)。
    '全站券*2': {
      boxes: [
        { xRatio: 0.366, yRatio: 0.079, wRatio: 0.521, hRatio: 0.344, rotateDeg: -3.5,
          maskAfter: { points: [
            { xRatio: 0.3654, yRatio: 0.3481 },
            { xRatio: 0.6340, yRatio: 0.4398 },
            { xRatio: 0.3880, yRatio: 0.4543 }
          ] } },
        { xRatio: 0.246, yRatio: 0.409, wRatio: 0.543, hRatio: 0.442, rotateDeg: 11.41 }
      ],
      color: '#ee4d2d', fontWeight: 700, symbolScale: 0.72
    },

    // 全站券+商城券各一張疊圖，一樣複製商城券*2的box座標當初始值，兩個
    // box分開上色：全站的那張橘字、商城的那張紅字(逐box的color會蓋掉外層
    // color，見product-module.js的_drawOneMaterialTextBox)。
    // 2026-09修正：你反映顏色反了，box[0]/box[1]對應的實際券樣位置跟原本
    // 假設的相反，把兩個box的color對調過來(box[0]=商城紅、box[1]=全站橘)。
    '全站券*1+商城券*1': {
      boxes: [
        // 2026-09：兩張券文字都往左3px(底圖309x208，3/309≈0.0097，xRatio各-0.0097)
        { xRatio: 0.3563, yRatio: 0.079, wRatio: 0.521, hRatio: 0.344, rotateDeg: -3.5, color: '#d0011b',
          maskAfter: { points: [
            { xRatio: 0.3459, yRatio: 0.3560 },
            { xRatio: 0.6340, yRatio: 0.4377 },
            { xRatio: 0.3686, yRatio: 0.4618 }
          ] } },
        { xRatio: 0.2363, yRatio: 0.409, wRatio: 0.543, hRatio: 0.442, rotateDeg: 11.41, color: '#ee4d2d' }
      ],
      color: '#d0011b', fontWeight: 700, symbolScale: 0.72
    },

    // 全站券+蝦幣堆疊圖，只有一張券需要文字，複製商城券*1的單一box當起始值，
    // 顏色用全站的蝦皮橘。你會自己用校正工具重新量這組的實際位置。
    '全站券*1+蝦幣堆': {
      // 2026-09：文字往左3px(底圖288x194，3/288≈0.0104，xRatio 0.2361→0.2257)
      boxes: [ { xRatio: 0.2257, yRatio: 0.4845, wRatio: 0.5868, hRatio: 0.4278, rotateDeg: 6.65 } ],
      color: '#ee4d2d', fontWeight: 700, symbolScale: 0.72
    },

    // 商城券+蝦幣堆疊圖，只有一張券需要文字。2026-09：你用校正工具量出來
    // 的正式座標，取代原本複製自商城券*1的暫時起始值。
    '商城券*1+蝦幣堆': {
      // 2026-09：文字往左3px(底圖288x193，xRatio 0.2361→0.2257)
      boxes: [ { xRatio: 0.2257, yRatio: 0.4845, wRatio: 0.5868, hRatio: 0.4278, rotateDeg: 6.65 } ],
      color: '#d0011b', fontWeight: 700, symbolScale: 0.72
    },

    // VIP券+蝦幣堆疊圖，只有一張券需要文字，複製商城券*1的單一box當起始值，
    // 你會自己用校正工具重新量這組的實際位置。顏色用VIP指定色#ff770f。
    'VIP券*1+蝦幣堆': {
      // 2026-09：照你給的VIP設計稿CSS(畫布288x194，文字範圍73,92,171,78，旋轉
      // 5.007度)換算。VIP的底圖是299x184，跟畫布尺寸不同，圖層在畫布裡的
      // 偏移沒給，所以是用「券面中心對齊商城券蝦幣版的相對位置」推算出圖片
      // 大約在畫布(-9.2,+1.5)的位置，換成底圖座標：左82.2、上90.5、寬171、
      // 高78(除以299x184)。有VIP的圖層CSS(.圖層_1的left/top)再精準換算。
      // 文字再往左3px(3/299≈0.0100，xRatio 0.2749→0.2649)。
      // 再往上3px(3/184≈0.0163，yRatio 0.4918→0.4755)，傾斜角度平一點(5.01°→4°)。
      boxes: [ { xRatio: 0.2649, yRatio: 0.4755, wRatio: 0.5719, hRatio: 0.4239, rotateDeg: 4 } ],
      color: '#ff770f', fontWeight: 700, symbolScale: 0.72
    },

    // 直營券*1：純一張券。2026-09：照你給的設計稿CSS換算(畫布跟底圖都是320x143，
    // 圖層在0,0，不用換算偏移)：文字範圍89,22,211,92，旋轉-1.49度(2026-09再依你的要求往同方向多斜一點，改成-2.5度)
    // (matrix 4.8288,-0.1254 → atan2(-0.1254,4.8288))，顏色rgb(208,1,27)=#d0011b
    // (跟商城券*1同一個紅)。
    '直營券*1': {
      boxes: [ { xRatio: 0.2781, yRatio: 0.1538, wRatio: 0.6594, hRatio: 0.6434, rotateDeg: -2.5 } ],
      color: '#d0011b', fontWeight: 700, symbolScale: 0.72
    },

    // VIP券*1：純一張券，顏色用VIP指定色#ff770f。2026-09：照你給的VIP設計稿
    // CSS換算(畫布跟底圖都是710x432，圖層在0,0，不用換算偏移)：文字範圍
    // 225,147,467,221，旋轉5.51度(matrix 10.3999,1.0031)。
    'VIP券*1': {
      boxes: [ { xRatio: 0.3169, yRatio: 0.3403, wRatio: 0.6577, hRatio: 0.5116, rotateDeg: 5.51 } ],
      color: '#ff770f', fontWeight: 700, symbolScale: 0.72
    },

    // 免運車+免運券*1疊圖，只有免運券那張需要文字，複製商城券*1的單一box
    // 當起始值，顏色先給商城紅當預設。你會自己用校正工具重新量這組的
    // 實際位置(免運車不是固定的券版型，跟蝦幣堆一樣位置沒有通用規則)。
    '免運車+免運券*1': {
      boxes: [ { xRatio: 0.309, yRatio: 0.203, wRatio: 0.591, hRatio: 0.595, rotateDeg: 4.85 } ],
      color: '#d0011b', fontWeight: 700, symbolScale: 0.72
    }
  },

  get: function(materialType){
    return (materialType && this.byType[materialType]) || this.default;
  }
};
