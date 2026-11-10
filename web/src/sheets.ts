// Extra contact-sheet sets used for visual QA against the reference images.
import type { Look, Outfit, SpeciesId } from '@shared/types.ts';
import { SPECIES } from '@shared/types.ts';
import { SPECIES_INFO } from '@shared/species.ts';
import type { SheetItem } from './sheet.ts';
import { buildAnimal, type EyeFrame, type MouthFrame } from './assets/animals.ts';
import { buildProp, propMesh } from './gfx/box.ts';

export const lookOf = (s: SpeciesId, o: Partial<Look> = {}): Look => ({ species: s, ...SPECIES_INFO[s].look, ...o });

function animal(name: string, look: Look, outfit: Outfit = {}, eyes: EyeFrame = 'open', mouth?: MouthFrame): SheetItem {
  const a = buildAnimal(look, outfit);
  a.setEyes(eyes);
  if (mouth) a.setMouth(mouth);
  return { name, obj: a.rig.root };
}

export async function sheet(name: string, q: URLSearchParams): Promise<SheetItem[]> {
  if (name === 'animals') {
    const only = q.get('only')?.split(',');
    return SPECIES.filter((s) => !only || only.includes(s)).map((s) => animal(s, lookOf(s)));
  }
  if (name === 'one') return [animal('one', lookOf((q.get('s') ?? 'fox') as SpeciesId), JSON.parse(q.get('o') ?? '{}'))];
  if (name === 'outfits') {
    const fits: [SpeciesId, Outfit, EyeFrame?, MouthFrame?][] = [
      ['fox', { body: 'drama_magenta', head: 'cap_back', neck: 'chain', face: 'shades' }],
      ['cat', { body: 'cloak_violet', head: 'wizard' }, 'half'],
      ['bunny', { body: 'hoodie_mint', head: 'phones_pink', back: 'pack_red' }, 'happy', 'open2'],
      ['raccoon', { body: 'varsity_red', head: 'cap_red', neck: 'bandana' }, 'open', 'grin'],
      ['frog', { body: 'haori_wave', head: 'straw' }],
      ['owl', { body: 'blazer_navy', head: 'gradcap', face: 'glasses_gold' }],
      ['bear', { body: 'overalls', head: 'flowercrown', neck: 'scarf_red' }, 'happy'],
      ['redpanda', { body: 'sweater_berry', head: 'beret', face: 'glasses_round' }, 'star'],
      ['capybara', { head: 'yuzu', neck: 'bell', back: 'wings' }],
      ['axolotl', { body: 'tunic', head: 'crown', back: 'cape_hero' }, 'heart', 'o'],
    ];
    return fits.map(([s, o, e, m]) => animal(s, lookOf(s), o, e, m));
  }
  if (name === 'faces') {
    const eyes: EyeFrame[] = ['open', 'half', 'closed', 'happy', 'wide', 'angry', 'sad', 'heart', 'star', 'dizzy'];
    const mouths: MouthFrame[] = ['smile', 'neutral', 'open1', 'open2', 'grin', 'o', 'frown', 'cat', 'chew1', 'blep'];
    return eyes.map((e, i) => animal(e, lookOf(i % 2 ? 'cat' : 'fox', { eyeStyle: (['sharp', 'round', 'sparkle', 'sleepy', 'dot'] as const)[i % 5] }), {}, e, mouths[i]));
  }
  if (name === 'furniture' || name === 'food') {
    const F = await import('./assets/furniture.ts');
    const only = q.get('only')?.split(',');
    const list = name === 'food' ? F.FOODS : F.FURNITURE;
    return list.filter((i) => !only || only.includes(i.id)).map((i) => ({ name: i.id, obj: propMesh(buildProp(i.build())) }));
  }
  return [];
}
