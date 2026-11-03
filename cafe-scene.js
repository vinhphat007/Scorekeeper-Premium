/**
 * CAFE SCENE - 3D coffee shop where the 4 players sit around one table.
 * Pure visual layer on top of the scorekeeper: app.js pushes players/ranks via
 * CafeScene.update() and score changes via CafeScene.pulse().
 */
import * as THREE from "three";
import { GLTFLoader } from "./vendor/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "./vendor/jsm/utils/SkeletonUtils.js";

(function () {
  const PLAYER_COLORS = { 1: 0x3b82f6, 2: 0xef4444, 3: 0x10b981, 4: 0xf59e0b };
  // Seat angle per player (radians around the table, 0 = towards +z / camera side)
  const SEAT_ANGLES = { 1: Math.PI * 0.25, 2: Math.PI * 0.75, 3: Math.PI * 1.25, 4: Math.PI * 1.75 };
  const SEAT_RADIUS = 1.45;
  // Character models (assets/characters, Kenney "Mini Characters", CC0)
  const MODEL_SCALE = 1.8;
  const PLAYER_MODELS = { 1: "male-d", 2: "female-b", 3: "male-b", 4: "female-d" };
  const WAITER_MODEL = "male-e";
  const CUSTOMER_MODELS = ["male-a", "male-c", "male-f", "female-c", "female-e", "female-f"];
  const SIT_OFFSET = { y: 0.5, z: 0.06 }; // lifts the "sit" pose onto a chair seat
  const APRON_POS = { x: 0, y: 0.04, z: 0.135 }; // model units, relative to the torso bone
  const TRAY_POS = { y: 0.26 * MODEL_SCALE, z: 0.19 * MODEL_SCALE }; // world units, at the waiter's hands
  const FAN_POS = { y: 0.3, z: 0.44 }; // world units in a seated player's holder: chest height, over the table edge
  const DOOR_X = -0.6; // entrance on the back wall, between the shelf and the counter

  let renderer, scene, camera, container, labelLayer;
  const characters = {}; // playerId -> { actor, crown, label, nameEl, scoreEl, jumpT, shakeT }
  let steamPuffs = []; // { sprite, cup, y, phase } - sprites live inside their cup group
  let scoreboard = null; // { ctx, tex, width, height }
  let door = null; // { pivot, open }
  const camState = { az: 0.55, pol: 0.98, radius: 8.6, target: new THREE.Vector3(0, 0.9, 0) };
  const clock = new THREE.Clock();

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------
  function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext("2d"), w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (repeatX !== 1 || repeatY !== 1) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
    }
    return tex;
  }

  function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...opts });
  }

  function box(w, h, d, material, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || scene).add(m);
    return m;
  }

  function cyl(rTop, rBottom, h, material, x, y, z, parent, segments = 24) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || scene).add(m);
    return m;
  }

  // ------------------------------------------------------------------------
  // Room: floor, walls, window, counter, decor
  // ------------------------------------------------------------------------
  function buildRoom() {
    // Wooden plank floor
    const floorTex = canvasTexture(512, 512, (ctx, w, h) => {
      const browns = ["#8b5a3c", "#7a4e33", "#95633f", "#83553a", "#9c6b45"];
      const plank = h / 8;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = browns[i % browns.length];
        ctx.fillRect(0, i * plank, w, plank);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(0, i * plank, w, 2);
        const seam = (i * 173) % w;
        ctx.fillRect(seam, i * plank, 2, plank);
      }
    }, 3, 3);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), mat(0xffffff, { map: floorTex, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Walls: cream plaster on top, red brick wainscot at the bottom
    const wallTex = canvasTexture(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = "#f3e6cf";
      ctx.fillRect(0, 0, w, h);
      const brickTop = h * 0.62;
      ctx.fillStyle = "#6b3a2a";
      ctx.fillRect(0, brickTop, w, h - brickTop);
      const bh = 22, bw = 64;
      for (let row = 0; brickTop + row * bh < h; row++) {
        const offset = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < w + bw; x += bw) {
          const shade = 150 + ((x * 7 + row * 13) % 40);
          ctx.fillStyle = `rgb(${shade}, ${Math.round(shade * 0.45)}, ${Math.round(shade * 0.32)})`;
          ctx.fillRect(x + offset + 2, brickTop + row * bh + 2, bw - 4, bh - 4);
        }
      }
      ctx.fillStyle = "#4a2a1c";
      ctx.fillRect(0, brickTop - 8, w, 10);
    });
    const wallMat = mat(0xffffff, { map: wallTex, roughness: 0.95 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.5), wallMat);
    backWall.position.set(0, 2.25, -6);
    backWall.receiveShadow = true;
    scene.add(backWall);
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.5), wallMat);
    leftWall.position.set(-6, 2.25, 0);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    scene.add(leftWall);

    // Live scoreboard on the left wall (redrawn by update())
    const boardCanvas = document.createElement("canvas");
    boardCanvas.width = 1024;
    boardCanvas.height = 512;
    const boardTex = new THREE.CanvasTexture(boardCanvas);
    boardTex.colorSpace = THREE.SRGBColorSpace;
    boardTex.anisotropy = 4;
    scoreboard = { ctx: boardCanvas.getContext("2d"), tex: boardTex, width: 1024, height: 512 };
    drawScoreboard([]);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: boardTex }));
    board.position.set(-5.97, 2.3, 0.5);
    board.rotation.y = Math.PI / 2;
    scene.add(board);
    box(0.25, 0.06, 1.2, mat(0x5a3522), -5.85, 1.33, 0.5); // little ledge under the board

    buildDoor();

    // Neon sign
    const neonTex = canvasTexture(1024, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = "bold 110px 'Plus Jakarta Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#ff5fa2";
      ctx.shadowBlur = 30;
      ctx.fillStyle = "#ffd1e6";
      ctx.fillText("Cà Phê Cùng Nhau", w / 2, h / 2);
    });
    const neon = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 1),
      new THREE.MeshBasicMaterial({ map: neonTex, transparent: true })
    );
    neon.position.set(0.6, 3.6, -5.97);
    scene.add(neon);

    // Chalkboard menu
    const menuTex = canvasTexture(512, 384, (ctx, w, h) => {
      ctx.fillStyle = "#5a3a24";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#1f2b24";
      ctx.fillRect(16, 16, w - 32, h - 32);
      ctx.fillStyle = "#f5f1e6";
      ctx.font = "bold 52px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("MENU", w / 2, 82);
      ctx.font = "30px sans-serif";
      ctx.textAlign = "left";
      const items = [["Cà phê đen", "20k"], ["Cà phê sữa", "25k"], ["Bạc xỉu", "30k"], ["Trà đào", "35k"], ["Hướng dương", "15k"]];
      items.forEach(([name, price], i) => {
        ctx.fillText(name, 48, 140 + i * 44);
        ctx.fillText(price, w - 120, 140 + i * 44);
      });
    });
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.35), mat(0xffffff, { map: menuTex }));
    menu.position.set(3.6, 2.6, -5.97);
    scene.add(menu);

    buildCounter();
    buildShelf();

    // Plants in the corners
    [[-5.3, -5.3], [5.3, 1.6], [-5.3, 5.2], [-5.3, -2.4]].forEach(([x, z]) => buildPlant(x, z));

    // A couple of empty side tables to fill the shop
    buildSideTable(-3.6, 3.4);
    buildSideTable(4.0, -2.3);
    buildSideTable(-3.8, -3.2);

    // Rug under the main table
    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.3, 48), mat(0x7c2d3a, { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.01;
    rug.receiveShadow = true;
    scene.add(rug);
    const rugInner = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.05, 48), mat(0xe9c46a, { roughness: 1 }));
    rugInner.rotation.x = -Math.PI / 2;
    rugInner.position.y = 0.012;
    scene.add(rugInner);

    // Pendant lamps
    buildPendant(0, 0, true);
    buildPendant(-3.6, 3.4, false);
    buildPendant(4.0, -2.3, false);
  }

  function buildCounter() {
    const wood = mat(0x6b4226);
    const top = mat(0x2b2b2b, { roughness: 0.4 });
    // Counter sits a bit off the wall so the waiter can stand behind it
    box(4.2, 0.82, 0.8, wood, 2.6, 0.41, -4.95);
    box(4.4, 0.08, 1.0, top, 2.6, 0.86, -4.9);
    // Espresso machine
    const steel = mat(0xc0c6cc, { metalness: 0.7, roughness: 0.3 });
    box(0.8, 0.55, 0.5, steel, 1.4, 1.18, -5.05);
    box(0.8, 0.08, 0.5, mat(0x1a1a1a), 1.4, 1.49, -5.05);
    cyl(0.04, 0.04, 0.12, mat(0x1a1a1a), 1.25, 1.05, -4.8);
    cyl(0.04, 0.04, 0.12, mat(0x1a1a1a), 1.55, 1.05, -4.8);
    // Cash register
    box(0.45, 0.25, 0.35, mat(0x374151), 3.9, 1.03, -4.95);
    // Row of cups
    for (let i = 0; i < 4; i++) {
      cyl(0.07, 0.06, 0.14, mat(0xfaf7f0), 2.3 + i * 0.25, 0.97, -4.75, null, 12);
    }
  }

  function buildShelf() {
    const wood = mat(0x5a3522);
    [2.0, 2.8].forEach(y => box(2.2, 0.06, 0.35, wood, -2.6, y, -5.82));
    const colors = [0xb45309, 0x1d4ed8, 0x15803d, 0x9f1239, 0xfaf7f0, 0x374151];
    for (let i = 0; i < 7; i++) {
      box(0.16, 0.36, 0.26, mat(colors[i % colors.length]), -3.5 + i * 0.22, 2.21, -5.8);
    }
    for (let i = 0; i < 4; i++) {
      cyl(0.11, 0.09, 0.22, mat(0xf5ede0), -3.3 + i * 0.5, 2.94, -5.8, null, 14);
    }
  }

  function buildPlant(x, z) {
    cyl(0.32, 0.24, 0.55, mat(0xb4532a), x, 0.275, z);
    const leafMat = mat(0x2f7d4f, { roughness: 0.9 });
    [[0, 0.95, 0, 0.42], [0.2, 1.25, 0.1, 0.32], [-0.18, 1.2, -0.1, 0.3], [0.05, 1.5, -0.05, 0.25]].forEach(([dx, y, dz, r]) => {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
      leaf.position.set(x + dx, y, z + dz);
      leaf.castShadow = true;
      scene.add(leaf);
    });
  }

  function buildChair(x, z, facing, parent) {
    const g = new THREE.Group();
    const wood = mat(0x8a5a36);
    box(0.5, 0.06, 0.5, wood, 0, 0.45, 0, g);
    box(0.5, 0.55, 0.06, wood, 0, 0.75, -0.22, g);
    [[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]].forEach(([lx, lz]) => {
      box(0.05, 0.45, 0.05, wood, lx, 0.225, lz, g);
    });
    g.position.set(x, 0, z);
    g.rotation.y = facing;
    (parent || scene).add(g);
    return g;
  }

  function buildSideTable(x, z) {
    const wood = mat(0x9b6b43);
    box(0.9, 0.06, 0.9, wood, x, 0.74, z);
    cyl(0.05, 0.05, 0.7, mat(0x2b2b2b), x, 0.36, z, null, 10);
    cyl(0.3, 0.3, 0.04, mat(0x2b2b2b), x, 0.02, z, null, 20);
    buildChair(x - 0.75, z, Math.PI / 2);
    buildChair(x + 0.75, z, -Math.PI / 2);
  }

  function buildDoor() {
    // Dark doorway on the back wall between the shelf and the counter
    const doorway = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.3), new THREE.MeshBasicMaterial({ color: 0x1a120c }));
    doorway.position.set(DOOR_X, 1.15, -5.985);
    scene.add(doorway);
    const frame = mat(0x3d2418);
    box(0.1, 2.4, 0.12, frame, DOOR_X - 0.6, 1.2, -5.94);
    box(0.1, 2.4, 0.12, frame, DOOR_X + 0.6, 1.2, -5.94);
    box(1.3, 0.12, 0.12, frame, DOOR_X, 2.36, -5.94);

    // Door panel hinged on its left edge, swings into the room
    const pivot = new THREE.Group();
    pivot.position.set(DOOR_X - 0.55, 0, -5.93);
    const panel = box(1.1, 2.25, 0.06, mat(0x7a4a2a), 0.55, 1.125, 0, pivot);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), mat(0xbfe3f5, { roughness: 0.2 }));
    glass.position.set(0, 0.45, 0.032);
    panel.add(glass);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), mat(0xd4af37, { metalness: 0.8, roughness: 0.3 }));
    knob.position.set(0.42, -0.05, 0.05);
    panel.add(knob);
    scene.add(pivot);
    door = { pivot, open: 0 };

    // Doormat
    const doormat = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), mat(0x3f4a3a, { roughness: 1 }));
    doormat.rotation.x = -Math.PI / 2;
    doormat.position.set(DOOR_X, 0.011, -5.35);
    scene.add(doormat);
  }

  function updateDoor(dt) {
    if (!door) return;
    // Open while anyone is close to the doorway
    const near = npcs.some(n => Math.hypot(n.group.position.x - DOOR_X, n.group.position.z + 5.6) < 1.4);
    const target = near ? 1 : 0;
    door.open += (target - door.open) * Math.min(1, dt * 5);
    door.pivot.rotation.y = -1.35 * door.open;
  }

  function drawScoreboard(players) {
    if (!scoreboard) return;
    const { ctx, width: w, height: h } = scoreboard;
    ctx.fillStyle = "#5a3522";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#17222b";
    ctx.fillRect(22, 22, w - 44, h - 44);

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fbbf24";
    ctx.font = "800 58px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("BẢNG ĐIỂM", w / 2, 82);
    ctx.fillStyle = "rgba(251, 191, 36, 0.4)";
    ctx.fillRect(w / 2 - 170, 120, 340, 4);

    const sorted = [...players].sort((a, b) => b.score - a.score);
    const medal = ["#fbbf24", "#cbd5e1", "#f59e0b", "#475569"];
    sorted.forEach((p, i) => {
      const y = 182 + i * 82;
      // Same score -> same rank number
      const rank = sorted.findIndex(q => q.score === p.score);
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.fillRect(60, y - 36, w - 120, 72);

      ctx.fillStyle = medal[rank];
      ctx.beginPath();
      ctx.arc(112, y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rank === 3 ? "#e2e8f0" : "#111827";
      ctx.font = "800 30px 'Plus Jakarta Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(rank + 1), 112, y + 2);

      ctx.fillStyle = `#${PLAYER_COLORS[p.id].toString(16).padStart(6, "0")}`;
      ctx.beginPath();
      ctx.arc(172, y, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.fillStyle = "#f1f5f9";
      ctx.font = "700 46px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(p.name, 202, y + 2, 520);

      ctx.textAlign = "right";
      ctx.fillStyle = p.score > 0 ? "#34d399" : p.score < 0 ? "#f87171" : "#e2e8f0";
      ctx.font = "800 52px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(p.score > 0 ? `+${p.score}` : String(p.score), w - 84, y + 2);
    });
    scoreboard.tex.needsUpdate = true;
  }

  function buildPendant(x, z, withLight) {
    cyl(0.01, 0.01, 1.4, mat(0x111111), x, 3.8, z, null, 6);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.3, 24, 1, true),
      mat(0x1f2937, { side: THREE.DoubleSide, roughness: 0.5 })
    );
    shade.position.set(x, 3.0, z);
    scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    bulb.position.set(x, 2.86, z);
    scene.add(bulb);
    if (withLight) {
      const light = new THREE.PointLight(0xffc77a, 6, 7, 1.6);
      light.position.set(x, 2.7, z);
      scene.add(light);
    }
  }

  // Cup on a saucer as one group, so it can be placed, carried and cleared
  function buildCup(x, y, z, withSteam, parent) {
    const cup = new THREE.Group();
    cyl(0.07, 0.055, 0.12, mat(0xfaf7f0), 0, 0.06, 0, cup, 14);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.062, 14), mat(0x4a2c1a));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.115;
    cup.add(coffee);
    cyl(0.12, 0.12, 0.012, mat(0xfaf7f0), 0, 0.006, 0, cup, 16); // saucer
    if (withSteam) {
      const steamMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
      for (let i = 0; i < 3; i++) {
        const puff = new THREE.Sprite(steamMat.clone());
        puff.scale.set(0.12, 0.12, 0.12);
        cup.add(puff);
        steamPuffs.push({ sprite: puff, cup, y: 0.15, phase: i / 3 });
      }
    }
    cup.position.set(x, y, z);
    (parent || scene).add(cup);
    return cup;
  }

  function removeCup(cup) {
    if (!cup) return;
    cup.removeFromParent();
    steamPuffs = steamPuffs.filter(p => p.cup !== cup);
  }

  // ------------------------------------------------------------------------
  // Rigged characters: Kenney "Mini Characters" glTF models (CC0) with
  // skeletal animations (idle, walk, sit, holding-both, ...)
  // ------------------------------------------------------------------------
  const gltfLoader = new GLTFLoader();
  const modelCache = {};
  function loadModel(name) {
    if (!modelCache[name]) {
      modelCache[name] = gltfLoader.loadAsync(`assets/characters/character-${name}.glb`).then(gltf => {
        const a = gltf.animations;
        gltf.clips = [
          ...a,
          makeCarryWalkClip(a),
          makeSeatedClip(a, "holding-both", "sit-hold"), // holding a hand of cards
          makeSeatedClip(a, "interact-right", "sit-play", true), // reaching out to play a card
          makeSeatedClip(a, "emote-no", "sit-no", true), // passing the turn
          makeSeatedClip(a, "emote-yes", "sit-yes", true) // celebrating a win
        ];
        return gltf;
      });
    }
    return modelCache[name];
  }

  // Legs/torso of "walk" + arms of "holding-both" = walking while carrying a tray
  function makeCarryWalkClip(clips) {
    const walk = THREE.AnimationClip.findByName(clips, "walk");
    const hold = THREE.AnimationClip.findByName(clips, "holding-both");
    const isArm = track => track.name.startsWith("arm-");
    const tracks = [...walk.tracks.filter(tr => !isArm(tr)), ...hold.tracks.filter(isArm)].map(tr => tr.clone());
    return new THREE.AnimationClip("walk-carry", walk.duration, tracks);
  }

  // There is no card-playing animation in the pack: keep the legs/root of "sit"
  // and take the arms (and optionally head/torso) from another clip
  const ONE_SHOT_ANIMS = ["sit-play", "sit-no", "sit-yes"];
  function makeSeatedClip(clips, from, name, withUpperBody = false) {
    const sit = THREE.AnimationClip.findByName(clips, "sit");
    const src = THREE.AnimationClip.findByName(clips, from);
    const fromSrc = tr => tr.name.startsWith("arm-") || (withUpperBody && /^(head|torso)\./.test(tr.name));
    const tracks = [...sit.tracks.filter(tr => !tr.name.startsWith("arm-")), ...src.tracks.filter(fromSrc)].map(tr => tr.clone());
    return new THREE.AnimationClip(name, src.duration, tracks);
  }

  // The actor is usable right away; the model pops in once its file has loaded
  function createActor(modelName) {
    const group = new THREE.Group(); // floor position + heading
    const holder = new THREE.Group(); // sit offset, bounce and shake
    group.add(holder);
    scene.add(group);
    const actor = { group, holder, mixer: null, anims: {}, currentAnim: null, wantedAnim: "idle", bones: {}, pendingAttach: [], seated: false };

    loadModel(modelName).then(gltf => {
      const model = SkeletonUtils.clone(gltf.scene);
      model.scale.setScalar(MODEL_SCALE);
      model.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
        if (o.isBone) actor.bones[o.name] = o;
      });
      holder.add(model);
      actor.mixer = new THREE.AnimationMixer(model);
      gltf.clips.forEach(clip => (actor.anims[clip.name] = actor.mixer.clipAction(clip)));
      ONE_SHOT_ANIMS.forEach(n => {
        actor.anims[n].setLoop(THREE.LoopOnce, 1);
        actor.anims[n].clampWhenFinished = true;
      });
      actor.mixer.addEventListener("finished", () => {
        const done = actor.onAnimDone;
        actor.onAnimDone = null;
        if (done) done();
      });
      actor.pendingAttach.forEach(([bone, obj]) => actor.bones[bone].add(obj));
      actor.pendingAttach = [];
      const wanted = actor.wantedAnim;
      actor.wantedAnim = null;
      playAnim(actor, wanted, 0);
    }).catch(err => console.warn("Could not load character", modelName, err));
    return actor;
  }

  function playAnim(actor, name, fade = 0.25) {
    if (actor.wantedAnim === name) return;
    actor.wantedAnim = name;
    const next = actor.anims[name];
    if (!next) return; // still loading: applied once the model is ready
    next.reset().fadeIn(fade).play();
    if (actor.currentAnim && actor.currentAnim !== next) actor.currentAnim.fadeOut(fade);
    actor.currentAnim = next;
  }

  // `obj` is built in world units; bones live inside the scaled model
  function attachToBone(actor, boneName, obj) {
    obj.scale.multiplyScalar(1 / MODEL_SCALE);
    if (actor.bones[boneName]) actor.bones[boneName].add(obj);
    else actor.pendingAttach.push([boneName, obj]);
  }

  // Play a one-shot clip, then go back to `then`. Returns false while the model is still loading.
  function playOnce(actor, name, then, onDone) {
    if (!actor.anims[name]) return false;
    actor.wantedAnim = null; // allow replaying the same clip
    actor.onAnimDone = () => {
      playAnim(actor, then);
      if (onDone) onDone();
    };
    playAnim(actor, name, 0.15);
    return true;
  }

  function setSeated(actor, seated, seatedAnim = "sit") {
    actor.seated = seated;
    actor.holder.position.set(0, seated ? SIT_OFFSET.y : 0, seated ? SIT_OFFSET.z : 0);
    playAnim(actor, seated ? seatedAnim : "idle");
  }

  function buildCrown() {
    const crown = new THREE.Group();
    const gold = mat(0xfbbf24, { metalness: 0.8, roughness: 0.25, emissive: 0x6b4a00 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 20, 1, true), gold);
    band.material.side = THREE.DoubleSide;
    crown.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 8), gold);
      spike.position.set(Math.cos(a) * 0.19, 0.1, Math.sin(a) * 0.19);
      crown.add(spike);
    }
    return crown;
  }

  // ------------------------------------------------------------------------
  // Main table + 4 players
  // ------------------------------------------------------------------------
  function buildMainTable() {
    const wood = mat(0xa86f45, { roughness: 0.6 });
    cyl(1.0, 1.0, 0.08, wood, 0, 0.74, 0, null, 48);
    cyl(1.02, 1.02, 0.03, mat(0x6b4226), 0, 0.69, 0, null, 48);
    cyl(0.08, 0.1, 0.7, mat(0x2b2b2b), 0, 0.35, 0, null, 12);
    cyl(0.45, 0.45, 0.04, mat(0x2b2b2b), 0, 0.02, 0, null, 24);


    Object.entries(SEAT_ANGLES).forEach(([id, angle]) => {
      const sx = Math.sin(angle), sz = Math.cos(angle);
      const color = PLAYER_COLORS[id];
      buildChair(sx * SEAT_RADIUS, sz * SEAT_RADIUS, angle + Math.PI);

      // Colored ring on the floor marks whose seat it is
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40), new THREE.MeshBasicMaterial({ color }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx * SEAT_RADIUS, 0.014, sz * SEAT_RADIUS);
      scene.add(ring);

      // A coffee for everyone, next to their hands
      const side = angle + Math.PI / 2;
      buildCup(sx * 0.72 + Math.sin(side) * 0.33, 0.78, sz * 0.72 + Math.cos(side) * 0.33, true);

      characters[id] = buildPlayer(Number(id), angle);
    });
  }

  function buildPlayer(playerId, angle) {
    const color = PLAYER_COLORS[playerId];
    const actor = createActor(PLAYER_MODELS[playerId]);
    actor.group.position.set(Math.sin(angle) * SEAT_RADIUS, 0, Math.cos(angle) * SEAT_RADIUS);
    actor.group.lookAt(0, 0, 0);
    setSeated(actor, true, "sit-hold");

    // Fan of cards held in both hands (backs in the player's color)
    const fan = new THREE.Group();
    const back = cardBackMaterial(color);
    for (let i = -3; i <= 3; i++) {
      const card = new THREE.Mesh(CARD_GEOMETRY, back);
      card.position.set(i * 0.035, Math.cos(i * 0.2) * 0.04, -0.002 * i);
      card.rotation.z = -i * 0.2;
      fan.add(card);
    }
    fan.position.set(0, FAN_POS.y, FAN_POS.z);
    fan.rotation.x = -0.25; // tilted slightly towards the player's face
    actor.holder.add(fan);

    // Gold crown on the head, only shown on the leader
    const crown = buildCrown();
    crown.position.y = 0.36; // head bone -> top of the head, in model units
    crown.visible = false;
    attachToBone(actor, "head", crown);

    // HTML label floating over the head
    const label = document.createElement("div");
    label.className = "cafe-label";
    label.style.setProperty("--player-color", `#${color.toString(16).padStart(6, "0")}`);
    const nameEl = document.createElement("span");
    nameEl.className = "cafe-label-name";
    const scoreEl = document.createElement("span");
    scoreEl.className = "cafe-label-score";
    label.append(nameEl, scoreEl);
    labelLayer.appendChild(label);

    return { actor, crown, fan, label, nameEl, scoreEl, jumpT: 0, shakeT: 0 };
  }

  // ------------------------------------------------------------------------
  // Card game: players take turns playing cards onto the middle of the table
  // (just for show - the real game happens in real life)
  // ------------------------------------------------------------------------
  const CARD_W = 0.17, CARD_H = 0.25;
  const CARD_GEOMETRY = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const PILE_Y = 0.786;
  const TURN_ORDER = [1, 2, 3, 4];
  const cardGame = { turn: 0, timer: 2.5, pile: [], flying: [], sweeping: [], passes: 0 };
  const cardFaceMaterials = [];

  function cardBackMaterial(color) {
    const tex = canvasTexture(128, 186, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      ctx.fillRect(8, 8, w - 16, h - 16);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 3;
      for (let i = -h; i < w + h; i += 18) {
        ctx.beginPath();
        ctx.moveTo(i, 8);
        ctx.lineTo(i + h, h - 8);
        ctx.stroke();
      }
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
  }

  // Random face-up card (rank + suit) from a small pool of pre-drawn faces
  function randomCardFace() {
    if (!cardFaceMaterials.length) {
      const ranks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
      const suits = [["♠", "#111827"], ["♣", "#111827"], ["♦", "#dc2626"], ["♥", "#dc2626"]];
      for (let i = 0; i < 16; i++) {
        const rank = ranks[(i * 5) % ranks.length];
        const [suit, ink] = suits[i % suits.length];
        const tex = canvasTexture(128, 186, (ctx, w, h) => {
          ctx.fillStyle = "#fbfaf7";
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = "#d6d3d1";
          ctx.lineWidth = 4;
          ctx.strokeRect(2, 2, w - 4, h - 4);
          ctx.fillStyle = ink;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = "bold 34px sans-serif";
          ctx.fillText(rank, 26, 26);
          ctx.font = "28px sans-serif";
          ctx.fillText(suit, 26, 56);
          ctx.font = "72px sans-serif";
          ctx.fillText(suit, w / 2, h / 2 + 8);
        });
        cardFaceMaterials.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
      }
    }
    return cardFaceMaterials[Math.floor(Math.random() * cardFaceMaterials.length)];
  }

  function playCard(playerId) {
    const c = characters[playerId];
    const card = new THREE.Mesh(CARD_GEOMETRY, randomCardFace());
    card.castShadow = true;
    c.fan.getWorldPosition(card.position);
    c.fan.getWorldQuaternion(card.quaternion);
    scene.add(card);

    // Land flat on the pile with a random twist, slightly scattered
    const n = cardGame.pile.length + cardGame.flying.length;
    const to = new THREE.Vector3((Math.random() - 0.5) * 0.3, PILE_Y + n * 0.0015, (Math.random() - 0.5) * 0.3);
    const toQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.random() * Math.PI * 2));
    cardGame.flying.push({ card, from: card.position.clone(), fromQuat: card.quaternion.clone(), to, toQuat, t: 0 });
  }

  // Clear the middle of the table (cards shrink away), then "deal" new hands
  function sweepPile() {
    [...cardGame.pile, ...cardGame.flying.map(f => f.card)].forEach(card => cardGame.sweeping.push({ card, t: 0 }));
    cardGame.pile = [];
    cardGame.flying = [];
    cardGame.passes = 0;
    Object.values(characters).forEach(c => c.fan.scale.setScalar(0.01));
    cardGame.timer = 2.2;
  }

  function updateCardGame(dt) {
    // Flying cards: arc from the hand to the pile
    for (let i = cardGame.flying.length - 1; i >= 0; i--) {
      const f = cardGame.flying[i];
      f.t = Math.min(1, f.t + dt / 0.45);
      const k = 1 - Math.pow(1 - f.t, 2); // ease out
      f.card.position.lerpVectors(f.from, f.to, k);
      f.card.position.y += Math.sin(Math.PI * k) * 0.25;
      f.card.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, k);
      if (f.t >= 1) {
        cardGame.flying.splice(i, 1);
        cardGame.pile.push(f.card);
      }
    }

    for (let i = cardGame.sweeping.length - 1; i >= 0; i--) {
      const s = cardGame.sweeping[i];
      s.t += dt / 0.4;
      s.card.scale.setScalar(Math.max(0.001, 1 - s.t));
      if (s.t >= 1) {
        s.card.removeFromParent();
        cardGame.sweeping.splice(i, 1);
      }
    }

    // Hands grow back after a sweep (new deal)
    Object.values(characters).forEach(c => {
      const s = c.fan.scale.x;
      if (s < 1) c.fan.scale.setScalar(Math.min(1, s + dt * 1.5));
    });

    cardGame.timer -= dt;
    if (cardGame.timer > 0) return;
    cardGame.timer = randomBetween(1.4, 2.4);

    const playerId = TURN_ORDER[cardGame.turn];
    const c = characters[playerId];
    if (c.jumpT > 0 || c.shakeT > 0) return; // busy reacting to a score change: try again later
    cardGame.turn = (cardGame.turn + 1) % TURN_ORDER.length;

    // Everyone else passed: the trick is over, clear the table
    if (cardGame.passes >= 3 || cardGame.pile.length >= 14) {
      sweepPile();
      return;
    }
    if (cardGame.pile.length && Math.random() < 0.25) {
      cardGame.passes++;
      playOnce(c.actor, "sit-no", "sit-hold");
      return;
    }
    cardGame.passes = 0;
    // The card leaves the hand halfway through the reach
    if (playOnce(c.actor, "sit-play", "sit-hold")) setTimeout(() => playCard(playerId), 280);
  }

  // ------------------------------------------------------------------------
  // NPCs: customers walking in / out and a waiter serving them
  // ------------------------------------------------------------------------
  // Walkable waypoint graph (x, z). Actors only move along these edges, which
  // keeps them clear of tables, chairs and the counter.
  const NAV_NODES = {
    H: [3.0, -5.68],   // waiter's spot behind the counter
    M: [1.4, -5.68],   // espresso machine
    E0: [5.25, -5.68], // counter end (behind)
    E1: [5.25, -4.1],  // counter end (front)
    E2: [5.4, -1.2],
    F: [2.6, -3.85],
    S: [DOOR_X, -5.85], // just inside the doorway (spawn / despawn)
    D: [DOOR_X, -5.25],
    A: [DOOR_X, -3.9]
  };
  const NAV_EDGES = [
    ["H", "M"], ["H", "E0"], ["E0", "E1"], ["E1", "F"], ["E1", "E2"], ["E2", "R2"],
    ["F", "R3"], ["F", "R4"], ["F", "A"], ["S", "D"], ["D", "A"], ["A", "R4"], ["A", "R5"]
  ];
  // Ring of aisle nodes around the main table
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    NAV_NODES[`R${k}`] = [Math.sin(a) * 2.55, Math.cos(a) * 2.55];
    NAV_EDGES.push([`R${k}`, `R${(k + 1) % 8}`]);
  }
  // Side tables: an aisle node in front of each table plus one per chair
  const SIDE_TABLES = [
    { id: "T1", x: -3.6, z: 3.4, links: ["R7", "R0"] },
    { id: "T2", x: 4.0, z: -2.3, links: ["R2", "R3", "E2"] },
    { id: "T3", x: -3.8, z: -3.2, links: ["R5", "R6"] }
  ];
  const SEATS = [];
  SIDE_TABLES.forEach(t => {
    const dz = t.z > 0 ? -0.85 : 0.85; // aisle side faces the middle of the room
    NAV_NODES[`${t.id}a`] = [t.x, t.z + dz];
    t.links.forEach(l => NAV_EDGES.push([`${t.id}a`, l]));
    [["L", -0.75, Math.PI / 2], ["R", 0.75, -Math.PI / 2]].forEach(([side, dx, yaw]) => {
      const node = `${t.id}${side}`;
      NAV_NODES[node] = [t.x + dx, t.z + dz];
      NAV_EDGES.push([`${t.id}a`, node]);
      SEATS.push({
        node,
        tableNode: `${t.id}a`,
        waiterYaw: dz > 0 ? Math.PI : 0, // waiter faces the table from the aisle
        x: t.x + dx, z: t.z, yaw,
        cupX: t.x + dx / 3, cupZ: t.z,
        customer: null, cup: null, dirty: false
      });
    });
  });
  const WANDER_NODES = ["R0", "R1", "R2", "R3", "R6", "R7", "T1a", "T2a", "T3a"];

  const NAV_ADJ = {};
  NAV_EDGES.forEach(([a, b]) => {
    (NAV_ADJ[a] = NAV_ADJ[a] || []).push(b);
    (NAV_ADJ[b] = NAV_ADJ[b] || []).push(a);
  });

  // Dijkstra over the small waypoint graph; returns node names from -> to
  function findPath(from, to) {
    const dist = { [from]: 0 }, prev = {}, done = new Set();
    while (true) {
      let cur = null;
      Object.keys(dist).forEach(n => {
        if (!done.has(n) && (cur === null || dist[n] < dist[cur])) cur = n;
      });
      if (cur === null) return [from];
      if (cur === to) break;
      done.add(cur);
      (NAV_ADJ[cur] || []).forEach(nb => {
        const [ax, az] = NAV_NODES[cur], [bx, bz] = NAV_NODES[nb];
        const d = dist[cur] + Math.hypot(ax - bx, az - bz);
        if (dist[nb] === undefined || d < dist[nb]) {
          dist[nb] = d;
          prev[nb] = cur;
        }
      });
    }
    const path = [to];
    while (path[0] !== from) path.unshift(prev[path[0]]);
    return path;
  }

  const npcs = [];
  let waiter = null;
  const waiterTasks = []; // { type: 'serve' | 'clear', seat }
  let nextCustomerIn = 6;
  let waiterIdleFor = 12;
  const randomBetween = (a, b) => a + Math.random() * (b - a);

  // NPC = rigged actor + behaviour state
  function createNpc(modelName, speed) {
    const actor = createActor(modelName);
    return Object.assign(actor, { modelName, actions: [], node: null, planNode: null, walking: false, speed, appear: 1, tray: null, trayCup: null });
  }

  function buildWaiter() {
    const w = createNpc(WAITER_MODEL, 1.8);

    // Apron + pocket, tied to the torso bone so it follows the body
    const apron = new THREE.Group();
    const apronMat = mat(0x4a3424, { roughness: 0.9 });
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.03), apronMat);
    apron.add(front);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), mat(0x5c4331));
    pocket.position.set(0, -0.06, 0.02);
    apron.add(pocket);
    apron.position.set(APRON_POS.x, APRON_POS.y, APRON_POS.z);
    attachToBone(w, "torso", apron);

    // Tray with a cup, held in front with both hands while carrying
    const tray = new THREE.Group();
    tray.add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 24), mat(0xb8bec5, { metalness: 0.6, roughness: 0.35 })));
    const trayCup = buildCup(0, 0.012, 0, false, tray);
    tray.position.set(0, TRAY_POS.y, TRAY_POS.z);
    tray.visible = false;
    w.holder.add(tray);
    w.tray = tray;
    w.trayCup = trayCup;
    return w;
  }

  // --- Action queue helpers (planning happens ahead, execution in updateNpcs) ---
  function planWalk(person, toNode) {
    const path = findPath(person.planNode, toNode);
    const points = path.slice(1).map(n => NAV_NODES[n]);
    if (points.length) person.actions.push({ type: "walk", points });
    person.actions.push({ type: "call", fn: () => (person.node = toNode) });
    person.planNode = toNode;
  }

  function planPoint(person, x, z) {
    person.actions.push({ type: "walk", points: [[x, z]] });
  }

  const plan = {
    wait: (person, t) => person.actions.push({ type: "wait", t }),
    face: (person, yaw) => person.actions.push({ type: "face", yaw }),
    call: (person, fn) => person.actions.push({ type: "call", fn })
  };

  function spawnCustomer() {
    const free = SEATS.filter(s => !s.customer && !s.dirty && !s.cup);
    if (!free.length || npcs.length - 1 >= 3) return;
    const seat = free[Math.floor(Math.random() * free.length)];
    const busy = npcs.map(n => n.modelName);
    const models = CUSTOMER_MODELS.filter(m => !busy.includes(m));
    const c = createNpc(models[Math.floor(Math.random() * models.length)], 1.1);
    c.isCustomer = true;
    c.appear = 0;
    const [sx, sz] = NAV_NODES.S;
    c.group.position.set(sx, 0, sz);
    c.group.rotation.y = 0;
    c.node = c.planNode = "S";
    seat.customer = c;
    npcs.push(c);

    planWalk(c, seat.node);
    planPoint(c, seat.x, seat.z);
    plan.face(c, seat.yaw);
    plan.call(c, () => {
      setSeated(c, true);
      waiterTasks.push({ type: "serve", seat });
    });
    // Wait for the coffee (gives up after a while), then take time to drink it
    c.actions.push({ type: "until", cond: () => !!seat.cup, t: 50 });
    plan.wait(c, randomBetween(35, 60));
    plan.call(c, () => {
      setSeated(c, false);
      seat.customer = null;
      if (seat.cup) {
        seat.dirty = true;
        waiterTasks.push({ type: "clear", seat });
      }
    });
    planPoint(c, NAV_NODES[seat.node][0], NAV_NODES[seat.node][1]);
    c.planNode = seat.node;
    planWalk(c, "S");
    plan.call(c, () => (c.leaving = true));
  }

  function planWaiterTask(task) {
    const w = waiter;
    const { seat } = task;
    if (task.type === "serve") {
      if (!seat.customer || seat.cup) return false;
      planWalk(w, "M");
      plan.face(w, 0);
      plan.wait(w, 2.2); // brewing
      plan.call(w, () => {
        w.tray.visible = true;
        w.trayCup.visible = true;
      });
      planWalk(w, seat.tableNode);
      plan.face(w, seat.waiterYaw);
      plan.wait(w, 0.5);
      plan.call(w, () => {
        w.trayCup.visible = false;
        // Customer may already be gone; then the coffee goes back to the counter
        if (seat.customer && !seat.cup) seat.cup = buildCup(seat.cupX, 0.77, seat.cupZ, true);
        else w.trayCup.visible = true;
      });
    } else {
      planWalk(w, seat.tableNode);
      plan.face(w, seat.waiterYaw);
      plan.wait(w, 0.6);
      plan.call(w, () => {
        removeCup(seat.cup);
        seat.cup = null;
        seat.dirty = false;
        w.tray.visible = true;
        w.trayCup.visible = true;
      });
    }
    planWalk(w, "H");
    plan.face(w, 0);
    plan.wait(w, 0.6);
    plan.call(w, () => {
      w.tray.visible = false;
      w.trayCup.visible = false;
    });
    return true;
  }

  function planWaiterWander() {
    const target = WANDER_NODES[Math.floor(Math.random() * WANDER_NODES.length)];
    planWalk(waiter, target);
    plan.wait(waiter, randomBetween(1.5, 3));
    planWalk(waiter, "H");
    plan.face(waiter, 0);
  }

  function initNpcs() {
    waiter = buildWaiter();
    const [hx, hz] = NAV_NODES.H;
    waiter.group.position.set(hx, 0, hz);
    waiter.node = waiter.planNode = "H";
    npcs.push(waiter);
  }

  function turnTowards(current, target, maxStep) {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return current + Math.max(-maxStep, Math.min(maxStep, diff));
  }

  function stepActor(p, dt) {
    p.walking = false;
    // Run instant actions right away, stop at the first one that takes time
    while (p.actions.length) {
      const a = p.actions[0];
      if (a.type === "call") {
        a.fn();
        p.actions.shift();
        continue;
      }
      if (a.type === "wait") {
        a.t -= dt;
        if (a.t <= 0) p.actions.shift();
        return;
      }
      if (a.type === "until") {
        a.t -= dt;
        if (a.cond() || a.t <= 0) p.actions.shift();
        return;
      }
      if (a.type === "face") {
        p.group.rotation.y = turnTowards(p.group.rotation.y, a.yaw, dt * 6);
        if (Math.abs(turnTowards(p.group.rotation.y, a.yaw, 10) - p.group.rotation.y) < 0.02) p.actions.shift();
        return;
      }
      if (a.type === "walk") {
        const [tx, tz] = a.points[0];
        const pos = p.group.position;
        const dx = tx - pos.x, dz = tz - pos.z;
        const dist = Math.hypot(dx, dz);
        const step = p.speed * dt;
        if (dist <= step) {
          pos.x = tx;
          pos.z = tz;
          a.points.shift();
          if (!a.points.length) p.actions.shift();
        } else {
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
        }
        if (dist > 0.01) p.group.rotation.y = turnTowards(p.group.rotation.y, Math.atan2(dx, dz), dt * 8);
        p.walking = true;
        return;
      }
      p.actions.shift();
    }
  }

  function updateNpcs(dt) {
    if (!waiter) return;

    nextCustomerIn -= dt;
    if (nextCustomerIn <= 0) {
      spawnCustomer();
      nextCustomerIn = randomBetween(22, 40);
    }

    // Waiter picks the next job only when back at the counter with nothing queued
    if (!waiter.actions.length) {
      let planned = false;
      // Waiting customers come first, dirty cups can wait
      const next = () => {
        const i = waiterTasks.findIndex(task => task.type === "serve");
        return waiterTasks.splice(i >= 0 ? i : 0, 1)[0];
      };
      while (waiterTasks.length && !planned) planned = planWaiterTask(next());
      if (!planned) {
        waiterIdleFor -= dt;
        if (waiterIdleFor <= 0) {
          planWaiterWander();
          waiterIdleFor = randomBetween(14, 28);
        }
      }
    }

    for (let i = npcs.length - 1; i >= 0; i--) {
      const p = npcs[i];
      stepActor(p, dt);

      // Pop in at the door, shrink away when leaving
      if (p.leaving) p.appear -= dt * 3;
      else if (p.appear < 1) p.appear = Math.min(1, p.appear + dt * 3);
      p.group.scale.setScalar(Math.max(0.001, p.appear));
      if (p.leaving && p.appear <= 0) {
        p.group.removeFromParent();
        npcs.splice(i, 1);
        continue;
      }

      if (!p.seated) {
        const carrying = p.tray && p.tray.visible;
        playAnim(p, p.walking ? (carrying ? "walk-carry" : "walk") : carrying ? "holding-both" : "idle");
      }
    }
  }

  // ------------------------------------------------------------------------
  // Camera controls: drag to orbit, wheel / pinch to zoom
  // ------------------------------------------------------------------------
  function setupControls(canvas) {
    const pointers = new Map();
    let lastPinch = 0;

    canvas.addEventListener("pointerdown", e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener("pointermove", e => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (pointers.size === 1) {
        camState.az -= (e.clientX - prev.x) * 0.008;
        camState.pol -= (e.clientY - prev.y) * 0.006;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) camState.radius *= lastPinch / dist;
        lastPinch = dist;
      }
      clampCamera();
    });
    const release = e => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      camState.radius *= 1 + e.deltaY * 0.001;
      clampCamera();
    }, { passive: false });
  }

  function clampCamera() {
    // Walls are on the back and left sides, so keep the camera in the open front-right area
    camState.az = Math.min(Math.max(camState.az, -0.35), 1.9);
    camState.pol = Math.min(Math.max(camState.pol, 0.45), 1.3);
    camState.radius = Math.min(Math.max(camState.radius, 4.5), 12);
  }

  function updateCamera() {
    const { az, pol, radius, target } = camState;
    camera.position.set(
      target.x + radius * Math.sin(pol) * Math.sin(az),
      target.y + radius * Math.cos(pol),
      target.z + radius * Math.sin(pol) * Math.cos(az)
    );
    camera.lookAt(target);
  }

  // ------------------------------------------------------------------------
  // Render loop
  // ------------------------------------------------------------------------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const tmpVec = new THREE.Vector3();
  function positionLabels() {
    const w = container.clientWidth, h = container.clientHeight;
    Object.values(characters).forEach(c => {
      const head = c.actor.bones.head;
      if (head) {
        head.getWorldPosition(tmpVec);
        tmpVec.y += 0.34 * MODEL_SCALE + 0.2; // top of the head + a little gap
      } else {
        c.actor.group.getWorldPosition(tmpVec);
        tmpVec.y += 1.9;
      }
      tmpVec.project(camera);
      const x = (tmpVec.x * 0.5 + 0.5) * w;
      const y = (-tmpVec.y * 0.5 + 0.5) * h;
      c.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      c.labelX = x;
      c.labelY = y;
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!container.offsetParent) return; // dashboard hidden: skip rendering

    Object.values(characters).forEach(c => {
      let y = 0, rotZ = 0;
      if (c.jumpT > 0) {
        c.jumpT = Math.max(0, c.jumpT - dt);
        y = Math.abs(Math.sin((1 - c.jumpT) * Math.PI * 2)) * 0.35 * c.jumpT;
      }
      if (c.shakeT > 0) {
        c.shakeT = Math.max(0, c.shakeT - dt);
        rotZ = Math.sin(t * 40) * 0.12 * c.shakeT;
      }
      c.actor.holder.position.y = SIT_OFFSET.y + y;
      c.actor.holder.rotation.z = rotZ;
      if (c.crown.visible) c.crown.rotation.y += dt * 1.5;
    });

    updateDoor(dt);
    updateNpcs(dt);
    updateCardGame(dt);
    [...Object.values(characters).map(c => c.actor), ...npcs].forEach(a => a.mixer && a.mixer.update(dt));

    steamPuffs.forEach(p => {
      const k = (t * 0.45 + p.phase) % 1;
      p.sprite.position.set(Math.sin((k + p.phase) * 6) * 0.03, p.y + k * 0.45, 0);
      p.sprite.material.opacity = 0.35 * (1 - k);
      p.sprite.scale.setScalar(0.08 + k * 0.12);
    });

    updateCamera();
    renderer.render(scene, camera);
    positionLabels();
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------
  function init(el) {
    if (!el) return false;
    container = el;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (e) {
      console.warn("WebGL not available, cafe scene disabled:", e);
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.className = "cafe-canvas";
    container.appendChild(renderer.domElement);

    labelLayer = document.createElement("div");
    labelLayer.className = "cafe-label-layer";
    container.appendChild(labelLayer);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a1d16);
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3b2a20, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    buildRoom();
    buildMainTable();
    initNpcs();
    setupControls(renderer.domElement);

    new ResizeObserver(resize).observe(container);
    resize();
    animate();
    return true;
  }

  // players: [{id, name, score}], ranks: {playerId: rank}
  function update(players, ranks) {
    const scores = players.map(p => p.score);
    const hasLeader = Math.max(...scores) !== Math.min(...scores);
    drawScoreboard(players);
    players.forEach(p => {
      const c = characters[p.id];
      if (!c) return;
      const isLeader = hasLeader && ranks[p.id] === 1;
      c.nameEl.textContent = isLeader ? `👑 ${p.name}` : p.name;
      c.scoreEl.textContent = p.score > 0 ? `+${p.score}` : `${p.score}`;
      c.scoreEl.className = "cafe-label-score " + (p.score > 0 ? "pos" : p.score < 0 ? "neg" : "");
      c.crown.visible = isLeader;
    });
  }

  // Score change reaction: bounce for gains, shake for losses, plus a floating number
  function pulse(playerId, delta) {
    const c = characters[playerId];
    if (!c || !delta) return;
    if (delta > 0) c.jumpT = 1;
    else c.shakeT = 0.8;

    const bubble = document.createElement("div");
    bubble.className = `cafe-float ${delta > 0 ? "pos" : "neg"}`;
    bubble.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    bubble.style.left = `${c.labelX || 0}px`;
    bubble.style.top = `${(c.labelY || 0) - 34}px`;
    labelLayer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1200);
  }

  // A round was recorded: clear the table and let the winner celebrate
  function roundEnd(winnerId) {
    if (!scene) return;
    sweepPile();
    const c = characters[winnerId];
    if (c) playOnce(c.actor, "sit-yes", "sit-hold");
  }

  window.CafeScene = { init, update, pulse, roundEnd };
})();
