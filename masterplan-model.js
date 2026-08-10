import * as THREE from 'three';

const M = {
  land:   new THREE.MeshStandardMaterial({ color: 0xd5cbb6, roughness: 0.95, metalness: 0.0 }),
  water:  new THREE.MeshStandardMaterial({ color: 0x2b5f66, roughness: 0.42, metalness: 0.18 }),
  stone:  new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.72, metalness: 0.05 }),
  gold:   new THREE.MeshStandardMaterial({ color: 0xb89552, roughness: 0.44, metalness: 0.34 }),
  green:  new THREE.MeshStandardMaterial({ color: 0x7d9068, roughness: 0.9,  metalness: 0.0 }),
  dark:   new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.8,  metalness: 0.1 }),
  roof:   new THREE.MeshStandardMaterial({ color: 0xb0714f, roughness: 0.82, metalness: 0.05 }),
  palm:   new THREE.MeshStandardMaterial({ color: 0x5d7a4d, roughness: 0.9,  metalness: 0.0 }),
  sand:   new THREE.MeshStandardMaterial({ color: 0xe9dec2, roughness: 0.96, metalness: 0.0 }),
  rock:   new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.88, metalness: 0.04 }),
  glass:  new THREE.MeshStandardMaterial({ color: 0x87a6ab, roughness: 0.18, metalness: 0.55 }),
  metal:  new THREE.MeshStandardMaterial({ color: 0x4c4f52, roughness: 0.38, metalness: 0.72 }),
  marking:new THREE.MeshStandardMaterial({ color: 0xf3f2ec, roughness: 0.6,  metalness: 0.0 })
};
Object.entries(M).forEach(([k, m]) => (m.name = k));

const HX = 2.3; // vertical exaggeration so massing reads at 3 km span
const W = (z) => -z; // shape space: w = -worldZ (north = larger w)

