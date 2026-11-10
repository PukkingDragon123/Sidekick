// Shop, bag, wardrobe, friends, settings, first-run onboarding and the garden editing bar.
import { useEffect, useState } from 'preact/hooks';
import type { IntegrationsRes } from '@shared/api.ts';
import { SPECIES_INFO, STARTERS } from '@shared/species.ts';
import { SPECIES, uid, type EyeStyle, type OutfitSlot, type Pattern, type SpeciesId } from '@shared/types.ts';
import { FOOD, FOODS, FURNITURE, ITEM } from '../assets/furniture.ts';
import { PIECES } from '../assets/outfits.ts';
import { sound } from '../core/audio.ts';
import { ACCENT_COLORS, AD_REWARD, ADS_PER_DAY, demoTasks, EYE_COLORS, FUR_COLORS, GARDEN_LEVEL, OUTFIT, OUTFITS } from '../core/data.ts';
import * as net from '../core/net.ts';
import { adWatched, begin, buyFood, buyItem, buyOutfit, feed, movePlaced, placeItem, rename, resetSave, rev, S, setActive, setLook, setOutfit, setOwner, setSettings, sidekick, storePlaced, unlockSpecies, unlockStatus } from '../core/store.ts';
import { GARDEN } from '../world/layout.ts';
import type { SkyMode } from '../world/sky.ts';
import { actor, away, Btn, Count, ctx, gardenMode, Ico, Modal, modal, open, Paper, Price, say, Sheet, Tabs, toast } from './kit.tsx';
import { faceIcon, foodIcon, itemIcon, outfitIcon, speciesIcon } from './icons3d.ts';
import { startFocus } from './panels.tsx';

const U = (n: number) => `calc(var(--u) * ${n})`;

// ---------------------------------------------------------------- shop

