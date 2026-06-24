import { createAgentSession, AuthStorage, SessionManager, ModelRegistry } from '@earendil-works/pi-coding-agent';

async function main() {
    process.env.OPENAI_API_KEY = 'test_key';
    const authStorage = AuthStorage.create();
    
    // We need to resolve a model, say "openai/gpt-4o"
    // Let's see if ModelRegistry.create() works
    const registry = ModelRegistry.create(authStorage);
    
    const available = registry.getEnabledModels();
    console.log("Enabled Models:", available);
    
    const model = registry.find('openai', 'gpt-4o');
    console.log("Resolved model:", model?.id);
    
}

main().catch(console.error);
