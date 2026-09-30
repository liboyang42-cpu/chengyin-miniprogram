'use strict';

const H = require('./roam-hangout.js');

const FALLBACK_TEAM_ICON = '/images/d_profile.png';
const TEAM_MARKER_TAG = 4;
const POST_MARKER_TAG = 5;

function validPoint(row) {
  return row && H.numOrNull(row.latitude) != null && H.numOrNull(row.longitude) != null;
}
function coverOf(row, getImgUrl) {
  const raw = row && (row.picUrl || row.coverUrl || row.imgUrl);
  return raw && getImgUrl ? getImgUrl(raw) : (raw || '');
}
function teamsFor(row, teams) {
  const topicId = row && (row.topicId || (row.kind === 'topic' ? row.id : null));
  return (teams || []).filter((team) =>
    (topicId && String(team.topicId) === String(topicId)) ||
    (row && row.kind === 'activity' && String(team.activityId) === String(row.id)));
}

function buildTeamMarkers(teams) {
  return (teams || []).filter((team) => validPoint(team) && Number(team.teamId) > 0).map((team) => ({
    id: Number(team.teamId) * 10 + TEAM_MARKER_TAG,
    latitude: Number(team.latitude),
    longitude: Number(team.longitude),
    width: 14,
    height: 14,
    anchor: { x: 0.5, y: 0.5 },
    zIndex: 12,
    iconPath: FALLBACK_TEAM_ICON,
  }));
}

function imageList(row) {
  const source = row && (row.postImages || row.imageUrls || row.images);
  return Array.isArray(source) ? source.filter(Boolean) : [];
}

function buildPostMarkers(rows, getImgUrl) {
  return (rows || []).filter((row) => validPoint(row) && imageList(row).length).map((row) => ({
    id: Number(row.id) * 10 + POST_MARKER_TAG,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    width: 22,
    height: 22,
    anchor: { x: 0.5, y: 0.5 },
    zIndex: 13,
    iconPath: coverOf({ picUrl: imageList(row)[0] }, getImgUrl),
  }));
}

function activityView(row, teams, getImgUrl) {
  const linkedTeams = teamsFor(row, teams);
  const participantFaces = linkedTeams.reduce((all, team) => all.concat(Array.isArray(team.memberAvatars) ? team.memberAvatars : []), []).filter(Boolean).slice(0, 3);
  const participantCount = Number(row && row.participantCount) || linkedTeams.reduce((sum, team) => sum + (Number(team.joinedCount) || 0), 0);
  const dynamicImages = imageList(row).slice(0, 3).map((url) => getImgUrl ? getImgUrl(url) : url);
  const registered = !!(row && (row.registered === true || row.viewerRegistered === true || row.viewerHasTicket === true))
    || linkedTeams.some((team) => team && team.viewerHasTicket === true);
  const free = row && Number(row.productType) === 2;
  const distance = H.fmtKm(row && row.distance);
  return {
    key: (row && row.kind) + '-' + (row && row.id),
    id: row && row.id,
    kind: row && row.kind,
    topicId: row && (row.topicId || (row.kind === 'topic' ? row.id : null)),
    title: String((row && row.name) || '未命名活动'),
    cover: coverOf(row, getImgUrl),
    tag: free ? '自由探索' : '城市定向',
    meta: [distance && ('距你 ' + distance), linkedTeams.length && (linkedTeams.length + ' 支队伍招募')].filter(Boolean).join(' · '),
    address: String((row && row.addressName) || ''),
    participantFaces,
    participantCount,
    dynamicImages,
    registered,
    teams: linkedTeams.slice(0, 2).map((team) => ({
      teamId: team.teamId,
      title: team.title || '玩家队伍',
      members: (Number(team.joinedCount) || 0) + '/' + (Number(team.maxMembers) || 0) + ' 人',
      canApply: team.viewerHasTicket === true,
      faces: (Array.isArray(team.memberAvatars) ? team.memberAvatars : []).filter(Boolean).slice(0, 3),
    })),
  };
}

function build(items, teams, layers, getImgUrl) {
  const visible = layers || { activities: true, teams: true, posts: true };
  const rows = (items || []).filter((row) => validPoint(row) && (row.kind === 'activity' || row.kind === 'topic'));
  const teamRows = (teams || []).filter((row) => validPoint(row) && Number(row.teamId) > 0);
  const cards = rows.map((row) => activityView(row, teamRows, getImgUrl));
  const markers = [];
  if (visible.activities !== false) markers.push.apply(markers, H.buildHangoutMarkers(rows, {}, {}));
  if (visible.teams !== false) markers.push.apply(markers, buildTeamMarkers(teamRows));
  if (visible.posts !== false) markers.push.apply(markers, buildPostMarkers(rows, getImgUrl));
  return {
    markers,
    cards,
    searchPlaces: cards.map((card) => {
      const row = rows.find((item) => String(item.id) === String(card.id) && item.kind === card.kind);
      return { id: card.kind + '-' + card.id, name: card.title, address: card.address, kind: Number(row.productType) === 2 ? 'free' : 'city', lat: Number(row.latitude), lng: Number(row.longitude) };
    }),
  };
}

function parseMarker(markerId) {
  const n = Number(markerId);
  const tag = n % 10;
  const id = Math.floor(n / 10);
  if (!(id > 0)) return null;
  if (tag === TEAM_MARKER_TAG) return { kind: 'team', id };
  if (tag === POST_MARKER_TAG) return { kind: 'post', id };
  return H.parseMarkerId(markerId);
}

function hasLayerError(errors) { return !!(errors && (errors.activities || errors.teams)); }

module.exports = { build, activityView, parseMarker, hasLayerError };