export function ShopPanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const [tab, setTab] = useState<'food' | 'decor' | 'outfits' | 'plus'>('food'), [sel, setSel] = useState<string | null>(null);
  const p = S.progress, look = sidekick()?.look;
  const pick = (id: string) => { sound.play('ui_tap'); setSel(sel === id ? null : id); };
  const item = sel ? ITEM[sel] : null, fit = sel ? OUTFIT[sel] : null;
  const locked = (lvl?: number, plus?: boolean) => (lvl && p.level < lvl ? `Level ${lvl}` : plus && !S.premium.plus ? 'Plus' : '');
  return (
    <Sheet title="Market" icon="shop" size="tall" head={<span class="row num small"><Count icon="coin" n={p.coins} /><Count icon="gem" n={p.gems} /></span>}>
      <Tabs value={tab} set={(t) => { setTab(t); setSel(null); }} items={[['food', 'Snacks'], ['decor', 'Garden'], ['outfits', 'Outfits'], ['plus', 'Plus']]} />
      <Paper>
        {tab === 'food' && <div class="grid">{FOODS.map((f) => (
          <button key={f.id} class="cell fr slot" onClick={() => { if (buyFood(f.id)) { sound.play('ui_buy'); toast(`${f.name} added to your bag`, 'apple'); } }}>
            <img class="art" src={foodIcon(f.id)} alt="" />{(S.inventory[f.id] ?? 0) > 0 && <span class="cnt">{S.inventory[f.id]}</span>}
            <span class="lbl">{f.name}</span><Price coins={f.price} />
          </button>))}</div>}
        {tab === 'decor' && <>
          {item && <div class="fr paper sm row" style={{ marginBottom: U(2) }}>
            <img class="art big" src={itemIcon(item.id)} alt="" />
            <div class="grow"><b>{item.name}</b><p class="small">{item.blurb}</p>
              <Btn k="leaf" disabled={!!locked(item.level)} onClick={() => { if (buyItem(item.id)) { sound.play('ui_buy'); toast(`${item.name} is in your bag`, 'bag'); } }}>{locked(item.level) || 'Buy'} <Price coins={item.price} gems={item.gems} /></Btn></div>
          </div>}
          <div class="grid">{FURNITURE.map((f) => (
            <button key={f.id} class={`cell fr slot ${sel === f.id ? 'on' : ''} ${locked(f.level) ? 'locked' : ''}`} onClick={() => pick(f.id)}>
              <img class="art" src={itemIcon(f.id)} alt="" />{(S.inventory[f.id] ?? 0) > 0 && <span class="cnt">{S.inventory[f.id]}</span>}
              <span class="lbl">{f.name}</span>{locked(f.level) ? <span class="price"><Ico n="lock" s />{f.level}</span> : <Price coins={f.price} gems={f.gems} />}
            </button>))}</div>
        </>}
        {tab === 'outfits' && look && <>
          {fit && <div class="fr paper sm row" style={{ marginBottom: U(2) }}>
            <img class="art big" src={outfitIcon(fit.id, fit.slot, look)} alt="" />
            <div class="grow"><b>{PIECES[fit.id]?.name}</b><p class="small mute">{fit.slot} piece</p>
              {S.wardrobe.includes(fit.id)
                ? <Btn k="sky" icon="shirt" onClick={() => { setOutfit(fit.slot, fit.id); toast('Wearing it now', 'shirt'); }}>Wear</Btn>
                : <Btn k="leaf" disabled={!!locked(fit.level, fit.plus)} onClick={() => { if (buyOutfit(fit.id)) { sound.play('ui_buy'); setOutfit(fit.slot, fit.id); toast(`${PIECES[fit.id]?.name} unlocked`, 'shirt'); } }}>{locked(fit.level, fit.plus) || 'Buy'} <Price coins={fit.price} gems={fit.gems} /></Btn>}</div>
          </div>}
          <div class="grid">{OUTFITS.map((o) => (
            <button key={o.id} class={`cell fr slot ${sel === o.id ? 'on' : ''} ${locked(o.level, o.plus) ? 'locked' : ''}`} onClick={() => pick(o.id)}>
              <img class="art" src={outfitIcon(o.id, o.slot, look)} alt="" />
              <span class="lbl">{PIECES[o.id]?.name}</span>
              {S.wardrobe.includes(o.id) ? <span class="price"><Ico n="check" s /></span> : locked(o.level, o.plus) ? <span class="price"><Ico n="lock" s />{o.level ?? '+'}</span> : <Price coins={o.price} gems={o.gems} />}
            </button>))}</div>
        </>}
        {tab === 'plus' && <>
          <h3>Sidekick Plus</h3>
          <p>{S.premium.plus ? 'You are a Plus member. Thank you for keeping the forest growing.' : 'A lot more AI conversation each day, Plus-only outfits, and no ad slot.'}</p>
          {!S.premium.plus && <Btn k="gold" icon="star" disabled={!net.health.value?.billing} onClick={() => net.checkout().catch(() => toast('Could not open checkout', 'coin'))}>Get Plus</Btn>}
          {!S.premium.plus && !net.health.value?.billing && <p class="small mute" style={{ marginTop: U(2) }}>Subscriptions are switched off on this server (no payment keys configured).</p>}
          {!S.premium.plus && <>
            <h3>Free coins</h3>
            <p class="small">Watch a short sponsor break for {AD_REWARD} coins. Always optional. {p.adsToday}/{ADS_PER_DAY} today.</p>
            <Btn k="sky" icon="coin" disabled={p.adsToday >= ADS_PER_DAY} onClick={() => { modal.value = <AdBreak />; }}>Watch for {AD_REWARD}</Btn>
          </>}
        </>}
      </Paper>
    </Sheet>
  );
}

/** Rewarded-ad slot. No ad network is wired in, so it shows a labelled placeholder and still pays out. */
function AdBreak() {
  const [left, setLeft] = useState(5);
  useEffect(() => { const t = setInterval(() => setLeft((n) => n - 1), 1000); return () => clearInterval(t); }, []);
  return (
    <Modal title="Sponsor break" icon="coin" actions={<Btn k="leaf" disabled={left > 0} onClick={() => { adWatched(); modal.value = null; }}>{left > 0 ? `Reward in ${left}` : 'Collect coins'}</Btn>}>
      <p class="center" style={{ padding: `${U(8)} 0` }}><b>Ad slot</b><br /><span class="small mute">No ad network is connected in this build.<br />A real ad would play here.</span></p>
    </Modal>
  );
}

