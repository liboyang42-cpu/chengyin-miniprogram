const test = require('node:test');
const assert = require('node:assert/strict');

function loadComponent(audio) {
  const componentPath = require.resolve('../../pages/play/components/advanced-game/index.js');
  delete require.cache[componentPath];
  let definition;
  global.getApp = () => ({ sendRequest() {} });
  global.wx = { createInnerAudioContext: () => audio, showToast() {} };
  global.Component = (value) => { definition = value; };
  require(componentPath);
  return definition;
}

test('tapping a drawn rhythm toggles its original audio without starting another round', () => {
  let plays = 0;
  const audio = {
    src: '',
    play() { plays += 1; }, pause() {}, stop() {}, destroy() {},
    onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {}
  };
  const definition = loadComponent(audio);
  const instance = {
    data: { playingDrawId: '' },
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.keys(definition.methods).forEach((name) => {
    instance[name] = definition.methods[name].bind(instance);
  });

  instance.toggleDrawAudio({ currentTarget: { dataset: {
    id: 'beat_one', url: '/pages/play/audio/merchant-games/rhythm-one.mp3'
  } } });

  assert.equal(audio.src, '/pages/play/audio/merchant-games/rhythm-one.mp3');
  assert.equal(plays, 1);
  assert.equal(instance.data.playingDrawId, 'beat_one');
});

test('legacy /audio/merchant-games url from server config maps into the subpackage path', () => {
  let plays = 0;
  const audio = {
    src: '', play() { plays += 1; }, pause() {}, stop() {}, destroy() {},
    onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {}
  };
  const definition = loadComponent(audio);
  const instance = {
    data: { playingDrawId: '' },
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.keys(definition.methods).forEach((name) => {
    instance[name] = definition.methods[name].bind(instance);
  });

  instance.toggleDrawAudio({ currentTarget: { dataset: {
    id: 'beat_two', url: '/audio/merchant-games/rhythm-two.mp3'
  } } });

  assert.equal(audio.src, '/pages/play/audio/merchant-games/rhythm-two.mp3');
  assert.equal(plays, 1);
});

test('packaged component dependency lists every dynamically configured merchant asset', () => {
  const { merchantGameAssets } = require('../../pages/play/utils/merchant-game-assets.js');
  assert.deepEqual(merchantGameAssets, [
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/signature-dish-blitz.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/coffee-flavor-personality.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/hidden-menu-clue-chain.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/table-flavor-relay.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/table-mission-bingo.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/menu-co-creation.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/fitness-reaction-60.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/team-energy-relay.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/partner-training-relay.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/movement-bingo.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/gym-charity-sprint.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/rhythm-blind-guess.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/branch-story-relay.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/song-mood-relay.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/performance-bingo.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/original-role-mystery.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/style-personality-lab.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/color-co-creation.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/detail-observation-blitz.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/self-care-bingo.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/space-styling-challenge.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/duo-memory-relay.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/gift-match-guess.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/keepsake-treasure-clues.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/festival-story-puzzle.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/stain-detective.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/clothing-care-bingo.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/seasonal-storage-challenge.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/home-safety-mines.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/repair-tool-guess.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/family-safety-check-relay.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/city-sidequest-observation.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/travel-partner-decisions.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/travel-safety-bingo.jpg',
    'https://api.example.invalid/prod-api/profile/merchant-game-covers/route-badge-story.jpg',
    '/pages/play/audio/merchant-games/rhythm-one.mp3',
    '/pages/play/audio/merchant-games/rhythm-two.mp3',
    '/pages/play/audio/merchant-games/rhythm-three.mp3'
  ]);
});

test('page hide stops rhythm playback instead of leaking audio into the next page', () => {
  let stops = 0;
  const audio = {
    src: '', play() {}, pause() {}, stop() { stops += 1; }, destroy() {},
    onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {}
  };
  const definition = loadComponent(audio);
  const instance = {
    data: { playingDrawId: 'beat_one' },
    setData(patch) { Object.assign(this.data, patch); },
    _drawAudio: audio
  };
  Object.keys(definition.methods).forEach((name) => {
    instance[name] = definition.methods[name].bind(instance);
  });

  definition.pageLifetimes.hide.call(instance);

  assert.equal(stops, 1);
  assert.equal(instance.data.playingDrawId, '');
});
