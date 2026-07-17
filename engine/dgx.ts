import type { FactorySettings, LLMProvider, PiSettings } from './types.ts';

export interface DgxPreflightResult {
    provider: string;
    model: string;
    endpointHost: string;
    latencyMs: number;
}

export class DgxPreflightError extends Error {
    constructor(message: string) {
        super(`DGX_PREFLIGHT_FAILED: ${message}`);
        this.name = 'DgxPreflightError';
    }
}

export function resolvePiDgxProvider(
    settings: FactorySettings,
    piConfig?: PiSettings,
    storyModel?: string,
): { provider: LLMProvider; model: string } {
    const localProviders = settings.providers.filter(provider => provider.enabled && provider.kind === 'openai-compat' && provider.baseUrl && isLocalModelEndpoint(provider.baseUrl));
    const selector = storyModel || piConfig?.model || '';
    const explicit = localProviders.find(provider => selector.startsWith(`${provider.id}/`));
    if (explicit) return { provider: explicit, model: selector.slice(explicit.id.length + 1) };
    if (piConfig?.providerId) {
        const configured = localProviders.find(provider => provider.id === piConfig.providerId);
        if (!configured) throw new DgxPreflightError(`configured Pi provider "${piConfig.providerId}" is not an enabled local endpoint.`);
        return { provider: configured, model: selector || configured.defaultModel || configured.models[0]?.id || '' };
    }
    if (selector) {
        const matching = localProviders.find(provider => provider.models.some(model => model.id === selector));
        if (matching) return { provider: matching, model: selector };
    }
    const provider = localProviders[0];
    if (!provider) throw new DgxPreflightError('no enabled local OpenAI-compatible provider is configured for Pi.');
    return { provider, model: provider.defaultModel || provider.models[0]?.id || selector };
}

export function isLocalModelEndpoint(baseUrl: string): boolean {
    let hostname: string;
    try { hostname = new URL(baseUrl).hostname.toLowerCase(); } catch { return false; }
    if (hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local')) return true;
    if (!hostname.includes('.') && /^[a-z0-9-]+$/i.test(hostname)) return true;
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)
        || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
        || parts[0] === 127;
}

export function validateDgxConfig(provider: LLMProvider | null, requestedModel?: string): { baseUrl: string; model: string } {
    if (!provider || !provider.enabled) throw new DgxPreflightError('no enabled Pi model provider is configured.');
    if (provider.kind !== 'openai-compat') throw new DgxPreflightError('Pi must use an OpenAI-compatible local provider.');
    if (!provider.baseUrl) throw new DgxPreflightError('the local provider has no baseUrl.');
    if (!isLocalModelEndpoint(provider.baseUrl)) throw new DgxPreflightError(`refusing non-local model endpoint ${new URL(provider.baseUrl).host}.`);
    const model = requestedModel || provider.defaultModel || provider.models?.[0]?.id;
    if (!model) throw new DgxPreflightError('no DGX model is selected.');
    return { baseUrl: provider.baseUrl, model };
}

export async function preflightDgx(
    provider: LLMProvider | null,
    requestedModel?: string,
    fetchImpl: typeof fetch = fetch,
): Promise<DgxPreflightResult> {
    const { baseUrl, model } = validateDgxConfig(provider, requestedModel);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const started = Date.now();
    try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/models`, {
            headers: provider?.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
            signal: controller.signal,
        });
        if (!response.ok) throw new DgxPreflightError(`model discovery returned HTTP ${response.status}.`);
        const payload = await response.json() as { data?: Array<{ id?: string }> };
        const available = (payload.data || []).map(item => item.id).filter(Boolean);
        if (available.length > 0 && !available.includes(model)) {
            throw new DgxPreflightError(`model "${model}" is not available on the DGX endpoint.`);
        }
        return { provider: provider!.id, model, endpointHost: new URL(baseUrl).host, latencyMs: Date.now() - started };
    } catch (error) {
        if (error instanceof DgxPreflightError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new DgxPreflightError(`cannot reach the local model endpoint: ${message}`);
    } finally {
        clearTimeout(timeout);
    }
}

export function isDgxInfrastructureFailure(output: string): boolean {
    return /DGX_PREFLIGHT_FAILED|SDK_(?:WORKER_)?STALL|SDK_TURN_ERROR|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|502[\s\S]{0,80}upstream|model .*not (?:found|available)|rate.?limit|\b429\b/i.test(output);
}
