/**
 * One stylesheet for the whole HUD, injected on first use.
 *
 * THE LOOK IS THE REFERENCE ART'S: heavy rounded display type in white with a
 * thick dark rim, chunky rounded tiles in saturated gradients with a dark
 * border and a drop, white panels with a coloured header and a red close
 * square, and a red badge when something is waiting. Bright, toy-like, and
 * readable over a bright sky - which is what a Roblox-style HUD is.
 *
 * NO BACKTICKS ANYWHERE IN THIS FILE: the stylesheet is a template literal.
 */
let injected = false;

export const injectHudStyles = (): void => {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.textContent = `
:root {
  /*
   * THE HUD UNIT. Every HUD size and offset is a multiple of it, so the whole
   * HUD scales as one - smoothly, with the viewport, never per device.
   *
   * One unit is one pixel of the HUD as designed for a 1920x1080 screen (or
   * 1080x1920 held upright): the viewport's fit to whichever of the two it
   * matches better, so a window keeps its HUD in proportion as it is resized
   * and a phone keeps it in proportion whichever way it is held. Bounded both
   * ways: never so small that a tile is not a comfortable touch target (0.4 -
   * a 49px tile; only a very short screen, under 360px, goes a little below,
   * so the HUD still fits its height), never so large on a huge screen that
   * the HUD crowds it.
   */
  --u: clamp(min(0.4px, 100vh / 900), max(min(100vw / 1920, 100vh / 1080), min(100vw / 1080, 100vh / 1920)), 1.35px);
  --gs-rail: calc(82 * var(--u));
  --gs-ink: #1c2233;
  --gs-font: "Fredoka", "Baloo 2", "Nunito", "Segoe UI", system-ui, sans-serif;
  --gs-blue: #3fa9ff;
  --gs-blue-dark: #1f6fd6;
  --gs-green: #5ed64f;
  --gs-green-dark: #2f9e2b;
  --gs-orange: #ffa62b;
  --gs-orange-dark: #e2721a;
  --gs-pink: #ff5fb3;
  --gs-pink-dark: #d8347f;
  --gs-purple: #9b6bff;
  --gs-purple-dark: #6d3fd6;
  --gs-yellow: #ffd93d;
  --gs-gold: #f0c040;
  --gs-red: #ff4d4d;
  --gs-panel: #f2f2f2;
  --gs-panel-dark: #dcdcdc;
}

.aoe-font {
  font-family: var(--gs-font);
  font-weight: 700;
  letter-spacing: 0.01em;
}

/* THE OUTLINED TYPE: white glyphs with a thick dark rim, the reference's look. */
.aoe-outline {
  color: #fff;
  text-shadow:
    2px 0 0 var(--gs-ink), -2px 0 0 var(--gs-ink), 0 2px 0 var(--gs-ink), 0 -2px 0 var(--gs-ink),
    2px 2px 0 var(--gs-ink), -2px 2px 0 var(--gs-ink), 2px -2px 0 var(--gs-ink), -2px -2px 0 var(--gs-ink),
    0 4px 6px rgba(0, 0, 0, 0.35);
  paint-order: stroke fill;
}
.aoe-outline--big {
  text-shadow:
    3px 0 0 var(--gs-ink), -3px 0 0 var(--gs-ink), 0 3px 0 var(--gs-ink), 0 -3px 0 var(--gs-ink),
    3px 3px 0 var(--gs-ink), -3px 3px 0 var(--gs-ink), 3px -3px 0 var(--gs-ink), -3px -3px 0 var(--gs-ink),
    0 5px 8px rgba(0, 0, 0, 0.35);
}

/* ---- Wins, top centre ------------------------------------------------- */
.aoe-wins {
  position: fixed;
  top: max(10px, env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  user-select: none;
  z-index: 22;
}
.aoe-wins__icon { width: clamp(34px, 3.8vw, 54px); height: clamp(34px, 3.8vw, 54px); }
.aoe-wins__icon .aoe-icon { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 4px 5px rgba(0, 0, 0, 0.35)); }
.aoe-wins__value {
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: clamp(22px, 2.8vw, 36px);
  line-height: 1;
  color: #ffd93d;
}
.aoe-wins--pop .aoe-wins__value { animation: aoe-pop 520ms ease-out; }
@keyframes aoe-pop {
  0% { transform: scale(1); }
  35% { transform: scale(1.25); }
  100% { transform: scale(1); }
}

/* ---- Left rail ---------------------------------------------------------- */
/*
 * THE LEFT DOCK: the progression indicators and the button rail, as ONE
 * vertical group anchored to the left edge and centred on it. The indicators
 * sit directly above the first tile with one fixed gap between them, and
 * every measure is in --u, so the whole group scales with the viewport
 * instead of growing past it on a phone or a short window.
 *
 * The dock itself takes no pointer events - its box spans the widest child,
 * and the gaps between tiles are not click targets - so only the tiles do.
 */
.aoe-dock {
  position: fixed;
  left: max(10px, calc(16 * var(--u)), env(safe-area-inset-left, 0px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: calc(18 * var(--u));
  z-index: 21;
  pointer-events: none;
  user-select: none;
}
.aoe-rail {
  display: flex;
  flex-direction: column;
  gap: calc(22 * var(--u));
  pointer-events: auto;
  user-select: none;
}
/* A RAIL TILE: a rounded gradient plate with a dark rim and a drop. */
.aoe-tile {
  position: relative;
  width: var(--gs-rail);
  height: var(--gs-rail);
  border: max(2px, calc(4 * var(--u))) solid var(--gs-ink);
  border-radius: calc(18 * var(--u));
  background: linear-gradient(180deg, var(--tile-a, #9b6bff), var(--tile-b, #6d3fd6));
  box-shadow: 0 calc(6 * var(--u)) 0 rgba(0, 0, 0, 0.28), inset 0 calc(3 * var(--u)) 0 rgba(255, 255, 255, 0.35);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  transition: transform 110ms ease;
}
.aoe-tile:hover { transform: scale(1.06); }
.aoe-tile:active { transform: translateY(calc(3 * var(--u))); box-shadow: 0 calc(3 * var(--u)) 0 rgba(0, 0, 0, 0.28); }
.aoe-tile .aoe-icon {
  width: 70%;
  height: 70%;
  object-fit: contain;
  filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.35));
  pointer-events: none;
}
.aoe-tile__label {
  position: absolute;
  left: 50%;
  bottom: calc(-15 * var(--u));
  transform: translateX(-50%);
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: max(11px, calc(16 * var(--u)));
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
}
.aoe-tile__key {
  position: absolute;
  right: calc(-6 * var(--u));
  top: calc(-6 * var(--u));
  min-width: max(14px, calc(20 * var(--u)));
  height: max(14px, calc(20 * var(--u)));
  padding: 0 calc(5 * var(--u));
  box-sizing: border-box;
  border: max(1px, calc(2 * var(--u))) solid var(--gs-ink);
  border-radius: calc(7 * var(--u));
  background: #ffffff;
  color: var(--gs-ink);
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: max(9px, calc(11 * var(--u)));
  display: grid;
  place-items: center;
  line-height: 1;
  text-align: center;
  pointer-events: none;
}
body.aoe-touch-mode .aoe-tile__key { display: none; }
.aoe-tile__badge {
  position: absolute;
  left: calc(-9 * var(--u));
  top: calc(-9 * var(--u));
  width: max(12px, calc(22 * var(--u)));
  height: max(12px, calc(22 * var(--u)));
  box-sizing: border-box;
  border: max(2px, calc(3 * var(--u))) solid var(--gs-ink);
  border-radius: 50%;
  background: var(--gs-red);
  display: none;
  animation: aoe-pip 1.4s ease-in-out infinite;
}
@keyframes aoe-pip {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); }
}
.aoe-tile--ready .aoe-tile__badge { display: block; }
.aoe-tile--locked { filter: saturate(0.6) brightness(0.9); }
.aoe-tile--rebirth { --tile-a: #ff5fb3; --tile-b: #c92a78; }
.aoe-tile--shop { --tile-a: #ff5a5a; --tile-b: #c92a2a; }
.aoe-tile--backpack { --tile-a: #ffb347; --tile-b: #d9741a; }
.aoe-tile--audio { --tile-a: #5ed64f; --tile-b: #2f9e2b; }
.aoe-tile--pets { --tile-a: #ff9ecb; --tile-b: #d8347f; }
.aoe-tile--teleport { --tile-a: #b98cff; --tile-b: #6d3fd6; }
.aoe-tile--bag { --tile-a: #ffb347; --tile-b: #d9741a; }
.aoe-tile--off { filter: saturate(0.3) brightness(0.75); }
.aoe-tile--off .aoe-icon { opacity: 0.55; }

/* ---- Bloxity account chip, top right ----------------------------------- */
.aoe-account {
  position: fixed;
  top: max(8px, calc(12 * var(--u)), env(safe-area-inset-top, 0px));
  right: max(8px, calc(12 * var(--u)), env(safe-area-inset-right, 0px));
  z-index: 23;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: calc(6 * var(--u));
}
.aoe-account__row {
  display: flex;
  align-items: center;
  gap: calc(8 * var(--u));
  padding: calc(4 * var(--u)) calc(12 * var(--u)) calc(4 * var(--u)) calc(4 * var(--u));
  border: max(2px, calc(3 * var(--u))) solid var(--gs-ink);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
}
.aoe-account__pfp { width: max(22px, calc(30 * var(--u))); height: max(22px, calc(30 * var(--u))); border-radius: 50%; border: 2px solid var(--gs-ink); object-fit: cover; }
.aoe-account__name { font-size: max(11px, calc(15 * var(--u))); color: var(--gs-ink); max-width: 22vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aoe-account__note { font-size: max(10px, calc(13 * var(--u))); color: #ffffff; }
.aoe-account__actions { display: flex; gap: calc(6 * var(--u)); }
.aoe-account__btn,
.aoe-account__login {
  cursor: pointer;
  border: max(2px, calc(3 * var(--u))) solid var(--gs-ink);
  border-radius: calc(12 * var(--u));
  padding: max(4px, calc(6 * var(--u))) max(8px, calc(12 * var(--u)));
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: max(11px, calc(13 * var(--u)));
  color: #ffffff;
  background: linear-gradient(180deg, var(--gs-blue), var(--gs-blue-dark));
  box-shadow: 0 calc(3 * var(--u)) 0 rgba(0, 0, 0, 0.3);
}
.aoe-account__login { background: linear-gradient(180deg, var(--gs-green), var(--gs-green-dark)); padding: max(5px, calc(8 * var(--u))) max(10px, calc(16 * var(--u))); }
.aoe-account__btn:hover, .aoe-account__login:hover { filter: brightness(1.08); }
body.aoe-touch-mode .aoe-account__name { max-width: 30vw; }

/* ---- Friends and Bux rows ----------------------------------------------- */
.aoe-friend { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 2px solid rgba(0, 0, 0, 0.08); }
.aoe-friend:last-of-type { border-bottom: none; }
.aoe-friend__pfp { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--gs-ink); object-fit: cover; flex: none; }
.aoe-friend__name { display: flex; flex-direction: column; line-height: 1.2; flex: 1 1 auto; min-width: 0; }
.aoe-friend__name b, .aoe-friend__name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aoe-friend__status { font-size: 12px; opacity: 0.7; flex: none; }
.aoe-friend__invite, .aoe-bux__buy {
  cursor: pointer;
  flex: none;
  border: 3px solid var(--gs-ink);
  border-radius: 12px;
  padding: 6px 12px;
  color: #fff;
  font: inherit;
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: 12px;
  background: linear-gradient(180deg, var(--gs-green), var(--gs-green-dark));
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.25);
}
.aoe-friend__invite:disabled, .aoe-bux__buy:disabled { filter: saturate(0.3) brightness(0.85); cursor: default; }
.aoe-bux { display: flex; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 2px solid rgba(0, 0, 0, 0.08); }
.aoe-bux:last-of-type { border-bottom: none; }
.aoe-bux__text { display: flex; flex-direction: column; line-height: 1.25; flex: 1 1 auto; }
.aoe-bux__text small { opacity: 0.65; }
.aoe-bux__buy { background: linear-gradient(180deg, var(--gs-orange), var(--gs-orange-dark)); }
.aoe-panel--friends .aoe-panel__head, .aoe-panel--bux .aoe-panel__head { background: linear-gradient(180deg, var(--gs-blue), var(--gs-blue-dark)); }

/* ---- The FPS readout ---------------------------------------------------- */
.aoe-fps {
  position: fixed;
  left: 12px;
  top: 12px;
  z-index: 23;
  font-family: var(--gs-font);
  font-size: 13px;
  color: #ffffff;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.95);
  pointer-events: none;
}
.aoe-fps[hidden] { display: none; }

/* ---- Panels ------------------------------------------------------------- */
.aoe-panel {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(20, 30, 60, 0.35);
  z-index: 40;
}
.aoe-panel[hidden] { display: none; }
/* A PANEL is a white card with a thick dark rim and a coloured header. */
.aoe-panel__box {
  position: relative;
  width: min(640px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border: 5px solid var(--gs-ink);
  border-radius: 22px;
  background: var(--gs-panel);
  box-shadow: 0 14px 0 rgba(0, 0, 0, 0.25), 0 22px 60px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.aoe-panel__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 60px 12px 18px;
  color: #fff;
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: clamp(24px, 3vw, 36px);
  background: linear-gradient(180deg, var(--gs-blue), var(--gs-blue-dark));
  border-bottom: 5px solid var(--gs-ink);
}
.aoe-panel__title { flex: 1; text-align: center; }
.aoe-panel__mark { display: grid; place-items: center; flex: 0 0 auto; }
.aoe-panel__mark .aoe-icon { height: clamp(34px, 4vw, 52px); width: auto; filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.4)); }
.aoe-panel--rebirth .aoe-panel__head { background: linear-gradient(180deg, var(--gs-pink), var(--gs-pink-dark)); }
.aoe-panel--shop .aoe-panel__head { background: linear-gradient(180deg, #ff5a5a, #c92a2a); }
.aoe-panel--backpack .aoe-panel__head { background: linear-gradient(180deg, var(--gs-orange), var(--gs-orange-dark)); }
.aoe-panel__close {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: 4px solid var(--gs-ink);
  border-radius: 12px;
  background: linear-gradient(180deg, #ff5a5a, #c92a2a);
  color: #fff;
  width: 42px;
  height: 42px;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.3);
}
.aoe-panel__close:hover { filter: brightness(1.1); }
.aoe-panel__body {
  padding: 16px 18px 20px;
  overflow-y: auto;
  color: var(--gs-ink);
  font-family: var(--gs-font);
  font-weight: 600;
  font-size: 14px;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0 12px, transparent 12px 24px);
}
.aoe-panel__note { margin-bottom: 12px; line-height: 1.45; text-align: center; }
.aoe-panel__note b { font-size: 16px; }

/* THE COMMIT CONTROL: a green rounded button with a drop. */
.aoe-action {
  width: 100%;
  padding: 14px;
  border: 4px solid var(--gs-ink);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gs-green), var(--gs-green-dark));
  color: #fff;
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 5px 0 rgba(0, 0, 0, 0.3);
  transition: filter 120ms ease;
}
.aoe-action:hover:not(:disabled) { filter: brightness(1.08); }
.aoe-action:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 2px 0 rgba(0, 0, 0, 0.3); }
.aoe-action:disabled { background: linear-gradient(180deg, #b9b9b9, #8d8d8d); color: #f2f2f2; cursor: not-allowed; }

/* ---- The Rebirth panel -------------------------------------------------- */
.aoe-rb { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px 12px; margin-bottom: 14px; }
.aoe-rb__heads { display: grid; grid-template-columns: 1fr auto 1fr; margin-bottom: 8px; text-align: center; font-size: clamp(18px, 2.4vw, 28px); }
.aoe-rb__card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 10px;
  border: 4px solid var(--gs-ink);
  border-radius: 16px;
  font-family: var(--gs-font);
  font-size: clamp(16px, 2.1vw, 26px);
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  box-shadow: 0 5px 0 rgba(0, 0, 0, 0.25);
}
.aoe-rb__card--speed { background: linear-gradient(180deg, var(--gs-blue), var(--gs-blue-dark)); }
.aoe-rb__card--level { background: linear-gradient(180deg, var(--gs-green), var(--gs-green-dark)); }
.aoe-rb__card .aoe-icon { height: 1.3em; width: auto; }
.aoe-rb__arrow { font-size: clamp(22px, 3vw, 34px); justify-self: center; }
.aoe-rb__bar {
  position: relative;
  height: 42px;
  border: 4px solid var(--gs-ink);
  border-radius: 999px;
  background: #ffffff;
  overflow: hidden;
  margin-bottom: 14px;
}
.aoe-rb__fill { height: 100%; background: linear-gradient(90deg, var(--gs-orange), var(--gs-yellow)); transition: width 220ms ease-out; }
.aoe-rb__barlabel {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-size: clamp(15px, 1.7vw, 20px);
}
.aoe-rb__go { font-size: clamp(20px, 2.4vw, 28px); background: linear-gradient(180deg, var(--gs-pink), var(--gs-pink-dark)); }
.aoe-rb__go:disabled { background: linear-gradient(180deg, #b9b9b9, #8d8d8d); }
.aoe-rb__warn { text-align: center; margin: 0 0 12px; color: #c92a2a; font-size: clamp(14px, 1.5vw, 17px); }

/* ---- Backpack tabs ------------------------------------------------------ */
.aoe-tabs { display: flex; justify-content: center; gap: 12px; margin-bottom: 14px; }
.aoe-tab {
  width: 78px;
  height: 78px;
  border: 4px solid var(--gs-ink);
  border-radius: 16px;
  display: grid;
  grid-template-rows: 1fr auto;
  place-items: center;
  padding: 4px;
  cursor: pointer;
  color: #fff;
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: 13px;
  box-shadow: 0 5px 0 rgba(0, 0, 0, 0.25);
  opacity: 0.72;
  background: linear-gradient(180deg, var(--tab-a), var(--tab-b));
}
.aoe-tab .aoe-icon { width: 60%; height: 60%; object-fit: contain; }
.aoe-tab--active { opacity: 1; transform: scale(1.06); }
.aoe-tab--trails { --tab-a: #ffb347; --tab-b: #d9741a; }
.aoe-tab--auras { --tab-a: #ff6b6b; --tab-b: #c92a7a; }
.aoe-tab--charms { --tab-a: #5ed64f; --tab-b: #2f9e2b; }

/* ---- Shop rows ---------------------------------------------------------- */
.aoe-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 4px solid var(--gs-ink);
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #e6e6e6);
  color: var(--gs-ink);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.18);
}
.aoe-row--owned { background: linear-gradient(180deg, #fff6d6, #ffe08a); }
.aoe-row--equipped { background: linear-gradient(180deg, #ffe9a6, #ffc94a); }
.aoe-row--locked { opacity: 0.85; }
.aoe-row__swatch {
  width: 44px;
  height: 44px;
  border: 3px solid var(--gs-ink);
  border-radius: 12px;
  box-shadow: inset 0 0 12px rgba(255, 255, 255, 0.5);
  flex: none;
  display: grid;
  place-items: center;
}
.aoe-row__swatch svg { width: 70%; height: 70%; }
.aoe-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-bottom: 12px; }
.aoe-actions .aoe-row__buy { min-width: 132px; }
.aoe-row__text { flex: 1; min-width: 0; }
.aoe-row__name { font-weight: 700; font-size: clamp(15px, 1.6vw, 20px); }
.aoe-row__meta { font-size: clamp(13px, 1.4vw, 17px); color: #d9741a; }
.aoe-row__meta--speed { color: #1f8f2b; }
.aoe-row__buy {
  border: 4px solid var(--gs-ink);
  border-radius: 14px;
  padding: 9px 14px;
  min-width: 96px;
  background: linear-gradient(180deg, var(--gs-green), var(--gs-green-dark));
  color: #fff;
  font: inherit;
  font-family: var(--gs-font);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.aoe-row__buy .aoe-icon { height: 18px; width: auto; }
.aoe-row__buy--equipped { background: linear-gradient(180deg, #56d4ff, #1fa8e8); }
.aoe-row__buy--unlock { background: linear-gradient(180deg, var(--gs-green), var(--gs-green-dark)); }
.aoe-row__buy:hover:not(:disabled) { filter: brightness(1.08); }
.aoe-row__buy:disabled { background: linear-gradient(180deg, #c4c4c4, #9a9a9a); color: #fff; cursor: not-allowed; }

/* ---- The charm shop ----------------------------------------------------- */
.aoe-shop__timer { text-align: center; font-size: clamp(16px, 1.8vw, 22px); margin-bottom: 14px; color: var(--gs-ink); }
.aoe-shop__timer b { color: #c92a2a; }
.aoe-shop__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.aoe-charm {
  border: 4px solid var(--gs-ink);
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff, #e9e9e9);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 5px 0 rgba(0, 0, 0, 0.2);
}
.aoe-charm__rarity {
  padding: 6px;
  text-align: center;
  color: #fff;
  font-size: 13px;
  letter-spacing: 0.04em;
  border-bottom: 4px solid var(--gs-ink);
  background: var(--rarity, #888);
}
.aoe-charm--common { --rarity: #8a9bb0; }
.aoe-charm--rare { --rarity: #3fa9ff; }
.aoe-charm--epic { --rarity: #9b6bff; }
.aoe-charm--legendary { --rarity: #ffa62b; }
.aoe-charm--mythic { --rarity: #ff4d8d; }
.aoe-charm__icon { display: grid; place-items: center; padding: 12px 0 6px; }
.aoe-charm__icon svg { width: 54px; height: 54px; filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.3)); }
.aoe-charm__name { text-align: center; font-size: 15px; padding: 0 8px; }
.aoe-charm__effect { text-align: center; font-size: 14px; color: #1f8f2b; padding: 2px 8px 8px; }
.aoe-charm__buy { margin: auto 8px 10px; }
.aoe-charm--empty { opacity: 0.6; justify-content: center; align-items: center; min-height: 160px; }
@media (max-width: 560px) { .aoe-shop__grid { grid-template-columns: 1fr; } }

/* ---- Speed-gain popups -------------------------------------------------- */
.aoe-pops { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 19; }
.aoe-pop {
  --aoe-pop-tilt: 0deg;
  --aoe-pop-scale: 1;
  position: absolute;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  opacity: 0;
  will-change: transform, opacity;
}
.aoe-pop[hidden] { display: none; }
.aoe-pop__icon { height: clamp(28px, 3.2vw, 44px); width: auto; filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45)); }
.aoe-pop__value { font-family: var(--gs-font); font-weight: 700; font-size: clamp(18px, 2.2vw, 30px); line-height: 1; color: #ffffff;
  text-shadow: 2px 0 0 var(--gs-ink), -2px 0 0 var(--gs-ink), 0 2px 0 var(--gs-ink), 0 -2px 0 var(--gs-ink), 2px 2px 0 var(--gs-ink), -2px 2px 0 var(--gs-ink), 2px -2px 0 var(--gs-ink), -2px -2px 0 var(--gs-ink); }
.aoe-pop--run { animation: aoe-pop-float 1150ms ease-out forwards; }
@keyframes aoe-pop-float {
  0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--aoe-pop-tilt)) scale(calc(var(--aoe-pop-scale) * 0.6)); }
  16% { opacity: 1; transform: translate(-50%, -54%) rotate(var(--aoe-pop-tilt)) scale(calc(var(--aoe-pop-scale) * 1.1)); }
  30% { opacity: 1; transform: translate(-50%, -62%) rotate(var(--aoe-pop-tilt)) scale(var(--aoe-pop-scale)); }
  100% { opacity: 0; transform: translate(-50%, -125%) rotate(var(--aoe-pop-tilt)) scale(var(--aoe-pop-scale)); }
}


@media (prefers-reduced-motion: reduce) {
  .aoe-tile, .aoe-wins--pop .aoe-wins__value { transition: none; animation: none; }
  .aoe-pop--run { animation: aoe-pop-fade 1150ms ease-out forwards; }
  @keyframes aoe-pop-fade {
    0% { opacity: 0; transform: translate(-50%, -50%); }
    15%, 65% { opacity: 1; transform: translate(-50%, -50%); }
    100% { opacity: 0; transform: translate(-50%, -50%); }
  }
}

/* A short screen: menus may use nearly all of its height (their bodies scroll). */
@media (max-height: 500px) {
  .aoe-panel__box { max-height: 94vh; }
}

/*
 * THE PORTAL'S CORNER, RESERVED. The portal draws its own controls in the
 * top-left; the HUD's top edge (--aoe-portal-top) moves down past them.
 */
body.aoe-portal-embedded { --aoe-portal-top: 58px; --aoe-portal-left: 248px; }
`;
  document.head.appendChild(style);
};

