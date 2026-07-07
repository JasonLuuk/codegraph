/**
 * Cangjie end-to-end resolution tests.
 *
 * Pins the ArkUI-in-Cangjie state→build() re-render bridge: a `@Component
 * class` method that
 * ASSIGNS a `@State`-decorated field gets a synthesized calls edge to the
 * class's `build()`; a method that only READS state — or writes a
 * non-reactive field — must get nothing (the assignment gate is the precision
 * line).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

describe('Cangjie ArkUI state → build() bridge', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('links assigning methods to build(), gated on reactive fields and component annotation', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cangjie-'));
    fs.writeFileSync(
      path.join(tmpDir, 'counter_view.cj'),
      'package demo\n' +
        '\n' +
        '@Entry\n' +
        '@Component\n' +
        'public class CounterView {\n' +
        '    @State\n' +
        '    var count: Int64 = 0\n' +
        '\n' +
        '    var plain: Int64 = 0\n' +
        '\n' +
        '    func increment(): Unit {\n' +
        '        this.count = this.count + 1\n' +
        '    }\n' +
        '\n' +
        '    func readOnly(): Int64 {\n' +
        '        return this.count\n' +
        '    }\n' +
        '\n' +
        '    func touchPlain(): Unit {\n' +
        '        this.plain = 5\n' +
        '    }\n' +
        '\n' +
        '    func build(): Unit {\n' +
        '        Column { Text("x") }\n' +
        '    }\n' +
        '}\n' +
        '\n' +
        '// NOT a component: same shape, no @Component annotation — no bridge.\n' +
        'public class PlainBuilderHolder {\n' +
        '    @State\n' +
        '    var value: Int64 = 0\n' +
        '    func poke(): Unit { this.value = 1 }\n' +
        '    func build(): Unit {}\n' +
        '}\n'
    );

    const cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const methods = cg.getNodesByKind('method');
    const build = methods.find((n) => n.qualifiedName === 'CounterView::build');
    const increment = methods.find((n) => n.name === 'increment');
    const readOnly = methods.find((n) => n.name === 'readOnly');
    const touchPlain = methods.find((n) => n.name === 'touchPlain');
    expect(build && increment && readOnly && touchPlain).toBeTruthy();

    const callers = cg
      .getIncomingEdges(build!.id)
      .filter((e) => e.kind === 'calls');
    const callerIds = callers.map((e) => e.source);
    expect(callerIds).toContain(increment!.id);
    expect(callerIds).not.toContain(readOnly!.id);
    expect(callerIds).not.toContain(touchPlain!.id);

    // The bridged edge is labeled heuristic ArkUI state dispatch.
    const bridged = callers.find((e) => e.source === increment!.id);
    expect(bridged?.provenance).toBe('heuristic');
    expect((bridged?.metadata as Record<string, unknown>)?.synthesizedBy).toBe('arkui-state');

    // The annotation-less decoy class gets no bridge at all.
    const decoyBuild = methods.find((n) => n.qualifiedName === 'PlainBuilderHolder::build');
    expect(decoyBuild).toBeDefined();
    expect(
      cg.getIncomingEdges(decoyBuild!.id).filter((e) => e.kind === 'calls')
    ).toHaveLength(0);
  });
});
