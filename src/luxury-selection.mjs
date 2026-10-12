import {randomInt} from 'node:crypto';

// Prefer clips absent from recent videos, and always avoid repeating the immediately
// previous clip when another valid choice exists for that scene.
export function selectLuxurySuggestions(candidates, recent = [], sceneCount = 8,
  chooseIndex = length => randomInt(length)) {
  const used = new Set();
  return Array.from({length: sceneCount}, (_, slot) => {
    let pool = candidates.filter(candidate => candidate.slot === slot && !used.has(candidate.id));
    if (!pool.length) return '';
    const previous = recent[0]?.[slot];
    if (pool.length > 1 && previous) pool = pool.filter(candidate => candidate.id !== previous);
    const uses = candidate => recent.reduce((total, video) => total + Number(video[slot] === candidate.id), 0);
    const least = Math.min(...pool.map(uses));
    pool = pool.filter(candidate => uses(candidate) === least);
    const selected = pool[chooseIndex(pool.length)];
    used.add(selected.id);
    return selected.id;
  });
}