// ---------------------------------------------------------------- bag

export function BagPanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const foods = FOODS.filter((f) => (S.inventory[f.id] ?? 0) > 0), items = FURNITURE.filter((f) => (S.inventory[f.id] ?? 0) > 0);
  const eat = (id: string) => {
    if (away.value) return toast(`${sidekick()?.name} is on another device`, 'device');
    if (feed(id)) open(null);
  };
  return (
    <Sheet title="Bag" icon="bag">
      <Paper>
        <div class="row wrap">
          <Btn k="sky" icon="shirt" onClick={() => open('wardrobe')}>Wardrobe</Btn>
          <Btn k="sky" icon="paw" onClick={() => open('friends')}>Friends</Btn>
          <Btn k="leaf" icon="garden" onClick={() => enterGarden()}>Garden</Btn>
          <Btn k="gold" icon="timer" onClick={() => startFocus(25)}>Focus 25</Btn>
          <Btn k="pap" icon="gear" onClick={() => open('settings')}>Settings</Btn>
        </div>
        <h3>Snacks</h3>
        {!foods.length && <p class="mute small">No snacks. The market has plenty.</p>}
        <div class="grid">{foods.map((f) => (
          <button key={f.id} class="cell fr slot" onClick={() => eat(f.id)}><img class="art" src={foodIcon(f.id)} alt="" /><span class="cnt">{S.inventory[f.id]}</span><span class="lbl">{f.name}</span><span class="small mute">Feed</span></button>))}</div>
        <h3>Garden things</h3>
        {!items.length && <p class="mute small">Nothing waiting to be placed.</p>}
        <div class="grid">{items.map((f) => (
          <button key={f.id} class="cell fr slot" onClick={() => enterGarden(f.id)}><img class="art" src={itemIcon(f.id)} alt="" /><span class="cnt">{S.inventory[f.id]}</span><span class="lbl">{f.name}</span><span class="small mute">Place</span></button>))}</div>
      </Paper>
    </Sheet>
  );
}

// ---------------------------------------------------------------- garden mode

export function enterGarden(itemId?: string) {
  const w = ctx.world;
  if (!w) return;
  if (!S.garden.unlocked) { toast(`The garden plot opens at level ${GARDEN_LEVEL}`, 'lock'); return; }
  open(null);
  gardenMode.value = true;
  w.garden.editing = true; w.setFocus('garden'); w.ghostRot = 0;
  if (itemId) { w.garden.beginGhost(itemId); w.garden.moveGhost(GARDEN.x, GARDEN.z, 0); }
}

