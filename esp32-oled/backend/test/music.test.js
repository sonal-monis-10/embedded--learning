import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Device } from '../entity/device.js';
import { recordedMessages } from '../mqtt/publisher.js';
import { isLatinScript, parseLrc, toOledText } from '../utils/lrc.js';
import { useFetch } from '../utils/lrclib.js';
import { syncPlaying } from '../utils/music.js';
import { release } from '../utils/turns.js';
import { startApp } from './support/app.js';

// A fake LRCLIB: two songs, one with Latin lyrics, one in Devanagari.
const SONGS = {
  101: {
    id: 101,
    trackName: 'Tum Hi Ho',
    artistName: 'Arijit Singh',
    albumName: 'Aashiqui 2',
    duration: 262,
    instrumental: false,
    syncedLyrics: '[00:10.00] Hum tere bin\n[00:14.50] ab reh nahi sakte\n[00:20.00]\n',
  },
  102: {
    id: 102,
    trackName: 'Tum Hi Ho',
    artistName: 'Arijit Singh',
    duration: 262,
    instrumental: false,
    syncedLyrics: '[00:10.00] हम तेरे बिन\n[00:14.50] अब रह नहीं सकते\n',
  },
  103: {
    id: 103,
    trackName: 'Plain Song',
    artistName: 'Someone',
    duration: 100,
    instrumental: false,
    syncedLyrics: null,
    plainLyrics: 'no timing here',
  },
};

let lrclibCalls = [];
let lrclibDown = false;
function fakeLrclib(url) {
  lrclibCalls.push(url);
  if (lrclibDown) return Promise.resolve(new Response('down', { status: 503 }));
  const { pathname } = new URL(url);
  if (pathname === '/api/search') {
    return Promise.resolve(Response.json([SONGS[103], SONGS[102], SONGS[101]]));
  }
  const song = SONGS[pathname.split('/').at(-1)];
  return Promise.resolve(song ? Response.json(song) : new Response('{}', { status: 404 }));
}

let t;
before(async () => {
  t = await startApp();
  useFetch(fakeLrclib);
});
after(() => t.stop());
beforeEach(() => {
  lrclibCalls = [];
  lrclibDown = false;
});

async function playing(name = 'Sonal') {
  const { deviceId, code } = await t.freeDevice();
  const { token } = await t.pair(code, { name });
  return { deviceId, phone: t.asPhone(token) };
}

const lastMessage = (topic) => recordedMessages().findLast((m) => m.topic === topic);

describe('LRC parsing', () => {
  it('reads timestamps, repeats, offsets and gaps', () => {
    const lines = parseLrc(
      '[offset:+500]\n[ar:Someone]\n[00:12.34] First\n[00:05.5][01:00.000]Chorus\n[00:20.00]\n',
    );
    assert.deepEqual(lines, [
      { t: 5000, text: 'Chorus' },
      { t: 11840, text: 'First' },
      { t: 19500, text: '' },
      { t: 59500, text: 'Chorus' },
    ]);
  });

  it('turns text into what the OLED font can draw', () => {
    assert.equal(toOledText('  Café “déjà” vu — it’s…  '), 'Cafe "deja" vu - it\'s...');
    assert.equal(toOledText('emoji 🎵 gone'), 'emoji gone');
  });

  it('tells Latin lyrics from other scripts', () => {
    assert.equal(isLatinScript('Hum tere bin ab reh nahi sakte'), true);
    assert.equal(isLatinScript('हम तेरे बिन'), false);
    assert.equal(isLatinScript(''), false);
  });
});

