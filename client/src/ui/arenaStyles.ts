import { injectHudStyles } from './hudStyles.js';

/**
 * THE ARENA HUD'S LOOK, from the reference: heavy italic display type in
 * white with a thick dark rim, dark diamond ability keys over a red health
 * bar bottom-left, chunky square Store / Inventory / Settings tiles under
 * them, Yen in yellow bottom-right, a big green PLAY! bar bottom-centre in
 * the lobby, and a dark rounded inventory card with a glowing gold rim.
 *
 * Every size is a multiple of --u (hudStyles), so the HUD scales as one on a
 * desktop window and on a phone held landscape.
 *
 * NO BACKTICKS ANYWHERE IN THIS STYLESHEET: it is a template literal.
 */
let injected = false;

export const injectArenaStyles = (): void => {
  if (injected) return;
  injected = true;
  injectHudStyles();
  const style = document.createElement('style');
  style.textContent = `
.ar-font { font-family: var(--gs-font); font-weight: 700; font-style: italic; }
.ar-outline {
  color: #fff;
  text-shadow:
    2px 0 0 #10131f, -2px 0 0 #10131f, 0 2px 0 #10131f, 0 -2px 0 #10131f,
    2px 2px 0 #10131f, -2px 2px 0 #10131f, 2px -2px 0 #10131f, -2px -2px 0 #10131f,
    0 4px 6px rgba(0, 0, 0, 0.35);
}

/* ---- bottom-left: health, abilities, menu tiles ---------------------- */
.ar-left {
  position: fixed;
  left: max(10px, calc(24 * var(--u)), env(safe-area-inset-left, 0px));
  bottom: max(8px, calc(18 * var(--u)), env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: calc(8 * var(--u));
  z-index: 21;
  pointer-events: none;
  user-select: none;
}
.ar-hp {
  position: relative;
  width: calc(380 * var(--u));
  height: calc(40 * var(--u));
  margin-left: calc(20 * var(--u));
  border: calc(3 * var(--u)) solid #10131f;
  border-radius: calc(6 * var(--u));
  background: #3a0a0a;
  overflow: visible;
  box-shadow: 0 calc(3 * var(--u)) 0 rgba(0,0,0,0.3);
}
.ar-hp__fill { position: absolute; inset: 0; right: auto; width: 100%; background: linear-gradient(180deg, #e33a3a, #9e1414); transition: width 120ms ease; border-radius: calc(3 * var(--u)); }
.ar-hp__ghost { position: absolute; inset: 0; right: auto; width: 100%; background: rgba(255,255,255,0.55); transition: width 600ms ease 200ms; border-radius: calc(3 * var(--u)); }
.ar-hp__text { position: absolute; inset: 0; display: grid; place-items: center; font-size: calc(24 * var(--u)); }
.ar-hp__heart {
  position: absolute; left: calc(-30 * var(--u)); top: 50%;
  width: calc(46 * var(--u)); height: calc(46 * var(--u));
  transform: translateY(-50%) rotate(45deg);
  background: linear-gradient(135deg, #ff5a5a, #8a1010);
  border: calc(3 * var(--u)) solid #10131f;
  border-radius: calc(8 * var(--u));
  display: grid; place-items: center;
}
.ar-hp__heart svg { width: 58%; height: 58%; transform: rotate(-45deg); }
.ar-hp--low .ar-hp__fill { animation: ar-pulse 0.6s ease-in-out infinite alternate; }
@keyframes ar-pulse { from { filter: brightness(1); } to { filter: brightness(1.6); } }
.ar-buff { font-size: calc(18 * var(--u)); margin-left: calc(22 * var(--u)); }
.ar-buff[hidden] { display: none; }
.ar-abilities-title { font-size: calc(30 * var(--u)); margin-left: calc(8 * var(--u)); margin-top: calc(2 * var(--u)); }
.ar-keys { display: flex; align-items: flex-start; gap: calc(10 * var(--u)); padding-left: calc(6 * var(--u)); }
.ar-key { position: relative; width: calc(118 * var(--u)); display: flex; flex-direction: column; align-items: center; }
.ar-key__gem {
  position: relative;
  /* Rotated 45deg the square reaches ~21% past its box: keep that clear of the label. */
  margin: calc(15 * var(--u)) 0;
  width: calc(70 * var(--u)); height: calc(70 * var(--u));
  transform: rotate(45deg);
  border: calc(3 * var(--u)) solid #10131f;
  border-radius: calc(12 * var(--u));
  background: linear-gradient(135deg, #5b6070, #2a2d38);
  box-shadow: 0 calc(4 * var(--u)) 0 rgba(0,0,0,0.35), inset 0 calc(3 * var(--u)) 0 rgba(255,255,255,0.12);
  overflow: hidden;
}
.ar-key__shade { --cd: 0deg; position: absolute; inset: -30%; background: conic-gradient(rgba(0,0,0,0.65) var(--cd), transparent 0); transform: rotate(-45deg); }
.ar-key__bind { position: absolute; inset: 0; display: grid; place-items: center; transform: rotate(-45deg); font-size: calc(32 * var(--u)); }
.ar-key__timer { position: absolute; inset: 0; display: grid; place-items: center; transform: rotate(-45deg); font-size: calc(26 * var(--u)); color: #fff; }
.ar-key__name { margin-top: calc(2 * var(--u)); font-size: calc(18 * var(--u)); line-height: 1.1; text-align: center; width: calc(118 * var(--u)); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ar-key.is-cooling .ar-key__bind { opacity: 0.3; }
.ar-key.is-ready .ar-key__gem { animation: ar-ready 360ms ease-out; }
@keyframes ar-ready { 0% { filter: brightness(2.2); } 100% { filter: brightness(1); } }
.ar-key--ult .ar-key__gem { background: linear-gradient(135deg, #ffcf4a, #b8620a); }
.ar-key--skill .ar-key__gem { background: linear-gradient(135deg, #9c7bff, #4a2aa8); }
.ar-key--small { width: calc(76 * var(--u)); }
.ar-key--small .ar-key__name { width: calc(76 * var(--u)); }
.ar-key--small .ar-key__gem { width: calc(50 * var(--u)); height: calc(50 * var(--u)); margin: calc(25 * var(--u)) 0; }
.ar-key--small .ar-key__bind { font-size: calc(12 * var(--u)); letter-spacing: 0.02em; }
.ar-key--small .ar-key__name { font-size: calc(18 * var(--u)); margin-top: calc(-8 * var(--u)); }
body.aoe-touch-mode .ar-keys, body.aoe-touch-mode .ar-abilities-title { display: none; }

.ar-tiles { display: flex; gap: calc(16 * var(--u)); pointer-events: auto; margin-top: calc(4 * var(--u)); }
.ar-tile {
  position: relative;
  width: calc(108 * var(--u)); height: calc(100 * var(--u));
  border: calc(4 * var(--u)) solid #10131f;
  border-radius: calc(8 * var(--u));
  cursor: pointer;
  display: grid; place-items: center;
  box-shadow: 0 calc(4 * var(--u)) 0 rgba(0,0,0,0.3);
  padding: 0;
}
.ar-tile:hover { filter: brightness(1.1); }
.ar-tile:active { transform: translateY(calc(3 * var(--u))); }
.ar-tile img, .ar-tile svg { width: 72%; height: 72%; object-fit: contain; filter: drop-shadow(0 3px 3px rgba(0,0,0,0.4)); }
.ar-tile__label { position: absolute; left: 50%; bottom: calc(-14 * var(--u)); transform: translateX(-50%); font-size: calc(26 * var(--u)); white-space: nowrap; }
.ar-tile__key { position: absolute; top: calc(4 * var(--u)); left: calc(6 * var(--u)); font-size: calc(15 * var(--u)); opacity: 0.85; }
body.aoe-touch-mode .ar-tile__key { display: none; }
.ar-tile--store { background: linear-gradient(180deg, #a01818, #5e0a0a); }
.ar-tile--inventory { background: linear-gradient(180deg, #9a7a14, #5a4408); }
.ar-tile--settings { background: linear-gradient(180deg, #4a1aa0, #28086a); }

/* In touch mode the right-hand buttons own the bottom right; the left column shrinks. */
body.aoe-touch-mode .ar-hp { width: calc(300 * var(--u)); }
/* On a phone the thumb stick owns the bottom left: health and the menu tiles move to the top left. */
body.aoe-touch-mode .ar-left { bottom: auto; top: max(8px, env(safe-area-inset-top, 0px)); left: max(10px, env(safe-area-inset-left, 0px)); flex-direction: column-reverse; }
body.aoe-touch-mode .ar-tiles { margin-top: 0; margin-bottom: calc(18 * var(--u)); gap: calc(30 * var(--u)); }
body.aoe-touch-mode .ar-tile { width: calc(88 * var(--u)); height: calc(80 * var(--u)); }
body.aoe-touch-mode .ar-feed { top: max(96px, calc(150 * var(--u))); }

/* ---- bottom-right: Yen -------------------------------------------------- */
.ar-yen {
  position: fixed;
  right: max(12px, calc(28 * var(--u)), env(safe-area-inset-right, 0px));
  bottom: max(8px, calc(16 * var(--u)), env(safe-area-inset-bottom, 0px));
  font-size: calc(56 * var(--u));
  color: #ffd21f;
  z-index: 21;
  pointer-events: none;
  line-height: 1;
}
.ar-yen--pop { animation: ar-pop 420ms ease-out; }
@keyframes ar-pop { 0% { transform: scale(1); } 35% { transform: scale(1.25); } 100% { transform: scale(1); } }
body.aoe-touch-mode .ar-yen { bottom: auto; top: max(52px, calc(84 * var(--u))); font-size: calc(46 * var(--u)); }
.ar-gain {
  position: fixed;
  z-index: 26;
  pointer-events: none;
  font-size: calc(30 * var(--u));
  color: #ffd21f;
  white-space: nowrap;
  animation: ar-gain 1.1s ease-out forwards;
}
@keyframes ar-gain { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.6); } 15% { opacity: 1; transform: translate(-50%, -10px) scale(1.15); } 100% { opacity: 0; transform: translate(-50%, -70px) scale(1); } }

/* ---- lobby: Equipped + PLAY! ------------------------------------------ */
.ar-play {
  position: fixed;
  left: 50%;
  bottom: max(10px, calc(56 * var(--u)), env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: calc(8 * var(--u));
  z-index: 21;
}
.ar-play[hidden] { display: none; }
.ar-play__equipped { font-size: calc(30 * var(--u)); pointer-events: none; }
.ar-play__row { display: flex; align-items: center; }
.ar-play__star { width: calc(84 * var(--u)); height: calc(84 * var(--u)); margin-right: calc(-34 * var(--u)); z-index: 1; filter: drop-shadow(0 3px 3px rgba(0,0,0,0.5)); }
.ar-play__button {
  min-width: calc(330 * var(--u));
  padding: calc(10 * var(--u)) calc(60 * var(--u));
  border: calc(4 * var(--u)) solid #1ec23a;
  outline: calc(3 * var(--u)) solid #062a0c;
  background: linear-gradient(180deg, #0b5a1a, #06360f);
  clip-path: polygon(6% 0, 100% 0, 100% 100%, 0 100%, 0 30%);
  font-size: calc(48 * var(--u));
  cursor: pointer;
  pointer-events: auto;
  line-height: 1.05;
}
.ar-play__button:hover { filter: brightness(1.2); }
.ar-play__button:active { transform: translateY(calc(3 * var(--u))); }
body.aoe-touch-mode .ar-play { bottom: auto; top: 58%; }

/* ---- the pedestal prompt ----------------------------------------------- */
.ar-prompt {
  position: fixed;
  left: 50%;
  bottom: calc(210 * var(--u));
  transform: translateX(-50%);
  z-index: 22;
  display: flex; align-items: center; gap: calc(10 * var(--u));
  padding: calc(8 * var(--u)) calc(20 * var(--u));
  border: calc(3 * var(--u)) solid #10131f;
  border-radius: calc(12 * var(--u));
  background: rgba(20, 22, 34, 0.88);
  font-size: calc(26 * var(--u));
  cursor: pointer;
  pointer-events: auto;
}
.ar-prompt[hidden] { display: none; }
.ar-prompt__key { display: inline-grid; place-items: center; min-width: calc(34 * var(--u)); height: calc(34 * var(--u)); border-radius: calc(6 * var(--u)); background: #fff; color: #10131f; font-style: normal; font-size: calc(22 * var(--u)); }
body.aoe-touch-mode .ar-prompt__key { display: none; }
.ar-prompt--buy { border-color: #1ec23a; }
.ar-prompt--poor { border-color: #c92a2a; }

/* ---- killfeed, top right ---------------------------------------------- */
.ar-feed {
  position: fixed;
  top: max(64px, calc(90 * var(--u)));
  right: max(10px, calc(18 * var(--u)), env(safe-area-inset-right, 0px));
  display: flex; flex-direction: column; align-items: flex-end; gap: calc(6 * var(--u));
  z-index: 21; pointer-events: none;
}
.ar-feed__row {
  display: flex; align-items: center; gap: calc(8 * var(--u));
  padding: calc(4 * var(--u)) calc(12 * var(--u));
  border-radius: calc(8 * var(--u));
  background: rgba(12, 14, 24, 0.7);
  font-size: calc(19 * var(--u));
  animation: ar-feed 5s ease forwards;
}
.ar-feed__row b { color: #ff6b5a; }
.ar-feed__row i { color: #9fe8ff; font-style: italic; }
.ar-feed__row--me { outline: calc(2 * var(--u)) solid #ffd21f; }
@keyframes ar-feed { 0% { opacity: 0; transform: translateX(20px); } 6% { opacity: 1; transform: none; } 85% { opacity: 1; } 100% { opacity: 0; } }

/* ---- big centre messages ---------------------------------------------- */
.ar-banner {
  position: fixed; left: 50%; top: 24%;
  transform: translateX(-50%);
  z-index: 24; pointer-events: none; text-align: center;
}
.ar-banner[hidden] { display: none; }
.ar-banner__title { font-size: calc(76 * var(--u)); line-height: 1; }
.ar-banner__sub { font-size: calc(30 * var(--u)); margin-top: calc(8 * var(--u)); }
.ar-banner--death .ar-banner__title { color: #ff4040; }
.ar-banner--show { animation: ar-banner 480ms cubic-bezier(.2,1.6,.4,1); }
@keyframes ar-banner { from { transform: translateX(-50%) scale(0.4); opacity: 0; } to { transform: translateX(-50%) scale(1); opacity: 1; } }
.ar-death-veil { position: fixed; inset: 0; z-index: 19; pointer-events: none; background: radial-gradient(ellipse at center, rgba(40,0,0,0) 30%, rgba(60,0,0,0.55) 100%); opacity: 0; transition: opacity 300ms ease; }
.ar-death-veil--on { opacity: 1; }
.ar-hurt { position: fixed; inset: 0; z-index: 19; pointer-events: none; box-shadow: inset 0 0 calc(160 * var(--u)) rgba(255, 20, 20, 0.85); opacity: 0; }
.ar-hurt--flash { animation: ar-hurt 420ms ease-out; }
@keyframes ar-hurt { from { opacity: 1; } to { opacity: 0; } }
.ar-flash { position: fixed; inset: 0; z-index: 30; pointer-events: none; background: #fff; opacity: 0; }
.ar-flash--on { animation: ar-flash 700ms ease-out; }
@keyframes ar-flash { 0% { opacity: 0; } 20% { opacity: 1; } 100% { opacity: 0; } }
.ar-streak { position: fixed; left: 50%; top: 15%; transform: translateX(-50%); z-index: 24; pointer-events: none; font-size: calc(40 * var(--u)); color: #ffd21f; }
.ar-streak--show { animation: ar-streak 1.6s ease forwards; }
@keyframes ar-streak { 0% { opacity: 0; transform: translateX(-50%) scale(0.5); } 12% { opacity: 1; transform: translateX(-50%) scale(1.2); } 25% { transform: translateX(-50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }

/* ---- the alert ribbon (unlocks) --------------------------------------- */
.ar-alert {
  position: fixed; left: 50%; top: 12%;
  transform: translateX(-50%);
  z-index: 25; pointer-events: none;
  display: flex; align-items: center;
}
.ar-alert[hidden] { display: none; }
.ar-alert--show { animation: ar-alert 3.2s ease forwards; }
@keyframes ar-alert { 0% { opacity: 0; transform: translateX(-50%) translateY(-20px); } 8% { opacity: 1; transform: translateX(-50%); } 85% { opacity: 1; } 100% { opacity: 0; } }
.ar-alert__star { width: calc(90 * var(--u)); height: calc(90 * var(--u)); margin-right: calc(-40 * var(--u)); z-index: 1; filter: drop-shadow(0 3px 3px rgba(0,0,0,0.5)); }
.ar-alert__body {
  min-width: calc(460 * var(--u));
  padding: calc(10 * var(--u)) calc(90 * var(--u)) calc(12 * var(--u)) calc(56 * var(--u));
  background: linear-gradient(180deg, #3a3a3a, #1c1c1c);
  clip-path: polygon(3% 0, 100% 0, 97% 100%, 0 100%);
  text-align: center;
}
.ar-alert__title { font-size: calc(34 * var(--u)); }
.ar-alert__text { font-size: calc(24 * var(--u)); }
.ar-alert__face { width: calc(96 * var(--u)); height: calc(96 * var(--u)); margin-left: calc(-60 * var(--u)); transform: rotate(45deg); border: calc(4 * var(--u)) solid #555; overflow: hidden; background: #111; }
.ar-alert__face img { width: 142%; height: 142%; margin: -21%; transform: rotate(-45deg); }

/* ---- floating damage numbers, hit marker ------------------------------ */
.ar-dmg { position: fixed; z-index: 23; pointer-events: none; font-size: calc(34 * var(--u)); white-space: nowrap; transform: translate(-50%, -50%); }
.ar-dmg--big { font-size: calc(48 * var(--u)); color: #ffd21f; }
.ar-dmg--me { color: #ff5a5a; }
.ar-dmg--blocked { color: #9fdcff; font-size: calc(26 * var(--u)); }
.ar-marker { position: fixed; left: 50%; top: 50%; width: calc(34 * var(--u)); height: calc(34 * var(--u)); transform: translate(-50%, -50%) rotate(45deg); z-index: 23; pointer-events: none; opacity: 0; }
.ar-marker::before, .ar-marker::after { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: calc(4 * var(--u)); margin-left: calc(-2 * var(--u)); background: linear-gradient(#fff 0 35%, transparent 35% 65%, #fff 65%); }
.ar-marker::after { transform: rotate(90deg); }
.ar-marker--hit { animation: ar-marker 220ms ease-out; }
@keyframes ar-marker { from { opacity: 1; transform: translate(-50%, -50%) rotate(45deg) scale(1.4); } to { opacity: 0; transform: translate(-50%, -50%) rotate(45deg) scale(1); } }
.ar-cross { position: fixed; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255,255,255,0.85); box-shadow: 0 0 0 2px rgba(0,0,0,0.4); z-index: 20; pointer-events: none; }
.ar-cross[hidden] { display: none; }
.ar-toasts { position: fixed; left: 50%; top: 30%; transform: translateX(-50%); z-index: 24; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ar-toast { font-size: calc(28 * var(--u)); animation: ar-feed 2.4s ease forwards; white-space: nowrap; }
.ar-toast--bad { color: #ff7a6a; }
.ar-toast--good { color: #7dff7a; }
.ar-toast--gold { color: #ffd21f; }
.ar-zone { position: fixed; left: 50%; top: 9%; transform: translateX(-50%); z-index: 21; pointer-events: none; font-size: calc(44 * var(--u)); letter-spacing: 0.06em; }
.ar-zone--show { animation: ar-streak 2.2s ease forwards; }
.ar-zone:not(.ar-zone--show) { opacity: 0; }

/* ---- the inventory ---------------------------------------------------- */
.aoe-panel--inventory { background: rgba(10, 14, 30, 0.35); }
.aoe-panel--inventory .aoe-panel__box {
  width: min(1180px, 96vw);
  max-height: 90vh;
  background: #141414;
  border: calc(5 * var(--u)) solid #ffc21a;
  border-radius: calc(26 * var(--u));
  box-shadow: 0 0 calc(22 * var(--u)) rgba(255, 170, 20, 0.65), 0 calc(20 * var(--u)) calc(60 * var(--u)) rgba(0,0,0,0.5);
  overflow: visible;
}
.aoe-panel--inventory .aoe-panel__head {
  justify-content: flex-start;
  background: linear-gradient(100deg, #b8860b, #ffcf3a 40%, #d49a10);
  border: none;
  margin: calc(-30 * var(--u)) auto 0 calc(-14 * var(--u));
  width: calc(430 * var(--u));
  clip-path: polygon(0 0, 100% 0, 94% 100%, 0 100%);
  font-style: italic;
  font-size: calc(46 * var(--u));
  padding: calc(8 * var(--u)) calc(20 * var(--u));
  text-shadow: 2px 2px 0 #10131f, -2px -2px 0 #10131f, 2px -2px 0 #10131f, -2px 2px 0 #10131f;
}
.aoe-panel--inventory .aoe-panel__title { text-align: left; }
.aoe-panel--inventory .aoe-panel__close {
  top: calc(-6 * var(--u)); right: calc(-12 * var(--u));
  position: fixed; display: none;
}
.aoe-panel--inventory .aoe-panel__body { background: none; color: #fff; padding: calc(16 * var(--u)) calc(26 * var(--u)) calc(26 * var(--u)); overflow: auto; }
.ar-inv__close {
  position: absolute; top: calc(-28 * var(--u)); right: calc(-18 * var(--u));
  width: calc(66 * var(--u)); height: calc(66 * var(--u));
  transform: rotate(45deg);
  border: calc(4 * var(--u)) solid #10131f; border-radius: calc(10 * var(--u));
  background: linear-gradient(135deg, #e0406a, #8a0f33);
  color: #fff; font-size: calc(30 * var(--u)); cursor: pointer; z-index: 2;
  font-family: var(--gs-font); font-weight: 700;
}
.ar-inv__close span { display: block; transform: rotate(-45deg); }
.ar-inv { display: grid; grid-template-columns: 1fr calc(330 * var(--u)); gap: calc(26 * var(--u)); }
.ar-inv__section { font-size: calc(34 * var(--u)); border-bottom: calc(3 * var(--u)) solid #ffc21a; padding-bottom: calc(6 * var(--u)); margin-bottom: calc(14 * var(--u)); }
.ar-inv__grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: calc(18 * var(--u)) calc(12 * var(--u)); max-height: 60vh; overflow-y: auto; padding: calc(10 * var(--u)) calc(4 * var(--u)); }
.ar-card { position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer; background: none; border: none; padding: 0; color: #fff; }
.ar-card__name { font-size: calc(24 * var(--u)); color: #ff8f8f; white-space: nowrap; margin-bottom: calc(-10 * var(--u)); z-index: 1; }
.ar-card__face { width: calc(128 * var(--u)); height: calc(128 * var(--u)); border-radius: 50%; }
.ar-card--selected .ar-card__face { outline: calc(4 * var(--u)) solid #ffd21f; outline-offset: calc(2 * var(--u)); }
.ar-card--locked .ar-card__face { filter: grayscale(0.55) brightness(0.8); }
.ar-card__btn {
  margin-top: calc(-18 * var(--u));
  min-width: calc(120 * var(--u));
  padding: calc(4 * var(--u)) calc(10 * var(--u));
  border: calc(3 * var(--u)) solid #10131f;
  border-radius: calc(6 * var(--u));
  font-size: calc(18 * var(--u));
  background: repeating-linear-gradient(135deg, #6fdc2a 0 10px, #56c21a 10px 20px);
  z-index: 1;
}
.ar-card__btn--equip { background: repeating-linear-gradient(135deg, #f2f2f2 0 10px, #d6d6d6 10px 20px); color: #333; text-shadow: none; }
.ar-card__btn--price { background: repeating-linear-gradient(135deg, #6fdc2a 0 10px, #56c21a 10px 20px); }
.ar-card__btn--poor { background: repeating-linear-gradient(135deg, #7a7a7a 0 10px, #5e5e5e 10px 20px); }
.ar-card__new { position: absolute; top: calc(22 * var(--u)); right: calc(2 * var(--u)); font-size: calc(16 * var(--u)); color: #ffd21f; transform: rotate(12deg); }
.ar-detail {
  align-self: start;
  border: calc(5 * var(--u)) solid #ffc21a;
  border-radius: calc(26 * var(--u));
  background: #141414;
  box-shadow: 0 0 calc(16 * var(--u)) rgba(255, 170, 20, 0.5);
  padding: calc(18 * var(--u));
  display: flex; flex-direction: column; align-items: center; gap: calc(6 * var(--u));
}
.ar-detail__name { font-size: calc(40 * var(--u)); color: #ff8f8f; }
.ar-detail__face { width: calc(200 * var(--u)); height: calc(200 * var(--u)); border-radius: 50%; }
.ar-detail__moves { font-size: calc(26 * var(--u)); color: #d8d8d8; }
.ar-detail__move { width: 100%; text-align: left; }
.ar-detail__move b { font-size: calc(20 * var(--u)); color: #fff; }
.ar-detail__move p { margin: calc(2 * var(--u)) 0 calc(6 * var(--u)); font-size: calc(15 * var(--u)); font-style: normal; font-weight: 600; color: #bfbfbf; line-height: 1.3; }
.ar-detail__move small { color: #ffd21f; font-size: calc(14 * var(--u)); }
.ar-detail__btn { margin-top: calc(6 * var(--u)); min-width: calc(200 * var(--u)); font-size: calc(26 * var(--u)); padding: calc(6 * var(--u)) calc(16 * var(--u)); }
.ar-inv__yen { font-size: calc(26 * var(--u)); color: #ffd21f; text-align: right; margin-top: calc(-44 * var(--u)); margin-bottom: calc(10 * var(--u)); }
@media (max-aspect-ratio: 4/3) {
  .ar-inv { grid-template-columns: 1fr; }
  .ar-inv__grid { grid-template-columns: repeat(4, 1fr); max-height: 38vh; }
}
body.aoe-touch-mode .ar-inv__grid { grid-template-columns: repeat(5, 1fr); max-height: 58vh; }

/* ---- settings --------------------------------------------------------- */
.aoe-panel--settings .aoe-panel__head { background: linear-gradient(180deg, #7a3aff, #3e14a8); }
.ar-set { display: flex; flex-direction: column; gap: 12px; }
.ar-set__row { display: flex; align-items: center; justify-content: space-between; gap: 14px; font-size: 18px; }
.ar-set__toggle { min-width: 96px; padding: 8px 14px; border: 3px solid #10131f; border-radius: 10px; font-family: var(--gs-font); font-weight: 700; font-size: 16px; cursor: pointer; color: #fff; background: linear-gradient(180deg, #5ed64f, #2f9e2b); }
.ar-set__toggle--off { background: linear-gradient(180deg, #b9b9b9, #8d8d8d); }
.ar-set__range { width: 180px; }
.ar-set__help { font-size: 14px; line-height: 1.5; color: #333; background: #fff; border-radius: 10px; padding: 10px 12px; border: 2px solid #ddd; }
`;
  document.head.appendChild(style);
};

