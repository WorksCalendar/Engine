import { describe, it, expect } from 'vitest';
import { positionToResourceTrackingMeta } from '../positionToResourceMeta.js';
import type { AssetTrackerPosition } from '../geoTypes.js';

function makePos(patch: Partial<AssetTrackerPosition> = {}): AssetTrackerPosition {
  return {
    id:        'asset-1',
    lat:       40.7128,
    lon:       -74.006,
    altitude:  1000,
    heading:   90,
    speed:     120,
    timestamp: 1000,
    source:    'adsb',
    label:     'N12345',
    ...patch,
  };
}

describe('positionToResourceTrackingMeta', () => {
  it('returns tracking meta for a valid position', () => {
    const pos = makePos();
    const meta = positionToResourceTrackingMeta(pos, 1010, 60);
    expect(meta).not.toBeNull();
    expect(meta!.location.lat).toBe(40.7128);
    expect(meta!.location.lon).toBe(-74.006);
    expect(meta!.altitudeFt).toBe(1000);
    expect(meta!.heading).toBe(90);
    expect(meta!.speedKt).toBe(120);
    expect(meta!.timestamp).toBe(1000);
    expect(meta!.source).toBe('adsb');
    expect(meta!.label).toBe('N12345');
  });

  it('marks position as NOT stale when within threshold', () => {
    const pos = makePos({ timestamp: 1000 });
    const meta = positionToResourceTrackingMeta(pos, 1010, 60);
    expect(meta!.stale).toBe(false); // 10s elapsed, 60s threshold
  });

  it('marks position as stale when beyond threshold', () => {
    const pos = makePos({ timestamp: 1000 });
    const meta = positionToResourceTrackingMeta(pos, 1100, 60);
    expect(meta!.stale).toBe(true); // 100s elapsed, 60s threshold
  });

  it('returns null for invalid latitude (out of range)', () => {
    expect(positionToResourceTrackingMeta(makePos({ lat: 91 }), 1000, 60)).toBeNull();
    expect(positionToResourceTrackingMeta(makePos({ lat: -91 }), 1000, 60)).toBeNull();
  });

  it('returns null for invalid longitude (out of range)', () => {
    expect(positionToResourceTrackingMeta(makePos({ lon: 181 }), 1000, 60)).toBeNull();
    expect(positionToResourceTrackingMeta(makePos({ lon: -181 }), 1000, 60)).toBeNull();
  });

  it('returns null for non-finite lat', () => {
    expect(positionToResourceTrackingMeta(makePos({ lat: NaN }), 1000, 60)).toBeNull();
    expect(positionToResourceTrackingMeta(makePos({ lat: Infinity }), 1000, 60)).toBeNull();
  });

  it('returns null for non-finite timestamp', () => {
    expect(positionToResourceTrackingMeta(makePos({ timestamp: NaN }), 1000, 60)).toBeNull();
  });

  it('passes through null nullable fields', () => {
    const pos = makePos({ altitude: null, heading: null, speed: null });
    const meta = positionToResourceTrackingMeta(pos, 1000, 60);
    expect(meta!.altitudeFt).toBeNull();
    expect(meta!.heading).toBeNull();
    expect(meta!.speedKt).toBeNull();
  });
});
