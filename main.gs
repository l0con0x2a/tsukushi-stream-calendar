const CONFIG = {
  channelId: 'UCHccxX2p_9DB_HPnXSb2omw',
  calendarName: '春日部つくし 配信予定',
  daysAhead: 30,
  eventLookbackDays: 30,
  fallbackDurationMinutes: 60,
  reminderMinutes: 15,
  excludedPrefix: '【情報】',
};

function main() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log('別の同期処理が実行中のためスキップ');
    return;
  }

  try {
    const calendarId = setup();
    sync(calendarId);
  } finally {
    lock.releaseLock();
  }
}

function setup() {
  const calendars = CalendarApp.getOwnedCalendarsByName(
    CONFIG.calendarName
  );

  if (calendars.length > 1) {
    throw new Error(`同名カレンダーが複数あります: ${CONFIG.calendarName}`);
  }

  const calendar = calendars[0] ??
    CalendarApp.createCalendar(CONFIG.calendarName, {
      timeZone: 'Asia/Tokyo',
    });

  console.log(
    `カレンダー: ${calendars.length ? '既存のためスキップ' : '作成完了'}`
  );

  ensureSyncTrigger();

  return calendar.getId();
}

function ensureSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'main');

  if (triggers.length > 1) {
    console.warn(`main のトリガーが${triggers.length}件あります`);
  }

  if (triggers.length === 0) {
    ScriptApp.newTrigger('main')
      .timeBased()
      .everyHours(1)
      .create();
  }

  console.log(
    `トリガー: ${triggers.length ? '既存のためスキップ' : '作成完了'}`
  );
}

function getUploadsPlaylistId() {
  const channel = YouTube.Channels.list('contentDetails', {
    id: CONFIG.channelId,
  }).items?.[0];

  const playlistId = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) {
    throw new Error(`YouTubeチャンネルが見つかりません: ${CONFIG.channelId}`);
  }

  return playlistId;
}

function getTrackedEvents(calendarId, since) {
  const events = new Map();
  let pageToken;

  do {
    const response = Calendar.Events.list(calendarId, {
      timeMin: since,
      showDeleted: false,
      maxResults: 2500,
      ...(pageToken ? { pageToken } : {}),
    });

    for (const event of response.items ?? []) {
      const id = event.extendedProperties?.private?.youtubeVideoId;
      if (!id) continue;

      if (events.has(id)) {
        throw new Error(`重複イベント: ${id}`);
      }

      events.set(id, event);
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return events;
}

function getVideos(playlistId, events) {
  // 新規枠の探索は最新50件に限定し、それ以前の動画は登録済みのものだけ追跡する。
  const playlist = YouTube.PlaylistItems.list('contentDetails', {
    playlistId,
    maxResults: 50,
  });

  const ids = [...new Set([
    ...(playlist.items ?? [])
      .map(item => item.contentDetails?.videoId)
      .filter(Boolean),
    // 一覧から外れた動画も、配信時刻やタイトルの変更を反映するため取得する。
    ...events.keys(),
  ])];

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const response = YouTube.Videos.list(
      'snippet,liveStreamingDetails',
      { id: ids.slice(i, i + 50).join(',') }
    );

    videos.push(...(response.items ?? []));
  }

  return videos;
}

function sync(calendarId) {
  const playlistId = getUploadsPlaylistId();
  const now = Date.now();
  const until = now + CONFIG.daysAhead * 86400000;
  const since = new Date(
    now - CONFIG.eventLookbackDays * 86400000
  ).toISOString();
  const events = getTrackedEvents(calendarId, since);
  const videos = getVideos(playlistId, events);

  const counts = {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
  };

  for (const video of videos) {
    const action = syncVideo(calendarId, video, events.get(video.id), now, until);
    if (action) counts[action]++;
  }

  console.log(`同期完了: ${JSON.stringify(counts)}`);
}

function findEventByVideoId(calendarId, videoId) {
  const matches = Calendar.Events.list(calendarId, {
    privateExtendedProperty: `youtubeVideoId=${videoId}`,
    showDeleted: false,
    maxResults: 2,
  }).items ?? [];

  if (matches.length > 1) {
    throw new Error(`重複イベント: ${videoId}`);
  }

  return matches[0];
}

function syncVideo(calendarId, video, event, now, until) {
  const { snippet, liveStreamingDetails: details } = video;

  const scheduledStart = Date.parse(details?.scheduledStartTime ?? '');
  const actualStart = Date.parse(details?.actualStartTime ?? '');
  const actualEnd = Date.parse(details?.actualEndTime ?? '');
  const upcoming = snippet.liveBroadcastContent === 'upcoming';

  const excluded = snippet.title.startsWith(CONFIG.excludedPrefix);
  const eligibleForCreation = upcoming &&
    Number.isFinite(scheduledStart) &&
    scheduledStart >= now &&
    scheduledStart <= until;

  // 情報枠は予約日時に関係なく、追跡期間外のイベントも探して削除する。
  // 新規登録する場合も、過去のイベントを確認して二重登録を防ぐ。
  if (!event && (excluded || eligibleForCreation)) {
    event = findEventByVideoId(calendarId, video.id);
  }

  if (excluded) {
    if (event) {
      Calendar.Events.remove(calendarId, event.id);
      console.log(`削除: ${snippet.title}`);
      return 'deleted';
    }
    return;
  }

  // 登録済みの枠は、配信開始後や予定日時の変更後も更新対象にする。
  if (!event && !eligibleForCreation) return;

  if (!details) return;

  const start = Number.isFinite(actualStart)
    ? actualStart
    : scheduledStart;

  if (!Number.isFinite(start)) return;

  const scheduledEnd = Date.parse(details.scheduledEndTime ?? '');
  const end = Number.isFinite(actualEnd) && actualEnd > start
    ? actualEnd
    : Number.isFinite(scheduledEnd) && scheduledEnd > start
      ? scheduledEnd
      : start + CONFIG.fallbackDurationMinutes * 60000;

  const data = {
    summary: snippet.title,
    description: `https://www.youtube.com/watch?v=${video.id}`,
    start: { dateTime: new Date(start).toISOString() },
    end: { dateTime: new Date(end).toISOString() },
  };

  if (!event) {
    Calendar.Events.insert({
      ...data,
      extendedProperties: {
        private: { youtubeVideoId: video.id },
      },
      reminders: {
        useDefault: false,
        overrides: [{
          method: 'popup',
          minutes: CONFIG.reminderMinutes,
        }],
      },
    }, calendarId);

    console.log(`作成: ${snippet.title}`);
    return 'created';
  } else if (
    event.summary !== data.summary ||
    event.description !== data.description ||
    Date.parse(event.start?.dateTime ?? '') !== start ||
    Date.parse(event.end?.dateTime ?? '') !== end
  ) {
    Calendar.Events.patch(data, calendarId, event.id);
    console.log(`更新: ${snippet.title}`);
    return 'updated';
  } else {
    return 'unchanged';
  }
}
