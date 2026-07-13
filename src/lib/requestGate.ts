/** Monotonic token gate for dropping stale asynchronous results. */
export class LatestRequestGate {
  private generation = 0;

  next(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  cancel(): void {
    this.generation += 1;
  }
}
