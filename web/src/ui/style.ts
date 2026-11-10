// Styles for the pixel UI. All sizes are multiples of --u (one art pixel on screen) so every
// frame, icon and gap lands on the same pixel grid. Motion uses stepped easing to stay in style.
export const CSS = /* css */ `
:root { --u: 3px; --ink: #2b1d14; --cream: #fff6dc; --paper: #f6e7c3; --leaf: #5cab3a; --berry: #d8433f; --gold: #f2b632; --sky: #5aa9e6; --mute: #8a6f52; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; overflow: hidden; background: #1b2a1b; overscroll-behavior: none; }
body { font-family: 'Pixelify Sans', ui-rounded, system-ui, sans-serif; font-size: calc(var(--u) * 5.4); line-height: 1.22; color: var(--ink);
  user-select: none; -webkit-user-select: none; touch-action: manipulation; }
#world { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
#ui { position: fixed; inset: 0; pointer-events: none; overflow: hidden;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
#ui > * { pointer-events: auto; }
img.ico, .px { image-rendering: pixelated; }
img.ico { width: calc(var(--u) * 12); height: calc(var(--u) * 12); flex: none; display: block; }
img.ico.s { width: calc(var(--u) * 8); height: calc(var(--u) * 8); }
.num { font-family: 'Silkscreen', monospace; letter-spacing: 0; }
button, input, textarea { font: inherit; color: inherit; }
input, textarea { user-select: text; -webkit-user-select: text; }

/* ---- nine-slice frames */
.fr { border-style: solid; border-width: calc(var(--u) * 6); border-image-slice: 6 fill; border-image-repeat: stretch; image-rendering: pixelated; }
.fr.sm { border-width: calc(var(--u) * 4); border-image-slice: 4 fill; }
.wood { border-image-source: var(--f-wood); color: var(--cream); }
.paper { border-image-source: var(--f-paper); }
.slot { border-image-source: var(--f-slot); }
.slot.on { border-image-source: var(--f-slotOn); }
.dark { border-image-source: var(--f-dark); color: #fffdf5; }
.bubblef { border-image-source: var(--f-bubble); }
.field { border-image-source: var(--f-field); }
.grain { position: relative; }
.grain::before { content: ''; position: absolute; inset: calc(var(--u) * -3); background: var(--f-grain) 0 0 / calc(var(--u) * 16) calc(var(--u) * 8); image-rendering: pixelated; pointer-events: none; }
.flecks { background: var(--f-flecks) 0 0 / calc(var(--u) * 16) calc(var(--u) * 16); image-rendering: pixelated; }

/* ---- buttons: a slab that physically sinks when pressed */
.btn { --b: var(--b-wood); --bd: var(--b-wood-down); border-style: solid; border-width: calc(var(--u) * 4) calc(var(--u) * 5) calc(var(--u) * 6);
  border-image: var(--b) 4 5 6 5 fill / calc(var(--u) * 4) calc(var(--u) * 5) calc(var(--u) * 6) stretch; image-rendering: pixelated;
  background: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: calc(var(--u) * 2);
  min-height: calc(var(--u) * 15); padding: 0 calc(var(--u) * 1.5); font-weight: 700; color: #fffdf5; text-shadow: 0 var(--u) 0 #0000004d; white-space: nowrap; }
.btn:active:not(:disabled), .btn.down { border-image-source: var(--bd); }
.btn:active:not(:disabled) > *, .btn.down > * { transform: translateY(calc(var(--u) * 2)); }
.btn:disabled { filter: grayscale(0.85) brightness(0.9); cursor: default; }
.btn.leaf { --b: var(--b-leaf); --bd: var(--b-leaf-down); } .btn.berry { --b: var(--b-berry); --bd: var(--b-berry-down); }
.btn.gold { --b: var(--b-gold); --bd: var(--b-gold-down); color: #4a2f08; text-shadow: 0 var(--u) 0 #fff3b080; }
.btn.sky { --b: var(--b-sky); --bd: var(--b-sky-down); } .btn.pap { --b: var(--b-paper); --bd: var(--b-paper-down); color: var(--ink); text-shadow: none; }
.btn.sq { min-width: calc(var(--u) * 15); padding: 0; } .btn.wide { width: 100%; }
.btn.tiny { min-height: calc(var(--u) * 11); font-size: calc(var(--u) * 4.6); border-width: calc(var(--u) * 3) calc(var(--u) * 4) calc(var(--u) * 5); border-image-width: calc(var(--u) * 3) calc(var(--u) * 4) calc(var(--u) * 5); }

/* ---- HUD */
.hud { position: absolute; top: calc(var(--u) * 3 + env(safe-area-inset-top)); left: calc(var(--u) * 3); right: calc(var(--u) * 3); display: flex; justify-content: space-between; align-items: flex-start; gap: calc(var(--u) * 2); pointer-events: none; }
.hud > * { pointer-events: auto; }
.chip { display: inline-flex; align-items: center; gap: calc(var(--u) * 1.5); min-height: calc(var(--u) * 13); padding: 0 calc(var(--u) * 1); cursor: pointer; }
.chips { display: flex; gap: calc(var(--u) * 1.5); flex-wrap: wrap; justify-content: flex-end; }
.who { display: flex; align-items: center; gap: calc(var(--u) * 2); cursor: pointer; padding: 0 calc(var(--u) * 1); }
.who .face { width: calc(var(--u) * 16); height: calc(var(--u) * 16); margin: calc(var(--u) * -3) 0 calc(var(--u) * -2) calc(var(--u) * -2); }
.who b { display: block; font-size: calc(var(--u) * 5.6); line-height: 1; }
.bar { height: calc(var(--u) * 3); background: #0d1410; border: var(--u) solid #0d1410; min-width: calc(var(--u) * 26); margin-top: calc(var(--u) * 1.4); }
.bar > i { display: block; height: 100%; background: linear-gradient(#b4f06a 0 50%, #6cc23a 50% 100%); transition: width 0.4s steps(8); }
.bar.gold > i { background: linear-gradient(#ffe08a 0 50%, #f2b632 50% 100%); } .bar.pap { background: #8a6f52; border-color: #5a3d24; }

.dock { position: absolute; left: 50%; bottom: calc(var(--u) * 3 + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: calc(var(--u) * 1.5); padding: 0; }
.dock button { position: relative; flex-direction: column; gap: 0; min-width: calc(var(--u) * 21); min-height: calc(var(--u) * 21); font-size: calc(var(--u) * 4.2); padding: 0; }
.badge { position: absolute; top: calc(var(--u) * -5); right: calc(var(--u) * -5); min-width: calc(var(--u) * 9); height: calc(var(--u) * 9); padding: 0 calc(var(--u) * 2); background: var(--berry); color: #fff; border: var(--u) solid var(--ink); font: 400 calc(var(--u) * 4.2) / calc(var(--u) * 7) 'Silkscreen', monospace; text-shadow: none; animation: pop 0.3s steps(4); }

/* ---- speech bubble */
.say { position: absolute; left: 0; top: 0; max-width: min(84vw, calc(var(--u) * 104)); min-width: calc(var(--u) * 30); transform: translate(-50%, -100%); padding: calc(var(--u) * 0.5) calc(var(--u) * 1); cursor: pointer; animation: pop 0.24s steps(5); z-index: 2; }
.say::after { content: ''; position: absolute; left: 50%; bottom: calc(var(--u) * -10); width: calc(var(--u) * 7); height: calc(var(--u) * 4); margin-left: calc(var(--u) * -3.5); background: var(--f-tail) 0 0 / 100% 100%; image-rendering: pixelated; }
.say.side::after { display: none; }
.say .name { font-weight: 700; font-size: calc(var(--u) * 4.4); color: var(--mute); display: block; margin-bottom: var(--u); }

/* ---- sheets */
.sheet { position: absolute; left: 0; right: 0; bottom: 0; height: 66%; display: flex; flex-direction: column; animation: rise 0.3s steps(9) both; z-index: 5; border-bottom-width: 0; padding-bottom: env(safe-area-inset-bottom); }
.sheet.tall { height: 82%; } .sheet.short { height: 44%; }
@media (min-width: 900px) and (min-aspect-ratio: 1/1) {
  .sheet, .sheet.tall, .sheet.short { left: auto; right: calc(var(--u) * 4); top: calc(var(--u) * 22); bottom: calc(var(--u) * 4); height: auto; width: min(460px, 42vw); border-bottom-width: calc(var(--u) * 6); animation-name: slide; }
}
.sheet > header { display: flex; align-items: center; gap: calc(var(--u) * 2); margin: calc(var(--u) * -2) 0 calc(var(--u) * 2); min-height: calc(var(--u) * 15); }
.sheet > header h2 { margin: 0; flex: 1; font-size: calc(var(--u) * 7); text-shadow: 0 var(--u) 0 #5a3d24; }
.body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.body::-webkit-scrollbar { display: none; }
.tabs { display: flex; gap: calc(var(--u) * 1); margin-bottom: calc(var(--u) * 2); }
.tabs .btn { flex: 1; min-height: calc(var(--u) * 12); font-size: calc(var(--u) * 4.8); padding: 0; }
.row { display: flex; align-items: center; gap: calc(var(--u) * 2); } .grow { flex: 1; min-width: 0; } .wrap { flex-wrap: wrap; }
.gap { height: calc(var(--u) * 3); } .mute { color: var(--mute); } .small { font-size: calc(var(--u) * 4.5); } .center { text-align: center; }
h3 { margin: calc(var(--u) * 3) 0 calc(var(--u) * 1.5); font-size: calc(var(--u) * 5.4); color: #6e4326; display: flex; align-items: center; gap: calc(var(--u) * 2); }
h3::after { content: ''; flex: 1; height: var(--u); background: repeating-linear-gradient(90deg, #cdb07f 0 calc(var(--u) * 2), transparent 0 calc(var(--u) * 4)); }
p { margin: 0 0 calc(var(--u) * 2); }

/* ---- task cards */
.task { display: flex; gap: calc(var(--u) * 2); margin-bottom: calc(var(--u) * 2); padding: 0; align-items: flex-start; }
.task .tick { width: calc(var(--u) * 13); height: calc(var(--u) * 13); flex: none; display: grid; place-items: center; cursor: pointer; padding: 0; border-width: calc(var(--u) * 3); border-image-slice: 3 fill; background: none; }
.task .tick img { animation: stamp 0.28s steps(5); }
.task.done .ttl { text-decoration: line-through; color: var(--mute); }
.ttl { font-weight: 700; word-break: break-word; user-select: text; -webkit-user-select: text; }
.meta { display: flex; flex-wrap: wrap; gap: calc(var(--u) * 1.5); margin-top: var(--u); font-size: calc(var(--u) * 4.4); align-items: center; }
.tag { padding: 0 calc(var(--u) * 1.5); border: var(--u) solid #0003; color: #fff; text-shadow: 0 var(--u) 0 #0003; line-height: calc(var(--u) * 6.5); white-space: nowrap; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; }
.due { color: var(--mute); } .due.hot { color: #c0562a; font-weight: 700; } .due.late { color: var(--berry); font-weight: 700; }
.more { margin-top: calc(var(--u) * 2); padding-top: calc(var(--u) * 2); border-top: var(--u) dashed #cdb07f; animation: fade 0.2s steps(4); }
.step { display: flex; gap: calc(var(--u) * 2); align-items: flex-start; padding: var(--u) 0; cursor: pointer; }
.step i { width: calc(var(--u) * 6); height: calc(var(--u) * 6); border: var(--u) solid var(--ink); background: #fffdf5; flex: none; margin-top: calc(var(--u) * 0.6); }
.step.on i { background: var(--leaf); box-shadow: inset 0 0 0 var(--u) #fffdf5; } .step.on span { text-decoration: line-through; color: var(--mute); }
.prompt { background: #fffdf5; border: var(--u) solid #cdb07f; padding: calc(var(--u) * 1.5); margin-bottom: calc(var(--u) * 1.5); font-size: calc(var(--u) * 4.6); display: flex; gap: calc(var(--u) * 2); user-select: text; -webkit-user-select: text; }
.inp { width: 100%; min-height: calc(var(--u) * 14); padding: 0 calc(var(--u) * 1); outline: none; background: none; border-width: calc(var(--u) * 3); border-image-slice: 3 fill; }
textarea.inp { padding: calc(var(--u) * 1); resize: none; min-height: calc(var(--u) * 26); }

/* ---- chat */
.msgs { display: flex; flex-direction: column; gap: calc(var(--u) * 2); padding-bottom: calc(var(--u) * 2); }
.msg { max-width: 86%; padding: calc(var(--u) * 1.5) calc(var(--u) * 2.5); border: var(--u) solid var(--ink); background: #fffdf5; box-shadow: 0 var(--u) 0 #cdb07f; user-select: text; -webkit-user-select: text; white-space: pre-wrap; word-break: break-word; }
.msg.me { align-self: flex-end; background: #d6f0b4; box-shadow: 0 var(--u) 0 #8fb86a; }
.sugg { display: flex; gap: calc(var(--u) * 1.5); overflow-x: auto; scrollbar-width: none; margin: calc(var(--u) * 2) 0; }
.sugg::-webkit-scrollbar { display: none; }

/* ---- grids */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--u) * 28), 1fr)); gap: calc(var(--u) * 2); }
.cell { position: relative; display: flex; flex-direction: column; align-items: center; padding: 0; cursor: pointer; border-width: calc(var(--u) * 3); border-image-slice: 3 fill; background: none; min-height: calc(var(--u) * 34); }
.cell img.art { width: calc(var(--u) * 24); height: calc(var(--u) * 24); image-rendering: pixelated; pointer-events: none; }
.cell .lbl { font-size: calc(var(--u) * 4); text-align: center; line-height: 1.05; padding: 0 var(--u); }
.cell .cnt { position: absolute; top: 0; right: 0; background: var(--ink); color: #fff; font: 400 calc(var(--u) * 4) / calc(var(--u) * 6) 'Silkscreen', monospace; padding: 0 calc(var(--u) * 1.5); }
.price { display: inline-flex; align-items: center; gap: var(--u); font-family: 'Silkscreen', monospace; font-size: calc(var(--u) * 4.2); }
.price img { width: calc(var(--u) * 7); height: calc(var(--u) * 7); image-rendering: pixelated; }
.cell.locked img.art { filter: grayscale(1) brightness(0.75); }
.swatches { display: flex; flex-wrap: wrap; gap: calc(var(--u) * 1.5); }
.sw { width: calc(var(--u) * 11); height: calc(var(--u) * 11); border: var(--u) solid var(--ink); box-shadow: inset calc(var(--u) * -1) calc(var(--u) * -1) 0 #0003, inset var(--u) var(--u) 0 #fff5; cursor: pointer; padding: 0; }
.sw.on { outline: calc(var(--u) * 1) solid #fffdf5; outline-offset: 0; box-shadow: 0 0 0 calc(var(--u) * 2) var(--ink); }

/* ---- toasts, modals, banners */
.toasts { position: absolute; top: calc(var(--u) * 20 + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: calc(var(--u) * 1.5); align-items: center; z-index: 20; pointer-events: none !important; width: max-content; max-width: 92vw; }
.toast { display: flex; align-items: center; gap: calc(var(--u) * 2); padding: 0 calc(var(--u) * 1); animation: drop 0.3s steps(6), fadeout 0.4s steps(4) 2.6s forwards; }
.veil { position: absolute; inset: 0; background: #10180fb3; display: grid; place-items: center; z-index: 30; animation: fade 0.2s steps(4); padding: calc(var(--u) * 5); }
.modal { width: min(100%, calc(var(--u) * 120)); max-height: 100%; display: flex; flex-direction: column; animation: pop 0.3s steps(6); }
.banner { position: absolute; left: 50%; top: calc(var(--u) * 20 + env(safe-area-inset-top)); transform: translateX(-50%); display: flex; align-items: center; gap: calc(var(--u) * 2); z-index: 4; white-space: nowrap; }
.fxlayer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none !important; z-index: 40; image-rendering: pixelated; }
.logo { font-size: calc(var(--u) * 16); font-weight: 700; letter-spacing: calc(var(--u) * 1); color: #ffe08a; text-shadow: 0 calc(var(--u) * 1) 0 #f2b632, 0 calc(var(--u) * 2) 0 #96640f, 0 calc(var(--u) * 4) 0 #2b1d14, calc(var(--u) * 1) calc(var(--u) * 3) 0 #2b1d14, calc(var(--u) * -1) calc(var(--u) * 3) 0 #2b1d14; margin: 0; text-align: center; }

@keyframes rise { from { transform: translateY(100%); } 70% { transform: translateY(-1.5%); } to { transform: translateY(0); } }
@keyframes slide { from { transform: translateX(110%); } 70% { transform: translateX(-1.5%); } to { transform: translateX(0); } }
@keyframes pop { from { transform: var(--pre, translate(0)) scale(0.5); opacity: 0; } 60% { transform: var(--pre, translate(0)) scale(1.08); opacity: 1; } to { transform: var(--pre, translate(0)) scale(1); } }
.say { --pre: translate(-50%, -100%); } .badge { --pre: translate(0); }
@keyframes stamp { from { transform: scale(2.2) rotate(-14deg); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeout { to { opacity: 0; transform: translateY(calc(var(--u) * -4)); } }
@keyframes drop { from { transform: translateY(calc(var(--u) * -12)); opacity: 0; } 70% { transform: translateY(calc(var(--u) * 2)); opacity: 1; } to { transform: translateY(0); } }
@keyframes bob { 50% { transform: translateY(calc(var(--u) * -1)); } }
.bob { animation: bob 1.2s steps(2) infinite; }
@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01s !important; } }
`;
