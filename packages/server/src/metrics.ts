/** Tiny Prometheus text exposition: counters, summaries (sum and count) and gauges. No dependency. */
export class Metrics {
  private counters = new Map<string, number>();
  private sums = new Map<string, { sum: number; count: number }>();

  private static key(name: string, labels: Record<string, string>): string {
    const l = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v.replace(/[\\"\n]/g, "_")}"`)
      .join(",");
    return l ? `${name}{${l}}` : name;
  }

  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    const k = Metrics.key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  observe(name: string, seconds: number, labels: Record<string, string> = {}): void {
    const k = Metrics.key(name, labels);
    const s = this.sums.get(k) ?? { sum: 0, count: 0 };
    s.sum += seconds;
    s.count += 1;
    this.sums.set(k, s);
  }

  render(gauges: Record<string, number> = {}): string {
    const lines: string[] = [];
    for (const [k, v] of [...this.counters].sort()) lines.push(`${k} ${v}`);
    for (const [k, s] of [...this.sums].sort()) {
      const i = k.indexOf("{");
      const [n, l] = i === -1 ? [k, ""] : [k.slice(0, i), k.slice(i)];
      lines.push(`${n}_sum${l} ${s.sum}`, `${n}_count${l} ${s.count}`);
    }
    for (const [k, v] of Object.entries(gauges)) lines.push(`${k} ${v}`);
    return lines.join("\n") + "\n";
  }
}
