import test from 'node:test';
import assert from 'node:assert/strict';
import {selectLuxurySuggestions} from './luxury-selection.mjs';

test('Luxury rotates footage between videos when each scene has alternatives', () => {
  const candidates = Array.from({length: 8}, (_, slot) => [
    {id: `clip-${slot}-a`, slot}, {id: `clip-${slot}-b`, slot},
  ]).flat();
  const first = selectLuxurySuggestions(candidates, [], 8, () => 0);
  const second = selectLuxurySuggestions(candidates, [first], 8, () => 0);
  assert.equal(new Set(first).size, 8);
  assert.equal(new Set(second).size, 8);
  second.forEach((id, slot) => assert.notEqual(id, first[slot]));
});

test('Luxury never assigns one stock clip to two scenes in the same video', () => {
  const candidates = [{id: 'shared', slot: 0}, {id: 'shared', slot: 1}, {id: 'other', slot: 1}];
  assert.deepEqual(selectLuxurySuggestions(candidates, [], 2, () => 0), ['shared', 'other']);
  assert.deepEqual(selectLuxurySuggestions([{id: 'only', slot: 0}], [['only']], 1), ['only']);
});

test('two Car and two Skyline scenes require different clips from their shared pools', () => {
  const categories = ['car', 'car', 'jet', 'yacht', 'mansion', 'watch', 'skyline', 'skyline'];
  const library = {car: ['car-a', 'car-b'], jet: ['jet-a'], yacht: ['yacht-a'],
    mansion: ['mansion-a'], watch: ['watch-a'], skyline: ['skyline-a', 'skyline-b']};
  const candidates = categories.flatMap((category, slot) =>
    library[category].map(id => ({id, slot})));
  const chosen = selectLuxurySuggestions(candidates, [], 8, () => 0);
  assert.equal(new Set(chosen).size, 8);
  assert.notEqual(chosen[0], chosen[1]);
  assert.notEqual(chosen[6], chosen[7]);
  const withoutSecondCar = candidates.filter(item => item.id !== 'car-b');
  assert.equal(selectLuxurySuggestions(withoutSecondCar, [], 8, () => 0)[1], '');
});