/** The four-point star mark on the PLAY bar and the alert ribbon. */
export const STAR_MARK =
  '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 2 L62 38 L98 50 L62 62 L50 98 L38 62 L2 50 L38 38 Z" fill="#10131f"/>' +
  '<path d="M50 12 L59 41 L88 50 L59 59 L50 88 L41 59 L12 50 L41 41 Z" fill="#2ee86a"/>' +
  '<path d="M50 28 L55 45 L72 50 L55 55 L50 72 L45 55 L28 50 L45 45 Z" fill="#eaffea"/></svg>';

export const STAR_MARK_GREY =
  '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 2 L62 38 L98 50 L62 62 L50 98 L38 62 L2 50 L38 38 Z" fill="#10131f"/>' +
  '<path d="M50 12 L59 41 L88 50 L59 59 L50 88 L41 59 L12 50 L41 41 Z" fill="#dcdcdc"/>' +
  '<path d="M50 28 L55 45 L72 50 L55 55 L50 72 L45 55 L28 50 L45 45 Z" fill="#555"/></svg>';

export const HEART =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M12 21s-7.5-4.6-9.6-9.2C.8 8.3 3 4.5 6.6 4.5c2 0 3.6 1.1 5.4 3.1 1.8-2 3.4-3.1 5.4-3.1 3.6 0 5.8 3.8 4.2 7.3C19.5 16.4 12 21 12 21z"/></svg>';

export const GEAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#b98cff" stroke="#10131f" stroke-width="1.2" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.8 7.8 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.8 7.8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.8 7.8 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.8 7.8 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
