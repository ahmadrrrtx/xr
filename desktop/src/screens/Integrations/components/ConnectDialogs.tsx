/*
 * Connect dialogs.
 *   ApiKeyDialog       fields come from the connector's configFields (registry). A
 *                      password field is masked with a show/hide toggle. Nothing is
 *                      stored until the engine's probe succeeds, and a failed probe
 *                      keeps the form values and shows the error inline.
 *   AppCredentialsDialog  BYOK: the user's OAuth app client ID and secret. They go
 *                      to the engine vault and are never echoed back.
 */
import { useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ConnectorConfigField, IntegrationView } from '@/integrations/api';
import { useIntegrationsStore } from '@/stores/integrationsStore';

export function ApiKeyDialog({ view }: { view: IntegrationView }) {
  const submit = useIntegrationsStore((s) => s.submitApiKey);
  const busy = useIntegrationsStore((s) => s.busyId === view.id);
  const error = useIntegrationsStore((s) => s.cardError[view.id]);
  const close = useIntegrationsStore((s) => s.closeDialog);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.configFields.map((f) => [f.key, f.defaultValue ?? ''])),
  );
  const [touched, setTouched] = useState(false);
  const formId = useId();

  const missing = view.configFields.filter((f) => f.required && !values[f.key]?.trim());

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing.length > 0) return;
    void submit(view.id, values).then((ok) => {
      if (ok) setValues({});
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>Connect {view.name}</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>
            Enter the details for your {view.name} account. XR checks them with {view.name} before saving anything.
            The key is stored in XR's encrypted local vault.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="ix-form">
          {view.configFields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
              showRequired={touched && field.required && !values[field.key]?.trim()}
              id={`${formId}-${field.key}`}
            />
          ))}
          {error && <p role="alert" className="ix-form__error">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Checking…' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  showRequired,
  id,
}: {
  field: ConnectorConfigField;
  value: string;
  onChange(v: string): void;
  showRequired: boolean;
  id: string;
}) {
  const [reveal, setReveal] = useState(false);
  const isSecret = field.type === 'password';
  const errorId = `${id}-err`;
  return (
    <div className="ix-field">
      <label htmlFor={id} className="ix-field__label">
        {field.label}
        {field.required ? <span aria-hidden="true"> *</span> : <span className="ix-field__opt"> (optional)</span>}
      </label>
      {field.description && <p className="ix-field__hint" id={`${id}-hint`}>{field.description}</p>}
      <div className="ix-field__control">
        <Input
          id={id}
          type={isSecret && !reveal ? 'password' : field.type === 'url' ? 'url' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-required={field.required || undefined}
          aria-invalid={showRequired || undefined}
          aria-describedby={[field.description ? `${id}-hint` : '', showRequired ? errorId : ''].filter(Boolean).join(' ') || undefined}
        />
        {isSecret && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setReveal((r) => !r)}
            aria-pressed={reveal}
            aria-label={reveal ? `Hide ${field.label}` : `Show ${field.label}`}
          >
            {reveal ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          </Button>
        )}
      </div>
      {showRequired && <p id={errorId} className="ix-field__error">{field.label} is required.</p>}
    </div>
  );
}

export function AppCredentialsDialog({ view }: { view: IntegrationView }) {
  const save = useIntegrationsStore((s) => s.saveAppCredentialsAndConnect);
  const error = useIntegrationsStore((s) => s.cardError[view.id]);
  const close = useIntegrationsStore((s) => s.closeDialog);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true);
    const ok = await save(view.id, clientId, clientSecret);
    setBusy(false);
    if (ok) {
      setClientId('');
      setClientSecret('');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>Set up {view.name}</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>
            {view.name} needs an OAuth app so XR can ask for access. Create one in your {view.name} developer settings, then paste the client ID and secret here.
            Set the callback URL to <code>xr://oauth/callback</code>. The secret is stored in XR's encrypted local vault.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="ix-form">
          <div className="ix-field">
            <label htmlFor={`${formId}-id`} className="ix-field__label">Client ID <span aria-hidden="true">*</span></label>
            <Input id={`${formId}-id`} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} aria-required="true" />
          </div>
          <div className="ix-field">
            <label htmlFor={`${formId}-secret`} className="ix-field__label">Client secret <span aria-hidden="true">*</span></label>
            <div className="ix-field__control">
              <Input id={`${formId}-secret`} type={reveal ? 'text' : 'password'} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" spellCheck={false} aria-required="true" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setReveal((r) => !r)} aria-pressed={reveal} aria-label={reveal ? 'Hide client secret' : 'Show client secret'}>
                {reveal ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              </Button>
            </div>
          </div>
          {error && <p role="alert" className="ix-form__error">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !clientId.trim() || !clientSecret.trim()} aria-busy={busy || undefined}>
              {busy ? 'Saving…' : 'Save and connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
