import { Channel, Processor } from '..';

describe('Processor', () => {
  describe('Processor.from()', () => {
    it('From Channel', async () => {
      const chan = new Channel();
      const proc = Processor.from(chan);

      let count = 0;
      const done = proc.forEach((val) => {
        expect(val).toBe(count);
        count++;
      });

      chan.push(0);
      chan.push(1);
      chan.push(2);
      chan.close();

      await done;
      expect(count).toBe(3);
    });

    it('From Array', async () => {
      const proc = Processor.from([0, 1, 2]);

      let count = 0;
      const done = proc.forEach((val) => {
        expect(val).toBe(count);
        count++;
      });

      await done;
      expect(count).toBe(3);
    });

    it('From Iterable', async () => {
      const proc = Processor.from(new Set([0, 1, 2]));

      let count = 0;
      const done = proc.forEach((val) => {
        expect(val).toBe(count);
        count++;
      });

      await done;
      expect(count).toBe(3);
    });

    it('From Array-like', async () => {
      const proc = Processor.from({ length: 3, 0: 0, 1: 1, 2: 2 });

      let count = 0;
      const done = proc.forEach((val) => {
        expect(val).toBe(count);
        count++;
      });

      await done;
      expect(count).toBe(3);
    });
  });

  describe('Processor.of()', () => {
    it('Empty', async () => {
      const proc = Processor.of();

      await proc.forEach(() => fail('Expected no values'));
    });

    it('Non-empty', async () => {
      const proc = Processor.of(0, 1, 2);

      let count = 0;
      const done = proc.forEach((val) => {
        expect(val).toBe(count);
        count++;
      });

      await done;
      expect(count).toBe(3);
    });

    it('Promises', async () => {
      const proc = Processor.of(0, 1, Promise.reject(0), Promise.resolve(2), Promise.reject(1));

      let count = 0;
      let failures = 0;
      const done = proc.forEach(
        (val) => {
          expect(val).toBe(count);
          count++;
        },
        (err) => {
          expect(err).toBe(failures);
          failures++;
        }
      );

      await done;
      expect(count).toBe(3);
      expect(failures).toBe(2);
    });
  });

  describe('Processor.transform()', () => {
    it('Can grab multiple values from a Channel', async () => {
      const result = await Processor.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
        .transform(async (input, output) => {
          await output.push((await input) * (await input));
        })
        .toArray();

      expect(result).toEqual([2, 12, 30, 56, 90]);
    });

    it('Can output multiple values per input', async () => {
      const result = await Processor.of(1, 2, 3, 4)
        .transform(async (input, output) => {
          const n = await input;
          for (let i = 0; i < n; i++) {
            await output.push(n);
          }
        })
        .toArray();

      expect(result).toEqual([1, 2, 2, 3, 3, 3, 4, 4, 4, 4]);
    });

    it('Can be run concurrently', async () => {
      let count = 0;
      let maxCount = 0;
      const result = await Processor.of(1, 2, 3, 4, 5, 6)
        .transform<number>(async (input, output) => {
          count++;
          expect(count).toBeLessThanOrEqual(3);
          maxCount = Math.max(count, maxCount);

          const n = await input;
          for (let i = 0; i < n; i++) {
            await output.push(n);
          }

          count--;
        }, 3)
        .toArray();

      const plainRes = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6];
      expect(result).not.toEqual(plainRes);
      expect(new Set(result)).toEqual(new Set(plainRes));
      expect(count).toBe(0);
      expect(maxCount).toBe(3);
    });

    it('Errors are propagated', async () => {
      const result = await Processor.of(1, 2, 3, 4)
        .transform<number>(async (input, output) => {
          const n = await input;
          if (n % 2) {
            throw n;
          }
          await output.push(n);
        })
        .map(
          (value) => {
            expect(value % 2).toBe(0);
            return value;
          },
          (error) => {
            expect(error % 2).toBe(1);
            return String(error);
          }
        )
        .toArray();

      expect(result).toEqual(['1', 2, '3', 4]);
    });

    it('Can buffer values in the output channel', async () => {
      const proc = Processor.of(1, 2, 3, 4, 5).transform(
        async (input, output) => {
          const n = await input;
          await output.push(n);
          await output.push(n);
        },
        1,
        10
      );

      const chan = proc.channel;

      expect(chan.bufferCapacity).toBe(10);
      await proc.channel.onClose;
      expect(chan.bufferSize).toBe(10);
      expect(await proc.toArray()).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    });

    it('Fails if an invalid concurrency is passed', () => {
      expect(() => {
        Processor.of().transform(() => Promise.resolve(), -1);
      }).toThrow(new RangeError('Value for concurrency must be positive and finite'));
      expect(() => {
        Processor.of().transform(() => Promise.resolve(), Infinity);
      }).toThrow(new RangeError('Value for concurrency must be positive and finite'));
    });
  });

  describe('Processor.map()', () => {
    it('Can map values and errors', async () => {
      const result = await Processor.of(1, 2, 3, Promise.reject(4), Promise.reject(5), Promise.reject(6))
        .map(
          (value) => {
            switch (value) {
              case 1:
                return value;
              case 2:
                throw value;
              case 3:
                return Promise.reject(value);
            }
          },
          (error) => {
            switch (error) {
              case 4:
                return error;
              case 5:
                throw error;
              case 6:
                return Promise.reject(error);
            }
          }
        )
        .map(
          (value) => value,
          (error) => error + 10
        )
        .toArray();

      expect(result).toEqual([1, 12, 13, 4, 15, 16]);
    });
  });

  describe('Processor.filter()', () => {
    it('Can filter values and errors', async () => {
      const result = await Processor.of(
        1,
        2,
        3,
        4,
        Promise.reject(5),
        Promise.reject(6),
        Promise.reject(7),
        Promise.reject(8)
      )
        .filter(
          (value) => {
            switch (value) {
              case 1:
                return true;
              case 2:
                return Promise.resolve(true);
              case 4:
                return Promise.reject(value);
              default:
                return false;
            }
          },
          (error) => {
            switch (error) {
              case 5:
                return true;
              case 6:
                return Promise.resolve(true);
              case 8:
                return Promise.reject(error + 10);
              default:
                return false;
            }
          }
        )
        .map(
          (value) => value,
          (error) => error + 10
        )
        .toArray();

      expect(result).toEqual([1, 2, 14, 15, 16, 28]);
    });
  });

  describe('Processor.forEach()', () => {
    it('Stops receiving values on an uncaught error', async () => {
      const proc = Processor.of(
        new Promise((res) => setTimeout(res, 100)),
        new Promise((res) => setTimeout(res, 100)),
        new Promise((_, rej) => setTimeout(() => rej('fail'), 150)),
        new Promise((res) => setTimeout(res, 200)),
        3,
        4
      );

      await expect(
        proc.forEach(
          () => {
            // nothing needed here
          },
          null,
          2
        )
      ).rejects.toBe('fail');

      // forEach should stop early, leaving the last 2 values
      expect(proc.channel.bufferSize).toBe(2);
      await expect(proc.toArray()).resolves.toEqual([3, 4]);
    });
  });

  describe('Processor.toArray()', () => {
    it('Fails if there are any errors on the Channel', async () => {
      await expect(Processor.of(1, 2, 3, Promise.reject(4)).toArray()).rejects.toBe(4);
    });
  });
});
