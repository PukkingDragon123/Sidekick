// The start screen: shown every time the app opens, before entering the forest. It is also where
// the player adds their own Anthropic API key so the sidekick can really talk.
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { sound } from '../core/audio.ts';
import { getKeys, hasKey, setKeys, testKey } from '../core/byok.ts';
import { S } from '../core/store.ts';
import { Btn, Ico } from './kit.tsx';

export const started = signal(false);

function KeyBoard({ close }: { close: () => void }) {
  const [key, setKey] = useState(getKeys().anthropic ?? ''), [show, setShow] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    const k = key.trim();
    if (!k) { setMsg({ ok: false, text: 'Paste a key first. It starts with sk-ant-.' }); return; }
    setBusy(true); setMsg({ ok: true, text: 'Checking the key with Anthropic…' });
    const err = await testKey(k);
    setBusy(false);
    if (err && !err.startsWith('Could not reach')) { setMsg({ ok: false, text: err }); sound.play('ui_error'); return; }
    setKeys({ ...getKeys(), anthropic: k });
    sound.play('ui_confirm');
    setMsg(err ? { ok: false, text: `Saved, but: ${err}` } : { ok: true, text: 'Key works and is saved on this device. Your sidekick can talk for real now.' });
  };
  const remove = () => { const k = getKeys(); delete k.anthropic; setKeys(k); setKey(''); setMsg({ ok: true, text: 'Key removed from this device.' }); };
  return (
    <div class="fr wood grain keyboard">
      <div class="row" style={{ marginBottom: '8px' }}><Ico n="lock" /><b class="grow" style={{ fontSize: '22px', color: '#ffe9b0' }}>API keys</b><Btn k="berry" cls="sq" icon="close" title="Close" onClick={close} /></div>
      <div class="fr paper">
        <label for="anthropic-key"><b>Anthropic API key</b></label>
        <p class="small" style={{ margin: '4px 0 8px' }}>Lets your sidekick hold real conversations and make AI study plans. Without a key it uses its built-in offline brain.</p>
        <div class="row">
          <input id="anthropic-key" class="inp fr field" type={show ? 'text' : 'password'} autocomplete="off" spellcheck={false} placeholder="sk-ant-…" value={key} onInput={(e) => setKey(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <Btn small k="pap" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</Btn>
        </div>
        <div class="row wrap" style={{ marginTop: '8px' }}>
          <Btn k="leaf" icon="check" disabled={busy} onClick={save}>Test and save</Btn>
          {hasKey() && <Btn k="berry" icon="trash" onClick={remove}>Remove</Btn>}
        </div>
        {msg && <p class="small" style={{ margin: '8px 0 0', color: msg.ok ? '#2f6b3a' : '#a82f33' }}>{msg.text}</p>}
        <h3>Where it goes</h3>
        <p class="small">The key is stored only in this browser and sent straight to Anthropic, never to anyone else. Get one at <span style={{ userSelect: 'text' }}>console.anthropic.com</span>, under API keys.</p>
        <p class="small" style={{ marginBottom: 0 }}>Google Classroom and Microsoft Teams sign-in keys belong on the Sidekick server instead (see docs/SERVER.md), because school accounts must never be connected from a browser alone.</p>
      </div>
    </div>
  );
}

export function Title() {
  const [keys, setOpen] = useState(false);
  const enter = () => { sound.play('reward_unlock', { volume: 0.6 }); started.value = true; };
  return (
    <div class="title-screen">
      <div class="title-top">
        <h1 class="logo">SIDEKICK</h1>
        <p class="tagline">a forest friend for your schoolwork</p>
      </div>
      {keys ? <KeyBoard close={() => setOpen(false)} /> : (
        <div class="fr wood grain title-menu">
          <Btn k="leaf" cls="wide big" icon="tree" onClick={enter}>{S.owner.onboarded ? 'Enter the forest' : 'Start'}</Btn>
          <Btn k="gold" cls="wide" icon="lock" onClick={() => setOpen(true)}>API keys</Btn>
          <div class={`ai-status ${hasKey() ? 'on' : ''}`}><i />{hasKey() ? 'Real AI: your key is set' : 'Offline brain (no key yet)'}</div>
        </div>
      )}
    </div>
  );
}

export const TITLE_CSS = `
.title-screen{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:calc(24px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));pointer-events:auto;background:linear-gradient(#0c140a00 40%,#0c140a99)}
.title-top{text-align:center}
.tagline{margin:6px 0 0;font-size:18px;color:#fff3dc;text-shadow:0 2px 0 #24150d,2px 0 0 #24150d,-2px 0 0 #24150d,0 -2px 0 #24150d}
.title-menu{width:min(360px,100%);display:flex;flex-direction:column;gap:8px}
.title-menu .btn.big{min-height:64px;font-size:24px}
.ai-status{display:flex;align-items:center;justify-content:center;gap:8px;font-size:15px;color:#fff3dc;text-shadow:0 2px 0 #24150d}
.ai-status i{width:10px;height:10px;background:#c9b48a;border:2px solid #24150d}
.ai-status.on i{background:#7fe08a}
.keyboard{width:min(460px,100%);max-height:72vh;overflow:auto}
.keyboard label b{font-size:18px}
`;
