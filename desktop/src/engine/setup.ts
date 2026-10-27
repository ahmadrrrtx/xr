/** Pure onboarding transaction. The secret goes only to the engine, and
 * completion/persistent settings cannot happen after a rejected key save. */
export type SetupChoice =
  | { source: 'local'; model: string; label: string }
  | { source: 'cloud'; providerId?: string; model?: string; apiKey?: string }
  | { source: 'skip' };
export interface SetupPorts {
  saveSecret(input: {
    providerId: string;
    apiKey: string;
    model?: string;
    setDefault: boolean;
    probe: boolean;
  }): Promise<{ ok: boolean; model: string | null }>;
  setDefault(providerId: string, model: string): Promise<void>;
}
export async function prepareModelSetup(
  choice: SetupChoice,
  ports: SetupPorts
): Promise<{ selection: string | null; durableChoice: SetupChoice }> {
  if (choice.source === 'local') {
    await ports.setDefault('ollama', choice.model);
    return {
      selection: `ollama/${choice.model}`,
      durableChoice: {
        source: 'local',
        model: choice.model,
        label: choice.label,
      },
    };
  }
  if (choice.source === 'cloud') {
    const providerId = choice.providerId;
    if (!choice.apiKey?.trim())
      return {
        selection: null,
        durableChoice: {
          source: 'cloud',
          ...(providerId ? { providerId } : {}),
        },
      };
    if (!providerId)
      throw new Error(
        'Choose the provider that issued this key. No key was saved.'
      );
    const result = await ports.saveSecret({
      providerId,
      apiKey: choice.apiKey.trim(),
      model: choice.model,
      setDefault: true,
      probe: false,
    });
    if (!result.ok || !result.model)
      throw new Error(
        'The engine did not confirm a stored key and target. Retry or continue as guest.'
      );
    return {
      selection: `${providerId}/${result.model}`,
      durableChoice: { source: 'cloud', providerId, model: result.model },
    };
  }
  return { selection: null, durableChoice: { source: 'skip' } };
}