describe('search', () => {
  it('needs a session', async () => {
    await t.http.get('/api/music/search?q=tum').expect(401);
  });

  it('lists readable lyrics first, and caches the search', async () => {
    const { phone } = await playing();
    const res = await phone.get('/api/music/search?q=Tum%20Hi%20Ho').expect(200);
    assert.deepEqual(
      res.body.results.map((r) => [r.id, r.lyrics]),
      [
        [101, 'synced'],
        [102, 'other-script'],
        [103, 'none'],
      ],
    );
    assert.equal(res.body.results[0].durationMs, 262_000);

    await phone.get('/api/music/search?q=tum%20hi%20ho').expect(200);
    assert.equal(lrclibCalls.length, 1);
  });

  it('says so when LRCLIB is down', async () => {
    const { phone } = await playing();
    lrclibDown = true;
    const res = await phone.get('/api/music/search?q=never%20cached').expect(502);
    assert.equal(res.body.error.code, 'lyrics_unavailable');
  });

  it('rejects an empty search', async () => {
    const { phone } = await playing();
    await phone.get('/api/music/search?q=a').expect(400);
  });
});

describe('choosing a song', () => {
  it('puts it on the device, paused at 0:00, in music mode', async () => {
    const { deviceId, phone } = await playing();
    const res = await phone.put(`/api/devices/${deviceId}/music`).send({ songId: 101 }).expect(200);

    const { music } = res.body;
    assert.equal(music.song.title, 'Tum Hi Ho');
    assert.deepEqual(music.song.lines[0], [10000, 'Hum tere bin']);
    assert.equal(music.lyrics, true);
    assert.equal(music.playing, false);
    assert.equal(music.positionMs, 0);

    assert.deepEqual(lastMessage(`d/${deviceId}/mode`).payload, { mode: 'music' });
    assert.deepEqual(lastMessage(`d/${deviceId}/music/track`).payload, {
      id: 101,
      title: 'Tum Hi Ho',
      artist: 'Arijit Singh',
      durationMs: 262_000,
      lyrics: true,
      hasLyrics: true,
    });
    assert.equal(
      lastMessage(`d/${deviceId}/music/lines`).payload,
      '#101\n10000\tHum tere bin\n14500\tab reh nahi sakte\n20000\t\n',
    );
    const sync = lastMessage(`d/${deviceId}/music/sync`);
    assert.equal(sync.retain, true);
    assert.equal(sync.payload.pos, 0);
    assert.equal(sync.payload.playing, false);

    const device = await Device.findById(deviceId);
    assert.equal(device.mode, 'music');
  });

  it('keeps lyrics off for songs the OLED cannot show', async () => {
    const { deviceId, phone } = await playing();
    const res = await phone
      .put(`/api/devices/${deviceId}/music`)
      .send({ songId: 102, lyrics: true })
      .expect(200);
    assert.equal(res.body.music.lyrics, false);
    assert.deepEqual(res.body.music.song.lines, []);

    const toggle = await phone
      .post(`/api/devices/${deviceId}/music/control`)
      .send({ op: 'lyrics', value: true })
      .expect(200);
    assert.equal(toggle.body.music.lyrics, false);
  });

  it('serves a chosen song from the cache when LRCLIB is down', async () => {
    const { deviceId, phone } = await playing();
    await phone.put(`/api/devices/${deviceId}/music`).send({ songId: 101 }).expect(200);
    lrclibDown = true;
    await phone.put(`/api/devices/${deviceId}/music`).send({ songId: 101 }).expect(200);
  });

  it('answers 404 for a song LRCLIB does not have', async () => {
    const { deviceId, phone } = await playing();
    const res = await phone.put(`/api/devices/${deviceId}/music`).send({ songId: 999 });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'song_not_found');
  });

  it("another phone can't touch the music", async () => {
    const { deviceId } = await playing('Owner');
    const stranger = (await playing('Stranger')).phone;
    await stranger.put(`/api/devices/${deviceId}/music`).send({ songId: 101 }).expect(404);
    await stranger.get(`/api/devices/${deviceId}/music`).expect(404);
  });
});