function box(name, mat, x, z, w, d, h, rotY = 0, y = 6) {
  h = h * HX;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.name = name;
  m.position.set(x, y + h / 2, z);
  m.rotation.y = rotY;
  return m;
}
function cyl(name, mat, x, z, r, h, seg = 32, y = 6) {
  h = h * HX;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.name = name;
  m.position.set(x, y + h / 2, z);
  return m;
}
// pyramid hip roof — matches the illustrations' tropical rooflines
function roofMesh(name, w, d, h) {
  const g = new THREE.ConeGeometry(0.707, 1, 4);
  g.rotateY(Math.PI / 4);
  const m = new THREE.Mesh(g, M.roof);
  m.name = name;
  m.scale.set(w * 1.14, h * HX, d * 1.14);
  return m;
}
// walls + terracotta pyramid roof, the villa/market vocabulary of the PDF art
function house(name, x, z, w, d, wallH, roofH, rotY = 0, mat = M.stone) {
  const g = new THREE.Group();
  g.name = name;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH * HX, d), mat);
  walls.name = name + '_walls';
  walls.position.y = (wallH * HX) / 2;
  const roof = roofMesh(name + '_roof', w, d, roofH);
  roof.position.y = wallH * HX + (roofH * HX) / 2;
  const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, wallH * HX * 0.52, 0.8), M.dark);
  door.name = name + '_door';
  door.position.set(0, (wallH * HX * 0.52) / 2, d / 2 + 0.3);
  const winGeo = new THREE.BoxGeometry(w * 0.18, wallH * HX * 0.3, 0.6);
  [-w * 0.28, w * 0.28].forEach((px, i) => {
    const win = new THREE.Mesh(winGeo, M.glass);
    win.name = name + '_window_' + i;
    win.position.set(px, wallH * HX * 0.55, d / 2 + 0.3);
    g.add(win);
  });
  g.add(walls, roof, door);
  g.position.set(x, 6, z);
  g.rotation.y = rotY;
  return g;
}
/* Real buildings instead of raw massing ------------------------------- */
// high-rise: podium + alternating stone/glass floor bands + gold crown
function tower(name, x, z, w, d, floors, rotY = 0, bandMat = M.glass, crownMat = M.gold) {
  const g = new THREE.Group();
  g.name = name;
  const fH = 4.2 * HX;
  const podH = fH * 1.6;
  const pod = new THREE.Mesh(new THREE.BoxGeometry(w * 1.3, podH, d * 1.3), M.stone);
  pod.name = name + '_podium';
  pod.position.y = podH / 2;
  g.add(pod);
  let y = podH;
  for (let i = 0; i < floors; i++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, fH * 0.55, d), M.stone);
    slab.name = name + '_floor_' + i;
    slab.position.y = y + fH * 0.275;
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, fH * 0.45, d * 0.94), bandMat);
    band.name = name + '_glass_' + i;
    band.position.y = y + fH * 0.55 + fH * 0.225;
    g.add(slab, band);
    y += fH;
  }
  const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, fH * 0.5, d * 0.7), crownMat);
  crown.name = name + '_crown';
  crown.position.y = y + fH * 0.25;
  g.add(crown);
  [[-w * 0.18, -d * 0.12, 8], [w * 0.15, d * 0.16, 6]].forEach(([hx, hz, s], i) => {
    const hvac = new THREE.Mesh(new THREE.BoxGeometry(s, 4, s * 0.8), M.metal);
    hvac.name = name + '_hvac_' + i;
    hvac.position.set(hx, y + fH * 0.5 + 2, hz);
    g.add(hvac);
  });
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, fH * 1.4, 6), M.metal);
  ant.name = name + '_antenna';
  ant.position.set(w * 0.22, y + fH * 0.5 + fH * 0.7, 0);
  g.add(ant);
  g.position.set(x, 6, z);
  g.rotation.y = rotY;
  return g;
}
// tropical villa: walls, hip roof, shaded porch on columns, private pool
function villa(name, x, z, w, d, rotY = 0) {
  const g = house(name, x, z, w, d, 8, 7, 0);
  const porchD = d * 0.55;
  const pr = roofMesh(name + '_porch_roof', w * 0.6, porchD, 3);
  pr.position.set(0, 8 * HX * 0.82, d / 2 + porchD / 2 - 2);
  g.add(pr);
  [-w * 0.24, w * 0.24].forEach((px, i) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 8 * HX * 0.7, 8), M.stone);
    col.name = name + '_porch_col_' + i;
    col.position.set(px, (8 * HX * 0.7) / 2, d / 2 + porchD - 4);
    g.add(col);
  });
  const pool = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 1, 10), M.water);
  pool.name = name + '_pool';
  pool.position.set(w * 0.78, 0.8, d * 0.2);
  g.add(pool);
  g.rotation.y = rotY;
  return g;
}
// resort: long podium, roofed wings, lagoon pool + palms
function resort(name, x, z, w, d, wallH, rotY = 0) {
  const g = new THREE.Group();
  g.name = name;
  const main = house(name + '_main', 0, 0, w * 0.55, d, wallH, 10, 0);
  main.position.set(0, 0, 0);
  g.add(main);
  [-1, 1].forEach((s, i) => {
    const wing = house(name + '_wing_' + i, s * w * 0.42, d * 0.12, w * 0.32, d * 0.7, wallH * 0.6, 7, s * 0.18);
    g.add(wing);
  });
  const lagoon = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.42, d * 0.42, 1, 24), M.water);
  lagoon.name = name + '_lagoon';
  lagoon.scale.x = 1.6;
  lagoon.position.set(0, 0.8, d * 0.95);
  g.add(lagoon);
  [[-w * 0.3, d * 1.15], [w * 0.3, d * 1.2], [0, d * 1.45]].forEach(([px, pz], i) => {
    const p = palm(px, pz, 0.8);
    p.position.y = 0;
    g.add(p);
  });
  g.position.set(x, 6, z);
  g.rotation.y = rotY;
  return g;
}
function tree(x, z, s = 1) {
  const g = new THREE.Group();
  g.name = 'tree';
  const trunk = cyl('tree_trunk', M.dark, 0, 0, 1.6 * s, 12 * s, 8, 0);
  g.add(trunk);
  [[0, 18, 9, 0], [4.5, 22, 6.2, 2.1], [-4, 21, 5.4, 4.4]].forEach(([ox, oy, r, rot], i) => {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(r * s, 12, 9), i ? M.palm : M.green);
    crown.name = 'tree_crown_' + i;
    crown.position.set(ox * s, oy * s, (i ? ox * 0.6 : 0) * s);
    crown.scale.y = 0.78;
    crown.rotation.y = rot;
    g.add(crown);
  });
  g.position.set(x, 6, z);
  return g;
}
// coconut palm — leaning trunk + radial fronds, as on every PDF beach
function palm(x, z, s = 1) {
  const g = new THREE.Group();
  g.name = 'palm';
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * s, 1.7 * s, 30 * s * HX * 0.55, 8), M.dark);
  trunk.name = 'palm_trunk';
  trunk.position.y = (30 * s * HX * 0.55) / 2;
  trunk.rotation.z = 0.14;
  g.add(trunk);
  const top = 30 * s * HX * 0.55;
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(16 * s, 0.7, 3.4 * s), M.palm);
    f.name = 'palm_frond_' + i;
    f.position.set(Math.cos((i / 6) * Math.PI * 2) * 7 * s + top * 0.14, top, Math.sin((i / 6) * Math.PI * 2) * 7 * s);
    f.rotation.y = -(i / 6) * Math.PI * 2;
    f.rotation.z = -0.35;
    g.add(f);
  }
  g.position.set(x, 6, z);
  return g;
}
// small sailboat with a white triangular sail — the hero illustration's boats
function sailboat(name, x, z, rotY = 0, s = 1) {
  const g = new THREE.Group();
  g.name = name;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(15 * s, 3.4 * s, 5 * s), M.roof);
  hull.name = name + '_hull';
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * s, 0.5 * s, 26 * s, 6), M.dark);
  mast.name = name + '_mast';
  mast.position.y = 14 * s;
  const sail = new THREE.Mesh(new THREE.ConeGeometry(6.5 * s, 20 * s, 4), M.stone);
  sail.name = name + '_sail';
  sail.scale.z = 0.08;
  sail.position.set(2.5 * s, 14 * s, 0);
  g.add(hull, mast, sail);
  g.position.set(x, 4.6, z);
  g.rotation.y = rotY;
  return g;
}
// Belitung's signature granite boulders, clustered in the shallows
function boulders(x, z, s = 1) {
  const g = new THREE.Group();
  g.name = 'granite_boulders';
  [[0, 0, 16], [14, 8, 10], [-12, 6, 11], [6, -12, 8]].forEach(([dx, dz, r], i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r * s, 10, 8), M.rock);
    b.name = 'boulder_' + i;
    b.position.set(dx * s, r * s * 0.35, dz * s);
    b.scale.set(1, 0.72, 0.88);
    b.rotation.y = i * 1.3;
    g.add(b);
  });
  g.position.set(x, 3.2, z);
  return g;
}
function grid(cb, x0, z0, cols, rows, dx, dz) {
  const g = new THREE.Group();
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) g.add(cb(x0 + i * dx, z0 + j * dz, i, j));
  return g;
}

