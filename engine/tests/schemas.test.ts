import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeConfigSchema } from '../schemas.ts';

const base = { version: 1, name: 'fixture', description: 'fixture' };

test('delivery policy fixes Pi to one worker and human merge', () => {
    const valid = BridgeConfigSchema.safeParse({
        ...base,
        delivery: {
            mode: 'pull-request', executor: 'pi-sdk', localModelsOnly: true,
            requireHumanMerge: true, maxWorkers: 1, leaseMinutes: 10,
            unattended: { enabled: false, maxRuntimeMinutes: 30, maxToolCalls: 150, maxChangedFiles: 25, maxChangedLines: 2000 },
        },
    });
    assert.equal(valid.success, true);
    assert.equal(BridgeConfigSchema.safeParse({ ...base, delivery: { maxWorkers: 2 } }).success, false);
    assert.equal(BridgeConfigSchema.safeParse({ ...base, delivery: { requireHumanMerge: false } }).success, false);
});
