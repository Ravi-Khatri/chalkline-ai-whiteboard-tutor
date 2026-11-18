import { describe, expect, it } from 'vitest';
import { namespaceIds, parseDrawLine, parseStep } from '../shared/dsl.ts';

describe('parseDrawLine', () => {
  it('parses quoted, bare and numeric values', () => {
    expect(parseDrawLine('box id=air text="Air molecules" x=50 y=24 w=22 h=8 color=blue')).toEqual({
      op: 'box',
      id: 'air',
      text: 'Air molecules',
      x: 50,
      y: 24,
      w: 22,
      h: 8,
      color: 'blue',
    });
  });

  it('tolerates spaces around = and single quotes', () => {
    expect(parseDrawLine("arrow from = sun to=air text='white light'")).toMatchObject({ op: 'arrow', from: 'sun', to: 'air', text: 'white light' });
  });
});

describe('parseStep', () => {
  it('groups DRAW lines under the preceding SAY line and ignores chatter', () => {
    const beats = parseStep(`Sure! Here is the step:
SAY: First sentence.
DRAW: text id=t text="Title" x=50 y=5
- SAY: Second sentence.
DRAW: circle id=c text="C" x=10 y=10 r=5
DRAW: highlight target=t
That's all.`);
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({ say: 'First sentence.', actions: [{ op: 'text', id: 't' }] });
    expect(beats[1].actions.map((a) => a.op)).toEqual(['circle', 'highlight']);
  });

  it('attaches drawings that come before the first sentence to it', () => {
    const beats = parseStep('DRAW: text id=t text="T" x=1 y=1\nSAY: Hello there.');
    expect(beats[0].actions).toHaveLength(1);
  });
});

describe('namespaceIds', () => {
  it('prefixes ids and every reference consistently', () => {
    const [b] = namespaceIds([{ say: 's', actions: [{ op: 'arrow', from: 'a', to: 'b' }, { op: 'highlight', target: 'a' }, { op: 'box', id: 'a' }] }], 's2');
    expect(b.actions).toMatchObject([{ from: 's2-a', to: 's2-b' }, { target: 's2-a' }, { id: 's2-a' }]);
  });
});