function landmass() {
  const s = new THREE.Shape();
  s.moveTo(-5200, W(5200));
  s.lineTo(5200, W(5200));
  s.lineTo(5200, W(-150));
  s.lineTo(2400, W(-150));
  s.lineTo(1500, W(-250));
  s.quadraticCurveTo(1300, W(-420), 1080, W(-380));
  s.quadraticCurveTo(820, W(-330), 640, W(-470));
  s.quadraticCurveTo(430, W(-620), 120, W(-560));
  s.quadraticCurveTo(-160, W(-500), -420, W(-640));
  s.quadraticCurveTo(-700, W(-790), -1050, W(-700));
  s.quadraticCurveTo(-1300, W(-640), -1500, W(-720));
  s.lineTo(-2400, W(-560));
  s.lineTo(-5200, W(-400));
  s.closePath();

  const basin = new THREE.Path();
  basin.absellipse(760, W(-215), 340, 215, 0, Math.PI * 2, true);
  const canal = new THREE.Path();
  canal.moveTo(690, W(-120));
  canal.lineTo(-230, W(280));
  canal.lineTo(-200, W(340));
  canal.lineTo(720, W(-60));
  canal.closePath();
  s.holes.push(basin, canal);

  const geo = new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: false, curveSegments: 24 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, M.land);
  m.name = 'land';
  return m;
}

function seaAndBeach() {
  const g = new THREE.Group();
  g.name = 'sea';
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(14000, 9000), M.water);
  sea.name = 'water';
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 3.2, -2200);
  g.add(sea);
  // sand ribbon along the developed coast — Pantai Laskar Pelangi
  const strip = (name, x, z, w, d, r) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), M.sand);
    b.name = name;
    b.position.set(x, 6.2, z);
    b.rotation.y = r;
    return b;
  };
  g.add(strip('beach_west', -1050, -600, 900, 70, -0.12));
  g.add(strip('beach_center', -100, -520, 900, 60, 0.1));
  g.add(strip('beach_east', 1180, -330, 700, 60, -0.14));
  // granite boulders offshore — the Belitung postcard
  g.add(boulders(-1520, -820, 1.4));
  g.add(boulders(-380, -760, 1.0));
  g.add(boulders(280, -700, 1.2));
  g.add(boulders(1600, -520, 1.1));
  return g;
}

