import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wifi, Info } from 'lucide-react';

const PROVEDORAS = [
  { value: 'autotrac', label: 'Autotrac' },
  { value: 'sascar', label: 'Sascar' },
  { value: 'omnilink', label: 'Omnilink' },
  { value: 'onixsat', label: 'Onixsat' },
];

function FieldGroup({ label, value, onChange, placeholder, type = 'text', hint }) {
  return (
    <div>
      <Label className="text-xs text-slate-600">{label}</Label>
      <Input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm font-mono"
      />
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function AutotracFields({ config, onChange }) {
  return (
    <div className="space-y-3">
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 text-xs text-blue-700">
        <Info className="w-3.5 h-3.5 inline mr-1" />
        Base URL padrão: <code className="font-mono">https://aapi3.autotrac-online.com.br/aticapi</code>
      </div>
      <FieldGroup
        label="Usuário"
        value={config.autotrac_usuario}
        onChange={v => onChange('autotrac_usuario', v)}
        placeholder="usuario@empresa.com"
      />
      <FieldGroup
        label="Senha"
        value={config.autotrac_senha}
        onChange={v => onChange('autotrac_senha', v)}
        placeholder="••••••••"
        type="password"
      />
      <FieldGroup
        label="Ocp-Apim-Subscription-Key (API Key)"
        value={config.autotrac_api_key}
        onChange={v => onChange('autotrac_api_key', v)}
        placeholder="Chave de assinatura da API"
        hint="Disponível no portal do desenvolvedor Autotrac"
      />
      <FieldGroup
        label="Número/Code da Conta"
        value={config.autotrac_account}
        onChange={v => onChange('autotrac_account', v)}
        placeholder="Ex: 268532276"
        hint="Será resolvido automaticamente via /v1/accounts"
      />
      <FieldGroup
        label="Base URL (opcional)"
        value={config.autotrac_base_url}
        onChange={v => onChange('autotrac_base_url', v)}
        placeholder="https://aapi3.autotrac-online.com.br/aticapi"
        hint="Deixe em branco para usar a URL padrão"
      />
    </div>
  );
}

function PlaceholderFields({ provedora }) {
  return (
    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
      <Wifi className="w-8 h-8 text-slate-300 mx-auto mb-2" />
      <p className="text-sm text-slate-500 font-medium">Integração {provedora} em breve</p>
      <p className="text-xs text-slate-400 mt-1">
        Os campos de configuração para {provedora} serão adicionados em breve.
      </p>
    </div>
  );
}

export default function ApiRastreamentoForm({ provedora, onChangeProvedora, apiConfig, onChangeApiConfig }) {
  const handleConfigChange = (field, value) => {
    onChangeApiConfig({ ...apiConfig, [field]: value });
  };

  return (
    <div className="space-y-4 pt-2 border-t border-slate-200">
      <div className="flex items-center gap-2">
        <Wifi className="w-4 h-4 text-emerald-600" />
        <span className="text-sm font-semibold text-slate-700">Configuração de Rastreamento</span>
      </div>

      <div>
        <Label className="text-xs text-slate-600">Provedora de Rastreamento</Label>
        <Select value={provedora || '__none__'} onValueChange={v => onChangeProvedora(v === '__none__' ? null : v)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Selecionar provedora..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— Nenhuma —</SelectItem>
            {PROVEDORAS.map(p => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {provedora === 'autotrac' && (
        <AutotracFields config={apiConfig || {}} onChange={handleConfigChange} />
      )}
      {provedora === 'sascar' && <PlaceholderFields provedora="Sascar" />}
      {provedora === 'omnilink' && <PlaceholderFields provedora="Omnilink" />}
      {provedora === 'onixsat' && <PlaceholderFields provedora="Onixsat" />}
    </div>
  );
}