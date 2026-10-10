import { AIConfig, Model } from '../types';

const getProxyFamilyKey = (m: Model): 'gpt' | 'claude' | 'gemini' | 'other' => {
  const vendor = (m.vendor ?? '').trim().toLowerCase();
  if (vendor === 'openai') return 'gpt';
  if (vendor === 'anthropic') return 'claude';
  if (vendor === 'google') return 'gemini';

  const id = (m.id ?? '').trim().toLowerCase();
  if (id.startsWith('gpt') || id.includes('/gpt') || id.includes('gpt-')) return 'gpt';
  if (id.includes('claude')) return 'claude';
  if (id.includes('gemini')) return 'gemini';
  return 'other';
};

export const filterModels = (models: Model[], config: AIConfig): Model[] => {
  const isOpenRouter = config.provider === 'openrouter';

  return models.filter((m) => {
    if (isOpenRouter) {
      const openRouterFilters = config.filtersByProvider.openrouter;
      if (openRouterFilters.freeOnly && !m.isFree) return false;
      if (openRouterFilters.testedOnly && !m.id.startsWith('openai/') && !m.id.startsWith('anthropic/') && !m.id.startsWith('google/') && !m.id.startsWith('mistralai/') && !m.id.startsWith('meta-llama/')) return false; // Basic "tested" check logic often implies reliable providers
      if (openRouterFilters.minContextWindow > 0 && (m.contextLength ?? 0) < openRouterFilters.minContextWindow) return false;
      // Vendor filter is applied separately in UI usually, but we can include it here if we want a full filter
      if (openRouterFilters.vendor && m.vendor !== openRouterFilters.vendor) return false;
    } else if (config.provider === 'opencode-go') {
      const vendor = config.filtersByProvider['opencode-go'].vendor;
      if (vendor && m.vendor !== vendor) return false;
    } else {
      const proxyFilters = config.provider === 'agent'
        ? config.filtersByProvider.agent
        : config.filtersByProvider.cliproxy;
      const family = (proxyFilters.family ?? '').trim().toLowerCase();
      if (family) {
        if (getProxyFamilyKey(m) !== family) return false;
      }
    }
    return true;
  });
};