/* ── Zona 1 — Marina Bay & Pusat Bahari Dunia ───────────────────── */
function zone1() {
  const g = new THREE.Group();
  g.name = 'zone1_MarinaBay';
  const cx = 780, cz = -190;
  for (let i = 0; i < 5; i++) {
    const z = cz - 100 + i * 52;
    g.add(box('marina_pier_' + (i + 1), M.stone, cx - 120, z, 300, 10, 2, 0, 3.2));
    for (let j = 0; j < 6; j++) {
      const yacht = new THREE.Group();
      yacht.name = 'superyacht_' + (i + 1) + '_' + (j + 1);
      const hull = new THREE.Mesh(new THREE.BoxGeometry(30, 7, 9), M.stone);
      hull.name = 'yacht_hull';
      const bow = new THREE.Mesh(new THREE.ConeGeometry(5, 14, 4), M.stone);
      bow.name = 'yacht_bow';
      bow.rotation.z = -Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      bow.position.x = 20;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 6), M.gold);
      cabin.name = 'yacht_cabin';
      cabin.position.set(-3, 6, 0);
      const deck2 = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 4.5), M.stone);
      deck2.name = 'yacht_deck2';
      deck2.position.set(-4, 11, 0);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 6), M.dark);
      mast.name = 'yacht_mast';
      mast.position.set(-8, 16, 0);
      yacht.add(hull, bow, cabin, deck2, mast);
      yacht.position.set(cx - 250 + j * 52, 4.5, z + 20);
      g.add(yacht);
    }
  }
  // sailboats out in the basin, as in the hero art
  g.add(sailboat('sailboat_1', cx + 130, cz - 40, 0.6));
  g.add(sailboat('sailboat_2', cx + 40, cz + 110, -0.8, 0.85));
  g.add(sailboat('sailboat_3', cx + 220, cz + 60, 1.9, 0.75));
  const fc = box('floating_commercial_F', M.gold, cx + 60, cz + 40, 200, 90, 16, 0.2, 3.2);
  g.add(fc);
  for (let i = 0; i < 4; i++) {
    const pav = roofMesh('floating_pavilion_' + i, 34, 30, 5);
    pav.position.set(cx + 60 - 70 + i * 47, 3.2 + 16 * HX + (5 * HX) / 2, cz + 40 + (i % 2 ? 18 : -14));
    pav.rotation.y = 0.2;
    g.add(pav);
  }
  g.add(tower('waterfront_hotel_D', cx - 420, cz - 120, 120, 60, 14, 0.15));
  g.add(tower('waterfront_hotel_E', cx - 430, cz + 110, 100, 55, 18, -0.1));
  g.add(tower('waterfront_apartments', cx + 330, cz + 90, 150, 52, 11, 0.35));
  const conv = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 34 * HX, 40, 1, false, 0, Math.PI), M.stone);
  conv.name = 'convention_center_P';
  conv.rotation.y = -0.3;
  conv.position.set(cx + 250, 6 + (34 * HX) / 2, cz + 330);
  conv.scale.set(1, 1, 0.62);
  g.add(conv);
  const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(152, 152, 8, 40, 1, false, 0, Math.PI), M.glass);
  ribbon.name = 'convention_glass_ribbon';
  ribbon.rotation.y = -0.3;
  ribbon.position.set(cx + 250, 6 + 34 * HX * 0.55, cz + 330);
  ribbon.scale.set(1, 1, 0.62);
  g.add(ribbon);
  g.add(cyl('lighthouse', M.gold, cx + 400, cz - 120, 12, 70, 24));
  // palm promenade around the basin rim
  [[-0.45], [0], [0.45], [0.9], [1.35], [1.8], [2.25]].forEach(([a], i) => {
    g.add(palm(cx + Math.cos(a) * 385, cz + Math.sin(a) * 258, 0.9 + (i % 3) * 0.12));
  });
  return g;
}