export function GardenBar() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const w = ctx.world!, g = w.garden;
  const [, bump] = useState(0), [spot, setSpot] = useState<{ x: number; z: number; ok: boolean }>({ x: 0, z: 0, ok: true });
  const refresh = () => bump((n) => n + 1);
  useEffect(() => w.on((e) => {
    if (e.type === 'ghost') setSpot(e);
    if (e.type === 'tapItem') { sound.play('pickup_item'); g.select(e.id || null); refresh(); }
    if (e.type === 'moved') movePlaced(e.id, { x: e.x, z: e.z });
  }), []);
  useEffect(() => { if (g.selected) g.select(g.selected); }, [rev.value]);
  const done = () => { g.endGhost(); g.select(null); g.editing = false; gardenMode.value = false; w.setFocus('home'); };
  const items = FURNITURE.filter((f) => (S.inventory[f.id] ?? 0) > 0), sel = g.selected ? S.garden.items.find((i) => i.id === g.selected) : null;
  return (
    <div class="fr wood grain" style={{ position: 'absolute', left: U(3), right: U(3), bottom: U(3), zIndex: 6 }}>
      <div class="row" style={{ marginBottom: U(1.5) }}><Ico n="garden" s /><b class="grow">{g.ghostItem ? `Drag to position: ${ITEM[g.ghostItem].name}` : sel ? `${ITEM[sel.item].name}: drag to move` : 'Tap something to move it, or pick from below'}</b></div>
      <div class="row" style={{ marginBottom: U(2), justifyContent: 'flex-end' }}>
        {g.ghostItem && <>
          <Btn k="sky" cls="sq" icon="rotate" title="Rotate" snd="rotate_item" onClick={() => { w.ghostRot = (w.ghostRot + 1) % 4; setSpot(g.moveGhost(GARDEN.x + spot.x, GARDEN.z + spot.z, w.ghostRot)); }} />
          <Btn k="leaf" icon="check" disabled={!spot.ok} snd="place_item" onClick={() => { const id = g.ghostItem!; if (placeItem(id, spot.x, spot.z, w.ghostRot)) { g.endGhost(); if ((S.inventory[id] ?? 0) > 0) g.beginGhost(id); refresh(); } }}>Place</Btn>
          <Btn k="berry" cls="sq" icon="close" title="Cancel" onClick={() => { g.endGhost(); g.select(null); refresh(); }} />
        </>}
        {sel && !g.ghostItem && <>
          <Btn k="sky" cls="sq" icon="rotate" title="Rotate" snd="rotate_item" onClick={() => movePlaced(sel.id, { rot: (sel.rot + 1) % 4 })} />
          <Btn k="pap" icon="bag" snd="pickup_item" onClick={() => { storePlaced(sel.id); g.select(null); refresh(); }}>Store</Btn>
        </>}
        <Btn k="gold" onClick={done}>Done</Btn>
      </div>
      <div class="sugg" style={{ margin: 0 }}>
        {!items.length && <span class="small">Your bag has no garden things. Visit the market.</span>}
        {items.map((f) => (
          <button key={f.id} class={`cell fr slot ${g.ghostItem === f.id ? 'on' : ''}`} style={{ minWidth: U(26), minHeight: U(26), color: 'var(--ink)' }} onClick={() => { sound.play('ui_drag'); g.select(null); g.beginGhost(f.id); setSpot(g.moveGhost(GARDEN.x, GARDEN.z, w.ghostRot)); refresh(); }}>
            <img class="art" style={{ width: U(18), height: U(18) }} src={itemIcon(f.id)} alt={f.name} /><span class="cnt">{S.inventory[f.id]}</span>
          </button>))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- wardrobe

const SLOTS: [OutfitSlot, string][] = [['head', 'Head'], ['face', 'Face'], ['neck', 'Neck'], ['body', 'Body'], ['back', 'Back']];
const PATTERNS: Pattern[] = ['plain', 'socks', 'stripes', 'spots', 'mask', 'patch'];
const EYES: EyeStyle[] = ['round', 'sparkle', 'sleepy', 'sharp', 'dot'];
const EARS = ['auto', 'fox', 'cat', 'bunny', 'lop', 'bear', 'redpanda', 'owl'];
const TAILS = ['auto', 'fox', 'cat', 'bunny', 'raccoon', 'redpanda', 'bear'];

export function WardrobePanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const [tab, setTab] = useState<'outfit' | 'look'>('outfit'), [slot, setSlot] = useState<OutfitSlot>('head');
  const sk = sidekick();
  if (!sk) return null;
  const L = sk.look, owned = OUTFITS.filter((o) => o.slot === slot && S.wardrobe.includes(o.id));
  const Sw = ({ list, cur, set }: { list: string[]; cur: string; set: (c: string) => void }) => (
    <div class="swatches">{list.map((c) => <button key={c} class={`sw ${c === cur ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => { sound.play('ui_tap'); set(c); }} />)}</div>
  );
  const Chips = <T extends string>({ list, cur, set }: { list: readonly T[]; cur: T; set: (c: T) => void }) => (
    <div class="row wrap">{list.map((c) => <Btn key={c} small k={c === cur ? 'gold' : 'pap'} cls={c === cur ? 'down' : ''} onClick={() => set(c)}>{c}</Btn>)}</div>
  );
  return (
    <Sheet title="Wardrobe" icon="shirt" size="short">
      <Tabs value={tab} set={setTab} items={[['outfit', 'Outfit'], ['look', 'Look']]} />
      <Paper>
        {tab === 'outfit' && <>
          <Tabs value={slot} set={setSlot} items={SLOTS} />
          <div class="grid">
            <button class={`cell fr slot ${!sk.outfit[slot] ? 'on' : ''}`} onClick={() => { sound.play('ui_tap'); setOutfit(slot, undefined); }}><div style={{ height: U(24), display: 'grid', placeItems: 'center' }}><Ico n="close" /></div><span class="lbl">Nothing</span></button>
            {owned.map((o) => (
              <button key={o.id} class={`cell fr slot ${sk.outfit[slot] === o.id ? 'on' : ''}`} onClick={() => { sound.play('ui_drop'); setOutfit(slot, o.id); actor()?.emote('happy'); }}>
                <img class="art" src={outfitIcon(o.id, o.slot, L)} alt="" /><span class="lbl">{PIECES[o.id]?.name}</span></button>))}
          </div>
          {!owned.length && <p class="small mute" style={{ marginTop: U(2) }}>No {slot} pieces yet. The market's Outfits tab has plenty.</p>}
        </>}
        {tab === 'look' && <>
          <div class="row"><b>Name</b><input class="inp fr field" maxLength={16} value={sk.name} onChange={(e) => rename(e.currentTarget.value)} /></div>
          <h3>Fur</h3><Sw list={FUR_COLORS} cur={L.fur} set={(fur) => setLook({ fur })} />
          <h3>Belly and muzzle</h3><Sw list={['#ffffff', '#fff3e0', '#f1eef5', '#e2c4a0', '#f3e3c7', '#ffe1ea', '#e8f5b8', '#d9bd94', ...FUR_COLORS.slice(0, 4)]} cur={L.fur2} set={(fur2) => setLook({ fur2 })} />
          <h3>Markings</h3><Sw list={ACCENT_COLORS} cur={L.accent} set={(accent) => setLook({ accent })} />
          <Chips list={PATTERNS} cur={L.pattern} set={(pattern) => setLook({ pattern })} />
          <h3>Eyes</h3><Sw list={EYE_COLORS} cur={L.eye} set={(eye) => setLook({ eye })} />
          <Chips list={EYES} cur={L.eyeStyle} set={(eyeStyle) => setLook({ eyeStyle })} />
          <h3>Ears</h3><Chips list={EARS} cur={L.ears} set={(ears) => setLook({ ears })} />
          <h3>Tail</h3><Chips list={TAILS} cur={L.tail} set={(tail) => setLook({ tail })} />
          <h3>Build</h3><Chips list={['slim', 'regular', 'chubby'] as const} cur={L.build < -0.3 ? 'slim' : L.build > 0.5 ? 'chubby' : 'regular'} set={(b) => setLook({ build: b === 'slim' ? -1 : b === 'chubby' ? 1 : 0 })} />
          <div class="gap" /><Btn small k={L.blush ? 'gold' : 'pap'} onClick={() => setLook({ blush: !L.blush })}>Rosy cheeks: {L.blush ? 'on' : 'off'}</Btn>
        </>}
      </Paper>
    </Sheet>
  );
}

// ---------------------------------------------------------------- friends

export function FriendsPanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  return (
    <Sheet title="Friends" icon="paw" size="tall">
      <Paper>
        <p class="small mute">Everyone you invite lives in the forest. One of them is your sidekick: the one who talks, plans and hops to your desktop.</p>
        {SPECIES.map((sp) => {
          const info = SPECIES_INFO[sp], st = unlockStatus(sp), mine = S.sidekicks.find((s) => s.look.species === sp);
          return (
            <div key={sp} class="task fr paper sm" style={{ alignItems: 'center' }}>
              <img class="art" src={mine ? faceIcon(mine) : speciesIcon(sp)} alt="" style={st.owned ? {} : { filter: 'grayscale(0.7) brightness(0.9)' }} />
              <div class="grow"><div class="ttl">{mine ? `${mine.name} the ${info.label}` : info.label}</div><div class="small">{info.tagline}</div>{!st.owned && <div class="small mute">{st.label}</div>}</div>
              {mine ? (mine.id === S.active ? <Ico n="star" /> : <Btn small k="sky" onClick={() => { setActive(mine.id); say({ text: `${mine.name} reporting for duty.`, emote: 'wave' }); }}>Choose</Btn>)
                : <Btn small k={st.can ? 'leaf' : 'pap'} disabled={!st.can} icon={st.can ? undefined : 'lock'} snd="reward_unlock" onClick={() => { if (unlockSpecies(sp)) toast(`${info.label} moved into the forest`, 'paw'); }}>{st.can ? 'Invite' : ''}</Btn>}
            </div>
          );
        })}
      </Paper>
    </Sheet>
  );
}

// ---------------------------------------------------------------- settings

const SKY_KEY = 'sidekick.sky';
export const savedSky = (): SkyMode => (localStorage.getItem(SKY_KEY) as SkyMode) || 'clock';

export function SettingsPanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const st = S.settings, [ints, setInts] = useState<IntegrationsRes | null>(null), [ics, setIcs] = useState(''), [code, setCode] = useState(''), [mine, setMine] = useState(''), [sky, setSky] = useState<SkyMode>(savedSky());
  const load = () => net.integrations().then(setInts).catch(() => setInts(null));
  useEffect(() => { if (net.link.value === 'online') void load(); }, [net.link.value]);
  const online = net.link.value === 'online';
  const connect = (p: 'google' | 'microsoft') => net.startOAuth(p).catch((e: Error) => toast(e.message, 'cloud'));
  const vol = (k: 'sfx' | 'ambience') => (e: { currentTarget: HTMLInputElement }) => { setSettings({ [k]: Number(e.currentTarget.value) }); sound.volumes(S.settings.sfx, S.settings.ambience); };
  return (
    <Sheet title="Settings" icon="gear" size="tall">
      <Paper>
        <h3>Schoolwork</h3>
        {!online && <p class="small mute">The Sidekick server is not reachable, so school accounts cannot be connected right now. Everything else keeps working on this device.</p>}
        {ints?.items.map((i) => (
          <div key={i.id} class="row small" style={{ marginBottom: U(1.5) }}><Ico n={i.provider === 'google' ? 'board' : i.provider === 'microsoft' ? 'people' : 'calendar'} s /><span class="grow">{i.label}{i.error ? ` (${i.error})` : ''}</span>
            <Btn small k="berry" cls="sq" icon="close" title="Disconnect" onClick={() => net.disconnect(i.id).then(load)} /></div>))}
        <div class="row wrap">
          <Btn k="sky" icon="board" disabled={!online || !ints?.configured.google} onClick={() => connect('google')}>Google Classroom</Btn>
          <Btn k="sky" icon="people" disabled={!online || !ints?.configured.microsoft} onClick={() => connect('microsoft')}>Microsoft Teams</Btn>
        </div>
        {online && ints && (!ints.configured.google || !ints.configured.microsoft) && <p class="small mute" style={{ marginTop: U(1.5) }}>Greyed-out services need sign-in keys added on the server first (see docs/SERVER.md).</p>}
        <div class="row" style={{ marginTop: U(2) }}>
          <input class="inp fr field" placeholder="Calendar feed link (Canvas, Moodle, iCal)" value={ics} onInput={(e) => setIcs(e.currentTarget.value)} />
          <Btn k="leaf" icon="calendar" disabled={!online || !ics.trim()} onClick={() => net.addIcs(ics.trim()).then(() => { setIcs(''); toast('Feed connected', 'calendar'); return net.syncNow().then(load); }).catch((e: Error) => toast(e.message, 'calendar'))}>Add</Btn>
        </div>
        <div class="gap" /><Btn small k="pap" icon="tasks" onClick={() => { S.tasks.push(...demoTasks()); setOwner(S.owner.name); toast('Sample week loaded', 'tasks'); }}>Load a sample week</Btn>

        <h3>Notifications</h3>
        <div class="row wrap">
          <Btn k="gold" icon="bell" onClick={async () => { const r = await net.enablePush().catch(() => 'no-server' as const); toast(r === 'ok' ? 'Notifications are on for this device' : r === 'denied' ? 'Notifications are blocked in your browser settings' : r === 'unsupported' ? 'On iPhone and iPad, add Sidekick to your Home Screen first' : 'Needs the Sidekick server to deliver them', 'bell'); }}>Turn on</Btn>
          <Btn small k={st.notifyDueSoon ? 'gold' : 'pap'} onClick={() => setSettings({ notifyDueSoon: !st.notifyDueSoon })}>Due soon: {st.notifyDueSoon ? 'on' : 'off'}</Btn>
          <Btn small k={st.notifyDaily ? 'gold' : 'pap'} onClick={() => setSettings({ notifyDaily: !st.notifyDaily })}>Morning brief: {st.notifyDaily ? 'on' : 'off'}</Btn>
          <input class="inp fr field" type="time" style={{ maxWidth: U(40) }} value={st.dailyAt} onChange={(e) => setSettings({ dailyAt: e.currentTarget.value })} aria-label="Morning brief time" />
        </div>

        <h3>Devices</h3>
        <p class="small mute">{online ? `${net.presence.value.devices.filter((d) => d.online).length || 1} device(s) online. Your sidekick hops to whichever one calls it.` : 'Offline.'}</p>
        <div class="row wrap">
          <Btn k="sky" icon="device" disabled={!online} onClick={() => net.pairCode().then((r) => setMine(r.code)).catch(() => toast('Could not make a code', 'device'))}>{mine ? `Code: ${mine}` : 'Link another device'}</Btn>
          <input class="inp fr field" style={{ maxWidth: U(34) }} placeholder="Enter code" maxLength={8} value={code} onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} />
          <Btn k="leaf" disabled={!online || code.length < 6} onClick={() => net.joinWith(code).then(() => { setCode(''); toast('Linked. Everything is in sync.', 'device'); }).catch((e: Error) => toast(e.message, 'device'))}>Join</Btn>
        </div>
        <div class="gap" /><Btn small k={st.desktopAuto ? 'gold' : 'pap'} onClick={() => setSettings({ desktopAuto: !st.desktopAuto })}>Hop to desktop automatically: {st.desktopAuto ? 'on' : 'off'}</Btn>

        <h3>Sound</h3>
        <div class="row"><Ico n="sound" s /><span style={{ width: U(22) }}>Effects</span><input class="grow" type="range" min="0" max="1" step="0.05" value={st.sfx} onInput={vol('sfx')} /></div>
        <div class="row"><Ico n="tree" s /><span style={{ width: U(22) }}>Forest</span><input class="grow" type="range" min="0" max="1" step="0.05" value={st.ambience} onInput={vol('ambience')} /></div>
        <Btn small k={st.voice ? 'gold' : 'pap'} onClick={() => { setSettings({ voice: !st.voice }); sound.voiceOn = S.settings.voice; }}>Sidekick voice: {st.voice ? 'on' : 'off'}</Btn>

        <h3>Forest</h3>
        <div class="row wrap">{(['clock', 'day', 'golden', 'night'] as SkyMode[]).map((m) => (
          <Btn key={m} small k={sky === m ? 'gold' : 'pap'} cls={sky === m ? 'down' : ''} onClick={() => { setSky(m); localStorage.setItem(SKY_KEY, m); const w = ctx.world; if (w) { w.skyMode = m; w.applySky(); } }}>{m === 'clock' ? 'Real time' : m === 'golden' ? 'Golden hour' : m[0].toUpperCase() + m.slice(1)}</Btn>))}</div>
        <div class="gap" /><div class="row wrap">{(['auto', 'low', 'high'] as const).map((qv) => <Btn key={qv} small k={st.quality === qv ? 'gold' : 'pap'} onClick={() => { setSettings({ quality: qv }); toast('Detail level changes after a reload', 'gear'); }}>Detail: {qv}</Btn>)}</div>

        <h3>About</h3>
        <p class="small mute">Sound effects are CC0 and public-domain recordings: the full list with authors and sources is in docs/AUDIO-CREDITS.md and /sfx/credits.json. Fonts: Pixelify Sans and Silkscreen (SIL Open Font License).</p>
        <Btn small k="berry" icon="trash" onClick={() => { modal.value = <Modal title="Start over?" icon="trash" actions={<><Btn k="pap" onClick={() => { modal.value = null; }}>Keep it</Btn><Btn k="berry" onClick={() => { resetSave(); location.reload(); }}>Erase</Btn></>}><p>This erases the save on this device: your sidekick, garden and progress. Schoolwork in your school accounts is not touched.</p></Modal>; }}>Erase this device's save</Btn>
      </Paper>
    </Sheet>
  );
}

// ---------------------------------------------------------------- onboarding

export function Onboarding() {
  const [step, setStep] = useState(0), [sp, setSp] = useState<SpeciesId>(STARTERS[0]), [name, setName] = useState(''), [owner, setOwnerName] = useState(''), [demo, setDemo] = useState(true);
  const info = SPECIES_INFO[sp];
  const preview = (s: SpeciesId) => {
    setSp(s); sound.play('ui_tab');
    ctx.world?.setSidekicks(STARTERS.map((x) => ({ id: 'starter-' + x, name: SPECIES_INFO[x].defaultName, look: { species: x, ...SPECIES_INFO[x].look }, outfit: { ...SPECIES_INFO[x].outfit } })), 'starter-' + s);
    ctx.world?.sidekick?.emote('wave');
  };
  useEffect(() => { preview(STARTERS[0]); }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: U(4), pointerEvents: 'none' }}>
      <h1 class="logo" style={{ marginTop: U(6) }}>SIDEKICK</h1>
      <div class="fr wood grain" style={{ pointerEvents: 'auto', maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        {step === 0 ? <>
          <b>Who is coming with you?</b>
          <div class="row" style={{ margin: `${U(2)} 0` }}>{STARTERS.map((s) => (
            <button key={s} class={`cell fr slot grow ${sp === s ? 'on' : ''}`} style={{ color: 'var(--ink)' }} onClick={() => preview(s)}><img class="art" src={speciesIcon(s)} alt="" /><span class="lbl"><b>{SPECIES_INFO[s].label}</b></span></button>))}</div>
          <div class="fr paper sm" style={{ marginBottom: U(2) }}><b>{info.tagline}</b><p class="small" style={{ margin: 0 }}>{info.personality.split('. ').slice(0, 2).join('. ')}.</p></div>
          <Btn k="leaf" cls="wide" onClick={() => { setName(info.defaultName); setStep(1); }}>Choose the {info.label}</Btn>
        </> : <>
          <b>Nearly there</b>
          <div class="fr paper sm" style={{ margin: `${U(2)} 0` }}>
            <div class="row"><span style={{ width: U(30) }}>Their name</span><input class="inp fr field" maxLength={16} value={name} onInput={(e) => setName(e.currentTarget.value)} /></div>
            <div class="row" style={{ marginTop: U(1.5) }}><span style={{ width: U(30) }}>Your name</span><input class="inp fr field" maxLength={24} placeholder="What should they call you?" value={owner} onInput={(e) => setOwnerName(e.currentTarget.value)} /></div>
            <div class="step" style={{ marginTop: U(2) }} onClick={() => setDemo(!demo)}><i style={demo ? { background: 'var(--leaf)', boxShadow: 'inset 0 0 0 var(--u) #fffdf5' } : {}} /><span class="small">Start with a sample week of homework so I can look around. I can connect Classroom or Teams later in Settings.</span></div>
          </div>
          <div class="row"><Btn k="pap" onClick={() => setStep(0)}>Back</Btn><Btn k="leaf" cls="grow" onClick={() => { sound.play('reward_unlock'); begin(sp, name || info.defaultName, owner, demo); }}>Enter the forest</Btn></div>
        </>}
      </div>
    </div>
  );
}

export { uid, FOOD };
