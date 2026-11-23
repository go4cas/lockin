// A clock tests can move by hand.
export class FakeClock {
  constructor(public t = Date.UTC(2026, 10, 20, 19, 0, 0)) {}
  now(): number { return this.t; }
  advance(ms: number): void { this.t += ms; }
}