/* ── Zona 2 — Hunian Eksklusif & Resor Pantai ───────────────────── */
function zone2() {
  const g = new THREE.Group();
  g.name = 'zone2_HunianResor';
  g.add(grid((x, z, i, j) => villa('exclusive_villa_' + i + '_' + j, x, z, 34, 26, 0.12 * (i % 3)),
    -1280, -560, 8, 3, 86, 74));
  g.add(tower('saphire_residence_G', -700, -430, 190, 70, 9, -0.22, M.gold));
  g.add(resort('beach_resort_5star', -1000, -320, 230, 66, 14, 0.1));
  g.add(resort('beach_resort_4star', -520, -250, 180, 60, 11, -0.05));
  g.add(grid((x, z, i) => palm(x + (i % 2) * 22, z, 0.95), -1300, -560, 10, 1, 100, 0));
  g.add(grid((x, z, i) => palm(x, z, 0.85), -1060, -380, 6, 1, 110, 0));
  return g;
}

/* ── Zona 3 — Pusat Rekreasi & Hiburan ──────────────────────────── */
function zone3() {
  const g = new THREE.Group();
  g.name = 'zone3_Rekreasi';
  const wheel = new THREE.Group();
  wheel.name = 'ferris_wheel_H';
  const rim = new THREE.Mesh(new THREE.TorusGeometry(60 * HX, 2.6 * HX, 12, 48), M.gold);
  rim.name = 'wheel_rim';
  for (let i = 0; i < 12; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(118 * HX, 1.4 * HX, 1.4 * HX), M.stone);
    sp.name = 'wheel_spoke_' + i;
    sp.rotation.z = (i / 12) * Math.PI;
    rim.add(sp);
  }
  // gondola cabins on the rim, like the illustration's wheel
  for (let i = 0; i < 8; i++) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 7), M.roof);
    cab.name = 'wheel_cabin_' + i;
    const a = (i / 8) * Math.PI * 2;
    cab.position.set(Math.cos(a) * 60 * HX, Math.sin(a) * 60 * HX, 0);
    rim.add(cab);
  }
  wheel.add(rim);
  wheel.position.set(-140, 6 + 66 * HX, 240);
  g.add(wheel);
  g.userData.wheel = wheel;
  g.add(cyl('wheel_mast_a', M.dark, -168, 240, 4, 66, 12));
  g.add(cyl('wheel_mast_b', M.dark, -112, 240, 4, 66, 12));

  for (let i = 0; i < 5; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(26, 30 * HX, 8), i % 2 ? M.gold : M.roof);
    t.name = 'themepark_pavilion_' + i;
    t.position.set(-20 + i * 62, 6 + (30 * HX) / 2, 340 + (i % 2) * 60);
    g.add(t);
  }
  const stadium = new THREE.Mesh(new THREE.TorusGeometry(120, 34, 8, 40), M.stone);
  stadium.name = 'sport_center_I';
  stadium.rotation.x = Math.PI / 2;
  stadium.scale.set(1, 0.7, 1);
  stadium.position.set(420, 6 + 16 * HX, 420);
  g.add(stadium);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 30, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.green);
  dome.name = 'botanical_garden_B';
  dome.scale.y = 0.5 * HX;
  dome.position.set(-420, 6, 480);
  g.add(dome);
  g.add(grid((x, z, i) => tree(x, z, 1.15), -560, 300, 4, 3, 70, 66));
  return g;
}

/* ── Zona 4 — Traditional Market & Art Village ──────────────────── */
function zone4() {
  const g = new THREE.Group();
  g.name = 'zone4_MarketArtVillage';
  g.add(grid((x, z, i, j) => house('market_shed_' + i + j, x, z, 46, 30, 6, 6, 0.06, i % 2 ? M.gold : M.stone),
    250, 120, 5, 4, 58, 44));
  g.add(house('art_village_hall_Q', 520, 130, 130, 74, 14, 11, -0.18));
  g.add(grid((x, z, i) => house('artisan_studio_' + i, x, z, 26, 22, 6, 5, 0.3 * (i % 2)),
    190, 330, 5, 2, 44, 48));
  g.add(grid((x, z) => palm(x, z, 0.8), 230, 240, 4, 1, 90, 0));
  return g;
}

