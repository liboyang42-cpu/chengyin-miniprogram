// 静态打包清单：服务端配置会动态下发这些路径，必须由出包源码显式引用。
const merchantGameAssets = Object.freeze([
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

const merchantGameAssetSet = new Set(merchantGameAssets);

function bundledMerchantGameAudioPath(path) {
  // 服务端配置(含存量库值)仍下发 /audio/merchant-games/*;#1103 起实体素材下沉到本分包,
  // 播放前必须映射到分包内路径,映射不到(未打包)返回空串由调用方拦截。
  if (typeof path !== 'string' || !path.startsWith('/audio/merchant-games/')) return '';
  const relocated = '/pages/play' + path;
  return merchantGameAssetSet.has(relocated) ? relocated : '';
}

function isBundledMerchantGameAudio(path) {
  return bundledMerchantGameAudioPath(path) !== '';
}

module.exports = { merchantGameAssets, isBundledMerchantGameAudio, bundledMerchantGameAudioPath };
