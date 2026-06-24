import { NextResponse } from 'next/server';
import { ModelRegistry, AuthStorage } from '@earendil-works/pi-coding-agent';

export async function GET() {
    try {
        const authStorage = AuthStorage.inMemory();
        // create() initializes the registry with built-in models and loads custom models from ~/.pi/agent/models.json
        const registry = ModelRegistry.create(authStorage);
        
        // Ensure models are fully loaded
        registry.refresh();

        const allModels = registry.getAll();
        
        // Format the models for the UI dropdown
        const models = allModels.map((m: any) => ({
            id: `${m.provider}/${m.id}`,
            provider: m.provider,
            displayName: m.displayName || m.name || m.id,
            capabilities: m.capabilities
        }));

        return NextResponse.json({ success: true, models });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