/* ── Zona 5 — Agro-Tourism & Jasa Inovatif ─────────────────────── */
function zone5() {
  const g = new THREE.Group();
  g.name = 'zone5_AgroTourism';
  g.add(grid((x, z, i, j) => box('organic_field_J_' + i + j, M.green, x, z, 130, 44, 1.6, 0.05, 6),
    -1100, 500, 5, 7, 150, 62));
  g.add(house('nursing_village_C', -1220, 980, 170, 64, 10, 8, 0.08));
  g.add(box('repair_hub', M.dark, -820, 1010, 120, 56, 18, -0.1));
  g.add(grid((x, z, i) => {
    const gh = box('greenhouse_' + i, M.stone, x, z, 90, 26, 6, 0);
    const arc = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 90, 16, 1, false, 0, Math.PI), M.stone);
    arc.name = 'greenhouse_arch_' + i;
    arc.rotation.z = Math.PI / 2;
    arc.position.set(x, 6 + 6 * HX, z);
    const w = new THREE.Group();
    w.add(gh, arc);
    return w;
  }, -420, 560, 2, 4, 110, 58));
  return g;
}

/* ── Zona 6 — Komunitas & Hunian Terintegrasi ──────────────────── */
function zone6() {
  const g = new THREE.Group();
  g.name = 'zone6_Komunitas';
  g.add(box('mosque_M_base', M.stone, 860, 620, 110, 110, 22));
  const gate = house('mosque_gate', 860, 700, 44, 20, 10, 6, 0, M.gold);
  g.add(gate);
  const md = new THREE.Mesh(new THREE.SphereGeometry(44, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), M.gold);
  md.name = 'mosque_dome';
  md.position.set(860, 6 + 22 * HX, 620);
  g.add(md);
  [[780, 545, 'a'], [940, 545, 'b']].forEach(([x, z, k]) => {
    g.add(cyl('minaret_' + k, M.stone, x, z, 7, 86, 20));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(9, 14 * HX * 0.4, 12), M.gold);
    cap.name = 'minaret_cap_' + k;
    cap.position.set(x, 6 + 86 * HX + (14 * HX * 0.4) / 2, z);
    g.add(cap);
  });
  const hosp = tower('hospital_N', 1200, 480, 180, 78, 7, -0.12, M.stone);
  g.add(hosp);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(6, 22, 3), M.roof);
  crossV.name = 'hospital_cross_v';
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 3), M.roof);
  crossH.name = 'hospital_cross_h';
  const hTop = 4.2 * HX * 1.6 + 7 * 4.2 * HX + 4.2 * HX * 0.5;
  crossV.position.set(1200, 6 + hTop + 12, 480 + 30);
  crossH.position.set(1200, 6 + hTop + 12, 480 + 30);
  g.add(crossV, crossH);
  g.add(house('school_N', 1180, 700, 160, 60, 12, 9, 0.06));
  g.add(grid((x, z, i) => tower('apartment_R_' + i, x, z, 52, 40, 10 + (i % 3) * 4, 0.04 * i),
    620, 840, 5, 2, 96, 90));
  g.add(tower('financial_service_O', 1080, 900, 90, 62, 12, 0.2, M.gold, M.gold));
  g.add(grid((x, z) => palm(x, z, 1), 700, 700, 5, 1, 110, 0));
  return g;
}

