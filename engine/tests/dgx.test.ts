import test from 'node:test';
import assert from 'node:assert/strict';
import { isDgxInfrastructureFailure, isLocalModelEndpoint, preflightDgx, resolvePiDgxProvider, validateDgxConfig } from '../dgx.ts';
import type { LLMProvider } from '../types.ts';

const provider: LLMProvider = {
    id: 'dgx',
    name: 'DGX Spark',
    kind: 'openai-compat',
    enabled: true,
    baseUrl: 'http://100.77.38.96:8080/v1',
    models: [{ id: 'local-model', name: 'Local Model' }],
    defaultModel: 'local-model',
};

test('accepts private, loopback, tailnet, and single-label local endpoints', () => {
    for (const url of ['http://127.0.0.1:8000/v1', 'http://10.0.0.2/v1', 'http://192.168.1.2/v1', 'http://100.77.38.96:8080/v1', 'http://dgx-spark:8080/v1']) {
        assert.equal(isLocalModelEndpoint(url), true, url);
    }
    assert.equal(isLocalModelEndpoint('https://api.openai.com/v1'), false);
    assert.equal(isLocalModelEndpoint('https://openrouter.ai/api/v1'), false);
});

test('rejects cloud fallback and missing model configuration', () => {
    assert.throws(() => validateDgxConfig({ ...provider, baseUrl: 'https://api.openai.com/v1' }), /refusing non-local/);
    assert.throws(() => validateDgxConfig({ ...provider, defaultModel: undefined, models: [] }), /no DGX model/);
});

test('keeps TPM and Pi provider selection separate', () => {
    const cloud = { ...provider, id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'cloud-model' };
    const settings = { providers: [provider, cloud], activeProvider: cloud.id, buildModel: 'cloud-model' };
    const automatic = resolvePiDgxProvider(settings);
    assert.equal(automatic.provider.id, 'dgx');
    assert.equal(automatic.model, 'local-model');
    const projectOverride = resolvePiDgxProvider(settings, { providerId: 'dgx', model: 'local-model', thinkingLevel: 'low', enableSkills: true, enableExtensions: true });
    assert.equal(projectOverride.provider.id, 'dgx');
});

test('preflight pins the requested model without exposing the API key', async () => {
    const result = await preflightDgx(provider, 'local-model', async (url, init) => {
        assert.equal(String(url), 'http://100.77.38.96:8080/v1/models');
        assert.equal(init?.headers && 'Authorization' in init.headers, false);
        return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 });
    });
    assert.equal(result.model, 'local-model');
    assert.equal(result.endpointHost, '100.77.38.96:8080');
});

test('classifies DGX and SDK transport failures as infrastructure failures', () => {
    assert.equal(isDgxInfrastructureFailure('DGX_PREFLIGHT_FAILED: endpoint unavailable'), true);
    assert.equal(isDgxInfrastructureFailure('SDK_WORKER_STALL: no events'), true);
    assert.equal(isDgxInfrastructureFailure('Candidate delivery failed lint validation'), false);
});
