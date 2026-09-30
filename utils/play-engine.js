'use strict';

const PREFAB_LIFE_TOPIC_ID = '990059';

function isPrefabLife(input) {
  const source = input || {};
  const engine = String(source.engineKey || source.experienceType || '').trim().toUpperCase();
  const topicId = source.topicId == null ? '' : String(source.topicId);
  return engine === 'PREFAB_LIFE' || topicId === PREFAB_LIFE_TOPIC_ID;
}

module.exports = { PREFAB_LIFE_TOPIC_ID, isPrefabLife };