function lamp(name) {
  const g = new THREE.Group();
  g.name = name;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 20, 8), M.metal);
  post.name = name + '_post';
  post.position.y = 10;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 0.8), M.metal);
  arm.name = name + '_arm';
  arm.position.set(2.6, 19.6, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 2), M.gold);
  head.name = name + '_head';
  head.position.set(5, 19, 0);
  g.add(post, arm, head);
  return g;
}
function roads() {
  const g = new THREE.Group();
  g.name = 'roads';
  // each street is a group: asphalt, curbs, sidewalks, dashed centreline, lamps
  const street = (name, x, z, w, d, r) => {
    const len = Math.max(w, d), wid = Math.min(w, d);
    const s = new THREE.Group();
    s.name = name;
    const asphalt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, wid), M.dark);
    asphalt.name = name + '_asphalt';
    asphalt.position.y = 0.3;
    s.add(asphalt);
    [-1, 1].forEach((side, i) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 1.6), M.rock);
      curb.name = name + '_curb_' + i;
      curb.position.set(0, 0.55, side * (wid / 2 + 0.8));
      const walk = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 9), M.sand);
      walk.name = name + '_sidewalk_' + i;
      walk.position.set(0, 0.4, side * (wid / 2 + 6.1));
      s.add(curb, walk);
    });
    const nDash = Math.floor(len / 46);
    const dashGeo = new THREE.BoxGeometry(20, 0.15, 1.6);
    const dashes = new THREE.InstancedMesh(dashGeo, M.marking, nDash);
    dashes.name = name + '_lane_dashes';
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < nDash; i++) {
      mtx.setPosition(-len / 2 + 23 + i * 46, 0.68, 0);
      dashes.setMatrixAt(i, mtx);
    }
    s.add(dashes);
    const rot = r + (d > w ? Math.PI / 2 : 0);
    // skip lamps whose world position falls in the marina basin (the road
    // itself bridges the water; lampposts must not stand in the sea)
    const inBasin = (lx, lz) => {
      const wx = x + lx * Math.cos(rot) + lz * Math.sin(rot);
      const wz = z - lx * Math.sin(rot) + lz * Math.cos(rot);
      return ((wx - 760) / 348) ** 2 + ((wz + 215) / 223) ** 2 < 1;
    };
    for (let i = 0, lx = -len / 2 + 90; lx < len / 2 - 60; lx += 175, i++) {
      [-1, 1].forEach((side, k) => {
        const lz = side * (wid / 2 + 5);
        if (inBasin(lx, lz)) return;
        const l = lamp(name + '_lamp_' + i + '_' + k);
        l.position.set(lx, 0, lz);
        l.rotation.y = side > 0 ? Math.PI : 0;
        s.add(l);
      });
    }
    s.position.set(x, 6, z);
    s.rotation.y = rot;
    return s;
  };
  g.add(street('boulevard_main', -100, 60, 2600, 26, 0.12));
  g.add(street('boulevard_marina', 700, 60, 24, 700, 0.05));
  g.add(street('boulevard_west', -900, 200, 24, 900, -0.04));
  g.add(street('boulevard_south', 200, 780, 2200, 20, -0.05));
  g.add(street('boulevard_link', 1150, 400, 20, 780, 0.03));
  // zebra crossings where the side streets meet the main boulevard
  const crossing = (name, x, z, r) => {
    const c = new THREE.Group();
    c.name = name;
    for (let i = 0; i < 8; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 24), M.marking);
      stripe.name = name + '_stripe_' + i;
      stripe.position.set(-14 + i * 4, 0.75, 0);
      c.add(stripe);
    }
    const tl = new THREE.Group();
    tl.name = name + '_signal';
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 16, 8), M.metal);
    pole.name = name + '_signal_pole';
    pole.position.y = 8;
    const lightbox = new THREE.Mesh(new THREE.BoxGeometry(2.4, 6.4, 2.2), M.dark);
    lightbox.name = name + '_signal_box';
    lightbox.position.y = 17.5;
    [[0xd0584a, 2.1], [0xd9a13f, 0], [0x5f8f56, -2.1]].forEach(([col, oy], i) => {
      const lensMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.1, emissive: col, emissiveIntensity: i === 2 ? 0.5 : 0.06 });
      lensMat.name = 'signal_lens';
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 10), lensMat);
      lens.name = name + '_lens_' + i;
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 17.5 + oy, 1.25);
      tl.add(lens);
    });
    tl.add(pole, lightbox);
    tl.position.set(20, 0, 14);
    c.add(tl);
    c.position.set(x, 6, z);
    c.rotation.y = r;
    return c;
  };
  g.add(crossing('crosswalk_marina', 700, -36, 0.12));
  g.add(crossing('crosswalk_west', -900, 156, 0.12));
  // surface parking by the convention centre — bays marked in white
  const lot = new THREE.Group();
  lot.name = 'parking_convention';
  const slab = new THREE.Mesh(new THREE.BoxGeometry(190, 0.7, 120), M.dark);
  slab.name = 'parking_slab';
  slab.position.y = 0.35;
  lot.add(slab);
  const bayGeo = new THREE.BoxGeometry(1.4, 0.16, 22);
  const bays = new THREE.InstancedMesh(bayGeo, M.marking, 24);
  bays.name = 'parking_bays';
  const bm = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) {
    bm.setPosition(-77 + i * 14, 0.78, -34);
    bays.setMatrixAt(i, bm);
    bm.setPosition(-77 + i * 14, 0.78, 34);
    bays.setMatrixAt(12 + i, bm);
  }
  lot.add(bays);
  lot.position.set(1290, 6, 130);
  lot.rotation.y = 0.1;
  g.add(lot);
  // park furniture along the central ring — benches and bins
  [[-40, 40, 0.4], [90, -10, 1.2], [230, 190, 2.2], [10, 220, 3.0]].forEach(([bx, bz, br], i) => {
    const bench = new THREE.Group();
    bench.name = 'park_bench_' + i;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(12, 1, 3.4), M.roof);
    seat.name = 'bench_seat';
    seat.position.y = 3.4;
    const back = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 0.8), M.roof);
    back.name = 'bench_back';
    back.position.set(0, 5.4, -1.5);
    [[-4.6], [4.6]].forEach(([lx], k) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 3.4, 3), M.metal);
      leg.name = 'bench_leg_' + k;
      leg.position.set(lx, 1.7, 0);
      bench.add(leg);
    });
    bench.add(seat, back);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.4, 5, 10), M.metal);
    bin.name = 'park_bin_' + i;
    bin.position.set(9, 2.5, 1);
    bench.add(bin);
    bench.position.set(120 + bx, 6, 120 + bz);
    bench.rotation.y = br;
    g.add(bench);
  });
  return g;
}