describe('the song clock', () => {
  async function withSong() {
    const ctx = await playing();
    await ctx.phone.put(`/api/devices/${ctx.deviceId}/music`).send({ songId: 101 }).expect(200);
    const send = (body) =>
      ctx.phone.post(`/api/devices/${ctx.deviceId}/music/control`).send(body).expect(200);
    return { ...ctx, send };
  }

  it('needs a song first', async () => {
    const { deviceId, phone } = await playing();
    const res = await phone
      .post(`/api/devices/${deviceId}/music/control`)
      .send({ op: 'play' })
      .expect(409);
    assert.equal(res.body.error.code, 'no_song');
  });

  it('seeks, nudges, plays and pauses', async () => {
    const { deviceId, send } = await withSong();

    let res = await send({ op: 'seek', value: 30_000 });
    assert.equal(res.body.music.positionMs, 30_000);

    res = await send({ op: 'nudge', value: -250 });
    assert.equal(res.body.music.positionMs, 29_750);

    res = await send({ op: 'play' });
    assert.equal(res.body.music.playing, true);
    assert.equal(lastMessage(`d/${deviceId}/music/sync`).payload.playing, true);

    // Pretend 2 s passed while playing.
    await Device.updateOne(
      { _id: deviceId },
      { $set: { 'music.updatedAt': new Date(Date.now() - 2000) } },
    );
    res = await send({ op: 'pause' });
    assert.equal(res.body.music.playing, false);
    assert.ok(Math.abs(res.body.music.positionMs - 31_750) < 200);
  });

  it('never goes past the ends of the song', async () => {
    const { send } = await withSong();
    assert.equal((await send({ op: 'nudge', value: -5000 })).body.music.positionMs, 0);
    assert.equal((await send({ op: 'seek', value: 999_999 })).body.music.positionMs, 262_000);
  });

  it('turns lyrics off and back on', async () => {
    const { deviceId, send } = await withSong();
    await send({ op: 'lyrics', value: false });
    assert.equal(lastMessage(`d/${deviceId}/music/track`).payload.lyrics, false);
    await send({ op: 'lyrics', value: true });
    assert.equal(lastMessage(`d/${deviceId}/music/track`).payload.lyrics, true);
  });

  it('re-syncs playing songs, pauses at the end, and keeps the turn alive', async () => {
    const { deviceId, send } = await withSong();
    await send({ op: 'play' });
    const longAgo = new Date(Date.now() - 20 * 60_000);
    await Device.updateOne({ _id: deviceId }, { $set: { 'controller.lastActiveAt': longAgo } });

    await syncPlaying();
    let device = await Device.findById(deviceId);
    assert.equal(device.music.playing, true);
    assert.ok(device.controller.lastActiveAt > longAgo);

    // 5 minutes later the 4:22 song is over.
    await syncPlaying(Date.now() + 5 * 60_000);
    device = await Device.findById(deviceId);
    assert.equal(device.music.playing, false);
    assert.equal(device.music.positionMs, 262_000);
  });
});

describe('ending the music', () => {
  it('Stop clears the song and the retained messages', async () => {
    const { deviceId, phone } = await playing();
    await phone.put(`/api/devices/${deviceId}/music`).send({ songId: 101 }).expect(200);
    await phone.delete(`/api/devices/${deviceId}/music`).expect(204);

    const res = await phone.get(`/api/devices/${deviceId}/music`).expect(200);
    assert.equal(res.body.music, null);
    for (const leaf of ['track', 'lines', 'sync']) {
      assert.equal(lastMessage(`d/${deviceId}/music/${leaf}`).payload, null);
    }
  });

  it('the next visitor starts without the last one’s song', async () => {
    const { deviceId, phone } = await playing();
    await phone.put(`/api/devices/${deviceId}/music`).send({ songId: 101 }).expect(200);
    await release(deviceId, 'left');

    const device = await Device.findById(deviceId);
    assert.equal(device.music, null);
    assert.equal(lastMessage(`d/${deviceId}/music/track`).payload, null);
  });
});
