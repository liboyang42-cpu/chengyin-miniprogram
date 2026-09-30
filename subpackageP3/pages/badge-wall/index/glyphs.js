// 城市身份卡徽记库 v2(Questify City Cards · PRD 2026-07-12 §6/§7.5)。
// v2 要点(对齐参考片"花能看出是花"):大面积实心有机形 + 每卡 2-3 层色区,
// 波点/字符的颜色由 shader 直接采样图案本色(engine uColorful 通道),配色照抄 PRD §6 逐卡定义。
// 接口不变:draw(ctx, key) —— 调用方已 translate/scale,±80 归一坐标;未知 key 落 DEFAULT。
// 图形语言仍是 坐标/轨迹/网格/门/回声/光点,禁 emoji/奖杯/皇冠/盾牌/旗帜。

function F(x, c, fn) { x.fillStyle = c; x.beginPath(); fn(); x.fill(); }
function ST(x, c, w, fn) { x.strokeStyle = c; x.lineWidth = w; x.beginPath(); fn(); x.stroke(); }
function CUT(x, fn) { x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#fff'; x.beginPath(); fn(); x.fill(); x.globalCompositeOperation = 'source-over'; }
function DOT(x, c, px, py, r) { F(x, c, function () { x.arc(px, py, r, 0, Math.PI * 2); }); }
function RING(x, c, px, py, r, w, a0, a1) { ST(x, c, w, function () { x.arc(px, py, r, a0 || 0, a1 == null ? Math.PI * 2 : a1); }); }

var G = {

  /* 01 开始在场 ARRIVAL:大坐标针落地,波纹外扩。曜石黑 + 信号蓝 + 冷银 */
  arrival: function (x) {
    RING(x, '#8B93B8', 0, 30, 62, 6, Math.PI * 0.15, Math.PI * 0.85);
    RING(x, '#B9C2DE', 0, 30, 44, 7, Math.PI * 0.08, Math.PI * 0.92);
    F(x, '#3D7EFF', function () {            // 定位针本体:圆头 + 收尖
      x.arc(0, -18, 42, Math.PI * 0.82, Math.PI * 0.18);
      x.quadraticCurveTo(30, 22, 0, 56);
      x.quadraticCurveTo(-30, 22, -39.9, -4.5);
      x.closePath();
    });
    DOT(x, '#FFFFFF', 0, -16, 17);
    DOT(x, '#B8D7FF', 0, -16, 8);
  },

  /* 02 完成一程 ROUTE CLEARED:厚环轨迹闭合。炭黑 + 信号绿 + 雾白 */
  route: function (x) {
    F(x, '#14663F', function () { x.arc(0, 0, 58, 0, Math.PI * 2); });
    CUT(x, function () { x.arc(0, 0, 30, 0, Math.PI * 2); });
    x.lineCap = 'round';
    ST(x, '#35E08A', 15, function () { x.arc(0, 0, 44, -Math.PI * 0.5, Math.PI * 1.18); });
    DOT(x, '#B9F5D8', 0, -44, 7);            // 起点
    DOT(x, '#FFFFFF', Math.cos(Math.PI * 1.18) * 44, Math.sin(Math.PI * 1.18) * 44, 11);  // 终点闭合
    RING(x, '#EAF7F0', Math.cos(Math.PI * 1.18) * 44, Math.sin(Math.PI * 1.18) * 44, 19, 4);
  },

  /* 03 城市提案 CITY PROPOSAL:蓝图上的提案印章。档案纸白 + 高饱和蓝 + 石墨黑 */
  proposal: function (x) {
    x.save(); x.rotate(0.06);
    F(x, '#3478D4', function () { x.rect(-52, -52, 104, 104); });
    F(x, '#285FA8', function () { x.rect(-52, 20, 104, 32); });   // 折叠暗面
    CUT(x, function () { x.rect(-9, -34, 18, 68); });             // 白色"提案"加号(镂空)
    CUT(x, function () { x.rect(-34, -9, 68, 18); });
    x.restore();
    ST(x, '#EDF0FF', 6, function () { x.moveTo(-66, -66); x.lineTo(-42, -66); x.moveTo(-66, -66); x.lineTo(-66, -42); });
    ST(x, '#EDF0FF', 6, function () { x.moveTo(66, 66); x.lineTo(42, 66); x.moveTo(66, 66); x.lineTo(66, 42); });
    DOT(x, '#FFFFFF', 36, -36, 7);
  },

  /* 04 开门成社 FOUNDING CIRCLE:未闭合门环。深墨 + 温铜 + 信号蓝细线 */
  founding: function (x) {
    x.lineCap = 'butt';
    RING(x, '#3D7EFF', 0, -2, 66, 4, Math.PI * 1.18, Math.PI * 1.82);
    RING(x, '#D08A4A', 0, -2, 46, 20, Math.PI * 0.62, Math.PI * 2.38);   // 铜环,底部留门
    RING(x, '#8A5426', 0, -2, 30, 9);                                     // 内环暗铜
    F(x, '#E8B98A', function () { x.rect(-31, 32, 13, 32); });            // 门柱
    F(x, '#E8B98A', function () { x.rect(18, 32, 13, 32); });
    DOT(x, '#FFFFFF', 0, 50, 8);                                          // 门口光点
  },

  /* 05 同路相逢 JOINED THE CIRCLE:两条宽带轨迹汇合。雾灰 + 柔蓝 + 冰蓝 */
  joined: function (x) {
    x.lineCap = 'round';
    ST(x, '#8EC5FF', 19, function () { x.moveTo(-62, 54); x.quadraticCurveTo(-24, 22, 0, 0); x.quadraticCurveTo(26, -24, 60, -54); });
    ST(x, '#9FD8FF', 19, function () { x.moveTo(62, 54); x.quadraticCurveTo(24, 22, 0, 0); x.quadraticCurveTo(-26, -24, -60, -54); });
    DOT(x, '#FFFFFF', 0, 0, 14);
    RING(x, '#E6F2FF', 0, 0, 24, 4);
  },

  /* 06 一次召集 THE GATHERING:离散坐标向心收束,中心留白。酒红 + 朱砂橙 + 暗银 */
  gathering: function (x) {
    x.lineCap = 'round';
    RING(x, '#B23A4A', 0, 0, 68, 4, Math.PI * 0.1, Math.PI * 0.9);
    RING(x, '#B23A4A', 0, 0, 68, 4, Math.PI * 1.1, Math.PI * 1.9);
    for (var k = 0; k < 7; k++) {
      var a = -Math.PI / 2 + k * Math.PI * 2 / 7;
      var c = Math.cos(a), s = Math.sin(a);
      F(x, '#B23A4A', function () {                       // 向心楔
        x.moveTo(c * 46 - s * 7, s * 46 + c * 7);
        x.lineTo(c * 46 + s * 7, s * 46 - c * 7);
        x.lineTo(c * 22, s * 22);
        x.closePath();
      });
      DOT(x, '#FF7A45', c * 54, s * 54, 11);
    }
    RING(x, '#FFFFFF', 0, 0, 13, 6);
  },

  /* 07 有人循迹 FOLLOWED PATH:轨迹与回声。纯黑 + 激光青 + 电蓝 */
  followed: function (x) {
    x.lineCap = 'round';
    ST(x, '#0F5B5F', 26, function () { x.moveTo(-62, 42); x.bezierCurveTo(-20, 62, 20, -62, 62, -42); });  // 辉光垫底
    ST(x, '#3EE6E0', 14, function () { x.moveTo(-62, 42); x.bezierCurveTo(-20, 62, 20, -62, 62, -42); });
    ST(x, '#3D8DFF', 8,  function () { x.moveTo(-48, 62); x.bezierCurveTo(-8, 78, 34, -46, 72, -28); });   // 回声
    DOT(x, '#FFFFFF', -62, 42, 10);
    DOT(x, '#C9E5FF', 72, -28, 7);
  },

  /* 08 带来同行者 NEW COMPANION:日出与远坐标。午夜蓝 + 日出橙 + 冷白 */
  companion: function (x) {
    DOT(x, '#FFA24D', -20, 22, 34);                                   // 升起的橙圆
    DOT(x, '#FFD9AE', -20, 22, 16);
    F(x, '#33549E', function () {                                     // 地平线丘
      x.moveTo(-80, 80); x.quadraticCurveTo(0, 26, 80, 80); x.closePath();
    });
    x.lineCap = 'round';
    ST(x, '#F2F6FF', 5, function () { x.moveTo(-4, 6); x.quadraticCurveTo(22, -22, 44, -40); });  // 一束光
    DOT(x, '#FFFFFF', 50, -46, 8);                                    // 远处第二坐标
    RING(x, '#F2F6FF', 50, -46, 17, 4);
  },

  /* 09 共创发生 CITY ALLIANCE:两种几何体相遇,交叠生成第三形态。石墨 + 铂金 + 冷蓝光 */
  alliance: function (x) {
    x.save(); x.translate(-18, 2); x.rotate(0.16);
    F(x, '#AEB6C6', function () { x.rect(-34, -34, 68, 68); });
    x.restore();
    DOT(x, '#4296E8', 24, -2, 36);
    x.save();                                                          // 交叠区 = 发光的第三形态
    x.beginPath(); x.arc(24, -2, 36, 0, Math.PI * 2); x.clip();
    x.save(); x.translate(-18, 2); x.rotate(0.16);
    F(x, '#FFFFFF', function () { x.rect(-34, -34, 68, 68); });
    x.restore(); x.restore();
  },

  /* 10 点亮一隅 CITY LIT:城市网格中一格点亮。深黑 + 极光金 + 路线蓝 */
  citylit: function (x) {
    var P = [-64, -32, 0, 32], SZ = 32;
    ST(x, '#4D8FD8', 6, function () {
      for (var i = 0; i <= 4; i++) {
        x.moveTo(-64, -64 + i * 32); x.lineTo(64, -64 + i * 32);
        x.moveTo(-64 + i * 32, -64); x.lineTo(-64 + i * 32, 64);
      }
    });
    F(x, '#FFD866', function () { x.rect(P[2], P[1], SZ, SZ); });      // 点亮的一格
    RING(x, '#FFE9A8', P[2] + SZ / 2, P[1] + SZ / 2, 26, 5);
    DOT(x, '#FFFFFF', P[2] + SZ / 2, P[1] + SZ / 2, 7);
  },

  /* 11 初次漫游 ROAM:迷雾被走过的轨迹擦开一条道。雾银 + 路线蓝 + 信号绿。
     与另两枚轨迹卡刻意区分:route 是闭合厚环(走完一程,有终点),
     followed 是别人循着我的线;漫游是【开放的、前方敞开、没有终点】——
     所以轨迹不闭合、右端直接出画,末端只留一个光点。 */
  roam: function (x) {
    // 没有闭合的环 + 从缺口走出去的轨迹。与 02 route 是【designed pair】:
    // route 是闭合厚环(走完一程,收口了),这枚走到缺口没收口,而是走了出去——漫游没有终点。
    // 形制刻意同族、含义相反;靠配色(蓝银 vs 信号绿)与缺口/出走轨迹区分。
    // 只用大尺度+大缺口的形:引擎把徽记波点化,细结构一律糊(实测螺旋两版皆废)。
    var COL = ['#C5E1FF', '#99CCFF', '#6FB4F2', '#4D8AC4', '#3F6185', '#3A4058'];
    var A0 = Math.PI * 0.62, A1 = Math.PI * 2.15, i;
    x.lineCap = 'butt';
    RING(x, '#2E3448', 0, 0, 46, 30, A0, A1);                  // 雾:垫在轨迹两侧
    RING(x, '#6FB4F2', 0, 0, 46, 20, A0, A1);                  // 厚弧本体(照 founding 的 20 宽)
    RING(x, '#C5E1FF', 0, 0, 46, 7, A0, A1);                   // 亮芯
    for (i = 0; i <= 13; i++) {                                // 从缺口走出去:由粗到细,散进雾
      var t = i / 13, rr = 44 + t * 32, aa = Math.PI * 2.385 + t * 0.42;
      DOT(x, COL[Math.min(COL.length - 1, Math.floor(t * COL.length))],
          Math.cos(aa) * rr, Math.sin(aa) * rr, 12.5 * (1 - t) + 2);
    }
    DOT(x, '#30D158', Math.cos(A0) * 46, Math.sin(A0) * 46, 13);   // 第一步(EXPLORE 信号绿)
    DOT(x, '#FFFFFF', Math.cos(A0) * 46, Math.sin(A0) * 46, 6);    // 白色焦点
  }
};

/* 未知徽记兜底:一个坐标点(PRD 语言) */
G.DEFAULT = function (x) {
  RING(x, '#3D7EFF', 0, 0, 44, 10);
  DOT(x, '#FFFFFF', 0, 0, 14);
  ST(x, '#B9C2DE', 6, function () { x.moveTo(0, -68); x.lineTo(0, -52); });
  ST(x, '#B9C2DE', 6, function () { x.moveTo(0, 52); x.lineTo(0, 68); });
  ST(x, '#B9C2DE', 6, function () { x.moveTo(-68, 0); x.lineTo(-52, 0); });
  ST(x, '#B9C2DE', 6, function () { x.moveTo(52, 0); x.lineTo(52, 0); x.lineTo(68, 0); });
};

module.exports = {
  keys: Object.keys(G).filter(function (k) { return k !== 'DEFAULT'; }),
  draw: function (ctx, key) {
    ctx.lineJoin = 'round';
    (G[key] || G.DEFAULT)(ctx);
  }
};
