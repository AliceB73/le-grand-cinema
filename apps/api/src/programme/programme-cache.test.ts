import { describe, expect, it, jest } from '@jest/globals';
import { createProgrammeCache } from './programme-cache.js';

describe('createProgrammeCache', () => {
  it('serves the cached value until the ttl expires, then reloads', async () => {
    let clock = 1_000;
    const load = jest
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const get = createProgrammeCache(load, 10_000, () => clock);

    await expect(get()).resolves.toBe('first');
    clock += 9_999;
    await expect(get()).resolves.toBe('first');
    expect(load).toHaveBeenCalledTimes(1);

    clock += 1;
    await expect(get()).resolves.toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent calls', async () => {
    const load = jest.fn<() => Promise<string>>().mockResolvedValue('shared');
    const get = createProgrammeCache(load, 10_000, () => 0);

    await expect(Promise.all([get(), get(), get()])).resolves.toEqual([
      'shared',
      'shared',
      'shared',
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const load = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce('recovered');
    const get = createProgrammeCache(load, 10_000, () => 0);

    await expect(get()).rejects.toThrow('database unavailable');
    await expect(get()).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