/** The HUD icons, as supplied in `assets/ui/`. Never regenerated. */
const icon = (file: string): string =>
  `<img class="aoe-icon" src="/ui/${file}" alt="" draggable="false">`;


/** A gold star: the multiplier mark in the menus. */
export const STAR_ICON =
  '<svg class="aoe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="#ffd21f" stroke="#1c2233" stroke-width="1.4" stroke-linejoin="round" d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>' +
  '</svg>';

/** A crossed-katana mark, for damage. */
export const SWORD_ICON =
  '<svg class="aoe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="#e8eef5" stroke="#1c2233" stroke-width="1.3" stroke-linejoin="round" d="M19.5 2.5l2 2-11 11-2-2z"/>' +
  '<path fill="#e0342b" stroke="#1c2233" stroke-width="1.3" d="M6.2 14.3l3.5 3.5-1.6 1.6-3.5-3.5z"/>' +
  '<path fill="#3a2a1c" stroke="#1c2233" stroke-width="1.3" d="M5.4 17.2l1.4 1.4-3.2 3.2-1.4-1.4z"/>' +
  '</svg>';

/** A torii gate, for the teleport menu. */
export const TORII_ICON =
  '<svg class="aoe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="#e0342b" stroke="#1c2233" stroke-width="1.2" stroke-linejoin="round" d="M2 4.5c4 1 16 1 20 0v2.6c-1 .3-2 .5-3 .6V9h-1.6v12h-2.6V9H9.2v12H6.6V9H5V7.7c-1-.1-2-.3-3-.6z"/>' +
  '<path fill="#e0342b" stroke="#1c2233" stroke-width="1.2" d="M4.6 10.4h14.8v2H4.6z"/>' +
  '</svg>';

export const ICONS = {
  trophy: icon('trophy.png'),
  rebirth: icon('rebirth.png'),
  bag: icon('inventory.png'),
  shop: icon('shop.png'),
  /** The supplied speaker, for Music on and (struck through) Music off. */
  audio: icon('Sound.png'),
  sword: SWORD_ICON,
  torii: TORII_ICON,
} as const;