function landscape() {
  const g = new THREE.Group();
  g.name = 'landscape';
  const patch = (name, x, z, w, d, r) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), M.green);
    p.name = name;
    p.position.set(x, 6.4, z);
    p.rotation.y = r;
    return p;
  };
  g.add(patch('green_belt_west', -1450, 350, 900, 620, 0.08));
  g.add(patch('green_belt_center', -230, 760, 1100, 380, -0.05));
  g.add(patch('green_belt_east', 1520, 120, 700, 900, 0.06));
  g.add(patch('green_belt_south', 640, 1300, 1900, 560, 0.02));
  g.add(patch('green_hinterland_a', -1900, 1500, 1800, 900, 0.03));
  g.add(patch('green_hinterland_b', 1900, 1650, 1700, 800, -0.04));
  g.add(patch('park_ring', 120, 120, 420, 300, 0.3));
  g.add(patch('coastal_green', -1180, -260, 620, 200, -0.12));
  const rows = [
    [-1400, -120, 6], [-560, 120, 5], [240, 520, 6], [1180, -120, 4], [980, 1080, 5], [-980, 980, 5]
  ];
  rows.forEach(([x, z, n], k) => {
    for (let i = 0; i < n; i++) g.add(tree(x + i * 96 + (k % 2) * 40, z + (i % 2) * 34, 1.1));
  });
  return g;
}

export const FRAME = { center: [120, 40, 40], radius: 1420, dir: [0.5, 0.62, -0.9] };

export function buildMasterplan() {
  const root = new THREE.Group();
  root.name = 'RANATI_Masterplan';
  root.add(seaAndBeach(), landmass(), landscape(), roads());
  const zones = [zone1(), zone2(), zone3(), zone4(), zone5(), zone6()];
  zones.forEach((z, i) => {
    z.userData.zone = i;
    // per-zone material clones so a zone can be lit or dimmed on its own
    const cache = new Map();
    z.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      if (!cache.has(src)) {
        const c = src.clone();
        c.name = src.name + '_z' + (i + 1);
        cache.set(src, c);
      }
      o.material = cache.get(src);
    });
    z.userData.materials = Array.from(cache.values());
    root.add(z);
  });
  root.userData.zones = zones;
  root.userData.wheel = zones[2].userData.wheel;
  return root;
}

export const ZONES = [
  { n: '01', title: 'Marina Bay & Pusat Bahari Dunia', meta: '120 Ha · Superyacht · Floating Commercial · Waterfront Hotels', at: [780, 6, -190], r: 900 },
  { n: '02', title: 'Hunian Eksklusif & Resor Pantai', meta: 'Exclusive Villas · Saphire Residence (G) · Resor 4–5 Star', at: [-900, 6, -400], r: 1000 },
  { n: '03', title: 'Pusat Rekreasi & Hiburan', meta: 'Themepark (H) · Botanical Garden (B) · Sport Center (I)', at: [-40, 6, 380], r: 1000 },
  { n: '04', title: 'Traditional Market & Art Village', meta: 'Authentic Market (Q) · Convention Center (P)', at: [430, 6, -30], r: 750 },
  { n: '05', title: 'Agro-Tourism & Jasa Inovatif', meta: 'Organic Agro (J) · Nursing Village (C) · Adventure Canal', at: [-780, 6, 760], r: 1050 },
  { n: '06', title: 'Komunitas & Hunian Terintegrasi', meta: 'Mosque (M) · Hospital & School (N) · Apartments (R)', at: [950, 6, 690], r: 950 }
];
